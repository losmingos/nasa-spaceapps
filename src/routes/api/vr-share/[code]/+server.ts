import { CODE_PATTERN } from '#lib/visor/share-protocol.js';
import { isRecord, jsonError } from '#lib/server/http.js';
import { rateLimit } from '#lib/server/ratelimit.js';
import { roomAction, roomRequest } from '#lib/server/vr-share.js';
import type { RequestHandler } from './$types';

export const prerender = false;

export const GET: RequestHandler = ({ request, params, url }) => {
	if (!CODE_PATTERN.test(params.code)) return jsonError(404, 'Invalid code.');
	if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
		return jsonError(426, 'A WebSocket connection is required.');
	}
	if (request.headers.get('origin') !== url.origin) return jsonError(403, 'Origin is not allowed.');
	return roomRequest(params.code, request);
};

export const POST: RequestHandler = async ({ request, params, getClientAddress }) => {
	const code = params.code;
	if (!CODE_PATTERN.test(code)) return jsonError(404, 'Invalid code.');
	const reader = request.body?.getReader();
	if (!reader) return jsonError(400, 'Invalid request.');
	const decoder = new TextDecoder();
	let bytes = 0;
	let raw = '';
	let data: unknown;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
		if (bytes > 1024) {
				void reader.cancel();
				return jsonError(413, 'Request too large.');
			}
			raw += decoder.decode(value, { stream: true });
		}
		data = JSON.parse(raw + decoder.decode());
	} catch {
		return jsonError(400, 'Invalid request.');
	}
	if (!isRecord(data) || typeof data.action !== 'string' ||
		!['join', 'leave', 'stop'].includes(data.action)) {
		return jsonError(400, 'Invalid action.');
	}
	if (data.action === 'join' || typeof data.key !== 'string') {
		const ip = request.headers.get('cf-connecting-ip') ?? getClientAddress();
		if (rateLimit(`vr-join:${ip}`, 20, 60_000)) return jsonError(429, 'Too many attempts. Wait one minute.');
	}
	const res = await roomAction(code, data);
	if (!res.ok || data.action !== 'join') return res;
	const { key } = await res.json() as { key: string };
	return Response.json({ code, key }, { headers: { 'cache-control': 'no-store' } });
};
