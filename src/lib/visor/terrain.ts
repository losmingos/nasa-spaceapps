import {
	BufferAttribute, BufferGeometry, CanvasTexture, Color, DataTexture, DirectionalLight, DoubleSide, FogExp2, HemisphereLight, LinearFilter, MathUtils,
	IcosahedronGeometry, InstancedMesh, LineSegments, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, NormalBlending, Object3D, PCFShadowMap, RGBAFormat, ShaderMaterial, SpotLight,
	PerspectiveCamera, Quaternion, Raycaster, Scene, SRGBColorSpace, UnsignedByteType,
	Texture, TextureLoader, Vector3, WebGLRenderer
} from 'three';
import {
	buildVisorOptics, drawHudTime, drawSwirHud, dustColor, mountHeadLockedHud,
	SWIR_DEPTH_RESPONSE_GLSL, SWIR_NOISE_GLSL,
	type SwirHudData, type VisorMessage, type VisorReadings
} from './optics.js';
import { buildRoverCabin } from './rover-cabin.js';
import { createXrPointer, drawXrMenu, xrMenuIndex, xrStick, type XrMenuPage } from './xr-controls.js';
import type { Exertion } from '../jarvis/types.js';
import { solarPosition } from './mars-time.js';
import { martianMoons } from './mars-moons.js';
import { createRockContact, footingOnRocks, type RockContact } from './rock-contact.js';
import { HAZARD, HAZARD_RADIUS } from '../missions/ares01/route.js';
import { weatherAt } from '../jarvis/weather.js';
import {
	computeStaticRisk, dangerColor, dangerScore, temperatureRisk, visibilityRisk,
	rockProximityRisk, textureRoughness, DANGER_TUNING
} from './danger.js';
import { createDangerRings } from './danger-visuals.js';

const elevationColors = ['#92563a', '#b47a54', '#c29169'];
const clearDustDensity = 0.00048;

export type TerrainDisplayMode = 'visible' | 'danger' | 'swir';

interface XrControls {
	onEnd: () => void;
	onTalkStart: () => void;
	onTalkEnd: () => void;
	onToggleSwir: () => void;
	onToggleFlashlight: () => void;
	onMenuOpen: () => void;
	getMenu: () => XrMenuPage;
	getMissionScreen: () => 'briefing' | 'complete' | undefined;
	getAction: () => string | undefined;
	getVoiceLabel: () => string;
}

export interface GeologyData {
	features: Array<{
		attributes: { unit?: string; name?: string };
		geometry?: { rings?: number[][][] };
	}>;
}

const jezeroBounds = { west: 77.34394372, east: 77.466254, south: 18.392143429723, north: 18.588734996352 };
const eqcRadius = 3_394_839.8133163;
const eqcLatitude = 18.49 * Math.PI / 180;
const eqcLongitude = 77.41;
const eqcRadians = Math.PI / 180;
// ponytail: map-unit SWIR values are visual proxies, not measured spectra; use CRISM if measured reflectance is required.
const swirAlbedo: Record<string, number> = {
	'0': 0.78, // Jezero fan 2 â€” dusty sediment
	'1': 0.75, // Jezero fan 1 â€” dusty sediment
	'2': 0.72, // crater floor â€” fine regolith
	'3': 0.68, // lower etched unit
	'7': 0.85, // eolian bedform â€” loose dust
	'8': 0.82, // smooth unit â€” loose regolith
	'10': 0.70, // upper etched unit
	'11': 0.22 // crater rim â€” exposed rock proxy
};

type SwirMaterial = MeshStandardMaterial | MeshLambertMaterial;

export function installSwirMaterialResponse(material: SwirMaterial, albedo: number, mapCarriesAlbedo = false) {
	const previousHook = material.onBeforeCompile;
	const previousKey = material.customProgramCacheKey.bind(material);
	let enabled = 0;
	let time = 0;
	let compiled: { uniforms: Record<string, { value: unknown }> } | undefined;
	material.onBeforeCompile = (shader, renderer) => {
		previousHook(shader, renderer);
		shader.uniforms.swirMaterialMode = { value: enabled };
		shader.uniforms.swirReflectance = { value: albedo };
		shader.uniforms.swirMapAlbedo = { value: Number(mapCarriesAlbedo) };
		shader.uniforms.swirTime = { value: time };
		shader.fragmentShader = `uniform float swirMaterialMode;
			uniform float swirReflectance;
			uniform float swirMapAlbedo;
			uniform float swirTime;
		` + SWIR_NOISE_GLSL + SWIR_DEPTH_RESPONSE_GLSL + shader.fragmentShader.replace(
			'#include <lights_fragment_begin>',
			`float swirVisible = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
			float swirBase = mix(swirReflectance, swirVisible, swirMapAlbedo);
			float swirShadowGain = 1.0 - smoothstep(0.03, 0.5, swirBase);
			float swirDistance = length(vViewPosition);
			float swirMid = swirMidHaze(swirDistance);
			float swirFar = swirFarBlur(swirDistance);
			float swirDetail = mix(1.12, 0.58, clamp(swirMid * 0.6 + swirFar * 0.4, 0.0, 1.0))
				* mix(0.92, 1.08, swirVisible);
			float swirValue = clamp(swirBase * swirDetail
				+ (swirSensorNoise(gl_FragCoord.xy, swirTime) - 0.5) * 0.026 * swirShadowGain, 0.0, 1.0);
			swirValue = mix(swirValue, 0.42, swirFar * 0.72);
			diffuseColor.rgb = mix(diffuseColor.rgb, vec3(swirValue), swirMaterialMode);
			totalEmissiveRadiance = mix(totalEmissiveRadiance,
				vec3(dot(totalEmissiveRadiance, vec3(0.2126, 0.7152, 0.0722))), swirMaterialMode);
			#include <lights_fragment_begin>`
		);
		compiled = shader as unknown as typeof compiled;
	};
	material.customProgramCacheKey = () => `${previousKey()}|swir:${albedo}:${Number(mapCarriesAlbedo)}`;
	return (swir: boolean, frameTime = 0) => {
		enabled = Number(swir);
		time = frameTime;
		if (compiled) {
			compiled.uniforms.swirMaterialMode.value = enabled;
			compiled.uniforms.swirTime.value = time;
		}
	};
}

export function createSaltationGrains() {
	// ponytail: 480 bounded streaks visualize near-field grains; full particulate optics stay in the dust shader.
	const count = 480;
	const random = seededRandom(0x51a7a710);
	const positions = new Float32Array(count * 6);
	const colors = new Float32Array(count * 6);
	const alphas = new Float32Array(count * 2);
	const offsets = Array.from({ length: count }, () => {
		const radius = 0.5 + random() * 5.5;
		const angle = random() * Math.PI * 2;
		const bright = random() > 0.3;
		const value = bright ? 0.72 + random() * 0.25 : 0.08 + random() * 0.12;
		const alpha = bright ? 0.72 + random() * 0.22 : 0.18 + random() * 0.12;
		const trail = 0.025 + random() * 0.11;
		return { x: Math.cos(angle) * radius, y: (random() - 0.52) * 2.2, z: Math.sin(angle) * radius, trail, value, alpha };
	});
	for (let i = 0; i < count; i++) {
		const { value, alpha } = offsets[i];
		colors.set([value, value, value, value * 0.28, value * 0.28, value * 0.28], i * 6);
		alphas[i * 2] = alpha;
		alphas[i * 2 + 1] = alpha * 0.35;
	}
	const geometry = new BufferGeometry();
	const positionAttribute = new BufferAttribute(positions, 3);
	geometry.setAttribute('position', positionAttribute);
	geometry.setAttribute('color', new BufferAttribute(colors, 3));
	geometry.setAttribute('alpha', new BufferAttribute(alphas, 1));
	const material = new ShaderMaterial({
		uniforms: { uSwir: { value: 0 } },
		vertexShader: `
			attribute vec3 color;
			attribute float alpha;
			varying vec3 vColor;
			varying float vAlpha;
			void main() {
				vColor = color;
				vAlpha = alpha;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
			uniform float uSwir;
			varying vec3 vColor;
			varying float vAlpha;
			void main() {
				if (vAlpha < 0.05) discard;
				vec3 visible = mix(vec3(0.34, 0.18, 0.08), vec3(0.95, 0.58, 0.24), vColor.r);
				vec3 swir = mix(vec3(0.62, 0.70, 0.76), vec3(1.0), vColor.r);
				gl_FragColor = vec4(mix(visible, swir, uSwir), vAlpha * mix(0.55, 0.9, uSwir));
			}
		`,
		transparent: true,
		depthWrite: false,
		blending: NormalBlending
	});
	const object = new LineSegments(geometry, material);
	object.frustumCulled = false;
	object.visible = false;
	const wind = new Vector3(0.94, 0, 0.34).normalize();
	return {
		object,
		update(camera: Vector3, elapsed: number, windSpeed: number, active: boolean, swir = false) {
			material.uniforms.uSwir.value = Number(swir);
			object.visible = active;
			if (!active) return;
			const drift = elapsed * windSpeed;
			for (let i = 0; i < count; i++) {
				const grain = offsets[i];
				const x = camera.x + ((grain.x + drift + 6) % 12 + 12) % 12 - 6;
				const y = camera.y + grain.y;
				const z = camera.z + grain.z;
				const start = i * 6;
				positions[start] = x;
				positions[start + 1] = y;
				positions[start + 2] = z;
				positions[start + 3] = x - wind.x * grain.trail;
				positions[start + 4] = y - 0.004;
				positions[start + 5] = z - wind.z * grain.trail;
			}
			positionAttribute.needsUpdate = true;
		},
		dispose() {
			geometry.dispose();
			material.dispose();
		}
	};
}

function materialMaps(data: GeologyData | undefined, columns: number, rows: number) {
	const swirCanvas = document.createElement('canvas');
	swirCanvas.width = columns;
	swirCanvas.height = rows;
	const swirContext = swirCanvas.getContext('2d');
	if (!swirContext) return undefined;
	swirContext.fillStyle = '#808080';
	swirContext.fillRect(0, 0, columns, rows);
	const projectX = (longitude: number) => eqcRadius * Math.cos(eqcLatitude)
		* (longitude - eqcLongitude) * eqcRadians;
	const projectY = (latitude: number) => eqcRadius * latitude * eqcRadians;
	const left = projectX(jezeroBounds.west), right = projectX(jezeroBounds.east);
	const bottom = projectY(jezeroBounds.south), top = projectY(jezeroBounds.north);
	for (const feature of data?.features ?? []) {
		const unit = String(feature.attributes.unit ?? '');
		const rings = feature.geometry?.rings;
		if (!rings?.length) continue;
		swirContext.beginPath();
		for (const ring of rings) {
			for (let i = 0; i < ring.length; i++) {
				const [longitude, latitude] = ring[i];
				const x = (projectX(longitude) - left) / (right - left) * columns;
				const y = (top - projectY(latitude)) / (top - bottom) * rows;
				if (i === 0) swirContext.moveTo(x, y);
				else swirContext.lineTo(x, y);
			}
			swirContext.closePath();
		}
		const gray = Math.round((swirAlbedo[unit] ?? 0.5) * 255);
		swirContext.fillStyle = `rgb(${gray} ${gray} ${gray})`;
		swirContext.fill('evenodd');
	}
	return { swirCanvas };
}

function dangerTexture(risk: Float32Array, columns: number, rows: number) {
	const canvas = document.createElement('canvas');
	canvas.width = columns;
	canvas.height = rows;
	const context = canvas.getContext('2d');
	if (!context) return undefined;
	const pixels = context.createImageData(columns, rows);
	for (let i = 0; i < risk.length; i++) {
		const [r, g, b] = dangerColor(risk[i]);
		pixels.data.set([r, g, b, 255], i * 4);
	}
	context.putImageData(pixels, 0, 0);
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	return texture;
}

