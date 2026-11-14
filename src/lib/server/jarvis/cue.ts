// Global operator cue channel for level 0 (D28). In-memory and shared by every client on purpose.

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

// Kept on globalThis so a dev-server module reload does not reset seq (clients would miss cues).
const g = globalThis as typeof globalThis & { __jarvisCue?: CueState };
const state: CueState = (g.__jarvisCue ??= { seq: 0, id: null });

export function getCue(): CueState {
	return { seq: state.seq, id: state.id };
}

export function pushCue(id: CueId): CueState {
	state.seq += 1;
	state.id = id;
	return getCue();
}
