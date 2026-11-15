export interface GeologyFeature {
	attributes: { unit?: string; name?: string };
	geometry?: { rings?: number[][][] };
}

export const DANGER_WEIGHTS = {
	slope: 0.30, soil: 0.20, rockProximity: 0.15,
	relief: 0.10, temperature: 0.15, visibility: 0.10
};

export const SOIL_FUSION = { prior: 0.70, texture: 0.30 };

export const DANGER_TUNING = {
	slopeOnsetDeg: 5,
	slopeMaxDeg: 20,
	rockProximityM: 4,
	rockHazardMinM: 1.2,
	rockHazardScale: 0.10,
	rockRingStrongM: 0.30,
	rockRingReferenceM: 0.5,
	hazardRadiusM: 32,
	coldOnsetC: -40,
	coldMaxC: -90
};

export const MATERIAL_RISK_BY_UNIT: Record<string, number> = {
	'0': 0.20, '1': 0.20, '2': 0.35, '3': 0.55, '7': 0.95,
	'8': 0.80, '10': 0.55, '11': 0.85
};

const jezeroBounds = { west: 77.34394372, east: 77.466254, south: 18.392143429723, north: 18.588734996352 };
const eqcRadius = 3_394_839.8133163;
const eqcLatitude = 18.49 * Math.PI / 180;
const eqcLongitude = 77.41;
const eqcRadians = Math.PI / 180;

const geologyColors: Record<string, string> = {
	'0': '#004deb', '1': '#0099ff', '2': '#eb4d80', '3': '#de4d00', '4': '#0000eb',
	'5': '#b300eb', '6': '#ebcc99', '7': '#ffff00', '8': '#ccde99', '9': '#ebb3ff',
	'10': '#ffb300', '11': '#b3804d', '12': '#669900', '13': '#ebeb66'
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string): string {
	const h = hex.replace('#', '');
	const n = parseInt(h, 16);
	return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export function unitRisk(unit: string | undefined, name?: string): number {
	if (unit !== undefined && Object.prototype.hasOwnProperty.call(MATERIAL_RISK_BY_UNIT, unit)) {
		return MATERIAL_RISK_BY_UNIT[unit];
	}
	const lower = (name ?? '').toLowerCase();
	if (lower.includes('eolian')) return 0.95;
	if (lower.includes('smooth')) return 0.80;
	if (lower.includes('rim') || lower.includes('rock')) return 0.85;
	if (lower.includes('etched')) return 0.55;
	if (lower.includes('fan')) return 0.20;
	return 0.50;
}

function percentileFromHistogram(histogram: Uint32Array, total: number, fraction: number): number {
	const target = total * fraction;
	let cumulative = 0;
	for (let i = 0; i < histogram.length; i++) {
		cumulative += histogram[i];
		if (cumulative >= target) return i / (histogram.length - 1);
	}
	return 1;
}

export function textureRoughness(image: CanvasImageSource, columns: number, rows: number): Float32Array {
	const count = columns * rows;
	const result = new Float32Array(count);
	result.fill(Number.NaN);
	if (typeof document === 'undefined' || columns < 3 || rows < 3) return result;

	const canvas = document.createElement('canvas');
	canvas.width = columns;
	canvas.height = rows;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) return result;

	let pixels: Uint8ClampedArray;
	try {
		context.drawImage(image, 0, 0, columns, rows);
		pixels = context.getImageData(0, 0, columns, rows).data;
	} catch {
		return result;
	}

	const luminance = new Float32Array(count);
	const valid = new Uint8Array(count);
	for (let i = 0; i < count; i++) {
		if (pixels[i * 4 + 3] < 128) continue;
		valid[i] = 1;
		luminance[i] = (pixels[i * 4] * 0.2126 + pixels[i * 4 + 1] * 0.7152 + pixels[i * 4 + 2] * 0.0722) / 255;
	}

	for (let row = 1; row < rows - 1; row++) {
		for (let col = 1; col < columns - 1; col++) {
			const i = row * columns + col;
			if (!valid[i]) continue;
			let samples = 0;
			let sum = 0;
			let sumSquares = 0;
			for (let dr = -1; dr <= 1; dr++) {
				for (let dc = -1; dc <= 1; dc++) {
					const j = i + dr * columns + dc;
					if (!valid[j]) continue;
					const value = luminance[j];
					samples++;
					sum += value;
					sumSquares += value * value;
				}
			}
			if (samples < 2) continue;
			const mean = sum / samples;
			result[i] = Math.sqrt(Math.max(0, sumSquares / samples - mean * mean));
		}
	}

	const histogram = new Uint32Array(256);
	let samples = 0;
	for (let i = 0; i < count; i++) {
		const value = result[i];
		if (!Number.isFinite(value)) continue;
		histogram[Math.min(255, Math.max(0, Math.round(value * 255)))]++;
		samples++;
	}
	if (!samples) return result;

	const low = percentileFromHistogram(histogram, samples, 0.10);
	const high = percentileFromHistogram(histogram, samples, 0.90);
	const span = high - low;
	if (span <= 1e-4) {
		for (let i = 0; i < count; i++) {
			if (Number.isFinite(result[i])) result[i] = 0.5;
		}
		return result;
	}

	for (let i = 0; i < count; i++) {
		const value = result[i];
		if (!Number.isFinite(value)) continue;
		result[i] = clamp((value - low) / span, 0, 1);
	}
	return result;
}

