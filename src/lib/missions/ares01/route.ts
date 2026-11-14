/** ARES-01 uses a fictional itinerary on the HiRISE mesh, in metres (+z south). */
export interface Point {
	x: number;
	z: number;
}

export const SAMPLE: Point = { x: 1575.1, z: -347.3 };
export const SAMPLING_KIT: Point = { x: SAMPLE.x - 1.15, z: SAMPLE.z - 0.85 };
export const DIRECT_DISTANCE = 70;
export const DETOUR_EXTRA = 13;

export const ROVER: Point = { x: SAMPLE.x, z: SAMPLE.z + DIRECT_DISTANCE };
export const BASE: Point = { x: ROVER.x, z: ROVER.z + 2400 };
const junction = { x: SAMPLE.x, z: SAMPLE.z + 7 };
const rejoin = { x: SAMPLE.x, z: SAMPLE.z + 47 };
const detourOffset = Math.sqrt((20 + DETOUR_EXTRA / 2) ** 2 - 20 ** 2);
export const HAZARD_RADIUS = 6.4;
export const HAZARD: Point = { x: SAMPLE.x, z: SAMPLE.z + 27 };
export const DIRECT = [SAMPLE, junction, rejoin, ROVER];
export const DETOUR = [SAMPLE, junction, { x: SAMPLE.x + detourOffset, z: HAZARD.z }, rejoin, ROVER];

export const LOOSE_ROCK_DISTANCE = 31.8;
export const LOOSE_ROCK = pointAlong(DETOUR, LOOSE_ROCK_DISTANCE);

export function distanceBetween(a: Point, b: Point) {
	return Math.hypot(a.x - b.x, a.z - b.z);
}

export function pointAlong(route: readonly Point[], distance: number): Point {
	for (let i = 1; i < route.length; i++) {
		const from = route[i - 1];
		const to = route[i];
		const length = distanceBetween(from, to);
		if (distance <= length) {
			const fraction = Math.max(0, distance) / length;
			return { x: from.x + fraction * (to.x - from.x), z: from.z + fraction * (to.z - from.z) };
		}
		distance -= length;
	}
	return route[route.length - 1];
}
