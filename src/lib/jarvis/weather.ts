// MEDA weather replay for Jarvis telemetry. Data: src/lib/data/meda-curves.json (scripts/build_meda.ts).
//
// Real MEDA curves (10-minute LMST bins) are replayed at the scene's local time: the curve comes from
// the sol whose season (Ls) is closest to the scene's, and values are interpolated linearly between
// bins so they move minute by minute. During the storm the values blend to the sol-313 storm curve.
// No browser APIs; safe during SSR.
import data from '../data/meda-curves.json';
import {
	MISSION_SOL_OFFSET,
	formatLmst,
	localSolAt,
	lmstMinutes,
	lsAtLocalSol,
	signalDelayMinutes,
	unixMsAtLocalSol
} from '../mars-clock.js';

type Bins = readonly (number | null)[];
interface Curve {
	sol: number;
	ls: number;
	air_temp_c: Bins | null;
	pressure_pa: Bins | null;
	relative_humidity_pct: Bins | null;
	ground_temp_c: Bins | null;
	wind_ms: Bins | null;
}
const curves = data.curves as unknown as { latest: Curve; storm: Curve; season: Curve[] };
const STEP_MIN = data.step_min;

/** Latest MEDA sol published in the PDS when meda-curves.json was built. */
export const MEDA_LATEST_SOL: number = curves.latest.sol;
/** Dust optical depth before the storm (sol 311) and at its peak (Lemmon et al. 2022). */
export const DUST_PRE_STORM = data.dust_opacity.pre_storm_sol_311;
export const DUST_STORM_PEAK = data.dust_opacity.storm_peak_approx;
/** Seconds to blend from the season curve to the storm curve after storm_start. */
export const STORM_BLEND_S = 60;
const DUST_TAU_S = 30;
/** Largest gap between bins (in bins) that is interpolated across; MEDA usually samples ~30 min per hour. */
const MAX_GAP_BINS = 12;

/**
 * Value of a 10-minute curve at `minutes` after local midnight: linear between the nearest bins with
 * data (bin i is centred at 10·i + 5 min; wraps around midnight). Null if there is no data nearby.
 */
export function sampleCurve(bins: Bins | null, minutes: number): number | null {
	if (!bins) return null;
	const n = bins.length;
	const x = minutes / STEP_MIN - 0.5;
	const i0 = Math.floor(x);
	let a: number | null = null;
	let b: number | null = null;
	for (let k = 0; k <= MAX_GAP_BINS && a === null; k++) if (bins[(((i0 - k) % n) + n) % n] !== null) a = i0 - k;
	for (let k = 1; k <= MAX_GAP_BINS + 1 && b === null; k++) if (bins[(((i0 + k) % n) + n) % n] !== null) b = i0 + k;
	const at = (i: number) => bins[((i % n) + n) % n] as number;
	if (a !== null && b !== null && b - a <= MAX_GAP_BINS + 1) return at(a) + ((at(b) - at(a)) * (x - a)) / (b - a);
	// One side only: hold the nearest value if it is close (≤ 30 min).
	if (a !== null && x - a <= 3) return at(a);
	if (b !== null && b - x <= 3) return at(b);
	return null;
}

const lsDistance = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/** The season-library curve whose Ls is closest to `ls`. */
export function seasonCurve(ls: number): Curve {
	let best = curves.season[0] ?? curves.latest;
	for (const c of curves.season) if (lsDistance(c.ls, ls) < lsDistance(best.ls, ls)) best = c;
	return best;
}

const lerpNullable = (a: number | null, b: number | null, w: number) =>
	a !== null && b !== null ? a + (b - a) * w : w < 0.5 ? a : b;
const smooth = (w: number) => w * w * (3 - 2 * w);

export interface Weather {
	air_temp_c: number | null;
	pressure_pa: number | null;
	relative_humidity_pct: number | null;
	ground_temp_c: number | null;
	wind_ms: number | null;
	dust_opacity: number | null;
	lmst: string;
	mission_sol: number;
	ls: number;
	meda_sol: number;
	meda_curve: 'season' | 'latest' | 'storm-blend';
	meda_latest_sol: number;
	meda_data_age_sols: number;
	latest_air_temp_c: number | null;
	latest_pressure_pa: number | null;
	signal_delay_min: number | null;
}

/**
 * Weather for a scene local sol (src/lib/mars-time.ts scale: MSD at Jezero LMST, fraction = time of day).
 * @param stormS seconds since storm_start, or null (clear weather).
 * @param nowMs real wall clock (for the age of the newest published data).
 */
export function weatherAt(localSol: number, stormS: number | null, nowMs: number): Weather {
	const minutes = lmstMinutes(localSol);
	const ls = lsAtLocalSol(localSol);
	const base = seasonCurve(ls);
	const storm = curves.storm;
	const w = stormS === null ? 0 : smooth(Math.min(1, Math.max(0, stormS / STORM_BLEND_S)));
	const field = (k: keyof Pick<Curve, 'air_temp_c' | 'pressure_pa' | 'relative_humidity_pct' | 'ground_temp_c'>) => {
		const v = sampleCurve(base[k], minutes);
		return stormS === null ? v : lerpNullable(v, sampleCurve(storm[k], minutes), w);
	};
	// Wind only exists in the storm curve (sensor lost on sol 313); no blending from a missing value.
	const wind = stormS === null ? sampleCurve(base.wind_ms, minutes) : sampleCurve(storm.wind_ms, minutes);
	const dust =
		stormS === null ? null : DUST_PRE_STORM + (DUST_STORM_PEAK - DUST_PRE_STORM) * (1 - Math.exp(-Math.max(0, stormS) / DUST_TAU_S));
	const nowMissionSol = Math.floor(localSolAt(nowMs) - MISSION_SOL_OFFSET);
	return {
		air_temp_c: field('air_temp_c'),
		pressure_pa: field('pressure_pa'),
		relative_humidity_pct: field('relative_humidity_pct'),
		ground_temp_c: field('ground_temp_c'),
		wind_ms: wind,
		dust_opacity: dust,
		lmst: formatLmst(localSol),
		mission_sol: Math.floor(localSol - MISSION_SOL_OFFSET),
		ls,
		meda_sol: stormS === null ? base.sol : w < 0.5 ? base.sol : storm.sol,
		meda_curve: stormS !== null ? 'storm-blend' : base.sol === curves.latest.sol ? 'latest' : 'season',
		meda_latest_sol: curves.latest.sol,
		meda_data_age_sols: nowMissionSol - curves.latest.sol,
		latest_air_temp_c: sampleCurve(curves.latest.air_temp_c, minutes),
		latest_pressure_pa: sampleCurve(curves.latest.pressure_pa, minutes),
		signal_delay_min: signalDelayMinutes(unixMsAtLocalSol(localSol))
	};
}
