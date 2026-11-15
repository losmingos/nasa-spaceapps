import { dev } from '$app/env';
import { VR_SHARE_ICE_SERVERS } from '$app/env/private';
import { CODE_ALPHABET } from '#lib/visor/share-protocol.js';
import { ShareRoom } from './vr-share-room.js';

const rooms = new Map<string, ShareRoom>();
const fallback: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export function iceServers(): RTCIceServer[] {
	if (!VR_SHARE_ICE_SERVERS) return fallback;
	try {
		const value: unknown = JSON.parse(VR_SHARE_ICE_SERVERS);
		if (Array.isArray(value) && value.length && value.every((entry) =>
			entry && (typeof entry.urls === 'string' ||
				(Array.isArray(entry.urls) && entry.urls.every((url: unknown) => typeof url === 'string'))))) return value;
	} catch {
		// Direct connections still work when no valid TURN configuration is supplied.
	}
	return fallback;
}

export function newCode() {
	return Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

export function shareTransport() {
	return dev ? { iceServers: iceServers() } : { relay: true };
}

export async function roomSocket(code: string, request: Request): Promise<Response> {
	if (!dev) {
		const { env } = await import('cloudflare:workers');
		const namespace = env.VR_SHARE;
		if (namespace) return namespace.get(namespace.idFromName(code)).fetch(request);
	}
	return new Response('La retransmisión requiere Cloudflare Workers.', { status: 503 });
}

export async function roomRequest(code: string, data: object, create = false): Promise<Response> {
	let room: Pick<ShareRoom, 'fetch'> | undefined;
	if (dev) {
		if (create) {
			for (const [id, candidate] of rooms) if (candidate.inactive) rooms.delete(id);
			if (!rooms.has(code)) rooms.set(code, new ShareRoom());
		}
		room = rooms.get(code);
	} else {
		const { env } = await import('cloudflare:workers');
		const namespace = env.VR_SHARE;
		if (!namespace) return Response.json({ error: 'La transmisión no está configurada en el servidor.' }, { status: 503 });
		room = namespace.get(namespace.idFromName(code));
	}
	if (!room) return Response.json({ error: 'El código no existe o la transmisión ha terminado.' }, { status: 404 });
	return room.fetch(new Request('https://vr-share/room', { method: 'POST', body: JSON.stringify(data) }));
}
