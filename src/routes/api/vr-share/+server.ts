import { jsonError } from '#lib/server/http.js';
import { rateLimit } from '#lib/server/ratelimit.js';
import { newCode, roomRequest, shareTransport } from '#lib/server/vr-share.js';
import type { RequestHandler } from './$types';

export const prerender = false;

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = request.headers.get('cf-connecting-ip') ?? getClientAddress();
	if (rateLimit(`vr-create:${ip}`, 12, 60_000)) return jsonError(429, 'Espera un minuto para generar otro código.');
	for (let attempt = 0; attempt < 3; attempt++) {
		const code = newCode();
		const res = await roomRequest(code, { action: 'create' }, true);
		if (res.status === 409) continue;
		if (!res.ok) return res;
		const { key } = await res.json() as { key: string };
		return Response.json({ code, key, ...shareTransport() }, { status: 201, headers: { 'cache-control': 'no-store' } });
	}
	return jsonError(503, 'No se pudo generar el código. Inténtalo de nuevo.');
};
