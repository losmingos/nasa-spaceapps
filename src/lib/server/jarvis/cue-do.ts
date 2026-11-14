// Durable Object backing the operator cue channel on Cloudflare Workers (spec D28).
// Workers run many isolated instances, so module memory is not shared between the laptop's POST and the
// headset's GET; one Durable Object instance holds the single shared { seq, id } state.
// Exported from the generated worker by scripts/cf-postbuild.js; bound as JARVIS_CUE in wrangler.jsonc.
// Keep this file free of SvelteKit imports: Wrangler bundles it directly.

interface CueRecord {
	seq: number;
	id: string | null;
}

interface DurableObjectStateLike {
	storage: {
		get<T>(key: string): Promise<T | undefined>;
		put(key: string, value: unknown): Promise<void>;
	};
	blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}

const KEY = 'cue';

export class CueChannel {
	private cue: CueRecord = { seq: 0, id: null };
	private readonly state: DurableObjectStateLike;

	constructor(state: DurableObjectStateLike, _env: unknown) {
		this.state = state;
		void state.blockConcurrencyWhile(async () => {
			this.cue = (await state.storage.get<CueRecord>(KEY)) ?? { seq: 0, id: null };
		});
	}

	async fetch(request: Request): Promise<Response> {
		if (request.method === 'POST') {
			const body = (await request.json()) as { id?: unknown };
			if (typeof body.id !== 'string') return Response.json({ error: 'id required' }, { status: 400 });
			this.cue = { seq: this.cue.seq + 1, id: body.id };
			await this.state.storage.put(KEY, this.cue);
		}
		return Response.json(this.cue);
	}
}
