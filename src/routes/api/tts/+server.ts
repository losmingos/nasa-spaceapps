// POST /api/tts — { text } → audio/mpeg from ElevenLabs, cached by sha1(text + voice + model) (spec §4.4).
// Upstream failure → 502 JSON; the client then falls back to speechSynthesis.

import { ELEVENLABS_API_KEY, ELEVENLABS_MODEL_ID, ELEVENLABS_VOICE_ID } from '$app/env/private';
import { isRecord, jsonError, missingEnv, readJson } from '#lib/server/http.js';
import { ElevenLabsError, elevenLabsTts } from '#lib/server/jarvis/elevenlabs.js';
import { getCachedTts, putCachedTts, ttsCacheKey } from '#lib/server/jarvis/tts-cache.js';
import type { RequestHandler } from './$types';

// The site is prerendered (src/routes/+layout.ts); API routes must stay dynamic in the Worker.
export const prerender = false;

const MAX_TEXT = 600;

function audioResponse(audio: Uint8Array, cache: 'hit' | 'miss'): Response {
	return new Response(audio as Uint8Array<ArrayBuffer>, {
		headers: {
			'content-type': 'audio/mpeg',
			'content-length': String(audio.byteLength),
			'cache-control': 'no-store',
			'x-tts-cache': cache
		}
	});
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	if (!isRecord(body) || typeof body.text !== 'string' || !body.text.trim()) {
		return jsonError(400, 'Body must be JSON { text: string }.');
	}
	const text = body.text.replace(/\s+/g, ' ').trim();
	if (text.length > MAX_TEXT) return jsonError(400, `\`text\` must be at most ${MAX_TEXT} characters.`);

	const voiceId = ELEVENLABS_VOICE_ID;
	const modelId = ELEVENLABS_MODEL_ID;

	// A cache hit needs no key, so cached lines keep working even if the key is later removed.
	if (voiceId) {
		const cached = await getCachedTts(ttsCacheKey(text, voiceId, modelId));
		if (cached) return audioResponse(cached, 'hit');
	}

	if (!ELEVENLABS_API_KEY) return missingEnv('ELEVENLABS_API_KEY');
	if (!voiceId) return missingEnv('ELEVENLABS_VOICE_ID');

	try {
		const audio = await elevenLabsTts({ apiKey: ELEVENLABS_API_KEY, voiceId, modelId, text });
		await putCachedTts(ttsCacheKey(text, voiceId, modelId), audio);
		return audioResponse(audio, 'miss');
	} catch (err) {
		if (err instanceof ElevenLabsError) {
			console.error(`[tts] ElevenLabs ${err.status}:`, err.message);
			return jsonError(502, `ElevenLabs TTS failed (${err.status}).`);
		}
		console.error('[tts] request failed:', err);
		return jsonError(502, 'ElevenLabs TTS request failed.');
	}
};
