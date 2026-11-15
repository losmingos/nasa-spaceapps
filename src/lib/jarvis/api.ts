// Fetch wrappers for the Jarvis endpoints (spec §4). Browser-only at call time; safe to import during SSR.
import type { ChatRequest, ChatResponse, CueId, CueState, SttResponse } from './types.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const CUE_TIMEOUT_MS = 3_000;

/** `?k=<token>` from the page URL (tunnel mode, D15). */
function demoToken(): string | null {
	if (typeof location === 'undefined') return null;
	try {
		return new URLSearchParams(location.search).get('k');
	} catch {
		return null;
	}
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
	const h: Record<string, string> = { ...extra };
	const token = demoToken();
	if (token) h['x-demo-token'] = token;
	return h;
}

/** fetch with a timeout, optionally also aborted by an external signal (turn cancellation). */
async function request(
	url: string,
	init: RequestInit,
	opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const onAbort = () => controller.abort();
	if (opts.signal) {
		if (opts.signal.aborted) controller.abort();
		else opts.signal.addEventListener('abort', onAbort, { once: true });
	}
	try {
		const res = await fetch(url, { ...init, signal: controller.signal });
		if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} → HTTP ${res.status}`);
		return res;
	} finally {
		clearTimeout(timeout);
		opts.signal?.removeEventListener('abort', onAbort);
	}
}

/** POST /api/stt — raw audio bytes as the body (NOT FormData: SvelteKit CSRF). */
export async function stt(blob: Blob, signal?: AbortSignal): Promise<SttResponse> {
	const res = await request(
		'/api/stt',
		{ method: 'POST', headers: headers({ 'Content-Type': blob.type || 'audio/webm' }), body: blob },
		{ signal }
	);
	const data = (await res.json()) as Partial<SttResponse>;
	return { text: typeof data.text === 'string' ? data.text : '' };
}

/** POST /api/chat — JSON { history, text, telemetry } → { reply, fallback? }. */
export async function chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
	const res = await request(
		'/api/chat',
		{ method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(req) },
		{ signal }
	);
	const data = (await res.json()) as Partial<ChatResponse>;
	// Keep the visor actions Sara requested (map zoom, infrared): dropping them made Sara say
	// "zooming out" while nothing happened. The server already validates their shape.
	const actions = Array.isArray(data.actions)
		? data.actions.filter((a) => a && (a.type === 'map_zoom' || a.type === 'infrared' || a.type === 'danger_layer' || a.type === 'flashlight'))
		: [];
	return {
		reply: typeof data.reply === 'string' ? data.reply : '',
		...(data.fallback ? { fallback: data.fallback } : {}),
		...(actions.length ? { actions } : {})
	};
}

/** POST /api/tts — JSON { text } → audio/mpeg bytes. */
export async function tts(text: string, signal?: AbortSignal): Promise<ArrayBuffer> {
	const res = await request(
		'/api/tts',
		{ method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ text }) },
		{ signal }
	);
	return res.arrayBuffer();
}

/** GET /api/cue → latest operator cue (D28). */
export async function getCue(signal?: AbortSignal): Promise<CueState> {
	const res = await request(
		'/api/cue',
		{ method: 'GET', headers: headers(), cache: 'no-store' },
		{ signal, timeoutMs: CUE_TIMEOUT_MS }
	);
	return (await res.json()) as CueState;
}

/** POST /api/cue { id } → { seq }. */
export async function postCue(id: CueId, signal?: AbortSignal): Promise<CueState> {
	const res = await request(
		'/api/cue',
		{ method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id }) },
		{ signal, timeoutMs: CUE_TIMEOUT_MS }
	);
	const data = (await res.json()) as Partial<CueState>;
	return { seq: typeof data.seq === 'number' ? data.seq : 0, id: data.id ?? id };
}
