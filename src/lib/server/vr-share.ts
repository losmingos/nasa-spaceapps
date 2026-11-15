import { dev } from '$app/env';
import { CODE_ALPHABET } from '#lib/visor/share-protocol.js';

export function newCode() {
	return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

export async function roomRequest(code: string, request: Request): Promise<Response> {
	if (!dev) {
		const { env } = await import('cloudflare:workers');
		const namespace = env.VR_SHARE;
		if (namespace) return namespace.get(namespace.idFromName(code)).fetch(request);
	}
	return Response.json({ error: 'La vista compartida requiere Cloudflare Workers. Para probarla en local, usa npm run cf:dev.' },
		{ status: 503 });
}

export function roomAction(code: string, data: object) {
	return roomRequest(code, new Request('https://vr-share/room', { method: 'POST', body: JSON.stringify(data) }));
}
