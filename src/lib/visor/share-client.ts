import { resolve } from '$app/paths';
import {
	MAX_SHARE_STATE, readSharePose, readShareState, SHARE_SOCKET_PROTOCOL,
	type ShareHud, type SharePose, type ShareTicket, type ShareWorld
} from './share-protocol.js';

const endpoint = (code = '') => code ? resolve('/api/vr-share/[code]', { code }) : resolve('/api/vr-share');
const CONNECTION_LOST = 'Se perdió la conexión. Vuelve a conectar con un código activo.';
type Update = (message: string, code?: string) => void;

async function request<T>(code = '', data?: object): Promise<T> {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	const token = !code && new URLSearchParams(location.search).get('k');
	if (token) headers['x-demo-token'] = token;
	const response = await fetch(endpoint(code), {
		method: 'POST', headers,
		body: data ? JSON.stringify(data) : undefined,
		signal: AbortSignal.timeout(8000)
	});
	const payload = await response.json().catch(() => ({}));
	if (response.status === 401) throw new Error('Abre el visor con el enlace de acceso de la demo para crear un código.');
	if (!response.ok) throw new Error(payload.error ?? CONNECTION_LOST);
	return payload;
}

function connect(role: 'host' | 'view', update: Update) {
	let ended = false;
	let ticket: ShareTicket | undefined;
	let socket: WebSocket | undefined;
	let timer: ReturnType<typeof setTimeout>;

	function release(value: ShareTicket) {
		void fetch(endpoint(value.code), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: role === 'host' ? 'stop' : 'leave', key: value.key }),
			keepalive: true
		}).catch(() => {});
	}
	function close() {
		if (ended) return;
		ended = true;
		clearTimeout(timer);
		socket?.close();
		if (ticket) release(ticket);
	}
	function fail(message = CONNECTION_LOST) {
		if (ended) return;
		close();
		update(message);
	}
	function expectData(delay = 15_000) {
		clearTimeout(timer);
		timer = setTimeout(fail, delay);
	}

	async function start(code: string | undefined, receive: (data: unknown, ws: WebSocket) => void) {
		try {
			const value = await request<ShareTicket>(code, code ? { action: 'join' } : undefined);
			if (ended) {
				release(value);
				return;
			}
			ticket = value;
			const url = new URL(endpoint(value.code), location.href);
			url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
			const ws = socket = new WebSocket(url, [SHARE_SOCKET_PROTOCOL, value.key]);
			ws.binaryType = 'arraybuffer';
			expectData(10_000);
			ws.onopen = () => {
				clearTimeout(timer);
				if (role === 'host') update('Esperando al PC', value.code);
				else expectData();
			};
			ws.onmessage = ({ data }) => { if (!ended) receive(data, ws); };
			ws.onerror = ws.onclose = () => fail();
		} catch (cause) {
			fail(cause instanceof Error ? cause.message : CONNECTION_LOST);
		}
	}

	return { start, close, fail, expectData, get socket() { return socket; }, get code() { return ticket?.code; } };
}

export function createHost(update: Update) {
	const room = connect('host', update);
	let ready = false;
	let transmitting = false;
	let world: string | undefined;
	let hud: string | undefined;

	return {
		get live() { return ready && room.socket?.readyState === WebSocket.OPEN; },
		close: room.close,
		start: () => room.start(undefined, (data, ws) => {
			if (data !== 'ready' && data !== 'waiting') return;
			ready = data === 'ready';
			transmitting = false;
			if (ready) {
				if (world) ws.send(world);
				// The HUD is sampled again on the next XR frame.
				hud = undefined;
			}
			update(ready ? 'Conectando con el PC…' : 'Esperando al PC', room.code);
		}),
		publishWorld(value: ShareWorld) {
			const next = JSON.stringify(value);
			if (world === next) return;
			if (next.length > MAX_SHARE_STATE) {
				room.fail('El estado de la misión supera el tamaño permitido.');
				return;
			}
			world = next;
			const ws = room.socket;
			if (ready && ws?.readyState === WebSocket.OPEN) {
				if (ws.bufferedAmount > MAX_SHARE_STATE * 8) room.fail();
				else ws.send(next);
			}
		},
		publishHud(value: ShareHud) {
			const ws = room.socket;
			if (!ready || ws?.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_SHARE_STATE) return;
			const next = JSON.stringify(value);
			if (next === hud || next.length > MAX_SHARE_STATE) return;
			hud = next;
			ws.send(next);
		},
		publishPose(pose: SharePose) {
			const ws = room.socket;
			if (!ready || ws?.readyState !== WebSocket.OPEN || ws.bufferedAmount) return;
			ws.send(pose);
			if (!transmitting) {
				transmitting = true;
				update('Vista en directo en el PC', room.code);
			}
		}
	};
}

export function createSpectator(
	code: string,
	receiveState: (data: ShareWorld | ShareHud) => void,
	receivePose: (pose: SharePose) => void,
	update: Update
) {
	const room = connect('view', update);
	return {
		close: room.close,
		start() {
			update('Conectando con las gafas…', code);
			return room.start(code, (data, ws) => {
				if (data === 'ready') {
					update('Esperando la pose de las gafas…', code);
					return;
				}
				if (data instanceof ArrayBuffer) {
					const pose = readSharePose(data);
					if (!pose) return;
					room.expectData();
					receivePose(pose);
					if (ws.readyState === WebSocket.OPEN) ws.send('ack');
				} else if (typeof data === 'string') {
					const value = readShareState(data);
					if (value) receiveState(value);
				}
			});
		}
	};
}
