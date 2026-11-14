// POST /api/stt — raw audio body (NOT multipart, see spec §4.1) → Groq Whisper → SttResponse.

import { GROQ_API_KEY } from '$app/env/private';
import type { SttResponse } from '#lib/jarvis/types.js';
import { jsonError, missingEnv } from '#lib/server/http.js';
import {
	STT_MAX_BYTES,
	STT_MIN_BYTES,
	SttUpstreamError,
	audioFileInfo,
	filterTranscript,
	transcribe
} from '#lib/server/jarvis/stt.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	if (!GROQ_API_KEY) return missingEnv('GROQ_API_KEY');

	const file = audioFileInfo(request.headers.get('content-type'));
	if (!file) {
		return jsonError(415, 'Send raw audio bytes with Content-Type audio/webm, audio/webm;codecs=opus or audio/mp4.');
	}

	const declared = Number(request.headers.get('content-length') ?? '0');
	if (declared > STT_MAX_BYTES) return jsonError(413, 'Audio is larger than 10 MB.');

	const audio = await request.arrayBuffer();
	if (audio.byteLength > STT_MAX_BYTES) return jsonError(413, 'Audio is larger than 10 MB.');
	if (audio.byteLength < STT_MIN_BYTES) return jsonError(400, 'Audio is smaller than 1 KB.');

	try {
		const raw = await transcribe(GROQ_API_KEY, audio, file);
		const text = filterTranscript(raw);
		console.log(`[stt] ${audio.byteLength} B → ${JSON.stringify(raw)}${text ? '' : ' (filtered)'}`);
		return Response.json({ text } satisfies SttResponse, { headers: { 'cache-control': 'no-store' } });
	} catch (err) {
		if (err instanceof SttUpstreamError) {
			console.error(`[stt] Groq ${err.status}:`, err.message);
			return jsonError(502, `Groq transcription failed (${err.status}).`);
		}
		console.error('[stt] request failed:', err);
		return jsonError(502, 'Groq transcription request failed.');
	}
};
