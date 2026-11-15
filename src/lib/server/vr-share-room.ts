import { MAX_SHARE_FRAME, SHARE_SOCKET_PROTOCOL, type ShareState, type Signal } from '../visor/share-protocol.js';

const ROOM_LIFETIME = 4 * 60 * 60_000;
const PRESENCE = 40_000;
const tick = (time: number) => Math.floor(time / 5000);
type Viewer = { key: string; seen: number; offer?: Signal; answer?: Signal };
type Room = { key: string; expires: number; seen: number; viewer?: Viewer };
type Storage = {
	get<T>(key: string): Promise<T | undefined>;
	put(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<boolean>;
	setAlarm(timestamp: number): Promise<void>;
};
type Peer = 'host' | 'view';
type RoomSocket = WebSocket & {
	serializeAttachment(key: string): void;
	deserializeAttachment(): string | null;
};
type RoomState = {
	storage: Storage;
	blockConcurrencyWhile(fn: () => Promise<void>): Promise<void>;
	acceptWebSocket(socket: RoomSocket, tags: Peer[]): void;
	getWebSockets(tag?: Peer): RoomSocket[];
};

declare const WebSocketPair: new () => { 0: WebSocket; 1: RoomSocket };

const reply = (body: object, status = 200) =>
	Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const error = (status: number, message: string) => reply({ error: message }, status);
const expired = () => error(404, 'El código no existe o la transmisión ha terminado.');
const secret = () => crypto.randomUUID();

function validSignal(value: unknown, type: Signal['type']): value is Signal {
	if (!value || typeof value !== 'object') return false;
	const { type: kind, sdp } = value as Partial<Signal>;
	return kind === type && typeof sdp === 'string' && sdp.startsWith('v=0') && sdp.length <= 24_000;
}

/** One headset and one spectator. Frames pass through sockets and are never stored. */
export class ShareRoom {
	private room?: Room;
	private readonly storage?: Storage;

	constructor(private readonly state?: RoomState) {
		this.storage = state?.storage;
		void state?.blockConcurrencyWhile(async () => {
			this.room = await state.storage.get<Room>('room');
		});
	}

	async alarm() {
		if (this.room && Date.now() < this.room.expires) {
			await this.storage?.setAlarm(this.room.expires);
			return;
		}
		this.room = undefined;
		this.closeSockets();
		await this.storage?.delete('room');
	}

	get inactive() {
		return !this.room || Date.now() >= this.room.expires ||
			(!this.socket('host') && Date.now() - this.room.seen >= PRESENCE);
	}

	private socket(peer: Peer, except?: WebSocket) {
		return this.state?.getWebSockets(peer).find((ws) => ws !== except && ws.readyState === WebSocket.OPEN);
	}

	private closeSockets() {
		for (const ws of this.state?.getWebSockets() ?? []) {
			if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Transmisión terminada');
		}
	}

	private openSocket(request: Request) {
		const room = this.room;
		if (!room || this.inactive) return expired();
		const [protocol, key] = request.headers.get('sec-websocket-protocol')?.split(',').map((part) => part.trim()) ?? [];
		if (protocol !== SHARE_SOCKET_PROTOCOL || !key) return expired();
		const viewer = room.viewer;
		const peer = key === room.key ? 'host' : key === viewer?.key && Date.now() - viewer.seen < PRESENCE ? 'view' : undefined;
		if (!peer) return expired();
		if (this.socket(peer)) return error(409, 'Ya hay un dispositivo conectado.');
		if (!this.state) return error(503, 'Retransmisión no disponible.');

		const { 0: client, 1: server } = new WebSocketPair();
		this.state.acceptWebSocket(server, [peer]);
		server.serializeAttachment(key);
		const host = this.socket('host');
		const view = this.socket('view');
		if (host && view) {
			host.send('ready');
			view.send('ready');
		}
		return new Response(null, {
			status: 101,
			headers: { 'sec-websocket-protocol': SHARE_SOCKET_PROTOCOL },
			webSocket: client
		} as ResponseInit & { webSocket: WebSocket });
	}

	webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		if (this.inactive) return;
		const host = this.socket('host');
		const view = this.socket('view');
		if (ws === view && message === 'frame') {
			host?.send('frame');
		} else if (ws === host && message instanceof ArrayBuffer && message.byteLength <= MAX_SHARE_FRAME) {
			view?.send(message);
		}
	}

	async webSocketClose(ws: RoomSocket) {
		const room = this.room;
		if (!room) return;
		const key = ws.deserializeAttachment();
		if (room.viewer && key === room.viewer.key && !this.socket('view', ws)) {
			delete room.viewer;
			this.socket('host')?.send('waiting');
			await this.storage?.put('room', room);
		} else if (key === room.key && !this.socket('host', ws)) {
			this.room = undefined;
			this.closeSockets();
			await this.storage?.delete('room');
		}
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return this.openSocket(request);
		const { action, key, viewer, signal } = (await request.json()) as Record<string, unknown>;
		const now = Date.now();
		const room = this.room;
		if (action === 'create') {
			if (!this.inactive) return error(409, 'Código en uso.');
			this.closeSockets();
			const created = { key: secret(), expires: now + ROOM_LIFETIME, seen: now };
			this.room = created;
			await this.storage?.put('room', created);
			await this.storage?.setAlarm(created.expires);
			return reply({ key: created.key }, 201);
		}
		if (!room || this.inactive) return expired();
		if (room.viewer && !this.socket('view') && now - room.viewer.seen >= PRESENCE) delete room.viewer;

		async function save(storage: Storage | undefined) {
			await storage?.put('room', room);
		}

		if (action === 'join') {
			if (room.viewer) return error(409, 'Ya hay un PC conectado a este código.');
			const slot = { key: secret(), seen: now };
			room.viewer = slot;
			await save(this.storage);
			return reply({ key: slot.key });
		}
		if (action === 'stop' || action === 'host' || action === 'answer') {
			if (key !== room.key) return expired();
			if (action === 'stop') {
				this.room = undefined;
				this.closeSockets();
				await this.storage?.delete('room');
				return reply({});
			}
			const previous = room.seen;
			room.seen = now;
			const slot = room.viewer;
			if (action === 'answer') {
				if (!slot || viewer !== slot.key || !slot.offer) return error(409, 'El espectador se desconectó.');
				if (!validSignal(signal, 'answer')) return error(400, 'Respuesta de vídeo inválida.');
				slot.answer = signal;
			}
			if (action === 'answer' || tick(now) !== tick(previous)) await save(this.storage);
			return reply({ viewer: slot?.key, offer: slot?.offer } satisfies ShareState);
		}
		const slot = room.viewer;
		if (!slot || key !== slot.key) return expired();
		if (action === 'leave') {
			delete room.viewer;
			this.socket('view')?.close(1000, 'Espectador desconectado');
			await save(this.storage);
			return reply({});
		}
		if (action !== 'view' && action !== 'offer') return error(400, 'Acción inválida.');
		const previous = slot.seen;
		slot.seen = now;
		if (action === 'offer') {
			if (slot.offer || !validSignal(signal, 'offer')) return error(400, 'Oferta de vídeo inválida.');
			slot.offer = signal;
		}
		if (action === 'offer' || tick(now) !== tick(previous)) await save(this.storage);
		return reply({ answer: slot.answer } satisfies ShareState);
	}
}
