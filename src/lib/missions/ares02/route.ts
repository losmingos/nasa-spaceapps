import type { Point } from '../../visor/terrain.js';
import { distanceBetween, pointAlong } from '../ares01/route.js';

export const bravo = { x: 800, z: -3395 };
export const handoff = { x: 800, z: -3372 };
export const startPoint = { x: 748, z: -3461 };
const bend = { x: 800, z: -3500 };
const farSide = { x: 838, z: -3490 };

function curve(start: Point, controlA: Point, controlB: Point, end: Point) {
	return Array.from({ length: 33 }, (_, i) => {
		const t = i / 32;
		const u = 1 - t;
		return {
			x: u ** 3 * start.x + 3 * u ** 2 * t * controlA.x + 3 * u * t ** 2 * controlB.x + t ** 3 * end.x,
			z: u ** 3 * start.z + 3 * u ** 2 * t * controlA.z + 3 * u * t ** 2 * controlB.z + t ** 3 * end.z
		};
	});
}

const approach = curve(startPoint, { x: 789, z: -3456 }, { x: 798.5, z: -3487 }, bend);
export const plannedRoute = [
	...approach,
	...curve(bend, { x: 803, z: -3526 }, { x: 838, z: -3523 }, farSide).slice(1),
	...curve(farSide, { x: 838, z: -3448 }, { x: 800, z: -3430 }, bravo).slice(1)
];

function length(points: readonly Point[]) {
	return points.slice(1).reduce((sum, point, i) => sum + distanceBetween(points[i], point), 0);
}

const faultIndex = 24;
export const faultProgress = length(approach.slice(0, faultIndex + 1));
export const plannedLength = length(plannedRoute);
export const directLength = distanceBetween(approach[faultIndex], bravo);

export function plannedNavigation(position: Point) {
	let best = Infinity;
	let travelled = 0;
	let progress = 0;
	for (let i = 1; i < plannedRoute.length; i++) {
		const a = plannedRoute[i - 1];
		const b = plannedRoute[i];
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
	return { progress, offset: best, ahead: pointAlong(plannedRoute, progress + 10) };
}
