import { daysSinceJ2000 } from './mars-time.js';

type Vec3 = { x: number; y: number; z: number };
type MoonSkyPosition = { east: number; up: number; north: number; angularRadius: number };

export interface MartianMoons {
	phobos: MoonSkyPosition;
	deimos: MoonSkyPosition;
}

const radians = Math.PI / 180;
const marsPoleRa = 317.68143 * radians;
const marsPoleDec = 52.8865 * radians;
const jezeroLongitude = 77.41 * radians;
const jezeroLatitude = 18.49 * radians;
const marsEquatorialRadiusKm = 3396.19;
const marsPolarRadiusKm = 3376.2;

// Mean elements at J2000 from JPL SSD. These give a visual, analytical orbit;
// JPL Horizons/SPICE is required for mission-grade topocentric ephemerides.
const orbit = {
	phobos: { a: 9375, e: 0.015, w: 216.3, m: 189.7, i: 1.1, node: 169.2, period: 0.3187, radius: 11.08 },
	deimos: { a: 23457, e: 0, w: 0, m: 205, i: 1.8, node: 54.3, period: 1.2625, radius: 6.2 }
} as const;

function add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(a: Vec3, s: number): Vec3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
function dot(a: Vec3, b: Vec3) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vec3, b: Vec3): Vec3 {
	return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function normalize(a: Vec3): Vec3 {
	const length = Math.hypot(a.x, a.y, a.z) || 1;
	return scale(a, 1 / length);
}

function eccentricAnomaly(mean: number, eccentricity: number) {
	let value = mean;
	for (let i = 0; i < 6; i++) value -= (value - eccentricity * Math.sin(value) - mean)
		/ (1 - eccentricity * Math.cos(value));
	return value;
}

function moonPosition(name: keyof typeof orbit, days: number, laplacePole: Vec3): Vec3 {
	const el = orbit[name];
	const inclination = el.i * radians;
	const node = el.node * radians;
	const periapsis = el.w * radians;
	const mean = (el.m + 360 * days / el.period) * radians;
	const anomaly = eccentricAnomaly(mean, el.e);
	const nodeReference = normalize(cross({ x: 0, y: 0, z: 1 }, laplacePole));
	const nodeAcross = normalize(cross(laplacePole, nodeReference));
	const ascendingNode = add(scale(nodeReference, Math.cos(node)), scale(nodeAcross, Math.sin(node)));
	const inPlane = add(scale(nodeAcross, Math.cos(node)), scale(nodeReference, -Math.sin(node)));
	const minorAxis = add(scale(inPlane, Math.cos(inclination)), scale(laplacePole, Math.sin(inclination)));
	const periapsisAxis = add(scale(ascendingNode, Math.cos(periapsis)), scale(minorAxis, Math.sin(periapsis)));
	const quadratureAxis = add(scale(ascendingNode, -Math.sin(periapsis)), scale(minorAxis, Math.cos(periapsis)));
	return add(
		scale(periapsisAxis, el.a * (Math.cos(anomaly) - el.e)),
		scale(quadratureAxis, el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(anomaly))
	);
}

/** Approximate topocentric moon directions at Jezero for a Mars Sol Date. */
export function martianMoons(localSol: number): MartianMoons {
	const days = daysSinceJ2000(localSol);
	const pole: Vec3 = {
		x: Math.cos(marsPoleDec) * Math.cos(marsPoleRa),
		y: Math.cos(marsPoleDec) * Math.sin(marsPoleRa),
		z: Math.sin(marsPoleDec)
	};
	const primeMeridian: Vec3 = { x: -Math.sin(marsPoleRa), y: Math.cos(marsPoleRa), z: 0 };
	const eastAtPrime = normalize(cross(pole, primeMeridian));
	const rotation = (176.630 + 350.89198226 * days) * radians;
	const meridian = add(scale(primeMeridian, Math.cos(rotation)), scale(eastAtPrime, Math.sin(rotation)));
	const eastMeridian = add(scale(primeMeridian, -Math.sin(rotation)), scale(eastAtPrime, Math.cos(rotation)));
	const cosLat = Math.cos(jezeroLatitude);
	const siteUp = normalize(add(add(scale(meridian, cosLat * Math.cos(jezeroLongitude)),
		scale(eastMeridian, cosLat * Math.sin(jezeroLongitude))), scale(pole, Math.sin(jezeroLatitude))));
	const east = normalize(add(scale(meridian, -Math.sin(jezeroLongitude)),
		scale(eastMeridian, Math.cos(jezeroLongitude))));
	const north = normalize(cross(siteUp, east));
	const radius = 1 / Math.sqrt((cosLat / marsEquatorialRadiusKm) ** 2
		+ (Math.sin(jezeroLatitude) / marsPolarRadiusKm) ** 2);
	const observer = scale(siteUp, radius);
	const moonPole: Vec3 = {
		x: Math.cos(52.9 * radians) * Math.cos(317.7 * radians),
		y: Math.cos(52.9 * radians) * Math.sin(317.7 * radians),
		z: Math.sin(52.9 * radians)
	};
	function toSky(name: keyof typeof orbit): MoonSkyPosition {
		const moon = moonPosition(name, days, moonPole);
		const relative = add(moon, scale(observer, -1));
		const distance = Math.hypot(relative.x, relative.y, relative.z);
		const direction = normalize(relative);
		return {
			east: dot(direction, east),
			up: dot(direction, siteUp),
			north: dot(direction, north),
			angularRadius: Math.asin(Math.min(1, orbit[name].radius / distance))
		};
	}
	return { phobos: toSky('phobos'), deimos: toSky('deimos') };
}
