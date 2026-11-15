// Shared mission constants (D27) — scene, telemetry and pre-recorded lines all use these numbers.
// Keep this file import-free so scripts/gen_lines.ts can import it directly with Node.
//
// Coordinates are in terrain.ts mesh space: metres, mesh centred on (0, 0).
//   x = col * spacing − width / 2   (+x = east)
//   z = row * spacing − length / 2  (+z = south, −z = north)
// The orientation comes from the PDS label of DTEEC_002387_1985_003798_1985_A01: an equirectangular map with
// rotation 0, east-positive longitude, and line 1 at the maximum latitude. So row 0 is the north edge.
// static/terrain/jezero.bin: 434 × 722 nodes, spacing 16.154 m.
//
// How the points were chosen (scripted analysis of jezero.bin; see src/lib/data/README.md):
//   - SAMPLE: on the crater floor at the foot of the western-delta front, in the bay between two delta lobes.
//     The scarp rises to the north/north-west: ~20 m above SAMPLE within 95 m, ~50 m within 160 m, ~70 m within 205 m.
//     The nearest slope over 15° is 58 m away, and slopes reach ~30° on the scarp face.
//     Ground slope <2° at the point, no node steeper than 10° within 48 m, valid DTM data within ~320 m.
//   - HABITAT: on flat open crater floor (no node steeper than 5° within 48 m), 640 m straight-line from SAMPLE.
//   - ROUTE: grid A* (slope < 11°), then waypoints adjusted by hand to keep ≥58 m from any slope >15°. Each
//     segment was sampled every 4 m: max node slope 3.5°, max along-route grade 3.1°, all on valid data.
//   - SPAWN: 4 m from SAMPLE along the first route leg (the player starts facing the sample, with the scarp behind it).
// Slopes come from a 16 m grid, so metre-scale boulders and ripples are not resolved.
// THE SCENE TEAM MUST VALIDATE THESE POINTS VISUALLY in the scene.

export interface Point {
	x: number;
	z: number;
}

export const SPAWN: Point = { x: 1578.9, z: -348.7 };
export const SAMPLE: Point = { x: 1575.1, z: -347.3 };
export const HABITAT: Point = { x: 2027.4, z: -799.6 };
/** Waypoints from SAMPLE to HABITAT (inclusive of both ends). */
export const ROUTE: Point[] = [SAMPLE, { x: 1720, z: -400 }, { x: 1920, z: -560 }, HABITAT];

/**
 * DTM elevations (m, Mars 2000 datum, bilinear on jezero.bin) of the key points.
 * Mesh height = elevation − low, where terrain.ts computes low at runtime (−2600.27 m for the current jezero.bin):
 * SAMPLE ≈ 68.4 m, HABITAT ≈ 65.4 m, SPAWN ≈ 68.5 m, before any vertical exaggeration (mesh.scale.y).
 * Along ROUTE (sampled every 4 m) the ground stays between −2535.4 and −2531.3 m, almost level.
 */

/** Assumed walking speed for the telemetry (m/s). */
export const WALK_SPEED_MS = 1.0;
/** Length of ROUTE in metres (sum of segments). ≈ 672.9 m for the points above. */
export const ROUTE_LENGTH_M = ROUTE.slice(1).reduce(
	(sum, p, i) => sum + Math.hypot(p.x - ROUTE[i].x, p.z - ROUTE[i].z),
	0
);
/** Compass bearing in words from SAMPLE to HABITAT (−z is treated as north), used in spoken lines. Exact: 45°. */
export const HABITAT_BEARING = 'north-east';

// Telemetry start values (D10).
export const O2_START_MIN = 312;
export const SUIT_POWER_START_PCT = 64;
export const VISIBILITY_CLEAR_M = 10000;
export const VISIBILITY_STORM_MIN_M = 15;
