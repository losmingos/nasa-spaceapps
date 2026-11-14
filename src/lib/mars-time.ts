const solLength = 1.0274912517;
const msPerDay = 86_400_000;
const longitude = 77.41;
const radians = Math.PI / 180;
const latitude = 18.49 * radians;
const msdAtJ2000 = 44796 - 0.0009626 - 4.5 / solLength;

// NASA GISS Mars24, with the current TT–UTC offset.
export function jezeroTime(now: number) {
	return (now / msPerDay + 2440587.5 - 2451545 + 69.184 / 86400) / solLength
		+ msdAtJ2000 + longitude / 360;
}

/** UT-like elapsed Earth days from J2000, derived from the Mars Sol Date. */
export function daysSinceJ2000(localSol: number) {
	return (localSol - longitude / 360 - msdAtJ2000) * solLength;
}

const perturbations = [
	[0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173], [0.0039, 1.1177, 191.837],
	[0.0037, 15.7866, 21.736], [0.0021, 2.1354, 15.704], [0.0020, 2.4694, 95.528],
	[0.0018, 32.8493, 49.095]
];
const sin = (degrees: number) => Math.sin(degrees * radians);

export function solarPosition(localSol: number) {
	const days = daysSinceJ2000(localSol);
	const anomaly = 19.3871 + 0.52402073 * days;
	const perturbation = perturbations.reduce((sum, [amplitude, period, phase]) =>
		sum + amplitude * Math.cos((0.985626 * days / period + phase) * radians), 0);
	const center = (10.691 + 3e-7 * days) * sin(anomaly) + 0.623 * sin(2 * anomaly)
		+ 0.050 * sin(3 * anomaly) + 0.005 * sin(4 * anomaly) + 0.0005 * sin(5 * anomaly)
		+ perturbation;
	const season = 270.3871 + 0.524038496 * days + center;
	const equationOfTime = 2.861 * sin(2 * season) - 0.071 * sin(4 * season)
		+ 0.002 * sin(6 * season) - center;
	const declination = Math.asin(0.42565 * sin(season)) + 0.25 * radians * sin(season);
	const angle = ((localSol - Math.floor(localSol) - 0.5) * 360 + equationOfTime) * radians;
	const east = -Math.cos(declination) * Math.sin(angle);
	const up = Math.sin(latitude) * Math.sin(declination)
		+ Math.cos(latitude) * Math.cos(declination) * Math.cos(angle);
	const north = Math.cos(latitude) * Math.sin(declination)
		- Math.sin(latitude) * Math.cos(declination) * Math.cos(angle);
	return { east, up, north };
}

export function formatMarsTime(localSol: number) {
	const minutes = Math.floor((localSol - Math.floor(localSol)) * 1440 + 1e-7) % 1440;
	return [Math.floor(minutes / 60), minutes % 60].map((value) => String(value).padStart(2, '0')).join(':');
}
