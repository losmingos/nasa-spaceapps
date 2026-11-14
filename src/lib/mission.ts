// Shared mission constants (D27) — scene, telemetry and pre-recorded lines all use these numbers.
// Coordinates are in terrain.ts mesh space: metres, x = column axis, z = row axis, mesh centred on (0, 0).
// PLACEHOLDER VALUES — to be replaced with points picked from static/terrain/jezero.bin, then validated by the scene team.
// Keep this file import-free so scripts/gen_lines.ts can import it directly with Node.

export interface Point {
	x: number;
	z: number;
}

export const SPAWN: Point = { x: 0, z: 0 };
export const SAMPLE: Point = { x: 0, z: 0 };
export const HABITAT: Point = { x: 0, z: 0 };
/** Waypoints from SAMPLE to HABITAT (inclusive of both ends). */
export const ROUTE: Point[] = [SAMPLE, HABITAT];

/** Assumed walking speed for the telemetry (m/s). */
export const WALK_SPEED_MS = 1.0;
/** Length of ROUTE in metres (sum of segments). */
export const ROUTE_LENGTH_M = ROUTE.slice(1).reduce(
	(sum, p, i) => sum + Math.hypot(p.x - ROUTE[i].x, p.z - ROUTE[i].z),
	0
);
/** Compass bearing in words from SAMPLE to HABITAT (−z is treated as north), used in spoken lines. */
export const HABITAT_BEARING = 'north-east';

// Telemetry start values (D10).
export const O2_START_MIN = 312;
export const SUIT_POWER_START_PCT = 64;
export const VISIBILITY_CLEAR_M = 10000;
export const VISIBILITY_STORM_MIN_M = 15;
