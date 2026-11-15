import { resolve } from '$app/paths';
import type { ShareState, ShareTicket, Signal } from './share-protocol.js';

const endpoint = (code: string) => code ? resolve('/api/vr-share/[code]', { code }) : resolve('/api/vr-share');
const NETWORK_ERROR = 'No se pudo enviar el vídeo. Comprueba que ambos dispositivos estén conectados a la misma red.';
type Update = (message: string, code?: string) => void;

class HttpError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

async function request<T>(code = '', data?: object): Promise<T> {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	const token = !code && new URLSearchParams(location.search).get('k');
	if (token) headers['x-demo-token'] = token;
	const res = await fetch(endpoint(code), {
		method: 'POST',
		headers,
		body: data ? JSON.stringify(data) : undefined,
		signal: AbortSignal.timeout(8000)
	});
	if (res.status === 401) throw new HttpError(401, 'Abre el visor con el enlace de acceso de la demo para crear un código.');
	const payload = await res.json().catch(() => ({}));
	if (!res.ok) throw new HttpError(res.status, payload.error ?? 'No se pudo contactar con la transmisión.');
	return payload;
}

async function signalFrom(peer: RTCPeerConnection, type: Signal['type']): Promise<Signal> {
	const description = type === 'offer' ? await peer.createOffer() : await peer.createAnswer();
	await peer.setLocalDescription(description);
	if (peer.iceGatheringState !== 'complete') {
		await new Promise<void>((resolve) => {
			const done = () => {
				clearTimeout(timeout);
				peer.removeEventListener('icegatheringstatechange', changed);
				peer.removeEventListener('connectionstatechange', changed);
				resolve();
			};
			const changed = () => {
				if (peer.iceGatheringState === 'complete' || peer.connectionState === 'closed') done();
			};
			const timeout = setTimeout(done, 5500);
			peer.addEventListener('icegatheringstatechange', changed);
			peer.addEventListener('connectionstatechange', changed);
		});
	}
	const sdp = peer.localDescription?.sdp;
	if (!sdp || peer.signalingState === 'closed') throw new Error(NETWORK_ERROR);
	return { type, sdp };
}

function release(ticket: ShareTicket, action: 'leave' | 'stop') {
	void fetch(endpoint(ticket.code), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ action, key: ticket.key }),
		keepalive: true
	}).catch(() => {});
}

function connection(onFailure: (text: string) => void, onReady: () => void, role: 'host' | 'view') {
	let ended = false;
	let ticket: ShareTicket | undefined;
	let peer: RTCPeerConnection | undefined;
	let disconnectSince = 0;
	let deadline = 0;
	let timer: ReturnType<typeof setTimeout>;

	function closePeer() {
		if (peer) {
			peer.onconnectionstatechange = null;
			peer.close();
			peer = undefined;
		}
	}
	function close() {
		ended = true;
		clearTimeout(timer);
		closePeer();
		if (ticket) release(ticket, role === 'host' ? 'stop' : 'leave');
		ticket = undefined;
	}
	function attach(value: ShareTicket) {
		if (ended) release(value, role === 'host' ? 'stop' : 'leave');
		else ticket = value;
		return !ended;
	}
	function fail(cause: unknown) {
		if (ended) return;
		close();
		onFailure(cause instanceof HttpError ? cause.message : NETWORK_ERROR);
	}
	function openPeer(onDead: () => void) {
		if (!ticket) throw new Error(NETWORK_ERROR);
		const pc = peer = new RTCPeerConnection({ iceServers: ticket.iceServers });
		deadline = Date.now() + 22_000;
		disconnectSince = 0;
		pc.onconnectionstatechange = () => {
			if (pc.connectionState === 'connected') {
				disconnectSince = deadline = 0;
				onReady();
			} else if (pc.connectionState === 'disconnected') {
				disconnectSince ||= Date.now();
			} else if (pc.connectionState === 'failed') onDead();
		};
		return pc;
	}
	async function send<T = ShareState>(action: string, extra?: object): Promise<T> {
		if (!ticket) throw new Error(NETWORK_ERROR);
		return request(ticket.code, { action, key: ticket.key, ...extra });
	}
	function poll(step: (state: ShareState) => Promise<void>, onDead: () => void) {
		let failedRequests = 0;
		async function run() {
			if (ended) return;
			try {
				const state = await send(role);
				if (ended) return;
				if (peer && ((deadline && Date.now() > deadline) || (disconnectSince && Date.now() - disconnectSince > 10_000))) onDead();
				if (!ended) await step(state);
				failedRequests = 0;
			} catch (cause) {
				if ((cause instanceof HttpError && cause.status < 500) || ++failedRequests >= 3) fail(cause);
			}
			if (!ended) timer = setTimeout(run, peer?.connectionState === 'connected' ? 2000 : 650);
		}
		void run();
	}
	return { attach, close, closePeer, fail, openPeer, poll, send, get ended() { return ended; },
		get live() { return peer?.connectionState === 'connected'; } };
}

