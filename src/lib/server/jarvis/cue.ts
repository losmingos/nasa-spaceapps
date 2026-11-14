// Global operator cue channel for level 0 (D28). In-memory and shared by every client on purpose.

import { dev } from '$app/env';
import type { CueId, CueState, MissionEvent, ProtocolStepId } from '#lib/jarvis/types.js';
import { LINE_IDS } from '#lib/jarvis/lines.js';

const MISSION_EVENTS: readonly MissionEvent[] = ['mission_start', 'sample_collected', 'storm_start'];
const STEPS: readonly ProtocolStepId[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

export const ALLOWED_CUES: ReadonlySet<string> = new Set<string>([
	...LINE_IDS,
	...MISSION_EVENTS,
	'reset',
	...STEPS.map((s) => `step:${s}`)
]);

export function isCueId(v: unknown): v is CueId {
	return typeof v === 'string' && ALLOWED_CUES.has(v);
}

// Where the state lives:
// - On Cloudflare Workers: the CueChannel Durable Object (binding JARVIS_CUE), because Worker isolates
//   don't share memory and a cue POSTed from the laptop could otherwise never reach the headset.
// - In `vite dev` (or if the binding is missing): process memory, kept on globalThis so a dev-server
//   module reload does not reset seq (clients would miss cues).
const g = globalThis as typeof globalThis & { __jarvisCue?: CueState };
const memory: CueState = (g.__jarvisCue ??= { seq: 0, id: null });

async function durableObject() {
	if (dev) return null;
	const { env } = await import('cloudflare:workers');
	const ns = env.JARVIS_CUE;
	return ns ? ns.get(ns.idFromName('global')) : null;
}

export async function getCue(): Promise<CueState> {
	const stub = await durableObject();
	if (stub) return (await (await stub.fetch('https://cue/state')).json()) as CueState;
	return { seq: memory.seq, id: memory.id };
}

export async function pushCue(id: CueId): Promise<CueState> {
	const stub = await durableObject();
	if (stub) {
		const res = await stub.fetch('https://cue/state', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id })
		});
		return (await res.json()) as CueState;
	}
	memory.seq += 1;
	memory.id = id;
	return { seq: memory.seq, id: memory.id };
}
