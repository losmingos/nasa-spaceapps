import { CODE_PATTERN } from '#lib/visor/share-protocol.js';
import { isRecord, jsonError } from '#lib/server/http.js';
import { rateLimit } from '#lib/server/ratelimit.js';
import { roomRequest, roomSocket, shareTransport } from '#lib/server/vr-share.js';
import type { RequestHandler } from './$types';

export const prerender = false;

export const GET: RequestHandler = ({ request, params, url }) => {
	if (!CODE_PATTERN.test(params.code)) return jsonError(404, 'Código inválido.');
	if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
		return jsonError(426, 'Se requiere una conexión WebSocket.');
	}
	if (request.headers.get('origin') !== url.origin) return jsonError(403, 'Origen no permitido.');
	return roomSocket(params.code, request);
};

export const POST: RequestHandler = async ({ request, params, getClientAddress }) => {
	const code = params.code;
	if (!CODE_PATTERN.test(code)) return jsonError(404, 'Código inválido.');
	const reader = request.body?.getReader();
	if (!reader) return jsonError(400, 'Solicitud inválida.');
	const decoder = new TextDecoder();
	let bytes = 0;
	let raw = '';
	let data: unknown;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > 36_000) {
				void reader.cancel();
				return jsonError(413, 'Solicitud demasiado grande.');
			}
			raw += decoder.decode(value, { stream: true });
		}
		data = JSON.parse(raw + decoder.decode());
	} catch {
		return jsonError(400, 'Solicitud inválida.');
	}
	if (!isRecord(data) || typeof data.action !== 'string' ||
		!['join', 'host', 'view', 'offer', 'answer', 'leave', 'stop'].includes(data.action)) {
		return jsonError(400, 'Acción inválida.');
	}
	if (data.action === 'join' || typeof data.key !== 'string') {
		const ip = request.headers.get('cf-connecting-ip') ?? getClientAddress();
		if (rateLimit(`vr-join:${ip}`, 20, 60_000)) return jsonError(429, 'Demasiados intentos. Espera un minuto.');
	}
	const res = await roomRequest(code, data);
	if (!res.ok || data.action !== 'join') return res;
	const { key } = await res.json() as { key: string };
	return Response.json({ code, key, ...shareTransport() }, { headers: { 'cache-control': 'no-store' } });
};
