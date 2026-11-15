import { isShareVoice, readSharePose, readShareState, SHARE_SOCKET_PROTOCOL } from '../visor/share-protocol.js';

const ROOM_LIFETIME = 4 * 60 * 60_000;
const PRESENCE = 40_000;
const POSE_WINDOW = 12;
type Viewer = { key: string; seen: number };
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
const expired = () => error(404, 'The code does not exist or the session has ended.');
const secret = () => crypto.randomUUID();

/** One headset and one spectator. Only room credentials and expiration are persisted. */
export class ShareRoom {
	private room?: Room;
	private readonly storage?: Storage;
	private posesInFlight = 0;
	private latestPose?: ArrayBuffer;

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
			if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Sharing ended');
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
		if (this.socket(peer)) return error(409, 'A device is already connected.');
		if (!this.state) return error(503, 'The relay is unavailable.');

		const { 0: client, 1: server } = new WebSocketPair();
		this.state.acceptWebSocket(server, [peer]);
		server.serializeAttachment(key);
		if (peer === 'view') {
			this.posesInFlight = 0;
			this.latestPose = undefined;
		}
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
		if (!host || !view) return;
		if (ws === view && message === 'ack' && this.posesInFlight) {
			this.posesInFlight--;
			if (this.latestPose) {
				const pose = this.latestPose;
				this.latestPose = undefined;
				view.send(pose);
				this.posesInFlight++;
			}
		} else if (ws === host) {
			if (typeof message === 'string') {
				if (readShareState(message)) view.send(message);
			} else if (isShareVoice(message)) {
				view.send(message);
			} else if (readSharePose(message)) {
				if (this.posesInFlight >= POSE_WINDOW) this.latestPose = message;
				else {
					view.send(message);
					this.posesInFlight++;
				}
			}
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
		const { action, key } = (await request.json()) as Record<string, unknown>;
		const now = Date.now();
		const room = this.room;
		if (action === 'create') {
			if (!this.inactive) return error(409, 'Code already in use.');
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
			if (room.viewer) return error(409, 'A PC is already connected with this code.');
			const slot = { key: secret(), seen: now };
			room.viewer = slot;
			await save(this.storage);
			return reply({ key: slot.key });
		}
		if (action === 'stop') {
			if (key !== room.key) return expired();
			this.room = undefined;
			this.closeSockets();
			await this.storage?.delete('room');
			return reply({});
		}
		const slot = room.viewer;
		if (!slot || key !== slot.key) return expired();
		if (action === 'leave') {
			delete room.viewer;
			this.socket('view')?.close(1000, 'Spectator disconnected');
			await save(this.storage);
			return reply({});
		}
		return error(400, 'Invalid action.');
	}
}
