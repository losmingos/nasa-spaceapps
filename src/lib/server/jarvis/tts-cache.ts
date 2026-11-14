// TTS cache keyed by sha1(text + voice + model) (D24). Repeated takes replay cached audio without spending
// ElevenLabs credits.
// - Always: in-memory LRU (per process / Worker isolate).
// - On Cloudflare Workers: the Cache API (caches.default), shared across requests in a data centre.
// - In `vite dev`: on disk under .cache/tts/ (survives dev-server restarts).

import { createHash } from 'node:crypto';
import { dev } from '$app/env';

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

/** Cloudflare's default cache (absent in Node). */
function edgeCache(): Cache | null {
	const storage = (globalThis as { caches?: { default?: Cache } }).caches;
	return storage?.default ?? null;
}
const edgeKey = (key: string) => `https://jarvis-tts.cache/${key}.mp3`;

async function diskPaths(key: string) {
	const path = await import('node:path');
	const dir = path.resolve('.cache', 'tts');
	return { dir, file: path.join(dir, `${key}.mp3`) };
}

export async function getCachedTts(key: string): Promise<Uint8Array | null> {
	const hit = memory.get(key);
	if (hit) return hit;
	try {
		let audio: Uint8Array | null = null;
		const cache = edgeCache();
		if (cache) {
			const res = await cache.match(edgeKey(key));
			if (res) audio = new Uint8Array(await res.arrayBuffer());
		} else if (dev) {
			const { readFile } = await import('node:fs/promises');
			audio = new Uint8Array(await readFile((await diskPaths(key)).file));
		}
		if (!audio || audio.byteLength === 0) return null;
		remember(key, audio);
		return audio;
	} catch {
		return null;
	}
}

export async function putCachedTts(key: string, audio: Uint8Array): Promise<void> {
	remember(key, audio);
	try {
		const cache = edgeCache();
		if (cache) {
			const body = audio.slice().buffer;
			await cache.put(
				edgeKey(key),
				new Response(body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=604800' } })
			);
		} else if (dev) {
			const { mkdir, rename, writeFile } = await import('node:fs/promises');
			const { dir, file } = await diskPaths(key);
			await mkdir(dir, { recursive: true });
			const tmp = `${file}.${Date.now()}.tmp`;
			await writeFile(tmp, audio);
			await rename(tmp, file);
		}
	} catch (err) {
		console.warn('[tts] could not write cache:', err);
	}
}
