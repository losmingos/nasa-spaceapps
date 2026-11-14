// TTS cache keyed by sha1(text + voice + model): in memory and on disk under .cache/tts/ (D24).
// Repeated takes replay cached audio without spending ElevenLabs credits.

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CACHE_DIR = path.resolve('.cache', 'tts');
const MAX_MEMORY_ENTRIES = 200;
const memory = new Map<string, Uint8Array>();

export function ttsCacheKey(text: string, voiceId: string, modelId: string): string {
	return createHash('sha1').update(`${text}\u0000${voiceId}\u0000${modelId}`).digest('hex');
}

function remember(key: string, audio: Uint8Array) {
	memory.delete(key);
	memory.set(key, audio);
	while (memory.size > MAX_MEMORY_ENTRIES) {
		const oldest = memory.keys().next().value;
		if (oldest === undefined) break;
		memory.delete(oldest);
	}
}

export async function getCachedTts(key: string): Promise<Uint8Array | null> {
	const hit = memory.get(key);
	if (hit) return hit;
	try {
		const buf = await readFile(path.join(CACHE_DIR, `${key}.mp3`));
		if (buf.byteLength === 0) return null;
		const audio = new Uint8Array(buf);
		remember(key, audio);
		return audio;
	} catch {
		return null;
	}
}

export async function putCachedTts(key: string, audio: Uint8Array): Promise<void> {
	remember(key, audio);
	try {
		await mkdir(CACHE_DIR, { recursive: true });
		const file = path.join(CACHE_DIR, `${key}.mp3`);
		const tmp = `${file}.${process.pid}.tmp`;
		await writeFile(tmp, audio);
		await rename(tmp, file);
	} catch (err) {
		console.warn('[tts] could not write disk cache:', err);
	}
}
