import {
	BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, DirectionalLight, FogExp2, Group, HemisphereLight, MathUtils,
	IcosahedronGeometry, InstancedMesh, LineBasicMaterial, LineSegments, Mesh, MeshLambertMaterial, MeshStandardMaterial, Object3D, PCFSoftShadowMap,
	PerspectiveCamera, Quaternion, Raycaster, Scene, SRGBColorSpace,
	TextureLoader, Vector3, WebGLRenderer
} from 'three';
import {
	buildVisorOptics, dustColor, SWIR_DEPTH_RESPONSE_GLSL, SWIR_DUST_TRANSMISSION, SWIR_NOISE_GLSL,
	type SwirHudData, type VisorMessage
} from './visor-optics.js';
import { solarPosition } from './mars-time.js';
import { BASE, HAZARD, ROVER, SAMPLE, type Point } from './ares/route.js';

const elevationColors = ['#92563a', '#b47a54', '#c29169'];

export type TerrainDisplayMode = 'visible' | 'geology' | 'slope' | 'swir';

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
const geologyColors: Record<string, string> = {
	'0': '#004deb', '1': '#0099ff', '2': '#eb4d80', '3': '#de4d00', '4': '#0000eb',
	'5': '#b300eb', '6': '#ebcc99', '7': '#ffff00', '8': '#ccde99', '9': '#ebb3ff',
	'10': '#ffb300', '11': '#b3804d', '12': '#669900', '13': '#ebeb66'
};
// ponytail: map-unit SWIR values are visual proxies, not measured spectra; use CRISM if measured reflectance is required.
const swirAlbedo: Record<string, number> = {
	'0': 0.78, // Jezero fan 2 — dusty sediment
	'1': 0.75, // Jezero fan 1 — dusty sediment
	'2': 0.72, // crater floor — fine regolith
	'3': 0.68, // lower etched unit
	'7': 0.85, // eolian bedform — loose dust
	'8': 0.82, // smooth unit — loose regolith
	'10': 0.70, // upper etched unit
	'11': 0.22 // crater rim — exposed rock proxy
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
	// ponytail: 160 bounded streaks visualize near-field grains; full particulate optics stay in the dust shader.
	const count = 160;
	const random = seededRandom(0x51a7a710);
	const positions = new Float32Array(count * 6);
	const colors = new Float32Array(count * 6);
	const offsets = Array.from({ length: count }, () => {
		const radius = 0.5 + random() * 5.5;
		const angle = random() * Math.PI * 2;
		const bright = random() > 0.3;
		const value = bright ? 0.72 + random() * 0.25 : 0.08 + random() * 0.12;
		const trail = 0.025 + random() * 0.11;
		return { x: Math.cos(angle) * radius, y: (random() - 0.52) * 2.2, z: Math.sin(angle) * radius, trail, value };
	});
	for (let i = 0; i < count; i++) {
		const value = offsets[i].value;
		colors.set([value, value, value, value * 0.28, value * 0.28, value * 0.28], i * 6);
	}
	const geometry = new BufferGeometry();
	const positionAttribute = new BufferAttribute(positions, 3);
	geometry.setAttribute('position', positionAttribute);
	geometry.setAttribute('color', new BufferAttribute(colors, 3));
	const material = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false });
	const object = new LineSegments(geometry, material);
	object.frustumCulled = false;
	object.visible = false;
	const wind = new Vector3(0.94, 0, 0.34).normalize();
	return {
		object,
		update(camera: Vector3, elapsed: number, windSpeed: number, active: boolean) {
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

function geologyTextures(data: GeologyData | undefined, columns: number, rows: number) {
	const geologyCanvas = document.createElement('canvas');
	const swirCanvas = document.createElement('canvas');
	for (const canvas of [geologyCanvas, swirCanvas]) {
		canvas.width = columns;
		canvas.height = rows;
	}
	const geologyContext = geologyCanvas.getContext('2d');
	const swirContext = swirCanvas.getContext('2d');
	if (!geologyContext || !swirContext) return undefined;
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
		for (const context of [geologyContext, swirContext]) {
			context.beginPath();
			for (const ring of rings) {
				for (let i = 0; i < ring.length; i++) {
					const [longitude, latitude] = ring[i];
					const x = (projectX(longitude) - left) / (right - left) * columns;
					const y = (top - projectY(latitude)) / (top - bottom) * rows;
					if (i === 0) context.moveTo(x, y);
					else context.lineTo(x, y);
				}
				context.closePath();
			}
		}
		geologyContext.fillStyle = geologyColors[unit] ?? '#777777';
		geologyContext.fill('evenodd');
		const gray = Math.round((swirAlbedo[unit] ?? 0.5) * 255);
		swirContext.fillStyle = `rgb(${gray} ${gray} ${gray})`;
		swirContext.fill('evenodd');
	}
	const geology = new CanvasTexture(geologyCanvas);
	geology.colorSpace = SRGBColorSpace;
	return { geology, swirCanvas };
}

function slopeTexture(elevations: Float32Array, columns: number, rows: number, spacing: number) {
	const canvas = document.createElement('canvas');
	canvas.width = columns;
	canvas.height = rows;
	const context = canvas.getContext('2d');
	if (!context) return undefined;
	const pixels = context.createImageData(columns, rows);
	for (let row = 1; row < rows - 1; row++) for (let col = 1; col < columns - 1; col++) {
		const i = row * columns + col;
		const west = elevations[i - 1], east = elevations[i + 1];
		const north = elevations[i - columns], south = elevations[i + columns];
		if (![west, east, north, south].every(Number.isFinite)) continue;
		const grade = Math.atan(Math.hypot((east - west) / (2 * spacing), (south - north) / (2 * spacing))) * 180 / Math.PI;
		const color = grade < 5 ? [38, 150, 101] : grade < 12 ? [222, 163, 62] : [207, 77, 67];
		pixels.data.set([...color, 230], i * 4);
	}
	context.putImageData(pixels, 0, 0);
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	return texture;
}

function buildSwirTexture(image: CanvasImageSource, mask: HTMLCanvasElement, columns: number, rows: number) {
	const canvas = document.createElement('canvas');
	canvas.width = columns;
	canvas.height = rows;
	const context = canvas.getContext('2d');
	const maskContext = mask.getContext('2d');
	if (!context || !maskContext) return undefined;
	context.drawImage(image, 0, 0, columns, rows);
	const pixels = context.getImageData(0, 0, columns, rows);
	const albedo = maskContext.getImageData(0, 0, columns, rows);
	for (let i = 0; i < pixels.data.length; i += 4) {
		if (!pixels.data[i + 3]) continue;
		const material = albedo.data[i] / 255;
		const value = Math.round(MathUtils.clamp(material, 0.05, 1) * 255);
		pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
	}
	context.putImageData(pixels, 0, 0);
	// Reflectance values are linear data, not sRGB display colors.
	return new CanvasTexture(canvas);
}

function buildTerrain(data: ArrayBuffer) {
	const header = new DataView(data);
	const columns = header.getUint32(0, true);
	const rows = header.getUint32(4, true);
	const spacing = header.getFloat32(8, true);
	const count = columns * rows;
	if (columns < 2 || rows < 2 || data.byteLength !== 12 + count * 4 || !(spacing > 0)) {
		throw new Error('La cuadrícula de elevación no es válida.');
	}

	const elevations = new Float32Array(data, 12);
	let low = Infinity;
	let high = -Infinity;
	for (const height of elevations) {
		if (!Number.isFinite(height)) continue;
		low = Math.min(low, height);
		high = Math.max(high, height);
	}
	if (!(high > low)) throw new Error('No hay elevaciones válidas.');

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
			positions.set([col * spacing - width / 2, height, row * spacing - length / 2], i * 3);
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
					indices.set([i, south, east], index);
					index += 3;
				}
				if (Number.isFinite(elevations[southeast])) {
					indices.set([east, south, southeast], index);
					index += 3;
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

interface MissionView {
	point: Point;
	ahead: Point;
	route: readonly Point[];
	showHazard: boolean;
	baseRoute: boolean;
	showPosition: boolean;
	tilt: number;
}

const mapSize = 96;
const mapSpan = 160;
const metresPerPixel = mapSpan / mapSize;
const walkKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
const rockTileSize = 64;
const rockLoadRadius = 128;

type RockCollider = { x: number; z: number; radius: number };

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
	getSwir: () => SwirHudData
) {
	const { geometry, width, length, spacing, columns, rows, elevations, surfaceHeight } = buildTerrain(data);
	let renderer: WebGLRenderer;
	try {
		renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
	} catch (error) {
		geometry.dispose();
		throw error;
	}
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = PCFSoftShadowMap;

	const swirRaycaster = new Raycaster();
	const swirDirection = new Vector3();
	const optics = buildVisorOptics(renderer, map, getNotice, getClock, getMessage, () => {
		const data = getSwir();
		if (displayMode !== 'swir') return { ...data, active: false };
		swirRaycaster.set(camera.position, camera.getWorldDirection(swirDirection));
		const target = swirRaycaster.intersectObjects(scene.children, true)
			.find((hit) => typeof hit.object.userData.swirAlbedo === 'number');
		return target ? {
			...data,
			distanceM: target.distance,
			albedo: target.object.userData.swirAlbedo as number,
			surface: String(target.object.userData.swirSurface ?? 'SURFACE')
		} : { ...data, distanceM: null, albedo: null, surface: undefined };
	});
	const scene = new Scene();
	const fog = new FogExp2('#bb8867', 0.00042);
	scene.fog = fog;
	const terrainMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
	const orthoTint = new Color('#bf9d83');
	const geologyLayer = geologyTextures(geology, columns, rows);
	const slopeLayer = slopeTexture(elevations, columns, rows, spacing);
	let swirLayer: CanvasTexture | undefined;
	let displayMode: TerrainDisplayMode = 'visible';
	let compiledShader: { uniforms: Record<string, { value: unknown }> } | undefined;
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
		` + shader.fragmentShader.replace(
			'#include <map_fragment>',
			`#ifdef USE_MAP
				vec4 ortho = texture2D(map, vMapUv);
				float gray = dot(ortho.rgb, vec3(0.2126, 0.7152, 0.0722));
				vec3 layerColor = mix(ortho.rgb, vec3(gray), swirMode);
				diffuseColor.rgb = mix(diffuseColor.rgb,
					layerColor * mix(vec3(1.0), orthoTint, orthoTintMode), ortho.a);
			#endif`
		).replace(
			'#include <color_fragment>',
			`#include <color_fragment>
			vec2 p = groundPoint.xz;
			vec2 st = p * 2.8;
			vec2 cell = floor(st);
			vec2 jitter = dustHash(cell);
			vec2 gravel = (fract(st) - (0.19 + 0.62 * jitter)) * vec2(1.0, 1.45);
			float pebble = (1.0 - smoothstep(0.025, 0.05 + 0.17 * jitter.x, length(gravel)))
				* smoothstep(0.30, 0.80, jitter.y);
			float distanceFade = 1.0 - smoothstep(14.0, 65.0, vViewPosition.z);
			float dust = dustNoise(p * 0.19) * 0.17 + dustNoise(p * 1.2) * 0.07;
			float strata = (dustNoise(vec2(p.x * 0.035, groundPoint.y * 0.12)) - 0.5) * 0.11;
			diffuseColor.rgb *= 0.86 + strata + (dust - pebble * 0.32) * distanceFade;`
		);
		shader.uniforms.orthoTint = { value: orthoTint };
		shader.uniforms.orthoTintMode = { value: displayMode === 'visible' ? 1 : 0 };
		shader.uniforms.swirMode = { value: displayMode === 'swir' ? 1 : 0 };
		compiledShader = shader as unknown as typeof compiledShader;
		shader.fragmentShader = 'uniform vec3 orthoTint;\n' + shader.fragmentShader;
		shader.fragmentShader = 'uniform float orthoTintMode;\nuniform float swirMode;\n' + shader.fragmentShader;
	};
	const swirMaterialSetters: Array<(enabled: boolean, time?: number) => void> = [
		installSwirMaterialResponse(terrainMaterial, 1, true)
	];
	const mesh = new Mesh(geometry, terrainMaterial);
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

	const rockGeometries = [0, 1, 2].map((variant) => {
		const geometry = new IcosahedronGeometry(1, variant === 0 ? 1 : 2);
		const positions = geometry.getAttribute('position');
		const roughness = [0.16, 0.22, 0.18][variant];
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
			const flattening = variant === 2 ? 0.62 : 1;
			positions.setXYZ(i, x * radius, y * radius * flattening, z * radius);
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
	const rockTiles = new Map<string, { meshes: InstancedMesh[]; colliders: RockCollider[] }>();
	let rockColliders: RockCollider[] = [];
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
		const colliders: RockCollider[] = [];
		const variants: Array<Array<{ x: number; z: number; y: number; sx: number; sy: number; sz: number; yaw: number; color: Color }>> =
			rockGeometries.map(() => []);
		const clusterCount = 2 + Math.floor(random() * 2);
		const clusters = Array.from({ length: clusterCount }, () => ({ x: random(), z: random() }));
		const count = 14 + Math.floor(random() * 9);
		for (let i = 0; i < count; i++) {
			let localX: number;
			let localZ: number;
			if (random() < 0.76) {
				const cluster = clusters[Math.floor(random() * clusters.length)];
				const offsetX = (random() + random() + random() - 1.5) * 13;
				const offsetZ = (random() + random() + random() - 1.5) * 13;
				localX = cluster.x * rockTileSize + offsetX;
				localZ = cluster.z * rockTileSize + offsetZ;
			} else {
				localX = random() * rockTileSize;
				localZ = random() * rockTileSize;
			}
			const x = -width / 2 + tileX * rockTileSize + localX;
			const z = -length / 2 + tileZ * rockTileSize + localZ;
			if (x < -width / 2 || x > width / 2 || z < -length / 2 || z > length / 2) continue;
			if (Math.hypot(x - spawnX, z - spawnZ) < 4.5) continue;
			const y = surfaceHeight(x, z);
			const left = surfaceHeight(x - spacing, z);
			const right = surfaceHeight(x + spacing, z);
			const back = surfaceHeight(x, z - spacing);
			const front = surfaceHeight(x, z + spacing);
			if (![y, left, right, back, front].every(Number.isFinite)) continue;
			const slopeX = (left - right) / (2 * spacing);
			const slopeZ = (back - front) / (2 * spacing);
			if (Math.hypot(slopeX, slopeZ) > 0.78) continue;

			const sizeRoll = random();
			const radius = sizeRoll < 0.72 ? 0.16 + random() * 0.28
				: sizeRoll < 0.96 ? 0.42 + random() * 0.62
					: 1.15 + random() * 1.15;
			const sx = radius * (0.78 + random() * 0.48);
			const sy = radius * (0.52 + random() * 0.42);
			const sz = radius * (0.78 + random() * 0.48);
			const variant = Math.floor(random() * rockGeometries.length);
			const palette = ['#765947', '#b4815c', '#916a51'];
			rockColor.set(palette[variant]);
			rockColor.multiplyScalar(0.9 + random() * 0.2);

			variants[variant].push({
				x, z, y, sx, sy, sz,
				yaw: random() * Math.PI * 2,
				color: rockColor.clone()
			});
		}

		const meshes: InstancedMesh[] = [];
		variants.forEach((instances, variant) => {
			if (instances.length === 0) return;
			const rocks = new InstancedMesh(rockGeometries[variant], rockMaterials[variant], instances.length);
			rocks.castShadow = true;
			rocks.receiveShadow = true;
			rocks.userData.swirAlbedo = [0.22, 0.72, 0.78][variant];
			rocks.userData.swirSurface = ['EXPOSED ROCK', 'DUSTED ROCK', 'SEDIMENTARY ROCK'][variant];
			instances.forEach((rock, index) => {
				placement.quaternion.setFromUnitVectors(up, normal.set(
					(surfaceHeight(rock.x - spacing, rock.z) - surfaceHeight(rock.x + spacing, rock.z)) / (2 * spacing),
					1,
					(surfaceHeight(rock.x, rock.z - spacing) - surfaceHeight(rock.x, rock.z + spacing)) / (2 * spacing)
				).normalize());
				yaw.setFromAxisAngle(up, rock.yaw);
				placement.quaternion.multiply(yaw);
				placement.scale.set(rock.sx, rock.sy, rock.sz);
				const vertices = rockGeometries[variant].getAttribute('position');
				let supportY = -Infinity;
				for (let vertex = 0; vertex < vertices.count; vertex++) {
					supportPoint.fromBufferAttribute(vertices, vertex)
						.multiply(placement.scale)
						.applyQuaternion(placement.quaternion);
					const groundY = surfaceHeight(rock.x + supportPoint.x, rock.z + supportPoint.z);
					if (Number.isFinite(groundY)) supportY = Math.max(supportY, groundY - supportPoint.y);
				}
				const sink = Math.max(0.035, rock.sy * 0.045);
				placement.position.set(rock.x, Number.isFinite(supportY) ? supportY - sink : rock.y + rock.sy * 0.5, rock.z);
				placement.updateMatrix();
				rocks.setMatrixAt(index, placement.matrix);
				rocks.setColorAt(index, rock.color);
			});
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
		const colliders: RockCollider[] = [];
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
				for (const mesh of rocks.meshes) scene.remove(mesh);
				rockTiles.delete(key);
			}
		}
		rockColliders = colliders;
	}

	const landmarks = new Group();
	landmarks.visible = false;
	scene.add(landmarks);
	const hardware = new BoxGeometry(1, 1, 1);
	const cabin = new MeshLambertMaterial({ color: '#ccc6b7' });
	const frameMaterial = new MeshLambertMaterial({ color: '#332b25' });
	const shale = new MeshLambertMaterial({ color: '#6e4736' });
	swirMaterialSetters.push(installSwirMaterialResponse(cabin, 0.92));
	swirMaterialSetters.push(installSwirMaterialResponse(frameMaterial, 0.9));
	swirMaterialSetters.push(installSwirMaterialResponse(shale, 0.72));
	function part(anchor: Point, dx: number, y: number, dz: number, w: number, h: number, d: number, paint: MeshLambertMaterial) {
		const block = new Mesh(hardware, paint);
		block.position.set(anchor.x + dx, surfaceHeight(anchor.x, anchor.z) + y, anchor.z + dz);
		block.scale.set(w, h, d);
		block.userData.swirAlbedo = paint === shale ? 0.22 : 0.92;
		block.userData.swirSurface = paint === shale ? 'EXPOSED ROCK' : 'HARDWARE';
		landmarks.add(block);
	}
	part(ROVER, 0, 1.5, 0, 3, 1.9, 5, cabin);
	part(ROVER, 0, 1.9, -2.51, 2.2, 0.7, 0.04, frameMaterial);
	for (const side of [-1, 1]) {
		for (const axle of [-1.6, 0, 1.6]) part(ROVER, side * 1.6, 0.53, axle, 0.65, 1.05, 1.05, frameMaterial);
	}
	part(BASE, 0, 1.9, 8, 7, 3.8, 8, cabin);
	const outcrop = { x: SAMPLE.x - 3, z: SAMPLE.z - 2 };
	part(outcrop, 0, 0.45, 0, 2.8, 0.85, 2, shale);
	part(outcrop, 0.24, 0.99, 0, 2.2, 0.26, 1.6, shale);
	part(outcrop, 0.25, 1.26, 0, 1.5, 0.32, 0.78, cabin);
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
	function drawMap() {
		if (!mapContext || !reliefContext || !pixels) return;
		const scale = missionView ? (missionView.baseRoute ? 30 : 5) : metresPerPixel;
		const { x, z } = missionView?.baseRoute ? { x: ROVER.x, z: (ROVER.z + BASE.z) / 2 }
			: missionView ? { x: SAMPLE.x + 30, z: SAMPLE.z + 175 } : camera.position;
		if (Math.hypot(x - mapX, z - mapZ) >= scale) {
			mapX = x;
			mapZ = z;
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
		mapContext.drawImage(relief, 0, 0);
		mapContext.save();
		if (missionView) {
			const px = (value: number) => mapSize / 2 + (value - x) / scale;
			const pz = (value: number) => mapSize / 2 + (value - z) / scale;
			if (missionView.showHazard) {
				mapContext.fillStyle = '#f2a05070';
				mapContext.beginPath();
				mapContext.ellipse(px(HAZARD.x), pz(HAZARD.z), 7, 10, 0, 0, Math.PI * 2);
				mapContext.fill();
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
			const objective = missionView.baseRoute ? BASE : SAMPLE;
			mapContext.fillRect(px(objective.x) - 2, pz(objective.z) - 2, 4, 4);
			mapContext.fillStyle = '#edfff6';
			mapContext.fillRect(px(ROVER.x) - 3, pz(ROVER.z) - 2, 6, 4);
			if (!missionView.showPosition) {
				mapContext.restore();
				return;
			}
			mapContext.translate(px(camera.position.x), pz(camera.position.z));
		} else mapContext.translate(mapSize / 2, mapSize / 2);
		mapContext.rotate(-camera.rotation.y);
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
	const worldToEye = new Quaternion();
	const nightFog = new Color('#161b29');
	const duskFog = new Color('#9c624a');
	const dayFog = new Color('#bb8867');
	const neutralFog = new Color('#777777');
	const dustFog = new Color();
	const lowSun = new Color('#ffad78');
	const highSun = new Color('#fff0d9');
	let daylight = 1;
	let twilight = 1;
	let dust = 0;
	let windSpeed = 7.4;
	let stormFrame = 0;
	let swirFrame = 0;
	let stormStarted = 0;
	let gustTime = 0;
	const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
	const draw = () => {
		const swir = displayMode === 'swir';
		const frameTime = performance.now() / 1000;
		for (const setSwir of swirMaterialSetters) setSwir(swir, frameTime);
		saltationGrains.update(camera.position, gustTime, windSpeed, swir && dust > 0.02);
		updateRockTiles();
		sun.target.position.copy(camera.position);
		sun.position.copy(camera.position).addScaledVector(sunDirectionWorld, rockLoadRadius * 2.5);
		worldToEye.copy(camera.quaternion).invert();
		lightInView.copy(sunDirectionWorld).applyQuaternion(worldToEye);
		drawMap();
		optics.render(scene, camera, lightInView, twilight, daylight,
				swir ? dust * SWIR_DUST_TRANSMISSION : dust, gustTime, swir, windSpeed);
	};
	function updateLighting() {
		const up = sunDirectionWorld.y;
		const opticalDust = displayMode === 'swir' ? dust * SWIR_DUST_TRANSMISSION : dust;
		daylight = MathUtils.smoothstep(up, 0, 0.38);
		twilight = MathUtils.smoothstep(up, -0.21, 0.08);
		sun.intensity = 2.05 * MathUtils.smoothstep(up, 0, 0.48);
		sun.color.copy(lowSun).lerp(highSun, daylight);
		ambient.intensity = 0.045 + 0.42 * twilight + 1.02 * daylight;
		fog.color.copy(nightFog).lerp(duskFog, twilight).lerp(dayFog, daylight);
		if (displayMode === 'swir') fog.color.lerp(neutralFog, 0.85);
		fog.density = MathUtils.lerp(0.00042, 0.006, dust) * (displayMode === 'swir' ? SWIR_DUST_TRANSMISSION : 1);
		if (opticalDust > 0) {
			sun.intensity *= Math.exp(-2.8 * opticalDust / Math.max(0.15, up));
			ambient.intensity *= MathUtils.lerp(1, 0.57, opticalDust);
			const stormColor = dustColor(dustFog, twilight, daylight);
			if (displayMode === 'swir') stormColor.lerp(neutralFog, 0.85);
			fog.color.lerp(stormColor, opticalDust);
		}
	}
	function setDisplayMode(mode: TerrainDisplayMode) {
		displayMode = mode;
		terrainMaterial.map = mode === 'geology' ? geologyLayer?.geology ?? null
			: mode === 'slope' ? slopeLayer ?? null
				: mode === 'swir' ? swirLayer ?? texture : texture;
		if (compiledShader) {
			compiledShader.uniforms.orthoTintMode.value = mode === 'visible' ? 1 : 0;
			compiledShader.uniforms.swirMode.value = mode === 'swir' ? 1 : 0;
		}
		cancelAnimationFrame(swirFrame);
		swirFrame = 0;
		if (mode === 'swir' && !reducedMotion.matches) {
			const animateSwir = () => {
				if (displayMode !== 'swir') { swirFrame = 0; return; }
				draw();
				swirFrame = requestAnimationFrame(animateSwir);
			};
			swirFrame = requestAnimationFrame(animateSwir);
		}
		terrainMaterial.needsUpdate = true;
		updateLighting();
		draw();
	}
	function setTime(localSol: number) {
		const { east, up, north } = solarPosition(localSol);
		sunDirectionWorld.set(east, up, -north).normalize();
		updateLighting();
		draw();
	}
	function animateStorm(now: number) {
		stormFrame = requestAnimationFrame(animateStorm);
		const elapsed = (now - stormStarted) / 1000;
		if (elapsed - gustTime < 1 / 30) return;
		gustTime = elapsed;
		if (!frame) draw();
	}
	function updateStormMotion() {
		cancelAnimationFrame(stormFrame);
		gustTime = 0;
		if (dust > 0 && !reducedMotion.matches) {
			stormStarted = performance.now();
			stormFrame = requestAnimationFrame(animateStorm);
		}
		draw();
	}
	function setDust(next: number) {
		if (next === dust) return;
		const motionChanged = (dust > 0) !== (next > 0);
		dust = next;
		updateLighting();
		if (motionChanged) updateStormMotion();
		else draw();
	}
	function setWind(next: number | null) {
		if (next === null || !Number.isFinite(next) || next < 0 || next === windSpeed) return;
		windSpeed = next;
		draw();
	}

	function setMissionView(view?: MissionView) {
		const wasActive = !!missionView;
		if (!wasActive && !view) return;
		missionView = view;
		landmarks.visible = !!view;
		if (wasActive !== !!view) mapX = Infinity;
		keys.clear();
		velocityX = velocityZ = 0;
		if (!view && atEdge) {
			atEdge = false;
			notify('ready');
		}
		const { x, z } = view?.point ?? { x: spawnX, z: spawnZ };
		const height = surfaceHeight(x, z);
		const tilt = reducedMotion.matches ? 0 : (view?.tilt ?? 0);
		if (Number.isFinite(height)) camera.position.set(x, height + eyeHeight - 0.64 * tilt, z);
		camera.rotation.set(-0.085 - 0.26 * tilt, view
			? Math.atan2(x - view.ahead.x, z - view.ahead.z)
			: 0.58, 0.32 * tilt);
		draw();
	}
	function resize() {
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
	const eyeY = () => surfaceHeight(camera.position.x, camera.position.z) + eyeHeight;

	function step(now: number) {
		const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
		previous = now;
		const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
		const side = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
		const speed = 1.45 / Math.max(1, Math.hypot(forward, side));
		const yaw = camera.rotation.y;
		velocityX = MathUtils.damp(velocityX, speed * (side * Math.cos(yaw) - forward * Math.sin(yaw)), 10, dt);
		velocityZ = MathUtils.damp(velocityZ, speed * (-side * Math.sin(yaw) - forward * Math.cos(yaw)), 10, dt);
		const x = camera.position.x + velocityX * dt;
		const z = camera.position.z + velocityZ * dt;
		const nextHeight = surfaceHeight(x, z);
		const distance = Math.hypot(velocityX, velocityZ) * dt;
		const hitsRock = rockColliders.some((rock) =>
			Math.hypot(x - rock.x, z - rock.z) < rock.radius + 0.42
		);
		const blocked = !Number.isFinite(nextHeight) || hitsRock || Math.abs(nextHeight + eyeHeight - eyeY()) > distance * 0.72;
		if (blocked !== atEdge && (forward || side)) {
			atEdge = blocked;
			notify(blocked ? 'edge' : 'ready');
		}
		if (!blocked) {
			camera.position.x = x;
			camera.position.z = z;
			stride += distance;
		}
		const bob = reducedMotion.matches || blocked ? 0 : Math.sin(stride * 7) * Math.min(distance / (dt || 1), 1) * 0.025;
		camera.position.y = eyeY() + bob;
		draw();
		if (keys.size || Math.hypot(velocityX, velocityZ) > 0.015) frame = requestAnimationFrame(step);
		else {
			frame = 0;
			previous = velocityX = velocityZ = 0;
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
		if (missionView) return;
		if (event.code === 'Enter' && !event.repeat) void captureLook();
		if (walkKeys.includes(event.code)) {
			event.preventDefault();
			keys.add(event.code);
			if (!frame) frame = requestAnimationFrame(step);
		}
		const dx = Number(event.code === 'ArrowRight') - Number(event.code === 'ArrowLeft');
		const dy = Number(event.code === 'ArrowDown') - Number(event.code === 'ArrowUp');
		if (dx || dy) {
			event.preventDefault();
			look(dx * 14, dy * 14);
		}
	}, options);
	window.addEventListener('keyup', (event) => keys.delete(event.code), options);
	canvas.addEventListener('blur', () => keys.clear(), options);
	window.addEventListener('blur', () => keys.clear(), options);
	document.addEventListener('pointerlockchange', () => {
		if (document.pointerLockElement !== canvas) keys.clear();
	}, options);
	document.addEventListener('mousemove', (event) => {
		if (document.pointerLockElement === canvas) look(event.movementX, event.movementY);
	}, options);
	canvas.addEventListener('pointerdown', (event) => {
		if (missionView || event.button !== 0 || drag || document.pointerLockElement === canvas) return;
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
		if (!missionView && event.pointerType === 'mouse' && !dragged) void captureLook();
	}, options);
	canvas.addEventListener('lostpointercapture', () => { drag = undefined; }, options);

	const observer = new ResizeObserver(resize);
	observer.observe(canvas);
	resize();

	const texture = new TextureLoader().load(orthoUrl, () => {
		if (abort.signal.aborted) return;
		texture.colorSpace = SRGBColorSpace;
		texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
		swirLayer = geologyLayer && buildSwirTexture(texture.image as CanvasImageSource,
			geologyLayer.swirCanvas, columns, rows);
		setDisplayMode(displayMode);
	}, undefined, () => {
		if (!abort.signal.aborted) console.warn('No se pudo cargar la ortoimagen HiRISE.');
	});

	return {
		refresh: draw,
		setTime,
		setDisplayMode,
		setStorm: (enabled: boolean) => setDust(Number(enabled)),
		setDust,
		setWind,
		setMissionView,
		dispose() {
			abort.abort();
			cancelAnimationFrame(stormFrame);
			cancelAnimationFrame(swirFrame);
			if (document.pointerLockElement === canvas) document.exitPointerLock();
			cancelAnimationFrame(frame);
			observer.disconnect();
			for (const rocks of rockTiles.values()) {
				for (const mesh of rocks.meshes) scene.remove(mesh);
			}
			rockTiles.clear();
			geometry.dispose();
			terrainMaterial.dispose();
			for (const rockGeometry of rockGeometries) rockGeometry.dispose();
			for (const material of rockMaterials) {
				material.dispose();
			}
			saltationGrains.dispose();
			texture.dispose();
			geologyLayer?.geology.dispose();
			swirLayer?.dispose();
			slopeLayer?.dispose();
			hardware.dispose();
			cabin.dispose();
			frameMaterial.dispose();
			shale.dispose();
			optics.dispose();
			renderer.dispose();
		}
	};
}
