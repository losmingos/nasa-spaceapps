// Mars calendar helpers for Jarvis and scripts/build_meda.ts. Import-free (Node runs it directly).
//
// Time scale used everywhere here: the "local sol" of src/lib/mars-time.ts (jezeroTime): the Mars
// Sol Date (MSD) shifted to Jezero's local mean solar time, so floor() is the sol number shown in the
// visor ("Sol (MSD)") and the fraction is LMST / 24 h.
//
// Mars time: Allison & McEwen (2000) / NASA GISS Mars24 algorithm (same constants as mars-time.ts).
// Earth–Mars distance: JPL "Approximate Positions of the Planets", Keplerian elements valid
// 1800–2050 (Standish), https://ssd.jpl.nasa.gov/planets/approx_pos.html — ~1% in distance.

const SOL_DAYS = 1.0274912517;
const MS_PER_DAY = 86_400_000;
/** TT − UTC = 32.184 s + 37 leap seconds (no leap second since 2017). */
const TT_UTC_S = 69.184;
/** Jezero crater / Perseverance longitude (°E), as in mars-time.ts. */
export const JEZERO_LON_E = 77.41;
const MSD_AT_J2000 = 44796 - 0.0009626 - 4.5 / SOL_DAYS;
const RAD = Math.PI / 180;

/**
 * Mars 2020 mission sol = local sol − MISSION_SOL_OFFSET. Landing: 2021-02-18 20:55 UTC = MSD 52304.45,
 * ≈ 15:53 LMST at Jezero → local sol 52304.66, i.e. mission sol 0. Checked against the MEDA PDS labels
 * (sol 313 spans 2022-01-05T18:55Z – 2022-01-06T19:35Z; sol 1859 spans 2026-05-13T06:57Z – 2026-05-14T07:37Z).
 */
export const MISSION_SOL_OFFSET = 52304;

const daysSinceJ2000TT = (unixMs: number) => unixMs / MS_PER_DAY + 2440587.5 - 2451545 + TT_UTC_S / 86400;

/** Local (Jezero LMST) sol for a UTC instant; equals jezeroTime() in mars-time.ts. */
export function localSolAt(unixMs: number): number {
	return daysSinceJ2000TT(unixMs) / SOL_DAYS + MSD_AT_J2000 + JEZERO_LON_E / 360;
}

/** UTC instant (ms since 1970) of a local sol. Inverse of localSolAt. */
export function unixMsAtLocalSol(localSol: number): number {
	const dtJ2000 = (localSol - JEZERO_LON_E / 360 - MSD_AT_J2000) * SOL_DAYS;
	return (dtJ2000 - TT_UTC_S / 86400 + 2451545 - 2440587.5) * MS_PER_DAY;
}

const PERTURBATIONS = [
	[0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173], [0.0039, 1.1177, 191.837],
	[0.0037, 15.7866, 21.736], [0.0021, 2.1354, 15.704], [0.002, 2.4694, 95.528],
	[0.0018, 32.8493, 49.095]
] as const;
const sinD = (deg: number) => Math.sin(deg * RAD);
const mod360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Areocentric solar longitude Ls (°, 0–360) for a TT day count since J2000 (Mars24 B-1…B-5). */
function lsFromDays(dt: number): number {
	const m = 19.3871 + 0.52402073 * dt;
	const alphaFms = 270.3871 + 0.524038496 * dt;
	const pbs = PERTURBATIONS.reduce((s, [a, tau, phi]) => s + a * Math.cos((0.985626 * dt / tau + phi) * RAD), 0);
	const center = (10.691 + 3e-7 * dt) * sinD(m) + 0.623 * sinD(2 * m) + 0.05 * sinD(3 * m)
		+ 0.005 * sinD(4 * m) + 0.0005 * sinD(5 * m) + pbs;
	return mod360(alphaFms + center);
}

/** Ls (°) at a local sol. */
export const lsAtLocalSol = (localSol: number) => lsFromDays((localSol - JEZERO_LON_E / 360 - MSD_AT_J2000) * SOL_DAYS);

/** Mars year (Clancy et al. 2000 convention: MY 1 began at Ls 0 on 1955-04-11). */
export function marsYearAtLocalSol(localSol: number): number {
	const dt = (localSol - JEZERO_LON_E / 360 - MSD_AT_J2000) * SOL_DAYS;
	const MY1_START = -16336.5; // 1955-04-11 00:00 TT, days from J2000 (Ls ≈ 0)
	const n = (dt - MY1_START) / 686.9726;
	return 1 + Math.round(n - lsFromDays(dt) / 360);
}

/** LMST minutes after local midnight (0–1440). */
export const lmstMinutes = (localSol: number) => (((localSol % 1) + 1) % 1) * 1440;

/** "HH:MM" LMST. */
export function formatLmst(localSol: number): string {
	const m = Math.floor(lmstMinutes(localSol) + 1e-7) % 1440;
	return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// ---- Earth–Mars light time ----------------------------------------------------------------------

/** [a (AU), e, I, L, long. perihelion, long. ascending node] and their rates per Julian century. */
type Elements = readonly [number, number, number, number, number, number];
const EARTH: readonly [Elements, Elements] = [
	[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
	[0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]
];
const MARS: readonly [Elements, Elements] = [
	[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
	[0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]
];

/** Heliocentric ecliptic (J2000) position in AU. */
function helio([el0, rate]: readonly [Elements, Elements], T: number): [number, number, number] {
	const [a, e, i, L, varpi, node] = el0.map((v, k) => v + rate[k] * T);
	const omega = varpi - node;
	const M = mod360(L - varpi + 180) - 180;
	let E = M + (e / RAD) * sinD(M);
	for (let k = 0; k < 10; k++) {
		const dE = (M - (E - (e / RAD) * sinD(E))) / (1 - e * Math.cos(E * RAD));
		E += dE;
		if (Math.abs(dE) < 1e-8) break;
	}
	const xp = a * (Math.cos(E * RAD) - e);
	const yp = a * Math.sqrt(1 - e * e) * Math.sin(E * RAD);
	const [co, so, cn, sn, ci, si] = [omega, omega, node, node, i, i].map((d, k) => (k % 2 ? Math.sin : Math.cos)(d * RAD));
	return [
		(co * cn - so * sn * ci) * xp + (-so * cn - co * sn * ci) * yp,
		(co * sn + so * cn * ci) * xp + (-so * sn + co * cn * ci) * yp,
		so * si * xp + co * si * yp
	];
}

/** Earth–Mars distance (AU) at a UTC instant, or null outside the elements' 1800–2050 validity. */
export function earthMarsDistanceAu(unixMs: number): number | null {
	const T = daysSinceJ2000TT(unixMs) / 36525;
	if (!Number.isFinite(T) || T < -2 || T > 0.5) return null;
	const e = helio(EARTH, T);
	const m = helio(MARS, T);
	return Math.hypot(m[0] - e[0], m[1] - e[1], m[2] - e[2]);
}

/** One-way light time Earth ↔ Mars in minutes (1 AU = 499.004784 light-seconds), or null if out of range. */
export function signalDelayMinutes(unixMs: number): number | null {
	const d = earthMarsDistanceAu(unixMs);
	return d === null ? null : (d * 499.004784) / 60;
}
