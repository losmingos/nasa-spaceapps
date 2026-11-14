/** ARES-01 uses a fictional itinerary on the HiRISE mesh, in metres (+z south). */
export interface Point {
	x: number;
	z: number;
}

export const SAMPLE: Point = { x: 1575.1, z: -347.3 };
export const ROVER: Point = { x: SAMPLE.x, z: SAMPLE.z + 350 };
export const BASE: Point = { x: ROVER.x, z: ROVER.z + 2400 };
const junction = { x: SAMPLE.x, z: SAMPLE.z + 35 };
const rejoin = { x: SAMPLE.x, z: SAMPLE.z + 235 };
const detourOffset = Math.sqrt(132.5 ** 2 - 100 ** 2);
export const HAZARD: Point = { x: SAMPLE.x, z: SAMPLE.z + 135 };
export const DIRECT = [SAMPLE, junction, rejoin, ROVER];
export const DETOUR = [SAMPLE, junction, { x: SAMPLE.x + detourOffset, z: HAZARD.z }, rejoin, ROVER];

export function pointAlong(route: readonly Point[], distance: number): Point {
	for (let i = 1; i < route.length; i++) {
		const from = route[i - 1];
		const to = route[i];
		const length = Math.hypot(to.x - from.x, to.z - from.z);
		if (distance <= length) {
			const fraction = Math.max(0, distance) / length;
			return { x: from.x + fraction * (to.x - from.x), z: from.z + fraction * (to.z - from.z) };
		}
		distance -= length;
	}
	return route[route.length - 1];
}