export function fuseSoilRisk(prior: Float32Array, texture?: Float32Array): Float32Array {
	if (!texture) return prior;
	const fused = new Float32Array(prior.length);
	for (let i = 0; i < prior.length; i++) {
		const evidence = texture[i];
		fused[i] = clamp(
			SOIL_FUSION.prior * prior[i] + SOIL_FUSION.texture * (Number.isFinite(evidence) ? evidence : prior[i]),
			0, 1
		);
	}
	return fused;
}

function projectX(longitude: number): number {
	return eqcRadius * Math.cos(eqcLatitude) * (longitude - eqcLongitude) * eqcRadians;
}

function projectY(latitude: number): number {
	return eqcRadius * latitude * eqcRadians;
}

function insideRings(rings: number[][][], lon: number, lat: number): boolean {
	let parity = false;
	for (const ring of rings) {
		let j = ring.length - 1;
		for (let i = 0; i < ring.length; i++) {
			const xi = ring[i][0], yi = ring[i][1];
			const xj = ring[j][0], yj = ring[j][1];
			const intersect = ((yi > lat) !== (yj > lat))
				&& (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
			if (intersect) parity = !parity;
			j = i;
		}
	}
	return parity;
}

function rasterizeMaterial(columns: number, rows: number, geology: readonly GeologyFeature[] | undefined): Float32Array {
	const count = columns * rows;
	const material = new Float32Array(count);
	for (let i = 0; i < count; i++) material[i] = 0.5;

	const features = geology ?? [];
	let canvasUsed = false;
	if (typeof document !== 'undefined') {
		const canvas = document.createElement('canvas');
		canvas.width = columns;
		canvas.height = rows;
		const ctx = canvas.getContext('2d');
		if (ctx) {
			const left = projectX(jezeroBounds.west);
			const right = projectX(jezeroBounds.east);
			const bottom = projectY(jezeroBounds.south);
			const top = projectY(jezeroBounds.north);
			for (const feature of features) {
				const unit = String(feature.attributes?.unit ?? '');
				const rings = feature.geometry?.rings;
				if (!rings?.length) continue;
				ctx.beginPath();
				for (const ring of rings) {
					for (let i = 0; i < ring.length; i++) {
						const [longitude, latitude] = ring[i];
						const x = (projectX(longitude) - left) / (right - left) * columns;
						const y = (top - projectY(latitude)) / (top - bottom) * rows;
						if (i === 0) ctx.moveTo(x, y);
						else ctx.lineTo(x, y);
					}
					ctx.closePath();
				}
				ctx.fillStyle = geologyColors[unit] ?? '#777777';
				ctx.fill('evenodd');
			}
			const img = ctx.getImageData(0, 0, columns, rows).data;
			let hasPaint = false;
			for (let i = 3; i < img.length; i += 4) {
				if (img[i] !== 0) { hasPaint = true; break; }
			}
			if (hasPaint) {
				const colorToUnit = new Map<string, string>();
				for (const [unit, color] of Object.entries(geologyColors)) colorToUnit.set(hexToRgb(color), unit);
				for (let i = 0; i < count; i++) {
					const key = `${img[i * 4]},${img[i * 4 + 1]},${img[i * 4 + 2]}`;
					const unit = colorToUnit.get(key);
					material[i] = unit !== undefined ? unitRisk(unit) : 0.5;
				}
				canvasUsed = true;
			}
		}
	}

	if (!canvasUsed) {
		const left = projectX(jezeroBounds.west);
		const right = projectX(jezeroBounds.east);
		const bottom = projectY(jezeroBounds.south);
		const top = projectY(jezeroBounds.north);
		const dx = right - left;
		const dy = top - bottom;
		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < columns; col++) {
				const px = col + 0.5;
				const py = row + 0.5;
				const projX = left + (px / columns) * dx;
				const projY = top - (py / rows) * dy;
				const lon = eqcLongitude + projX / (eqcRadius * Math.cos(eqcLatitude) * eqcRadians);
				const lat = projY / (eqcRadius * eqcRadians);
				let unit: string | undefined;
				for (const feature of features) {
					const rings = feature.geometry?.rings;
					if (!rings?.length) continue;
					if (insideRings(rings, lon, lat)) unit = String(feature.attributes?.unit ?? '');
				}
				material[row * columns + col] = unit !== undefined ? unitRisk(unit) : 0.5;
			}
		}
	}

	return material;
}

