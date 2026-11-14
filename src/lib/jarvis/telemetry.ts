// Simulated suit/mission telemetry (spec §5.3, D10, D23). Computed on demand from two clocks:
// mission_start (t_s) and storm_start (storm_t_s). No browser APIs; safe during SSR.
import snapshot from '../data/meda-snapshot.json';
import {
	O2_START_MIN,
	ROUTE_LENGTH_M,
	SUIT_POWER_START_PCT,
	VISIBILITY_CLEAR_M,
	VISIBILITY_STORM_MIN_M,
	WALK_SPEED_MS
} from '../mission.js';
import { P5_VISIBILITY_M, P6_DISTANCE_M, STEP_TIMES_S } from './protocol.js';
import type { Phase, ProtocolStepId, Telemetry } from './types.js';

/** O2 consumption multiplier during the storm (exertion). */
const STORM_O2_FACTOR = 1.5;
/** Suit power drain (%/s) before and during the storm. */
const POWER_DRAIN_PCT_S = 0.01;
const POWER_DRAIN_STORM_PCT_S = 0.05;
/** Visibility time constant (s): 10 000 m → ~18 m at storm_t ≈ 90 s, so P5 (< 20 m) arrives ~85 s into the storm. */
const VISIBILITY_TAU_S = 11;
/** Dust optical depth reached during the storm, and the base used when MEDA has no value (typical Jezero tau). */
const DUST_STORM_PEAK = 2.5;
const DUST_BASE_FALLBACK = 0.5;
const DUST_TAU_S = 30;