function buildSwirTexture(image: CanvasImageSource, mask: HTMLCanvasElement, columns: number, rows: number,
	elevations: Float32Array, spacing: number) {
	const canvas = document.createElement('canvas');
	const albedoCanvas = document.createElement('canvas');
	canvas.width = columns;
	canvas.height = rows;
	albedoCanvas.width = columns;
	albedoCanvas.height = rows;
	const context = canvas.getContext('2d');
	const maskContext = albedoCanvas.getContext('2d');
	if (!context || !maskContext) return undefined;
	context.drawImage(image, 0, 0, columns, rows);
	maskContext.drawImage(mask, 0, 0, columns, rows);
	const pixels = context.getImageData(0, 0, columns, rows).data;
	const material = maskContext.getImageData(0, 0, columns, rows).data;
	const data = new Uint8Array(columns * rows * 4);
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < columns; col++) {
			const i = row * columns + col;
			const luma = (pixels[i * 4] * 0.2126 + pixels[i * 4 + 1] * 0.7152 + pixels[i * 4 + 2] * 0.0722) / 255;
			const unit = material[i * 4] / 255;
			let grade = 0;
			if (row > 0 && col > 0 && row < rows - 1 && col < columns - 1) {
				const west = elevations[i - 1], east = elevations[i + 1];
				const north = elevations[i - columns], south = elevations[i + columns];
				if ([west, east, north, south].every(Number.isFinite)) {
					grade = Math.atan(Math.hypot((east - west) / (2 * spacing), (south - north) / (2 * spacing))) * 180 / Math.PI;
				}
			}
			const exposed = MathUtils.clamp((grade - 4) / 16, 0, 1);
			const dust = unit * (0.86 + 0.14 * luma);
			const value = Math.round(MathUtils.clamp(MathUtils.lerp(dust, 0.18, exposed), 0.15, 0.90) * 255);
			const out = ((rows - 1 - row) * columns + col) * 4;
			data[out] = data[out + 1] = data[out + 2] = value;
			data[out + 3] = 255;
		}
	}
	// Reflectance values are linear data, not sRGB display colors.
	const texture = new DataTexture(data, columns, rows, RGBAFormat, UnsignedByteType);
	texture.minFilter = LinearFilter;
	texture.magFilter = LinearFilter;
	texture.flipY = false;
	texture.needsUpdate = true;
	return texture;
}

function buildTerrain(data: ArrayBuffer) {
	const header = new DataView(data);
	const columns = header.getUint32(0, true);
	const rows = header.getUint32(4, true);
	const spacing = header.getFloat32(8, true);
	const count = columns * rows;
	if (columns < 2 || rows < 2 || data.byteLength !== 12 + count * 4 || !Number.isFinite(spacing) || !(spacing > 0)) {
		throw new Error('Invalid elevation grid.');
	}

	const elevations = new Float32Array(data, 12);
	let low = Infinity;
	let high = -Infinity;
	for (const height of elevations) {
		if (!Number.isFinite(height)) continue;
		low = Math.min(low, height);
		high = Math.max(high, height);
	}
	if (!(high > low)) throw new Error('No valid elevations found.');

	const width = (columns - 1) * spacing;
	const length = (rows - 1) * spacing;
	const positions = new Float32Array(count * 3);
	const colors = new Float32Array(count * 3);
	const uv = new Float32Array(count * 2);
	const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
	const [base, middle, peak] = elevationColors.map((hex) => new Color(hex));
	const color = new Color();
	let index = 0;
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < columns; col++) {
			const i = row * columns + col;
			const elevation = elevations[i];
			const present = Number.isFinite(elevation);
			const height = present ? elevation - low : 0;
			positions[i * 3] = col * spacing - width / 2;
			positions[i * 3 + 1] = height;
			positions[i * 3 + 2] = row * spacing - length / 2;
			uv[i * 2] = col / (columns - 1);
			uv[i * 2 + 1] = 1 - row / (rows - 1);

			const t = (height / (high - low)) ** 0.65;
			if (t < 0.5) color.copy(base).lerp(middle, t * 2);
			else color.copy(middle).lerp(peak, t * 2 - 1);
			color.toArray(colors, i * 3);

			if (row === rows - 1 || col === columns - 1) continue;
			const east = i + 1;
			const south = i + columns;
			const southeast = south + 1;
			const hasEast = Number.isFinite(elevations[east]);
			const hasSouth = Number.isFinite(elevations[south]);
			if (hasEast && hasSouth) {
				if (present) {
					indices[index++] = i;
					indices[index++] = south;
					indices[index++] = east;
				}
				if (Number.isFinite(elevations[southeast])) {
					indices[index++] = east;
					indices[index++] = south;
					indices[index++] = southeast;
				}
			}
		}
	}

	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(positions, 3));
	geometry.setAttribute('color', new BufferAttribute(colors, 3));
	geometry.setAttribute('uv', new BufferAttribute(uv, 2));
	geometry.setIndex(new BufferAttribute(indices.subarray(0, index), 1));
	geometry.computeVertexNormals();
	// Use the same diagonal and missing-sample rules as the rendered triangles.
	function surfaceHeight(x: number, z: number) {
		const gx = (x + width / 2) / spacing;
		const gz = (z + length / 2) / spacing;
		const col = Math.floor(gx);
		const row = Math.floor(gz);
		if (col < 0 || row < 0 || col >= columns - 1 || row >= rows - 1) return NaN;
		const i = row * columns + col;
		const u = gx - col;
		const v = gz - row;
		const east = elevations[i + 1];
		const south = elevations[i + columns];
		if (u + v <= 1) return elevations[i] * (1 - u - v) + east * u + south * v - low;
		return elevations[i + columns + 1] * (u + v - 1) + east * (1 - v) + south * (1 - u) - low;
	}

	return { geometry, width, length, spacing, columns, rows, elevations, surfaceHeight };
}

export type TerrainNotice = 'ready' | 'edge';

export interface Point { x: number; z: number }
export const distanceBetween = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

export interface MissionScene {
	group: Object3D;
	setView(active: boolean, samplesCollected: boolean, baseRoute: boolean): void;
	updateDrill(engaged: boolean, seconds: number): void;
	updateService?(now: number): void;
	setParkedRover?(position?: Point, service?: RoverService): void;
	reground(): void;
	dispose(): void;
}

export type MissionSceneFactory = (surfaceHeight: (x: number, z: number) => number, refresh: () => void, registerSwir: (root: Object3D, albedo: number, surface: string) => void) => MissionScene;

export interface RoverService {
	open: boolean;
	seated: boolean;
}

export interface MissionView {
	map: { center: Point; scale: number; objective: Point; vehicle: Point };
	hazard?: Point & { radius: number };
	samplesCollected: boolean;
	drilling: boolean;
	drillPaused: boolean;
	point: Point;
	ahead: Point;
	route: readonly Point[];
	secondaryRoute?: readonly Point[];
	mapObjectiveLabel?: string;
	groundRoute?: readonly Point[];
	parkedRover?: Point;
	roverService?: RoverService;
	inspectionPoint?: Point;
	cabinTransition?: Point;
	baseRoute: boolean;
	showPosition: boolean;
	tilt: number;
	inCabin?: boolean;
	headlamps?: number;
	player?: { run: number; enabled: boolean; speedMultiplier: number; driving: boolean; target?: Point; forwardSpeed?: number; maxSpeed?: number };
}

const mapSize = 96;
const mapSpan = 160;
const metresPerPixel = mapSpan / mapSize;
const compass = (yaw: number) => (Math.round(-yaw * 180 / Math.PI) % 360 + 360) % 360;
const walkKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
const rockTileSize = 64;
const rockLoadRadius = 128;
const rockPalette = ['#806955', '#a0856e', '#9b745a'];

const rockProfiles = [
	// Low flakes, layered slabs, fractured blocks and weathered cobbles.
	{ material: 2, shape: [1.1, 0.26, 0.78], crown: 0.31, shear: 0.16 },
	{ material: 2, shape: [1.3, 0.32, 0.59], crown: 0.45, shear: -0.24 },
	{ material: 2, shape: [0.86, 0.45, 1.06], crown: 0.38, shear: 0.07 },
	{ material: 0, shape: [1.04, 0.66, 0.85], crown: 0.54, shear: 0.25 },
	{ material: 0, shape: [0.72, 0.83, 1.02], crown: 0.62, shear: -0.19 },
	{ material: 0, shape: [1.20, 0.51, 0.64], crown: 0.77, shear: 0.33 },
	{ material: 1, shape: [0.92, 0.66, 0.9], crown: 0.91, shear: 0.05 },
	{ material: 1, shape: [1.15, 0.48, 0.75], crown: 0.88, shear: -0.1 },
	{ material: 1, shape: [0.74, 0.71, 1.1], crown: 0.95, shear: 0.12 }
];

