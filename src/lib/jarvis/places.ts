// Live distance and bearing from the astronaut to named places (rover, sample site, base…), computed on the
// client from the visor camera position at the moment a question is asked, and sent with the chat request.
// Coordinates are terrain mesh metres: +x east, +z south (so −z is north), the same frame as the ARES-01 route.

export interface PlanePoint {
	x: number;
	z: number;
}

export interface PlaceFix {
	/** Straight-line distance in metres (not along the walking corridor). */
	distance_m: number;
	/** Compass bearing from the astronaut, degrees clockwise from north. */
	bearing_deg: number;
	/** 8-point compass direction in words, for speech. */
	direction: string;
}

export type Places = Record<string, PlaceFix>;

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

export function placeFix(from: PlanePoint, to: PlanePoint): PlaceFix {
	const dx = to.x - from.x;
	const dNorth = -(to.z - from.z);
	const bearing = (Math.atan2(dx, dNorth) * 180) / Math.PI;
	const bearing_deg = Math.round((bearing + 360) % 360);
	return {
		distance_m: Math.round(Math.hypot(dx, dNorth)),
		bearing_deg,
		direction: COMPASS[Math.round(bearing_deg / 45) % 8]
	};
}

/** Distances from `from` to every named place. */
export function placesFrom(from: PlanePoint, targets: Record<string, PlanePoint>): Places {
	const out: Places = {};
	for (const [name, point] of Object.entries(targets)) out[name] = placeFix(from, point);
	return out;
}