const STEP_IDS: readonly ProtocolStepId[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
const P4_INDEX = 3;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** MEDA snapshot values (null when the sensor had no data that sol). */
export const MEDA = (() => {
	const s = snapshot as unknown as Record<string, unknown>;
	const air = s.air_temp_c;
	const airTemp = typeof air === 'object' && air !== null ? num((air as Record<string, unknown>).value) : num(air);
	return {
		air_temp_c: airTemp,
		pressure_pa: num(s.pressure_pa),
		wind_ms: num(s.wind_ms),
		dust_opacity: num(s.dust_opacity)
	};
})();

const round = (v: number, decimals = 0) => {
	const f = 10 ** decimals;
	return Math.round(v * f) / f;
};
const roundNullable = (v: number | null, decimals = 0) => (v === null ? null : round(v, decimals));
const roundVisibility = (v: number) => (v >= 1000 ? round(v, -2) : v >= 100 ? round(v, -1) : Math.round(v));

export interface TelemetrySim {
	/** Reset everything and start the mission clock. */
	missionStart(): void;
	/** Start the storm clock (starts the mission clock too if needed). Returns false if the storm already started. */
	stormStart(): boolean;
	/**
	 * Force the protocol step (operator keys 1–6). The override holds until the automatic step
	 * advances past both the forced step and the automatic step at the time it was forced.
	 */
	setStep(step: ProtocolStepId): void;
	reset(): void;
	get(): Telemetry;
	readonly missionStarted: boolean;
	readonly stormStarted: boolean;
}

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createTelemetry(now: () => number = defaultNow, routeLengthM = ROUTE_LENGTH_M): TelemetrySim {
	/** A route shorter than the P6 radius means mission.ts still has placeholders: never auto-advance to P6. */
	const routeConfigured = routeLengthM > P6_DISTANCE_M;
	let missionT0: number | null = null; // ms
	let stormT0: number | null = null; // ms
	let manual: { idx: number; autoIdxAtSet: number } | null = null;
	/** Mission time (s) at which a manual step ≥ P4 started the walk back. */
	let manualWalkT: number | null = null;

	function clocks() {
		const n = now();
		const t = missionT0 === null ? 0 : Math.max(0, (n - missionT0) / 1000);
		const st = stormT0 === null ? null : Math.max(0, (n - stormT0) / 1000);
		return { t, st };
	}

	function autoTimeIndex(st: number | null): number {
		if (st === null) return -1;
		if (st >= STEP_TIMES_S.P4) return 3;
		if (st >= STEP_TIMES_S.P3) return 2;
		if (st >= STEP_TIMES_S.P2) return 1;
		return 0;
	}

	function compute(): Telemetry {
		const { t, st } = clocks();
		const stormS = st ?? 0;
		const preStormS = Math.max(0, t - stormS);

		const o2 = Math.max(0, O2_START_MIN - preStormS / 60 - (STORM_O2_FACTOR * stormS) / 60);
		const power = Math.max(
			0,
			SUIT_POWER_START_PCT - POWER_DRAIN_PCT_S * preStormS - POWER_DRAIN_STORM_PCT_S * stormS
		);
		const visibility =
			st === null
				? VISIBILITY_CLEAR_M
				: VISIBILITY_STORM_MIN_M + (VISIBILITY_CLEAR_M - VISIBILITY_STORM_MIN_M) * Math.exp(-st / VISIBILITY_TAU_S);

		// Walk back starts when P4 is reached (automatically or forced), whichever is first.
		let walkStart: number | null = manualWalkT;
		if (st !== null && st >= STEP_TIMES_S.P4) {
			const autoWalk = t - st + STEP_TIMES_S.P4;
			walkStart = walkStart === null ? autoWalk : Math.min(walkStart, autoWalk);
		}
		const distance =
			walkStart === null ? routeLengthM : Math.max(0, routeLengthM - WALK_SPEED_MS * (t - walkStart));

		let autoIdx = autoTimeIndex(st);
		const walking = walkStart !== null;
		if (autoIdx >= P4_INDEX || (walking && st !== null)) {
			if (routeConfigured && distance <= P6_DISTANCE_M) autoIdx = 5;
			else if (visibility < P5_VISIBILITY_M) autoIdx = 4;
		}
		if (manual && autoIdx > Math.max(manual.idx, manual.autoIdxAtSet)) manual = null;
		const stepIdx = manual ? manual.idx : autoIdx;
		const protocolStep = stepIdx >= 0 ? STEP_IDS[stepIdx] : null;

		let phase: Phase;
		if (protocolStep === 'P6') phase = 'safe';
		else if (st !== null || protocolStep !== null) phase = 'storm';
		else if (missionT0 !== null) phase = 'sampling';
		else phase = 'idle';

		let dust = MEDA.dust_opacity;
		if (st !== null) {
			const base = dust ?? DUST_BASE_FALLBACK;
			const peak = Math.max(base, DUST_STORM_PEAK);
			dust = base + (peak - base) * (1 - Math.exp(-st / DUST_TAU_S));
		}

		return {
			t_s: Math.round(t),
			storm_t_s: st === null ? null : Math.round(st),
			phase,
			protocolStep,
			o2_remaining_min: round(o2, 1),
			suit_power_pct: round(power, 1),
			visibility_m: roundVisibility(visibility),
			distance_to_habitat_m: Math.round(distance),
			air_temp_c: roundNullable(MEDA.air_temp_c, 1),
			pressure_pa: roundNullable(MEDA.pressure_pa),
			wind_ms: roundNullable(MEDA.wind_ms, 1),
			dust_opacity: roundNullable(dust, 2)
		};
	}

	function reset() {
		missionT0 = null;
		stormT0 = null;
		manual = null;
		manualWalkT = null;
	}

	return {
		missionStart() {
			reset();
			missionT0 = now();
		},
		stormStart() {
			if (stormT0 !== null) return false;
			if (missionT0 === null) missionT0 = now();
			stormT0 = now();
			return true;
		},
		setStep(step) {
			const idx = STEP_IDS.indexOf(step);
			if (idx < 0) return;
			manual = null;
			const current = compute(); // auto step without the override
			const autoIdx = current.protocolStep ? STEP_IDS.indexOf(current.protocolStep) : -1;
			manual = { idx, autoIdxAtSet: autoIdx };
			if (idx >= P4_INDEX && manualWalkT === null) manualWalkT = clocks().t;
		},
		reset,
		get: compute,
		get missionStarted() {
			return missionT0 !== null;
		},
		get stormStarted() {
			return stormT0 !== null;
		}
	};
}
