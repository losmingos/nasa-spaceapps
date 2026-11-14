// /api/stt logic: forward raw push-to-talk audio to Groq Whisper and filter hallucinations (spec §4.2, D22).

export const STT_MODEL = 'whisper-large-v3-turbo';
export const STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const STT_MIN_BYTES = 1024;
export const STT_MAX_BYTES = 10 * 1024 * 1024;
const STT_PROMPT =
	'Jezero, Perseverance, MEDA, habitat, airlock, sample, dust storm, oxygen, suit power, visibility, beacon, Jarvis';

export class SttUpstreamError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** Map the request Content-Type to the upload filename/type Groq expects (it sniffs by extension). */
export function audioFileInfo(contentType: string | null): { filename: string; type: string } | null {
	const ct = (contentType ?? '').toLowerCase().split(';')[0].trim();
	switch (ct) {
		case 'audio/webm':
		case 'video/webm':
			return { filename: 'ptt.webm', type: 'audio/webm' };
		case 'audio/mp4':
		case 'audio/m4a':
		case 'audio/x-m4a':
		case 'video/mp4':
			return { filename: 'ptt.mp4', type: 'audio/mp4' };
		case 'audio/ogg':
			return { filename: 'ptt.ogg', type: 'audio/ogg' };
		case 'audio/wav':
		case 'audio/x-wav':
		case 'audio/wave':
			return { filename: 'ptt.wav', type: 'audio/wav' };
		case 'audio/mpeg':
			return { filename: 'ptt.mp3', type: 'audio/mpeg' };
		default:
			return null;
	}
}

/** Phrases Whisper tends to produce from silence/noise. Compared after normalization. */
const HALLUCINATIONS = new Set(
	[
		'you',
		'bye',
		'bye bye',
		'thank you',
		'thank you very much',
		'thanks',
		'thank you for watching',
		'thanks for watching',
		'thank you so much for watching',
		'thank you for listening',
		'please subscribe',
		'subscribe',
		'like and subscribe',
		'please like and subscribe',
		'see you next time',
		'see you in the next video',
		'subtitles by the amaraorg community',
		'subtitles by',
		'transcribed by',
		'okay',
		'ok',
		'so',
		'hmm',
		'uh',
		'um'
	].map((s) => normalize(s))
);

function normalize(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9\s']/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Returns '' for empty / single-word / known-hallucination transcripts (client then plays E01). */
export function filterTranscript(raw: string): string {
	const text = raw.replace(/\s+/g, ' ').trim();
	const norm = normalize(text);
	if (!norm) return '';
	if (norm.split(' ').length < 2) return '';
	if (HALLUCINATIONS.has(norm)) return '';
	if (/^(subtitles|captions|transcribed|translated) by\b/.test(norm)) return '';
	if (/amara ?org/.test(norm)) return '';
	return text;
}

export async function transcribe(apiKey: string, audio: ArrayBuffer, file: { filename: string; type: string }, language: 'en' | 'es' = 'en'): Promise<string> {
	const form = new FormData();
	form.append('file', new Blob([audio], { type: file.type }), file.filename);
	form.append('model', STT_MODEL);
	form.append('language', language);
	form.append('response_format', 'json');
	form.append('temperature', '0');
	form.append('prompt', language === 'es' ? 'JARVIS, rover marciano, estación Bravo, batería A, batería B, modo refugio.' : STT_PROMPT);

	const res = await fetch(STT_URL, {
		method: 'POST',
		headers: { authorization: `Bearer ${apiKey}` },
		body: form,
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) {
		const detail = (await res.text().catch(() => '')).slice(0, 500);
		throw new SttUpstreamError(res.status, detail || res.statusText);
	}
	const data = (await res.json()) as { text?: unknown };
	return typeof data.text === 'string' ? data.text : '';
}
