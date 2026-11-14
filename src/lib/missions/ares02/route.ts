import type { Point } from '../../visor/terrain.js';
import { distanceBetween, pointAlong } from '../ares01/route.js';

export const bravo = { x: 800, z: -3395 };
export const handoff = { x: 800, z: -3372 };
export const fault = { x: 800, z: -3500 };
export const startPoint = { x: 748, z: -3461 };
const turn = { x: 789, z: -3456 };
const beforeFault = { x: 798.5, z: -3487 };
const detour = { x: 760, z: -3447.5 };

export const approach = Array.from({ length: 33 }, (_, i) => {
	const t = i / 32;
	const u = 1 - t;
	return {
		x: u ** 3 * startPoint.x + 3 * u ** 2 * t * turn.x + 3 * u * t ** 2 * beforeFault.x + t ** 3 * fault.x,
		z: u ** 3 * startPoint.z + 3 * u ** 2 * t * turn.z + 3 * u * t ** 2 * beforeFault.z + t ** 3 * fault.z
	};
});
export const direct = [fault, bravo];
export const alternative = [fault, detour, bravo];
export const directLength = distanceBetween(fault, bravo);
export const alternativeLength = distanceBetween(fault, detour) + distanceBetween(detour, bravo);
export const approachLength = approach.slice(1).reduce((sum, point, i) => sum + distanceBetween(approach[i], point), 0);

export function approachNavigation(position: Point) {
	let best = Infinity;
	let travelled = 0;
	let progress = 0;
	for (let i = 1; i < approach.length; i++) {
		const a = approach[i - 1];
		const b = approach[i];
		const dx = b.x - a.x;
		const dz = b.z - a.z;
		const length = Math.hypot(dx, dz);
		const t = Math.max(0, Math.min(1, ((position.x - a.x) * dx + (position.z - a.z) * dz) / length ** 2));
		const offset = Math.hypot(position.x - a.x - t * dx, position.z - a.z - t * dz);
		if (offset < best) {
			best = offset;
			progress = travelled + length * t;
		}
		travelled += length;
	}
	return { progress, offset: best, ahead: pointAlong(approach, progress + 10) };
}