export function createHost(stream: MediaStream, update: Update) {
	let code: string | undefined;
	let viewer: string | undefined;
	let negotiating = false;
	let peer: RTCPeerConnection | undefined;
	const room = connection(update, () => update('Transmitiendo al PC', code), 'host');
	function onDead() {
		room.closePeer();
		peer = undefined;
		update('El PC perdió la conexión. Puede volver a entrar con el mismo código.', code);
	}
	return {
		get live() { return room.live; },
		close: room.close,
		async start() {
			try {
				const ticket = await request<ShareTicket>();
				if (!room.attach(ticket)) return;
				code = ticket.code;
				update('Esperando al PC', code);
				room.poll(async (state) => {
					if (state.viewer !== viewer) {
						room.closePeer();
						peer = undefined;
						viewer = state.viewer;
						negotiating = false;
						update(viewer ? 'Conectando con el PC…' : 'Esperando al PC', code);
					}
					if (!viewer || !state.offer || negotiating) return;
					negotiating = true;
					try {
						const pc = peer = room.openPeer(onDead);
						for (const track of stream.getVideoTracks()) pc.addTrack(track, stream);
						await pc.setRemoteDescription(state.offer);
						const signal = await signalFrom(pc, 'answer');
						if (!room.ended && peer === pc) await room.send('answer', { viewer, signal });
					} catch (cause) {
						if (!room.ended) {
							if (cause instanceof HttpError && cause.status === 404) room.fail(cause);
							else onDead();
						}
					}
				}, onDead);
			} catch (cause) {
				room.fail(cause);
			}
		}
	};
}

export function createSpectator(code: string, onVideo: (stream: MediaStream) => void, update: Update) {
	const room = connection(update, () => update('En directo', code), 'view');
	const onDead = () => room.fail(new Error(NETWORK_ERROR));
	return {
		close: room.close,
		async start() {
			try {
				if (typeof RTCPeerConnection === 'undefined') {
					update('Este navegador no admite vídeo WebRTC.');
					return;
				}
				update('Conectando con las gafas…', code);
				const ticket = await request<ShareTicket>(code, { action: 'join' });
				if (!room.attach(ticket)) return;
				const pc = room.openPeer(onDead);
				pc.ontrack = ({ track, streams }) => {
					if (!room.ended && track.kind === 'video') onVideo(streams[0] ?? new MediaStream([track]));
				};
				pc.addTransceiver('video', { direction: 'recvonly' });
				const signal = await signalFrom(pc, 'offer');
				if (room.ended) return;
				await room.send('offer', { signal });
				if (room.ended) return;
				room.poll(async ({ answer }) => {
					if (answer && !pc.remoteDescription) await pc.setRemoteDescription(answer);
				}, onDead);
			} catch (cause) {
				room.fail(cause);
			}
		}
	};
}