function seededRandom(seed: number) {
	let state = seed >>> 0;
	return () => {
		state += 0x6d2b79f5;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

export function mountTerrain(
	canvas: HTMLCanvasElement,
	map: HTMLCanvasElement,
	data: ArrayBuffer,
	orthoUrl: string,
	geology: GeologyData | undefined,
	notify: (notice: TerrainNotice) => void,
	getNotice: () => string,
	getClock: () => string,
	getMessage: () => VisorMessage,
	getSwir: () => SwirHudData,
	getReadings: () => VisorReadings,
	onExertion: (level: Exertion) => void,
	createMissionScene?: MissionSceneFactory
) {
	const lightTerrain = buildTerrain(data);
	const { width, length } = lightTerrain;
	let { spacing, columns, rows, elevations } = lightTerrain;
	let { surfaceHeight } = lightTerrain;
	let highTerrain: ReturnType<typeof buildTerrain> | undefined;
	let explored = false;
	let renderer: WebGLRenderer;
	try {
		renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
	} catch (error) {
		lightTerrain.geometry.dispose();
		throw error;
	}
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = PCFShadowMap;
	renderer.shadowMap.autoUpdate = false;

	const swirRaycaster = new Raycaster();
	const swirDirection = new Vector3();
	function readSwir(origin: Vector3, direction: Vector3): SwirHudData {
		const data = getSwir();
		if (displayMode !== 'swir') return { ...data, active: false };
		swirRaycaster.set(origin, direction);
		const target = swirRaycaster.intersectObjects(scene.children, true)
			.find(({ object }) => {
				if (typeof object.userData.swirAlbedo !== 'number') return false;
				for (let ancestor: Object3D | null = object; ancestor; ancestor = ancestor.parent) {
					if (!ancestor.visible) return false;
				}
				return true;
			});
		return target ? {
			...data,
			distanceM: target.distance,
			albedo: target.object.userData.swirAlbedo as number,
			surface: String(target.object.userData.swirSurface ?? 'SURFACE')
		} : { ...data, distanceM: null, albedo: null, surface: undefined };
	}
	const optics = buildVisorOptics(renderer, map, getNotice, getClock, getMessage,
		() => readSwir(camera.position, camera.getWorldDirection(swirDirection)), getReadings);
	const scene = new Scene();
	const cabin = buildRoverCabin(map);
	scene.add(cabin.group);
	let roverYaw = 0;
	const dayFog = new Color('#cca88a');
	const fog = new FogExp2(dayFog, clearDustDensity);
	scene.fog = fog;
	const terrainMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
	const orthoTint = new Color('#bfa38e');
	const materialLayer = materialMaps(geology, columns, rows);
	let dangerRisk = computeStaticRisk({
		elevations, columns, rows, spacing, geology: geology?.features,
		hazard: { x: HAZARD.x, z: HAZARD.z, radius: HAZARD_RADIUS },
		width, length
	});
	let dangerLayer = dangerTexture(dangerRisk, columns, rows);
	let swirLayer: DataTexture | undefined;
	let displayMode: TerrainDisplayMode = 'visible';
	let compiledShader: { uniforms: Record<string, { value: unknown }> } | undefined;
	let groundTempC: number | null = null;
	let dangerThermal = 0;
	let dangerVisibility = 0;
	let shadowDirty = true;
	const dangerRings = createDangerRings(scene, (x, z) => surfaceHeight(x, z));
	// Meter-scale detail is illustrative. The HiRISE grid determines the geometry.
	terrainMaterial.onBeforeCompile = (shader) => {
		shader.vertexShader = 'varying vec3 groundPoint;\n' + shader.vertexShader.replace(
			'#include <begin_vertex>', '#include <begin_vertex>\ngroundPoint = position;'
		);
		shader.fragmentShader = `varying vec3 groundPoint;
			vec2 dustHash(vec2 grid) {
				return fract(sin(vec2(dot(grid, vec2(127.1, 311.7)),
					dot(grid, vec2(269.5, 183.3)))) * 43758.5453);
			}
			float dustNoise(vec2 p) {
				vec2 cell = floor(p);
				vec2 f = smoothstep(0.0, 1.0, fract(p));
				return mix(mix(dustHash(cell).x, dustHash(cell + vec2(1, 0)).x, f.x),
					mix(dustHash(cell + vec2(0, 1)).x, dustHash(cell + vec2(1, 1)).x, f.x), f.y);
			}
			float gravelHeight(vec2 p, float scale, float density) {
				vec2 st = p * scale;
				vec2 cell = floor(st);
				vec2 jitter = dustHash(cell);
				vec2 shape = dustHash(cell + vec2(71.3, -43.7));
				vec2 q = fract(st) - mix(vec2(0.21), vec2(0.79), jitter);
				q.x += q.y * (shape.x - 0.5);
				q.y *= mix(0.85, 1.65, shape.y);
				float radius = mix(0.035, 0.20, shape.x * shape.x);
				float edge = max(abs(q.x), abs(q.x * 0.45) + abs(q.y) * 0.82);
				return (1.0 - smoothstep(radius * 0.25, radius, edge))
					* smoothstep(1.0 - density, 1.08 - density, shape.y) * mix(0.35, 1.0, jitter.x);
			}
			vec3 groundNormal(vec3 point, vec3 n, float height) {
				vec3 dx = dFdx(point);
				vec3 dy = dFdy(point);
				vec3 r1 = cross(dy, n);
				vec3 r2 = cross(n, dx);
				float det = dot(dx, r1);
				vec3 gradient = r1 * dFdx(height) + r2 * dFdy(height);
				return normalize(max(abs(det), 1e-12) * n - sign(det) * gradient);
			}
		` + shader.fragmentShader.replace(
			'#include <map_fragment>', ''
		).replace(
			'#include <color_fragment>',
			`#include <color_fragment>
			vec2 p = groundPoint.xz;
			#ifdef USE_MAP
				vec4 ortho = texture2D(map, vMapUv);
				float gray = dot(ortho.rgb, vec3(0.2126, 0.7152, 0.0722));
				vec3 layerColor = mix(ortho.rgb, vec3(gray), swirMode);
				vec3 tint = mix(vec3(1.0), orthoTint, orthoTintMode);
				float coverage = ortho.a * mix(1.0, 0.72, orthoTintMode);
				diffuseColor.rgb = mix(diffuseColor.rgb, layerColor * tint, coverage);
			#endif
			if (dangerMode > 0.5) {
				float dynamicRisk = clamp(dangerThermal * 0.15 + dangerVisibility * 0.10, 0.0, 1.0);
				diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.81, 0.30, 0.26), dynamicRisk);
			}
			float footprint = max(length(dFdx(p)), length(dFdy(p)));
			float gravelBed = smoothstep(0.29, 0.72, dustNoise(p * 0.38) * 0.68 + dustNoise(p * 1.4) * 0.32);
			vec2 scattered = p + 0.7 * vec2(dustNoise(p * 0.8), dustNoise(p * 0.8 + vec2(29.7, 12.8)));
			float coarse = gravelHeight(scattered, 2.6, mix(0.10, 0.78, gravelBed))
				* (1.0 - smoothstep(0.025, 0.15, footprint));
			float fine = gravelHeight(vec2(scattered.x + scattered.y, scattered.y - scattered.x) * 0.7071,
				11.0, mix(0.03, 0.85, gravelBed))
				* (1.0 - smoothstep(0.006, 0.04, footprint));
			float closeDetail = 1.0 - smoothstep(12.0, 55.0, length(vViewPosition));
			float gravel = (coarse * mix(0.45, 1.0, gravelBed) + fine * 0.42) * closeDetail;
			float windDust = dustNoise(p * vec2(0.18, 0.72)) - 0.5;
			float grain = (dustNoise(p * 21.0) - 0.5) * mix(0.15, 1.0, gravelBed)
				* (1.0 - smoothstep(0.009, 0.045, footprint));
			diffuseColor.rgb *= 1.0 + windDust * 0.16 + grain * 0.13 * closeDetail - gravel * 0.26;
			float microHeight = gravel * 0.018 + grain * 0.0015 * closeDetail;`
		).replace(
			'#include <normal_fragment_maps>',
			'#include <normal_fragment_maps>\nnormal = groundNormal(-vViewPosition, normal, microHeight);'
		);
		shader.uniforms.orthoTint = { value: orthoTint };
		shader.uniforms.orthoTintMode = { value: displayMode === 'visible' ? 1 : 0 };
		shader.uniforms.swirMode = { value: displayMode === 'swir' ? 1 : 0 };
		shader.uniforms.dangerMode = { value: displayMode === 'danger' ? 1 : 0 };
		shader.uniforms.dangerThermal = { value: dangerThermal };
		shader.uniforms.dangerVisibility = { value: dangerVisibility };
		compiledShader = shader as unknown as typeof compiledShader;
		shader.fragmentShader = 'uniform vec3 orthoTint;\n' + shader.fragmentShader;
		shader.fragmentShader = 'uniform float orthoTintMode;\nuniform float swirMode;\nuniform float dangerMode;\nuniform float dangerThermal;\nuniform float dangerVisibility;\n' + shader.fragmentShader;
	};
	const swirMaterialSetters: Array<(enabled: boolean, time?: number) => void> = [];
	const mesh = new Mesh(lightTerrain.geometry, terrainMaterial);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.userData.swirAlbedo = 0.78;
	mesh.userData.swirSurface = 'REGOLITH/DUST';
	const ambient = new HemisphereLight('#ffe4cc', '#82604c', 1.65);
	scene.add(mesh, ambient);
	const span = Math.max(width, length);
	const sun = new DirectionalLight('#fff0d9', 2.05);
	const sunDirectionWorld = new Vector3(-0.72, 1.25, -0.58).normalize();
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.camera.left = -rockLoadRadius * 1.4;
	sun.shadow.camera.right = rockLoadRadius * 1.4;
	sun.shadow.camera.top = rockLoadRadius * 1.4;
	sun.shadow.camera.bottom = -rockLoadRadius * 1.4;
	sun.shadow.camera.near = 1;
	sun.shadow.camera.far = rockLoadRadius * 4;
	sun.shadow.camera.updateProjectionMatrix();
	sun.shadow.bias = -0.0001;
	sun.shadow.normalBias = 0.03;
	scene.add(sun, sun.target);

	const camera = new PerspectiveCamera(66, 1, 0.08, Math.max(width, length) * 2);
	camera.rotation.order = 'YXZ';
	camera.rotation.set(-0.085, 0.58, 0);
	// Valid ground near the base of the western delta, facing its escarpment.
	const spawnX = width * 0.263;
	const spawnZ = length * 0.166;
	const eyeHeight = 1.68;
	camera.position.set(spawnX, surfaceHeight(spawnX, spawnZ) + eyeHeight, spawnZ);
	// Suit-mounted torch, attached to the camera so it follows the astronaut's view.
	const flashlight = new SpotLight('#ffe3b5', 0, 32, Math.PI / 5, 0.55, 2);
	flashlight.position.set(0, -0.08, 0);
	flashlight.target.position.set(0, -0.08, -1);
	flashlight.castShadow = true;
	flashlight.shadow.mapSize.set(1024, 1024);
	flashlight.shadow.bias = -0.0002;
	camera.add(flashlight, flashlight.target);
	scene.add(camera);
	function setFlashlight(enabled: boolean) {
		flashlight.intensity = enabled ? 90 : 0;
		draw();
	}

	const rockGeometries = rockProfiles.map(({ material, shape, crown, shear }, variant) => {
		const geometry = new IcosahedronGeometry(1, material === 1 ? 2 : 1);
		const positions = geometry.getAttribute('position');
		const roughness = [0.20, 0.14, 0.18][material];
		for (let i = 0; i < positions.count; i++) {
			const x = positions.getX(i);
			const y = positions.getY(i);
			const z = positions.getZ(i);
			const broad = Math.sin(x * 7.1 + y * 3.7 + variant * 2.3)
				* Math.cos(z * 6.3 - x * 4.1 + variant) * 0.65
				+ Math.sin(y * 11.2 + z * 5.4 + variant * 4.7) * 0.35;
			const chips = Math.sin(x * 23.0 + z * 17.0 + variant * 5.0)
				* Math.cos(y * 19.0 - x * 13.0 + variant * 3.0);
			const radius = 0.86 + broad * roughness + chips * 0.035;
			const height = MathUtils.clamp(y * radius, -0.56, crown + 0.14 * x - 0.10 * z);
			positions.setXYZ(i, (x * radius + height * shear) * shape[0], height * shape[1], z * radius * shape[2]);
		}
		geometry.computeVertexNormals();
		return geometry;
	});
	const rockMaterials = [0, 1, 2].map((variant) => {
		const material = new MeshStandardMaterial({
			color: '#ffffff',
			roughness: [0.98, 0.94, 0.99][variant],
			metalness: 0,
			flatShading: variant === 0
		});
		material.onBeforeCompile = (shader) => {
			shader.vertexShader = 'varying vec3 rockPoint;\n' + shader.vertexShader.replace(
				'#include <begin_vertex>', '#include <begin_vertex>\nrockPoint = position;'
			);
			const pattern = variant === 0
				? `float grain = rockNoise(rockPoint * 22.0);
				float fractures = smoothstep(0.69, 0.83, rockNoise(rockPoint * 8.0));
				diffuseColor.rgb *= 0.85 + grain * 0.18 - fractures * 0.12;`
				: variant === 1
					? `float mottling = rockNoise(rockPoint * 5.5);
				float grit = rockNoise(rockPoint * 24.0);
				diffuseColor.rgb *= 0.88 + mottling * 0.12 + grit * 0.06;`
					: `float strata = sin((rockPoint.y + rockNoise(rockPoint * 5.0) * 0.08) * 23.0);
				float grain = rockNoise(rockPoint * 19.0);
				diffuseColor.rgb *= 0.84 + smoothstep(-0.25, 0.25, strata) * 0.14 + grain * 0.05;`;
			shader.fragmentShader = `varying vec3 rockPoint;
				float rockHash(vec3 p) {
					return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
				}
				float rockNoise(vec3 p) {
					vec3 cell = floor(p);
					vec3 f = fract(p);
					f = f * f * (3.0 - 2.0 * f);
					float x00 = mix(rockHash(cell), rockHash(cell + vec3(1, 0, 0)), f.x);
					float x10 = mix(rockHash(cell + vec3(0, 1, 0)), rockHash(cell + vec3(1, 1, 0)), f.x);
					float x01 = mix(rockHash(cell + vec3(0, 0, 1)), rockHash(cell + vec3(1, 0, 1)), f.x);
					float x11 = mix(rockHash(cell + vec3(0, 1, 1)), rockHash(cell + vec3(1, 1, 1)), f.x);
					return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z);
				}
			` + shader.fragmentShader.replace('#include <color_fragment>',
				`#include <color_fragment>\n${pattern}`);
		};
		swirMaterialSetters.push(installSwirMaterialResponse(material, [0.22, 0.72, 0.78][variant]));
		return material;
	});
	const rockTiles = new Map<string, { meshes: InstancedMesh[]; colliders: RockContact[] }>();
	let rockColliders: RockContact[] = [];
	let lastRockTileX = Number.NaN;
	let lastRockTileZ = Number.NaN;
	const placement = new Object3D();
	const up = new Vector3(0, 1, 0);
	const normal = new Vector3();
	const supportPoint = new Vector3();
	const yaw = new Quaternion();
	const rockColor = new Color();

	function makeRockTile(tileX: number, tileZ: number) {
		const seed = Math.imul(tileX + 1, 73856093) ^ Math.imul(tileZ + 1, 19349663) ^ 0x51ed270b;
		const random = seededRandom(seed);
		const colliders: RockContact[] = [];
		const variants: Array<Array<{ x: number; z: number; radius: number; slopeX: number; slopeZ: number; yaw: number; color: Color }>> =
			rockGeometries.map(() => []);
		const clusterCount = 2 + Math.floor(random() * 2);
		const clusters = Array.from({ length: clusterCount }, () => ({ x: random(), z: random() }));
		const count = 38 + Math.floor(random() * 18);
		for (let i = 0; i < count; i++) {
			let localX: number;
			let localZ: number;
			if (random() < 0.76) {
				const cluster = clusters[Math.floor(random() * clusters.length)];
				const offsetX = (random() + random() + random() - 1.5) * 16;
				const offsetZ = (random() + random() + random() - 1.5) * 16;
				localX = cluster.x * rockTileSize + offsetX;
				localZ = cluster.z * rockTileSize + offsetZ;
			} else {
				localX = random() * rockTileSize;
				localZ = random() * rockTileSize;
			}
			const x = -width / 2 + tileX * rockTileSize + localX;
			const z = -length / 2 + tileZ * rockTileSize + localZ;
			if (x < -width / 2 || x > width / 2 || z < -length / 2 || z > length / 2) continue;
			if (Math.hypot(x - spawnX, z - spawnZ) < 1.5) continue;
			const y = surfaceHeight(x, z);
			const sizeRoll = random();
			const radius = sizeRoll < 0.72 ? 0.055 + random() * 0.17
				: sizeRoll < 0.94 ? 0.23 + random() * 0.30
					: sizeRoll < 0.985 ? 0.55 + random() * 0.65
						: 1.2 + random() * 2.0;
			const sampleOffset = Math.max(0.2, radius);
			const left = surfaceHeight(x - sampleOffset, z);
			const right = surfaceHeight(x + sampleOffset, z);
			const back = surfaceHeight(x, z - sampleOffset);
			const front = surfaceHeight(x, z + sampleOffset);
			if (![y, left, right, back, front].every(Number.isFinite)) continue;
			const slopeX = (left - right) / (2 * sampleOffset);
			const slopeZ = (back - front) / (2 * sampleOffset);
			if (Math.hypot(slopeX, slopeZ) > 0.78) continue;

			const variant = Math.floor(random() * rockGeometries.length);
			rockColor.set(rockPalette[rockProfiles[variant].material]);
			rockColor.multiplyScalar(0.78 + random() * 0.38);

			variants[variant].push({
				x, z, radius, slopeX, slopeZ,
				yaw: random() * Math.PI * 2,
				color: rockColor.clone()
			});
		}

		const meshes: InstancedMesh[] = [];
		variants.forEach((instances, variant) => {
			if (instances.length === 0) return;
			const geometry = rockGeometries[variant];
			const rocks = new InstancedMesh(geometry, rockMaterials[rockProfiles[variant].material], instances.length);
			rocks.castShadow = true;
			rocks.receiveShadow = true;
			const rockClass = rockProfiles[variant].material;
			rocks.userData.swirAlbedo = [0.22, 0.72, 0.78][rockClass];
			rocks.userData.swirSurface = ['EXPOSED ROCK', 'DUSTED ROCK', 'SEDIMENTARY ROCK'][rockClass];
			const firstContact = colliders.length;
			placeRock: for (const rock of instances) {
				placement.quaternion.setFromUnitVectors(up, normal.set(rock.slopeX, 1, rock.slopeZ).normalize());
				yaw.setFromAxisAngle(up, rock.yaw);
				placement.quaternion.multiply(yaw);
				placement.scale.setScalar(rock.radius);
				const vertices = geometry.getAttribute('position');
				let supportY = -Infinity;
				let lowestClearance = Infinity;
				for (let vertex = 0; vertex < vertices.count; vertex++) {
					supportPoint.fromBufferAttribute(vertices, vertex)
						.multiply(placement.scale)
						.applyQuaternion(placement.quaternion);
					const groundY = surfaceHeight(rock.x + supportPoint.x, rock.z + supportPoint.z);
					if (!Number.isFinite(groundY)) continue placeRock;
					const contactY = groundY - supportPoint.y;
					supportY = Math.max(supportY, contactY);
					lowestClearance = Math.min(lowestClearance, contactY);
				}
				const sink = Math.min(0.12, rock.radius * 0.07);
				placement.position.set(rock.x, supportY - sink, rock.z);
				placement.updateMatrix();
				const index = colliders.length - firstContact;
				rocks.setMatrixAt(index, placement.matrix);
				rocks.setColorAt(index, rock.color);
				colliders.push(createRockContact(geometry, placement.matrix, supportY - sink - lowestClearance, rock.radius));
			}
			rocks.count = colliders.length - firstContact;
			if (!rocks.count) {
				rocks.dispose();
				return;
			}
			rocks.instanceMatrix.needsUpdate = true;
			if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
			scene.add(rocks);
			meshes.push(rocks);
		});
		return { colliders, meshes };
	}

	function updateRockTiles() {
		const centerTileX = Math.floor((camera.position.x + width / 2) / rockTileSize);
		const centerTileZ = Math.floor((camera.position.z + length / 2) / rockTileSize);
		if (centerTileX === lastRockTileX && centerTileZ === lastRockTileZ) return;
		lastRockTileX = centerTileX;
		lastRockTileZ = centerTileZ;
		const tileRadius = Math.ceil(rockLoadRadius / rockTileSize);
		const wanted = new Set<string>();
		const colliders: RockContact[] = [];
		for (let tileX = Math.max(0, centerTileX - tileRadius); tileX <= Math.min(Math.ceil(width / rockTileSize) - 1, centerTileX + tileRadius); tileX++) {
			for (let tileZ = Math.max(0, centerTileZ - tileRadius); tileZ <= Math.min(Math.ceil(length / rockTileSize) - 1, centerTileZ + tileRadius); tileZ++) {
				const tileCenterX = -width / 2 + (tileX + 0.5) * rockTileSize;
				const tileCenterZ = -length / 2 + (tileZ + 0.5) * rockTileSize;
				if (Math.hypot(tileCenterX - camera.position.x, tileCenterZ - camera.position.z) > rockLoadRadius + rockTileSize) continue;
				const key = `${tileX}:${tileZ}`;
				wanted.add(key);
				let tile = rockTiles.get(key);
				if (!tile) {
					const created = makeRockTile(tileX, tileZ);
					if (created.meshes.length > 0) rockTiles.set(key, created);
					colliders.push(...created.colliders);
				} else {
					colliders.push(...tile.colliders);
				}
			}
		}
		for (const [key, rocks] of rockTiles) {
			if (!wanted.has(key)) {
				for (const mesh of rocks.meshes) {
					scene.remove(mesh);
					mesh.dispose();
				}
				rockTiles.delete(key);
			}
		}
		rockColliders = colliders;
		shadowDirty = true;
		dangerRings.setRocks(colliders, displayMode === 'danger');
	}

	const routeMaterial = new MeshBasicMaterial({ color: '#88ffd1', transparent: true, opacity: 0.72, depthWrite: false, side: DoubleSide, fog: false });
	const routeMesh = new Mesh(new BufferGeometry(), routeMaterial);
	routeMesh.visible = false;
	scene.add(routeMesh);
	let drawnRoute: readonly Point[] | undefined;

	function drawGroundRoute(route?: readonly Point[]) {
		if (route === drawnRoute) return;
		drawnRoute = route;
		routeMesh.visible = !!route;
		if (!route) return;
		const positions: number[] = [];
		for (let i = 1; i < route.length; i++) {
			const a = route[i - 1];
			const b = route[i];
			const length = distanceBetween(a, b);
			if (length === 0) continue;
			const nx = (b.z - a.z) / length * 0.48;
			const nz = (a.x - b.x) / length * 0.48;
			const count = Math.ceil(length / 2);
			let previous: number[] | undefined;
			for (let step = 0; step <= count; step++) {
				const x = MathUtils.lerp(a.x, b.x, step / count);
				const z = MathUtils.lerp(a.z, b.z, step / count);
				const left = surfaceHeight(x + nx, z + nz);
				const right = surfaceHeight(x - nx, z - nz);
				if (!Number.isFinite(left) || !Number.isFinite(right)) {
					previous = undefined;
					continue;
				}
				const pair = [x + nx, left + 0.16, z + nz, x - nx, right + 0.16, z - nz];
				if (previous) positions.push(...previous, ...pair.slice(0, 3), ...pair.slice(0, 3), ...previous.slice(3), ...pair.slice(3));
				previous = pair;
			}
		}
		routeMesh.geometry.dispose();
		routeMesh.geometry = new BufferGeometry();
		routeMesh.geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
	}

	const swirMissionMaterials = new Set<SwirMaterial>();
	const missionScene = createMissionScene?.((x, z) => surfaceHeight(x, z), () => draw(), (root, albedo, surface) => {
		root.traverse((object) => {
			if (!(object instanceof Mesh)) return;
			object.userData.swirAlbedo = albedo;
			object.userData.swirSurface = surface;
			for (const material of [object.material].flat()) {
				if (!(material instanceof MeshStandardMaterial || material instanceof MeshLambertMaterial)
					|| swirMissionMaterials.has(material)) continue;
				swirMissionMaterials.add(material);
				swirMaterialSetters.push(installSwirMaterialResponse(material, albedo));
			}
		});
	});
	if (missionScene) scene.add(missionScene.group);
	let missionView: MissionView | undefined;
	const saltationGrains = createSaltationGrains();
	scene.add(saltationGrains.object);

	const mapContext = map.getContext('2d');
	const relief = document.createElement('canvas');
	relief.width = relief.height = mapSize;
	const reliefContext = relief.getContext('2d');
	const pixels = reliefContext?.createImageData(mapSize, mapSize);
	let mapX = Infinity;
	let mapZ = Infinity;
	let mapScaleLast = 0;
	let mapZoom = 1;
	function drawMap(yaw = missionView?.inCabin ? roverYaw : camera.rotation.y) {
		if (!mapContext || !reliefContext || !pixels) return;
		const scale = (missionView?.map.scale ?? metresPerPixel) / mapZoom;
		// Keep the astronaut centered while mission landmarks and the route move around them.
		const { x, z } = camera.position;
		if (Math.hypot(x - mapX, z - mapZ) >= scale || scale !== mapScaleLast) {
			mapX = x;
			mapZ = z;
			mapScaleLast = scale;
			for (let row = 0; row < mapSize; row++) {
				for (let col = 0; col < mapSize; col++) {
					const groundX = x + (col + 0.5 - mapSize / 2) * scale;
					const groundZ = z + (row + 0.5 - mapSize / 2) * scale;
					const h = surfaceHeight(groundX, groundZ);
					const slope = surfaceHeight(groundX - scale, groundZ - scale) - h;
					const shade = MathUtils.clamp(55 + slope * 43, 28, 108);
					const contour = h % 3 < 0.28 ? 19 : 0;
					const i = (row * mapSize + col) * 4;
					const tint = Number.isFinite(shade) ? shade + contour : 25;
					// Project shaded relief as light over the glass, leaving the terrain visible.
					pixels.data[i] = 160;
					pixels.data[i + 1] = 244;
					pixels.data[i + 2] = 215;
					pixels.data[i + 3] = Math.max(0, (tint - 25) * 1.65);
				}
			}
			reliefContext.putImageData(pixels, 0, 0);
		}
		mapContext.setTransform(2, 0, 0, 2, 0, 0);
		mapContext.clearRect(0, 0, mapSize, mapSize);
		// Rotate the shaded relief and landmarks together around the astronaut.
		mapContext.save();
		mapContext.translate(mapSize / 2, mapSize / 2);
		mapContext.rotate(yaw);
		mapContext.translate(-mapSize / 2, -mapSize / 2);
		mapContext.drawImage(relief, 0, 0);
		const uprightLabels: Array<{ x: number; y: number; text: string; color: string }> = [];
		const uprightPoint = (x: number, y: number) => {
			const dx = x - mapSize / 2;
			const dy = y - mapSize / 2;
			const angle = yaw;
			return {
				x: mapSize / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
				y: mapSize / 2 + dx * Math.sin(angle) + dy * Math.cos(angle)
			};
		};
		if (missionView) {
			const px = (value: number) => mapSize / 2 + (value - x) / scale;
			const pz = (value: number) => mapSize / 2 + (value - z) / scale;
			if (missionView.hazard) {
				mapContext.fillStyle = '#f2a05070';
				mapContext.beginPath();
				mapContext.arc(px(missionView.hazard.x), pz(missionView.hazard.z), missionView.hazard.radius / scale, 0, Math.PI * 2);
				mapContext.fill();
			}
			if (missionView.secondaryRoute) {
				mapContext.beginPath();
				missionView.secondaryRoute.forEach((point, index) => {
					if (index === 0) mapContext.moveTo(px(point.x), pz(point.z));
					else mapContext.lineTo(px(point.x), pz(point.z));
				});
				mapContext.setLineDash([4, 3]);
				mapContext.strokeStyle = '#ff947c';
				mapContext.lineWidth = 1.5;
				mapContext.stroke();
			}
			mapContext.beginPath();
			missionView.route.forEach((point, i) => {
				if (i === 0) mapContext.moveTo(px(point.x), pz(point.z));
				else mapContext.lineTo(px(point.x), pz(point.z));
			});
			mapContext.strokeStyle = '#8bfac942';
			mapContext.lineWidth = 7;
			mapContext.stroke();
			mapContext.setLineDash([3, 2]);
			mapContext.strokeStyle = '#89ffd0';
			mapContext.lineWidth = 1.5;
			mapContext.stroke();
			mapContext.setLineDash([]);
			mapContext.fillStyle = '#f1d7a1';
			const objective = missionView.map.objective;
			mapContext.beginPath();
			mapContext.arc(px(objective.x), pz(objective.z), 2.2, 0, Math.PI * 2);
			mapContext.fill();
			const objectiveLabel = uprightPoint(px(objective.x) + 3, pz(objective.z) - 2);
			uprightLabels.push({
				...objectiveLabel,
				text: `${missionView.mapObjectiveLabel ?? 'TARGET'} ${Math.round(distanceBetween(camera.position, objective))}m`,
				color: '#fff2c7'
			});
			const vehicle = missionView.map.vehicle;
			mapContext.fillStyle = '#edfff6';
			mapContext.fillRect(px(vehicle.x) - 2, pz(vehicle.z) - 1.5, 4, 3);
			const roverLabel = uprightPoint(px(vehicle.x) + 3, pz(vehicle.z) + 1);
			uprightLabels.push({
				...roverLabel,
				text: `ROVER ${Math.round(distanceBetween(camera.position, vehicle))}m`,
				color: '#edfff6'
			});
			const target = missionView.player?.target;
			if (target) {
				mapContext.strokeStyle = '#ffe19b';
				mapContext.lineWidth = 1.5;
				mapContext.beginPath();
				mapContext.arc(px(target.x), pz(target.z), 3, 0, Math.PI * 2);
				mapContext.stroke();
			}
			if (!missionView.showPosition) {
				mapContext.restore();
				return;
			}
		}
		// A graduated compass bezel rotates with the map; 15° ticks, with stronger 45° marks.
		mapContext.strokeStyle = '#c6ffe5b8';
		mapContext.lineWidth = 0.45;
		mapContext.beginPath();
		mapContext.arc(mapSize / 2, mapSize / 2, 44, 0, Math.PI * 2);
		mapContext.stroke();
		for (let bearing = 0; bearing < 360; bearing += 15) {
			const angle = bearing * Math.PI / 180;
			const major = bearing % 45 === 0;
			const innerRadius = major ? 40.5 : 42.5;
			mapContext.beginPath();
			mapContext.moveTo(mapSize / 2 + Math.sin(angle) * innerRadius, mapSize / 2 - Math.cos(angle) * innerRadius);
			mapContext.lineTo(mapSize / 2 + Math.sin(angle) * 44, mapSize / 2 - Math.cos(angle) * 44);
			mapContext.stroke();
		}
		mapContext.restore();
		// Minimal scale bar, kept unobtrusive inside the oval map.
		const scaleBarPixels = 13;
		mapContext.fillStyle = '#f0fff8';
		mapContext.font = '5px monospace';
		mapContext.strokeStyle = '#07130f';
		mapContext.lineWidth = 1.5;
		const scaleLabel = `${Math.round(scaleBarPixels * scale)} m`;
		mapContext.strokeText(scaleLabel, 4, mapSize - 9);
		mapContext.fillText(scaleLabel, 4, mapSize - 9);
		mapContext.strokeStyle = '#dfffee';
		mapContext.lineWidth = 0.8;
		mapContext.beginPath();
		mapContext.moveTo(4, mapSize - 4);
		mapContext.lineTo(4 + scaleBarPixels, mapSize - 4);
		mapContext.moveTo(4, mapSize - 6);
		mapContext.lineTo(4, mapSize - 2);
		mapContext.moveTo(4 + scaleBarPixels, mapSize - 6);
		mapContext.lineTo(4 + scaleBarPixels, mapSize - 2);
		mapContext.stroke();
		mapContext.textAlign = 'center';
		for (const [label, angle] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) {
			const radians = (angle + yaw * 180 / Math.PI) * Math.PI / 180;
			const x = mapSize / 2 + Math.sin(radians) * 36;
			const y = mapSize / 2 - Math.cos(radians) * 36;
			mapContext.fillText(label, x, y);
		}
		mapContext.textAlign = 'start';
		mapContext.font = '5.5px monospace';
		mapContext.lineWidth = 1.6;
		mapContext.textBaseline = 'middle';
		for (const label of uprightLabels) {
			const labelX = MathUtils.clamp(label.x, 2, Math.max(2, mapSize - label.text.length * 3.3 - 2));
			const labelY = MathUtils.clamp(label.y, 3, mapSize - 3);
			mapContext.strokeStyle = '#101a16';
			mapContext.strokeText(label.text, labelX, labelY);
			mapContext.fillStyle = label.color;
			mapContext.fillText(label.text, labelX, labelY);
		}
		mapContext.textBaseline = 'alphabetic';
		mapContext.save();
		mapContext.translate(mapSize / 2, mapSize / 2);
		mapContext.fillStyle = '#e0ffeb';
		mapContext.strokeStyle = '#14231e';
		mapContext.lineWidth = 1.5;
		mapContext.beginPath();
		mapContext.moveTo(0, -7);
		mapContext.lineTo(5, 5);
		mapContext.lineTo(0, 3);
		mapContext.lineTo(-5, 5);
		mapContext.closePath();
		mapContext.stroke();
		mapContext.fill();
		mapContext.restore();
	}

	const lightInView = new Vector3();
	const phobosInView = new Vector3();
	const deimosInView = new Vector3();
	const phobosWorld = new Vector3();
	const deimosWorld = new Vector3();
	const worldToEye = new Quaternion();
	const nightFog = new Color('#161b29');
	const duskFog = new Color('#a57561');
	const neutralFog = new Color('#5f6463');
	const dustFog = new Color();
	const lowSun = new Color('#ffad78');
	const highSun = new Color('#fff0d9');
	let daylight = 1;
	let twilight = 1;
	let dust = 0;
	let windSpeed = 7.4;
	let sceneSol = 0;
	let moonPositions = martianMoons(sceneSol);
	let stormFrame = 0;
	let swirFrame = 0;
	let lastMapAt = 0;
	let lastShadowAt = 0;
	let stormStarted = 0;
	let gustTime = 0;
	const drillMoving = () => !!missionView?.drilling && !missionView.drillPaused;
	const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
	const xrOrigin = new Object3D();
	const xrCamera = new PerspectiveCamera(camera.fov, 1, camera.near, camera.far);
	xrOrigin.add(xrCamera);
	scene.add(xrOrigin);
	const xrHeading = new Vector3();
	let xrSession: XRSession | undefined;
	function updateWorld(frameTime: number) {
		cabin.group.visible = !!missionView?.inCabin;
		flashlight.visible = !cabin.group.visible;
		if (cabin.group.visible) {
			cabin.group.position.copy(camera.position);
			cabin.group.rotation.y = roverYaw;
			const power = missionView?.headlamps ?? 0;
			cabin.setLights(power);
			const cabinMapNow = performance.now();
			if (cabinMapNow - lastMapAt >= 250) {
				drawMap();
				lastMapAt = cabinMapNow;
			}
			cabin.update(frameTime, getMessage(), Math.hypot(velocityX, velocityZ) * 3.6, compass(roverYaw), power, getClock());
		}

		const swir = displayMode === 'swir';
		for (const setSwir of swirMaterialSetters) setSwir(swir, frameTime);
		saltationGrains.update(camera.position, performance.now() / 1000, windSpeed, windSpeed > 0.5, swir);
		missionScene?.updateService?.(performance.now());
		missionScene?.updateDrill(!!missionView?.drilling, drillMoving() && !reducedMotion.matches ? gustTime : 0);
		updateRockTiles();
		sun.target.position.copy(camera.position);
		sun.position.copy(camera.position).addScaledVector(sunDirectionWorld, rockLoadRadius * 2.5);
	}
	const draw = () => {
		if (xrSession) return;
		const swir = displayMode === 'swir';
		updateWorld(performance.now() / 1000);
		worldToEye.copy(camera.quaternion).invert();
		lightInView.copy(sunDirectionWorld).applyQuaternion(worldToEye);
		phobosWorld.set(moonPositions.phobos.east, moonPositions.phobos.up, -moonPositions.phobos.north);
		deimosWorld.set(moonPositions.deimos.east, moonPositions.deimos.up, -moonPositions.deimos.north);
		phobosInView.copy(phobosWorld).applyQuaternion(worldToEye).normalize();
		deimosInView.copy(deimosWorld).applyQuaternion(worldToEye).normalize();
		if (!missionView?.inCabin) {
			const mapNow = performance.now();
			if (mapNow - lastMapAt >= 250) {
				drawMap();
				lastMapAt = mapNow;
			}
		}
		if (shadowDirty) {
			renderer.shadowMap.needsUpdate = true;
			shadowDirty = false;
		}
		optics.render(scene, camera, lightInView, Math.asin(MathUtils.clamp(sunDirectionWorld.y, -1, 1)),
			phobosInView, moonPositions.phobos.up, moonPositions.phobos.angularRadius,
			deimosInView, moonPositions.deimos.up, moonPositions.deimos.angularRadius,
			twilight, daylight, swir ? 0 : dust, gustTime, swir, windSpeed, !!missionView?.inCabin);
	};
	function updateLighting() {
		const up = sunDirectionWorld.y;
		const opticalDust = displayMode === 'swir' ? 0 : dust;
		daylight = MathUtils.smoothstep(up, 0, 0.38);
		// High-altitude Martian dust can keep the sky faintly lit well after sunset.
		twilight = MathUtils.smoothstep(up, Math.sin(-29 * Math.PI / 180), Math.sin(5 * Math.PI / 180));
		sun.intensity = 2.05 * MathUtils.smoothstep(up, 0, 0.48);
		sun.color.copy(lowSun).lerp(highSun, daylight);
		ambient.intensity = 0.045 + 0.42 * twilight + 1.02 * daylight;
		fog.color.copy(nightFog).lerp(duskFog, twilight).lerp(dayFog, daylight);
		// Suspended dust softens distant relief while leaving nearby ground clear.
		if (displayMode === 'swir') fog.color.lerp(neutralFog, 0.85);
		fog.density = displayMode === 'swir' ? clearDustDensity : MathUtils.lerp(clearDustDensity, 0.006, dust);
		if (opticalDust > 0) {
			sun.intensity *= Math.exp(-2.8 * opticalDust / Math.max(0.15, up));
			ambient.intensity *= MathUtils.lerp(1, 0.57, opticalDust);
			const stormColor = dustColor(dustFog, twilight, daylight);
			if (displayMode === 'swir') stormColor.lerp(neutralFog, 0.85);
			fog.color.lerp(stormColor, opticalDust);
		}
		// Passive SWIR stays legible at night; the photon-starved scene must not invert.
		if (displayMode === 'swir') ambient.intensity = Math.max(ambient.intensity, 0.65);
	}
	function setDisplayMode(mode: TerrainDisplayMode) {
		displayMode = mode;
		const visibleTexture = highTexture ?? texture;
		terrainMaterial.map = mode === 'danger' ? dangerLayer ?? null
			: mode === 'swir' ? swirLayer ?? visibleTexture : visibleTexture;
		if (compiledShader) {
			compiledShader.uniforms.orthoTintMode.value = mode === 'visible' ? 1 : 0;
			compiledShader.uniforms.swirMode.value = mode === 'swir' ? 1 : 0;
			compiledShader.uniforms.dangerMode.value = mode === 'danger' ? 1 : 0;
			compiledShader.uniforms.dangerThermal.value = dangerThermal;
			compiledShader.uniforms.dangerVisibility.value = dangerVisibility;
		}
		dangerRings.setVisible(mode === 'danger');
		if (mode === 'danger') dangerRings.setRocks(rockColliders, true);
		const dangerRocks = mode === 'danger';
		for (const material of rockMaterials) {
			material.color.set(dangerRocks ? '#ff4438' : '#ffffff');
			material.emissive.set(dangerRocks ? '#6e0f08' : '#000000');
			material.emissiveIntensity = dangerRocks ? 0.55 : 1;
		}
		cancelAnimationFrame(swirFrame);
		swirFrame = 0;
		if (mode === 'swir' && !reducedMotion.matches) {
			const animateSwir = () => {
				if (displayMode !== 'swir') { swirFrame = 0; return; }
				swirFrame = requestAnimationFrame(animateSwir);
				if (document.hidden) return;
				if (!frame && !stormFrame) draw();
			};
			swirFrame = requestAnimationFrame(animateSwir);
		}
		terrainMaterial.needsUpdate = true;
		shadowDirty = true;
		updateLighting();
		optics.invalidate();
		draw();
	}
	function updateDangerWeather() {
		const weather = weatherAt(sceneSol, dust > 0 ? 0 : null, Date.now());
		groundTempC = weather.ground_temp_c ?? weather.air_temp_c;
		dangerThermal = temperatureRisk(groundTempC);
		dangerVisibility = visibilityRisk(dust, windSpeed);
		if (compiledShader) {
			compiledShader.uniforms.dangerThermal.value = dangerThermal;
			compiledShader.uniforms.dangerVisibility.value = dangerVisibility;
		}
	}
	function setTime(localSol: number) {
		sceneSol = localSol;
		moonPositions = martianMoons(localSol);
		const { east, up, north } = solarPosition(localSol);
		sunDirectionWorld.set(east, up, -north).normalize();
		updateDangerWeather();
		shadowDirty = true;
		updateLighting();
		optics.invalidate();
		draw();
	}
	function animateStorm(now: number) {
		if (displayMode === 'swir') { stormFrame = 0; return; }
		stormFrame = requestAnimationFrame(animateStorm);
		const elapsed = (now - stormStarted) / 1000;
		if (elapsed - gustTime < 1 / 30) return;
		gustTime = elapsed;
		if (!frame) draw();
	}
	function updateStormMotion() {
		if (displayMode === 'swir') {
			cancelAnimationFrame(stormFrame);
			stormFrame = 0;
			gustTime = 0;
			draw();
			return;
		}
		cancelAnimationFrame(stormFrame);
		gustTime = 0;
		if ((dust > 0 || drillMoving()) && !reducedMotion.matches) {
			stormStarted = performance.now();
			stormFrame = requestAnimationFrame(animateStorm);
		}
		draw();
	}
	function setDust(next: number) {
		if (next === dust) return;
		const motionChanged = (dust > 0) !== (next > 0);
		dust = next;
		updateDangerWeather();
		shadowDirty = true;
		updateLighting();
		optics.invalidate();
		if (motionChanged) updateStormMotion();
		else draw();
	}
	function setWind(next: number | null) {
		if (next === null || !Number.isFinite(next) || next < 0 || next === windSpeed) return;
		windSpeed = next;
		updateDangerWeather();
		optics.invalidate();
		draw();
	}

	function setMissionView(view?: MissionView) {
		const previousView = missionView;
		const wasActive = !!previousView;
		if (!wasActive && !view) return;
		missionView = view;
		drawGroundRoute(view?.groundRoute);
		missionScene?.setParkedRover?.(view?.parkedRover, view?.roverService);
		const drillMotionChanged = (previousView?.drilling && !previousView.drillPaused) !==
			(view?.drilling && !view.drillPaused);
		if (drillMotionChanged) updateStormMotion();
		missionScene?.setView(!!view, !!view?.samplesCollected, !!view?.baseRoute);
		if (view) explored = true;
		if (wasActive !== !!view || view?.map.scale !== previousView?.map.scale) mapX = Infinity;
		const player = view?.player;
		const previousPlayer = previousView?.player;
		const sameRun = player && previousPlayer && previousPlayer.run === player.run;
		if (!sameRun) {
			keys.clear();
			sprintHeld = false;
			velocityX = velocityZ = 0;
			reportExertion('resting');
		} else if (!player.enabled) {
			for (const key of walkKeys) keys.delete(key);
			sprintHeld = false;
			velocityX = velocityZ = 0;
			reportExertion('resting');
		}
		if (sameRun && previousView) {
			if (view.inspectionPoint && !previousView.inspectionPoint && !renderer.xr.isPresenting) {
				const target = view.inspectionPoint;
				camera.rotation.set(-0.12, Math.atan2(camera.position.x - target.x, camera.position.z - target.z), 0);
			}
			if (view.inCabin !== previousView.inCabin) {
				keys.clear();
				velocityX = velocityZ = 0;
				if (view.cabinTransition) {
					camera.position.x = view.cabinTransition.x;
					camera.position.z = view.cabinTransition.z;
					updateRockTiles();
				}
				const target = view.inCabin ? view.map.objective : view.player?.target;
				if (target) roverYaw = Math.atan2(camera.position.x - target.x, camera.position.z - target.z);
				camera.rotation.set(-0.085, roverYaw, 0);
			}
			if (previousPlayer.enabled === player.enabled && previousPlayer.driving === player.driving
				&& previousPlayer.target === player.target && previousView.headlamps === view.headlamps && previousView.route === view.route && previousView.secondaryRoute === view.secondaryRoute && previousView.hazard === view.hazard
				&& previousView.showPosition === view.showPosition && previousView.baseRoute === view.baseRoute
				&& previousView.samplesCollected === view.samplesCollected && previousView.drilling === view.drilling
				&& previousView.tilt === view.tilt && previousView.inCabin === view.inCabin) {
				if (view.headlamps !== undefined) draw();
				return;
			}
			const tilt = reducedMotion.matches ? 0 : view.tilt;
			camera.rotation.z = 0.32 * tilt;
			camera.position.y = eyeY() - 0.64 * tilt;
			shadowDirty = true;
			draw();
			return;
		}
		if (!view && atEdge) {
			atEdge = false;
			edgeNoticeShown = false;
			notify('ready');
		}
		const { x, z } = view?.point ?? { x: spawnX, z: spawnZ };
		const height = surfaceHeight(x, z);
		const tilt = reducedMotion.matches ? 0 : (view?.tilt ?? 0);
		if (Number.isFinite(height)) {
			camera.position.set(x, height + eyeOffset() - 0.64 * tilt, z);
			updateRockTiles();
			camera.position.y = eyeY() - 0.64 * tilt;
		}
		camera.rotation.set(-0.085 - 0.26 * tilt, view
			? Math.atan2(x - view.ahead.x, z - view.ahead.z)
			: 0.58, 0.32 * tilt);
		roverYaw = camera.rotation.y;
		shadowDirty = true;
		draw();
	}
	function resize() {
		if (xrSession) return;
		const { clientWidth, clientHeight } = canvas;
		if (!clientWidth || !clientHeight) return;
		camera.aspect = clientWidth / clientHeight;
		camera.updateProjectionMatrix();
		renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
		renderer.setSize(clientWidth, clientHeight, false);
		optics.resize(clientWidth, clientHeight);
		draw();
	}

	const abort = new AbortController();
	const options = { signal: abort.signal };
	const keys = new Set<string>();
	reducedMotion.addEventListener('change', updateStormMotion, options);
	let drag: { id: number; x: number; y: number } | undefined;
	let dragged = false;
	let velocityX = 0;
	let velocityZ = 0;
	let stride = 0;
	let previous = 0;
	let frame = 0;
	let atEdge = false;
	let sprintHeld = false;
	let edgeNoticeShown = false;
	let currentExertion: Exertion = 'resting';
	function reportExertion(level: Exertion) {
		if (level === currentExertion) return;
		currentExertion = level;
		onExertion(level);
	}
	const canLook = () => !xrSession && (!missionView || !!missionView.player);
	const canMove = () => !missionView || !!missionView.player?.enabled;
	const eyeOffset = () => missionView?.inCabin ? 2.5 : eyeHeight;
	const eyeY = () => {
		const { x, z } = camera.position;
		return footingOnRocks(rockColliders, surfaceHeight(x, z), x, z, true).height + eyeOffset();
	};

	function move(now: number, forward: number, steering: number, yaw: number, immersive = false) {
		const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
		previous = now;
		const driving = !!missionView?.inCabin;
		const side = driving ? 0 : steering;
		const sprinting = sprintHeld && !driving && forward > 0;
		if (driving) {
			const turn = steering * dt * 0.9;
			roverYaw -= turn;
			camera.rotation.y -= turn;
			yaw = roverYaw;
		}
		const speedMultiplier = missionView?.player?.speedMultiplier ?? 1;
		const forwardSpeed = missionView?.player?.forwardSpeed ?? 8;
		const maxSpeed = driving ? missionView?.player?.maxSpeed ?? Infinity : Infinity;
		const requestedSpeed = (driving ? (forward < 0 ? Math.min(missionView?.player?.maxSpeed === undefined ? 3 : 1.4, forwardSpeed) : forwardSpeed) : 1.45 * (sprinting ? 1.9 : 1)) * speedMultiplier;
		const speed = Math.min(maxSpeed, requestedSpeed)
			/ Math.max(1, Math.hypot(forward, side));
		velocityX = MathUtils.damp(velocityX, speed * (side * Math.cos(yaw) - forward * Math.sin(yaw)), 10, dt);
		velocityZ = MathUtils.damp(velocityZ, speed * (-side * Math.sin(yaw) - forward * Math.cos(yaw)), 10, dt);
		const magnitude = Math.hypot(velocityX, velocityZ);
		if (magnitude > maxSpeed) {
			velocityX *= maxSpeed / magnitude;
			velocityZ *= maxSpeed / magnitude;
		}
		const x = camera.position.x + velocityX * dt;
		const z = camera.position.z + velocityZ * dt;
		const nextHeight = surfaceHeight(x, z);
		const distance = Math.hypot(velocityX, velocityZ) * dt;
		const moving = Math.hypot(velocityX, velocityZ) > 0.12;
		reportExertion(!driving && moving ? (sprinting ? 'running' : 'walking') : 'resting');
		const hazard = missionView?.player && missionView.hazard;
		const blockedByHazard = !!hazard && distanceBetween({ x, z }, hazard) < hazard.radius
			&& distanceBetween({ x, z }, hazard) < distanceBetween(camera.position, hazard);
		const footing = footingOnRocks(rockColliders, nextHeight, x, z, driving);
		let blockedByRock = footing.blocked;
		const contactSamples = Math.ceil(distance / 0.12);
		for (let sample = 1; sample < contactSamples && !blockedByRock; sample++) {
			const fraction = sample / contactSamples;
			const sampleX = camera.position.x + (x - camera.position.x) * fraction;
			const sampleZ = camera.position.z + (z - camera.position.z) * fraction;
			blockedByRock = footingOnRocks(rockColliders, surfaceHeight(sampleX, sampleZ), sampleX, sampleZ, driving).blocked;
		}
		const blocked = blockedByHazard || blockedByRock || !Number.isFinite(nextHeight)
			|| Math.abs(nextHeight - surfaceHeight(camera.position.x, camera.position.z)) > distance * 0.72 + 1e-6;
		if (blockedByRock) {
			if (edgeNoticeShown) notify('ready');
			edgeNoticeShown = false;
		} else if (blocked && (forward || side)) {
			if (!edgeNoticeShown) notify('edge');
			edgeNoticeShown = true;
		} else if (!blocked && edgeNoticeShown) {
			notify('ready');
			edgeNoticeShown = false;
		}
		atEdge = blocked;
		if (!blocked) {
			camera.position.x = x;
			camera.position.z = z;
			stride += distance;
		}
		let bob = 0;
		if (!immersive && !reducedMotion.matches && !blocked && !driving) {
			if (sprinting && moving) {
				// Approximate a short running flight arc under Martian gravity (3.71 m/s²).
				const cycleLength = 1.65;
				const flightStart = 0.22;
				const cycleDuration = cycleLength / Math.max(0.8, Math.hypot(velocityX, velocityZ));
				const phase = (stride % cycleLength) / cycleLength;
				if (phase >= flightStart) {
					const flightDuration = cycleDuration * (1 - flightStart);
					const flightTime = (phase - flightStart) / (1 - flightStart) * flightDuration;
					bob = Math.max(0, 0.5 * 3.71 * flightTime * (flightDuration - flightTime));
				}
			} else {
				bob = Math.sin(stride * 7) * Math.min(distance / (dt || 1), 1) * 0.025;
			}
		}
		const tilt = immersive || reducedMotion.matches ? 0 : (missionView?.tilt ?? 0);
		const targetY = (blocked ? eyeY() : footing.height + eyeOffset()) + bob - 0.64 * tilt;
		camera.position.y = reducedMotion.matches ? targetY
			: Math.max(targetY, MathUtils.damp(camera.position.y, targetY, 18, dt));
		return targetY;
	}

	function step(now: number) {
		const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
		const turn = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
		const pitch = Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'));
		camera.rotation.y -= turn * dt * 1.4;
		camera.rotation.x = MathUtils.clamp(camera.rotation.x - pitch * dt * 1.1, -1.48, 1.48);
		const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
		const steering = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
		const targetY = move(now, forward, steering, camera.rotation.y);
		if (now - lastShadowAt >= 250) { shadowDirty = true; lastShadowAt = now; }
		draw();
		if (keys.size || Math.hypot(velocityX, velocityZ) > 0.015 || camera.position.y - targetY > 0.003) frame = requestAnimationFrame(step);
		else {
			camera.position.y = targetY;
			frame = 0;
			previous = velocityX = velocityZ = 0;
		}
	}

	async function enterVR(xr: XRSystem, controls: XrControls) {
		const session = await xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'] });
		if (abort.signal.aborted) {
			await session.end();
			return;
		}
		xrSession = session;
		explored = true;
		keys.clear();
		cancelAnimationFrame(frame);
		frame = previous = velocityX = velocityZ = 0;
		if (document.pointerLockElement === canvas) document.exitPointerLock();
		const hudCamera = new PerspectiveCamera();
		xrOrigin.add(hudCamera);
		const hud = mountHeadLockedHud(hudCamera);
		const pointer = createXrPointer(xrOrigin, hud.plane);
		const headPosition = new Vector3();
		const sessionEvents = new AbortController();
		const eventOptions = { signal: sessionEvents.signal };
		const shadowWasEnabled = flashlight.castShadow;
		flashlight.castShadow = false;
		hudCamera.add(flashlight, flashlight.target);
		let lastHud = -Infinity;
		let menuOpen = true;
		let missionScreen = controls.getMissionScreen();
		let displayedMenu: XrMenuPage | undefined;
		let talking = false;
		let menuPressed = false;
		let lightPressed = false;
		let swirPressed = false;
		let talkPressed = false;
		const cancelTalk = () => {
			if (!talking) return;
			talking = false;
			controls.onTalkEnd();
		};
		const setMenu = (show: boolean) => {
			menuOpen = show;
			displayedMenu = undefined;
			if (show) {
				controls.onMenuOpen();
				velocityX = velocityZ = 0;
			}
			lastHud = -Infinity;
		};
		session.addEventListener('select', (event) => {
			if (!menuOpen || session.visibilityState !== 'visible') return;
			const space = renderer.xr.getReferenceSpace();
			const point = space && pointer(event.frame, event.inputSource, space);
			if (!point) return;
			const id = displayedMenu?.items[xrMenuIndex(point.x, point.y)]?.id;
			const item = controls.getMenu().items.find((control) => control.id === id);
			if (!item || item.disabled) return;
			displayedMenu = undefined;
			item.run();
			if (item.close) setMenu(false);
			lastHud = -Infinity;
		}, eventOptions);
		session.addEventListener('inputsourceschange', (event) => {
			if (event.removed.some((source) => source.handedness === 'right')) cancelTalk();
		}, eventOptions);
		session.addEventListener('visibilitychange', () => {
			if (session.visibilityState !== 'visible') {
				cancelTalk();
				sprintHeld = false;
				previous = velocityX = velocityZ = 0;
				reportExertion('resting');
			}
		}, eventOptions);

		const restoreDesktop = () => {
			if (xrSession !== session) return;
			sessionEvents.abort();
			cancelTalk();
			hud.dispose();
			camera.add(flashlight, flashlight.target);
			flashlight.castShadow = shadowWasEnabled;
			xrOrigin.remove(hudCamera);
			xrSession = undefined;
			renderer.setAnimationLoop(null);
			renderer.xr.enabled = false;
			scene.background = null;
			sprintHeld = false;
			previous = velocityX = velocityZ = 0;
			reportExertion('resting');
			if (abort.signal.aborted) return;
			resize();
			controls.onEnd();
		};
		renderer.xr.enabled = true;
		renderer.xr.setReferenceSpaceType('local-floor');
		renderer.xr.setFramebufferScaleFactor(0.9);
		scene.background = fog.color;
		renderer.setAnimationLoop((now, xrFrame) => {
			if (!xrFrame) return;
			const space = renderer.xr.getReferenceSpace();
			const pose = space && xrFrame.getViewerPose(space);
			if (!space || !pose) return;
			let left: Gamepad | undefined;
			let right: Gamepad | undefined;
			for (const source of session.inputSources) {
				if (source.handedness === 'left') left = source.gamepad;
				if (source.handedness === 'right') right = source.gamepad;
			}
			const menuDown = right?.buttons[4]?.pressed ?? false;
			const lightDown = right?.buttons[5]?.pressed ?? false;
			const swirDown = left?.buttons[5]?.pressed ?? false;
			const talkDown = right?.buttons[1]?.pressed ?? false;
			const active = session.visibilityState === 'visible';
			if (active) {
				const nextScreen = controls.getMissionScreen();
				if (menuDown && !menuPressed) setMenu(!menuOpen);
				if (nextScreen && nextScreen !== missionScreen) setMenu(true);
				missionScreen = nextScreen;
				if (lightDown && !lightPressed) controls.onToggleFlashlight();
				if (swirDown && !swirPressed) controls.onToggleSwir();
				if (talkDown && !talkPressed) {
					talking = true;
					controls.onTalkStart();
				}
			}
			if (!active || !talkDown) cancelTalk();
			menuPressed = menuDown;
			lightPressed = lightDown;
			swirPressed = swirDown;
			talkPressed = talkDown;

			const { orientation, position } = pose.transform;
			worldToEye.set(orientation.x, orientation.y, orientation.z, orientation.w);
			xrHeading.set(0, 0, -1).applyQuaternion(worldToEye);
			const headYaw = Math.atan2(-xrHeading.x, -xrHeading.z);
			const leftStick = xrStick(left?.axes[2], left?.axes[3]);
			const rightStick = xrStick(right?.axes[2], right?.axes[3]);
			const moving = active && !menuOpen && canMove();
			const driving = !!missionView?.inCabin;
			const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
			if (active && !menuOpen && !driving) {
				// Pivot around the headset, including when the player steps away from the tracking origin.
				const oldYaw = camera.rotation.y;
				camera.rotation.y -= rightStick.x * dt * 1.15;
				const yaw = camera.rotation.y;
				camera.position.x += position.x * (Math.cos(oldYaw) - Math.cos(yaw))
					+ position.z * (Math.sin(oldYaw) - Math.sin(yaw));
				camera.position.z += position.x * (Math.sin(yaw) - Math.sin(oldYaw))
					+ position.z * (Math.cos(oldYaw) - Math.cos(yaw));
			}
			sprintHeld = moving && !!left?.buttons[1]?.pressed;
			// The rover follows its own heading, so looking sideways does not steer it.
			const yaw = camera.rotation.y + (driving ? 0 : headYaw);
			if (!missionView || missionView.player) {
				move(now, moving ? -leftStick.y : 0, moving ? leftStick.x : 0, yaw, true);
			} else previous = now;
			xrOrigin.position.set(camera.position.x, camera.position.y - (driving ? position.y : eyeHeight), camera.position.z);
			xrOrigin.rotation.y = camera.rotation.y;
			hudCamera.position.set(position.x, position.y, position.z);
			hudCamera.quaternion.copy(worldToEye);
			xrOrigin.updateMatrixWorld(true);
			if (!reducedMotion.matches && (dust > 0 || drillMoving())) gustTime = (now - stormStarted) / 1000;
			updateWorld(now / 1000);

			if (now - lastHud >= (menuOpen ? 40 : 100)) {
				lastHud = now;
				if (menuOpen) {
					const points: Array<{ x: number; y: number }> = [];
					for (const source of session.inputSources) {
						const point = pointer(xrFrame, source, space);
						if (point) points.push(point);
					}
					const page = controls.getMenu();
					displayedMenu = page;
					hud.redraw((context) => drawXrMenu(context, page, points));
				} else {
					drawMap(missionView?.inCabin ? roverYaw : camera.rotation.y + headYaw);
					const swir = readSwir(hudCamera.getWorldPosition(headPosition), hudCamera.getWorldDirection(swirDirection));
					hud.redraw((context, width, height) => {
						const message = getMessage();
						const readings = getReadings();
						context.drawImage(map, 40, height - 195, 146, 146);
						drawHudTime(context, width, height - 28, getClock(), swir.active);
						drawHudTime(context, width, height - 54,
							message.readouts?.map(({ value, unit }) => (value + ' ' + unit).trim()).join('  ·  ')
							?? readings.o2Percent.toFixed(1) + '% O₂  ·  ' + (readings.airTempC == null ? '—' : Math.round(readings.airTempC)) + ' °C', false);
						drawHudTime(context, width, height - 85, message.title || getNotice(), false);
						if (message.detail) drawHudTime(context, width, height - 108, message.detail, false);
						const voiceLabel = controls.getVoiceLabel();
						if (voiceLabel) drawHudTime(context, width, 64, 'SARA · ' + voiceLabel, false);
						const action = controls.getAction();
						if (getNotice() && message.title) drawHudTime(context, width, 92, getNotice(), false);
						if (action) drawHudTime(context, width, height - 136, 'A opens controls · ' + action, false);
						drawSwirHud(context, width, height, swir);
					});
				}
			}
			renderer.render(scene, xrCamera);
		});
		const starting = renderer.xr.setSession(session);
		// Three.js restores the desktop framebuffer before resizing the canvas.
		session.addEventListener('end', restoreDesktop, { once: true });
		try {
			await starting;
		} catch (error) {
			await session.end().catch(() => {});
			restoreDesktop();
			throw error;
		}
	}

	function look(dx: number, dy: number) {
		camera.rotation.y -= dx * 0.0024;
		camera.rotation.x = MathUtils.clamp(camera.rotation.x - dy * 0.0024, -1.48, 1.48);
		if (!frame) draw();
	}

	async function captureLook() {
		if (document.pointerLockElement === canvas) return;
		try {
			await canvas.requestPointerLock?.();
		} catch {
			// Drag and arrow keys remain available without pointer lock.
		}
	}

	canvas.addEventListener('keydown', (event) => {
		if (!canLook()) return;
		if (event.code === 'KeyF' && !event.repeat) {
			setFlashlight(flashlight.intensity === 0);
			return;
		}
		if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
			if (canMove()) { sprintHeld = true; if (!frame) frame = requestAnimationFrame(step); }
			return;
		}
		if (event.code === 'Enter' && !event.repeat) void captureLook();
		if (walkKeys.includes(event.code)) {
			event.preventDefault();
			if (!canMove()) return;
			explored = true;
			keys.add(event.code);
			if (!frame) frame = requestAnimationFrame(step);
		}
		const dx = Number(event.code === 'ArrowRight') - Number(event.code === 'ArrowLeft');
		const dy = Number(event.code === 'ArrowDown') - Number(event.code === 'ArrowUp');
		if (dx || dy) {
			event.preventDefault();
			keys.add(event.code);
			if (!frame) frame = requestAnimationFrame(step);
		}
	}, options);
	window.addEventListener('keyup', (event) => {
		keys.delete(event.code);
		if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') sprintHeld = false;
	}, options);
	canvas.addEventListener('blur', () => { keys.clear(); sprintHeld = false; reportExertion('resting'); }, options);
	window.addEventListener('blur', () => { keys.clear(); sprintHeld = false; reportExertion('resting'); }, options);
	document.addEventListener('pointerlockchange', () => {
		if (document.pointerLockElement !== canvas) { keys.clear(); sprintHeld = false; reportExertion('resting'); }
	}, options);
	document.addEventListener('mousemove', (event) => {
		if (canLook() && document.pointerLockElement === canvas) look(event.movementX, event.movementY);
	}, options);
	canvas.addEventListener('pointerdown', (event) => {
		if (!canLook() || event.button !== 0 || drag || document.pointerLockElement === canvas) return;
		dragged = false;
		canvas.focus();
		canvas.setPointerCapture(event.pointerId);
		drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
	}, options);
	canvas.addEventListener('pointermove', (event) => {
		if (!drag || drag.id !== event.pointerId || document.pointerLockElement === canvas) return;
		dragged ||= event.clientX !== drag.x || event.clientY !== drag.y;
		look(event.clientX - drag.x, event.clientY - drag.y);
		drag.x = event.clientX;
		drag.y = event.clientY;
	}, options);
	canvas.addEventListener('click', (event) => {
		if (canLook() && event.pointerType === 'mouse' && !dragged) void captureLook();
	}, options);
	canvas.addEventListener('lostpointercapture', () => { drag = undefined; }, options);

	const observer = new ResizeObserver(resize);
	observer.observe(canvas);
	resize();

	const texture = new TextureLoader().load(orthoUrl, () => {
		if (abort.signal.aborted) return;
		texture.colorSpace = SRGBColorSpace;
		texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
		if (!highTexture) {
			swirLayer?.dispose();
		swirLayer = materialLayer && buildSwirTexture(texture.image as CanvasImageSource,
			materialLayer.swirCanvas, columns, rows, elevations, spacing);
			dangerRisk = computeStaticRisk({
				elevations, columns, rows, spacing, geology: geology?.features,
				texture: textureRoughness(texture.image as CanvasImageSource, columns, rows),
				hazard: { x: HAZARD.x, z: HAZARD.z, radius: HAZARD_RADIUS },
				width, length
			});
			dangerLayer?.dispose();
			dangerLayer = dangerTexture(dangerRisk, columns, rows);
			setDisplayMode(displayMode);
		}
	}, undefined, () => {
		if (!abort.signal.aborted) console.warn('Could not load the HiRISE orthoimage.');
	});
	let highTexture: Texture | undefined;

	async function loadHighQuality(gridUrl: string, imageUrl: string) {
		if (renderer.capabilities.maxTextureSize < 7765) return;
		try {
			const response = await fetch(gridUrl, options);
			if (!response.ok) throw new Error('Could not download the high-resolution HiRISE grid.');
			const grid = await response.arrayBuffer();
			if (abort.signal.aborted || explored) return;
			const image = await new TextureLoader().loadAsync(imageUrl);
			try {
				if (abort.signal.aborted || explored) return;
				const { width: imageWidth, height: imageHeight } = image.image;
				if (Math.max(imageWidth, imageHeight) > renderer.capabilities.maxTextureSize) {
					throw new Error('The orthoimage exceeds the maximum texture size.');
				}
				const candidate = buildTerrain(grid);
				if (candidate.width !== width || candidate.length !== length ||
					!Number.isFinite(candidate.surfaceHeight(spawnX, spawnZ))) {
					candidate.geometry.dispose();
					throw new Error('The high-resolution grid does not match the terrain.');
				}
				image.colorSpace = SRGBColorSpace;
				image.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
				highTexture = image;
				highTerrain = candidate;
				applyHighQuality(candidate, image);
			} finally {
				if (highTexture !== image) image.dispose();
			}
		} catch (error) {
			if (!abort.signal.aborted) console.warn('Could not load the high-resolution terrain.', error);
		}
	}

	function applyHighQuality(active: ReturnType<typeof buildTerrain>, image: Texture) {
		spacing = active.spacing;
		columns = active.columns;
		rows = active.rows;
		elevations = active.elevations;
		surfaceHeight = active.surfaceHeight;
		mesh.geometry = active.geometry;
		swirLayer?.dispose();
		swirLayer = materialLayer && buildSwirTexture(image.image as CanvasImageSource, materialLayer.swirCanvas, columns, rows, elevations, spacing);
		dangerRisk = computeStaticRisk({
			elevations, columns, rows, spacing, geology: geology?.features,
			texture: textureRoughness(image.image as CanvasImageSource, columns, rows),
			hazard: { x: HAZARD.x, z: HAZARD.z, radius: HAZARD_RADIUS },
			width, length
		});
		dangerLayer?.dispose();
		dangerLayer = dangerTexture(dangerRisk, columns, rows);
		shadowDirty = true;
		sun.shadow.dispose();
		sun.shadow.map = null;
		sun.shadow.mapSize.setScalar(4096);
		for (const tile of rockTiles.values()) {
			for (const rocks of tile.meshes) {
				scene.remove(rocks);
				rocks.dispose();
			}
		}
		rockTiles.clear();
		lastRockTileX = lastRockTileZ = Number.NaN;
		mapX = Infinity;
		missionScene?.reground();
		setDisplayMode(displayMode);
		updateRockTiles();
		camera.position.y = eyeY();
		atEdge = false;
		edgeNoticeShown = false;
		notify('ready');
		draw();
	}

	return {
		enterVR,
		exitVR: () => xrSession?.end(),
		isInVR: () => renderer.xr.isPresenting,
		loadHighQuality,
		refresh: () => {
			optics.invalidate();
			draw();
		},
		setTime,
		setFlashlight,
		setMapZoom: (zoom: number) => {
			mapZoom = MathUtils.clamp(zoom, 0.5, 4);
			mapX = mapZ = Infinity;
			draw();
		},
		setDisplayMode,
		setStorm: (enabled: boolean) => setDust(Number(enabled)),
		setDust,
		setWind,
		setMissionView,
		getPosition: (): Point => ({ x: camera.position.x, z: camera.position.z }),
		getHeading: () => compass(missionView?.inCabin ? roverYaw : camera.rotation.y),
		getDangerAt: (x: number, z: number): number => {
			const col = Math.floor((x + width / 2) / spacing);
			const row = Math.floor((z + length / 2) / spacing);
			const staticRisk = col >= 0 && row >= 0 && col < columns && row < rows
				? dangerRisk[row * columns + col] : 1;
			return dangerScore(staticRisk, rockProximityRisk(x, z, rockColliders),
				dangerThermal, dangerVisibility);
		},
		dispose() {
			abort.abort();
			renderer.setAnimationLoop(null);
			void xrSession?.end().catch(() => {});
			cancelAnimationFrame(stormFrame);
			cancelAnimationFrame(swirFrame);
			if (document.pointerLockElement === canvas) document.exitPointerLock();
			cancelAnimationFrame(frame);
			observer.disconnect();
			for (const rocks of rockTiles.values()) {
				for (const mesh of rocks.meshes) {
					scene.remove(mesh);
					mesh.dispose();
				}
			}
			rockTiles.clear();
			lightTerrain.geometry.dispose();
			highTerrain?.geometry.dispose();
			highTexture?.dispose();
			sun.shadow.dispose();
			flashlight.shadow.dispose();
			terrainMaterial.dispose();
			for (const rockGeometry of rockGeometries) rockGeometry.dispose();
			for (const material of rockMaterials) {
				material.dispose();
			}
			saltationGrains.dispose();
			texture.dispose();
			missionScene?.dispose();
			cabin.dispose();
			routeMesh.geometry.dispose();
			routeMaterial.dispose();
			swirLayer?.dispose();
			dangerLayer?.dispose();
			dangerRings.dispose();
			optics.dispose();
			renderer.dispose();
		}
	};
}