export function computeStaticRisk(input: {
	elevations: Float32Array;
	columns: number;
	rows: number;
	spacing: number;
	geology: readonly GeologyFeature[] | undefined;
	texture?: Float32Array;
	hazard: { x: number; z: number; radius: number };
	width: number;
	length: number;
}): Float32Array {
	const { elevations, columns, rows, spacing, geology, texture, hazard, width, length } = input;
	const count = columns * rows;
	const result = new Float32Array(count);
	const soil = fuseSoilRisk(
		rasterizeMaterial(columns, rows, geology),
		texture?.length === count ? texture : undefined
	);

	const radius = Number.isFinite(hazard.radius) ? hazard.radius : DANGER_TUNING.hazardRadiusM;

	for (let i = 0; i < count; i++) {
		if (!Number.isFinite(elevations[i])) result[i] = 1;
	}

	for (let row = 1; row < rows - 1; row++) {
		for (let col = 1; col < columns - 1; col++) {
			const i = row * columns + col;
			if (!Number.isFinite(elevations[i])) { result[i] = 1; continue; }
			const west = elevations[i - 1];
			const east = elevations[i + 1];
			const north = elevations[i - columns];
			const south = elevations[i + columns];
			if (![west, east, north, south].every(Number.isFinite)) continue;

			const grade = Math.atan(Math.hypot((east - west) / (2 * spacing), (south - north) / (2 * spacing))) * 180 / Math.PI;
			const slopeNorm = clamp((grade - DANGER_TUNING.slopeOnsetDeg) / (DANGER_TUNING.slopeMaxDeg - DANGER_TUNING.slopeOnsetDeg), 0, 1);

			const neighbors = [west, east, north, south];
			const minN = Math.min(...neighbors);
			const maxN = Math.max(...neighbors);
			const relief = clamp((maxN - minN) / spacing, 0, 1);

			const soilRisk = soil[i];
			const staticScore = clamp(
				(slopeNorm * DANGER_WEIGHTS.slope + soilRisk * DANGER_WEIGHTS.soil + relief * DANGER_WEIGHTS.relief)
				/ (DANGER_WEIGHTS.slope + DANGER_WEIGHTS.soil + DANGER_WEIGHTS.relief),
				0, 1
			);

			const x = col * spacing - width / 2;
			const z = row * spacing - length / 2;
			const inHazard = Math.hypot(x - hazard.x, z - hazard.z) <= radius;
			result[i] = inHazard ? 1 : staticScore;
		}
	}

	return result;
}

export function rockProximityRisk(x: number, z: number, rocks: readonly { bounds: { min: { x: number; z: number }; max: { x: number; z: number } }; scale: number }[]): number {
	let maxRisk = 0;
	for (const rock of rocks) {
		if (rock.scale < DANGER_TUNING.rockHazardMinM) continue;
		const b = rock.bounds;
		const cx = (b.min.x + b.max.x) / 2;
		const cz = (b.min.z + b.max.z) / 2;
		const sx = b.max.x - b.min.x;
		const sz = b.max.z - b.min.z;
		const rockRadius = Math.max(sx, sz) / 2;
		const distanceToSurface = Math.hypot(x - cx, z - cz) - rockRadius;
		const t = clamp(distanceToSurface / (DANGER_TUNING.rockProximityM * DANGER_TUNING.rockHazardScale), 0, 1);
		const smooth = t * t * (3 - 2 * t);
		const risk = 1 - smooth;
		if (risk > maxRisk) maxRisk = risk;
	}
	return maxRisk;
}

export function temperatureRisk(groundTempC: number | null): number {
	if (groundTempC === null) return 0;
	if (groundTempC >= DANGER_TUNING.coldOnsetC) return 0;
	if (groundTempC <= DANGER_TUNING.coldMaxC) return 1;
	return (DANGER_TUNING.coldOnsetC - groundTempC) / (DANGER_TUNING.coldOnsetC - DANGER_TUNING.coldMaxC);
}

export function visibilityRisk(dust: number, wind: number): number {
	return clamp(dust * 0.85 + clamp(wind / 25, 0, 1) * 0.15, 0, 1);
}

export function dangerScore(staticScore: number, rockRisk: number, tempRisk: number, visRisk: number): number {
	return clamp(
		(DANGER_WEIGHTS.slope + DANGER_WEIGHTS.soil + DANGER_WEIGHTS.relief) * staticScore
		+ DANGER_WEIGHTS.rockProximity * rockRisk
		+ DANGER_WEIGHTS.temperature * tempRisk
		+ DANGER_WEIGHTS.visibility * visRisk,
		0, 1
	);
}

export function dangerColor(score: number): [number, number, number] {
	const green = [46, 150, 101];
	const amber = [222, 163, 62];
	const red = [207, 77, 67];
	let t: number;
	let a: number[];
	let b: number[];
	if (score <= 0.5) {
		t = score / 0.5;
		a = green;
		b = amber;
	} else {
		t = (score - 0.5) / 0.5;
		a = amber;
		b = red;
	}
	return [
		a[0] + (b[0] - a[0]) * t,
		a[1] + (b[1] - a[1]) * t,
		a[2] + (b[2] - a[2]) * t
	];
}

export const DANGER_LEGEND = [
	{ max: 0.33, color: '#2e9665', label: 'Low' },
	{ max: 0.66, color: '#dea33e', label: 'Moderate' },
	{ max: 1, color: '#cf4d43', label: 'High' }
];
