import {
	BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight, FogExp2, Group, HemisphereLight, MathUtils,
	IcosahedronGeometry, InstancedMesh, Mesh, MeshLambertMaterial, MeshStandardMaterial, Object3D, PCFShadowMap,
	PerspectiveCamera, Quaternion, Scene, SRGBColorSpace,
	Texture, TextureLoader, Vector3, WebGLRenderer
} from 'three';
import { buildVisorOptics, dustColor, type VisorMessage } from './visor-optics.js';
import { solarPosition } from './mars-time.js';
import { BASE, HAZARD, ROVER, SAMPLE, type Point } from './ares/route.js';

const elevationColors = ['#92563a', '#b47a54', '#c29169'];

function buildTerrain(data: ArrayBuffer) {
	const header = new DataView(data);
	const columns = header.getUint32(0, true);
	const rows = header.getUint32(4, true);
	const spacing = header.getFloat32(8, true);
	const count = columns * rows;
	if (columns < 2 || rows < 2 || data.byteLength !== 12 + count * 4 || !Number.isFinite(spacing) || !(spacing > 0)) {
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

	return { geometry, width, length, spacing, surfaceHeight };
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
	notify: (notice: TerrainNotice) => void,
	getNotice: () => string,
	getClock: () => string,
	getMessage: () => VisorMessage
) {
	const lightTerrain = buildTerrain(data);
	const { width, length } = lightTerrain;
	let { spacing, surfaceHeight } = lightTerrain;
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

	const optics = buildVisorOptics(renderer, map, getNotice, getClock, getMessage);
	const scene = new Scene();
	const fog = new FogExp2('#bb8867', 0.00042);
	scene.fog = fog;
	const terrainMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
	const orthoTint = new Color('#bfa38e');
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
			float gravelHeight(vec2 p, float scale) {
				vec2 st = p * scale;
				vec2 jitter = dustHash(floor(st));
				vec2 q = fract(st) - mix(vec2(0.24), vec2(0.76), jitter);
				q.x += q.y * (jitter.x - 0.5);
				float radius = mix(0.07, 0.21, jitter.x);
				float edge = max(abs(q.x), abs(q.x * 0.45) + abs(q.y) * 0.82);
				return (1.0 - smoothstep(radius * 0.25, radius, edge))
					* smoothstep(0.27, 0.82, jitter.y);
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
				diffuseColor.rgb = mix(diffuseColor.rgb, ortho.rgb * orthoTint, ortho.a * 0.72);
			#endif
			float footprint = max(length(dFdx(p)), length(dFdy(p)));
			float gravelBed = smoothstep(0.30, 0.66, dustNoise(p * 0.32));
			float coarse = gravelHeight(p, 2.6) * (1.0 - smoothstep(0.025, 0.15, footprint));
			float fine = gravelHeight(vec2(p.x + p.y, p.y - p.x) * 0.7071, 11.0)
				* (1.0 - smoothstep(0.006, 0.04, footprint));
			float closeDetail = 1.0 - smoothstep(12.0, 55.0, length(vViewPosition));
			float gravel = (coarse * mix(0.45, 1.0, gravelBed) + fine * 0.42) * closeDetail;
			float windDust = dustNoise(p * vec2(0.18, 0.72)) - 0.5;
			float grain = (dustNoise(p * 21.0) - 0.5) * (1.0 - smoothstep(0.009, 0.045, footprint));
			diffuseColor.rgb *= 1.0 + windDust * 0.16 + grain * 0.13 * closeDetail - gravel * 0.26;
			float microHeight = gravel * 0.018 + grain * 0.0015 * closeDetail;`
		).replace(
			'#include <normal_fragment_maps>',
			'#include <normal_fragment_maps>\nnormal = groundNormal(-vViewPosition, normal, microHeight);'
		);
		shader.uniforms.orthoTint = { value: orthoTint };
		shader.fragmentShader = 'uniform vec3 orthoTint;\n' + shader.fragmentShader;
	};
	const mesh = new Mesh(lightTerrain.geometry, terrainMaterial);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
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
				for (const mesh of rocks.meshes) {
					scene.remove(mesh);
					mesh.dispose();
				}
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
	const landmarkGrounding: { block: Mesh; anchor: Point; offset: number }[] = [];
	function part(anchor: Point, dx: number, y: number, dz: number, w: number, h: number, d: number, paint: MeshLambertMaterial) {
		const block = new Mesh(hardware, paint);
		block.position.set(anchor.x + dx, surfaceHeight(anchor.x, anchor.z) + y, anchor.z + dz);
		block.scale.set(w, h, d);
		landmarks.add(block);
		landmarkGrounding.push({ block, anchor, offset: y });
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
	const dustFog = new Color();
	const lowSun = new Color('#ffad78');
	const highSun = new Color('#fff0d9');
	let daylight = 1;
	let twilight = 1;
	let dust = 0;
	let stormFrame = 0;
	let stormStarted = 0;
	let gustTime = 0;
	const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
	const draw = () => {
		updateRockTiles();
		sun.target.position.copy(camera.position);
		sun.position.copy(camera.position).addScaledVector(sunDirectionWorld, rockLoadRadius * 2.5);
		worldToEye.copy(camera.quaternion).invert();
		lightInView.copy(sunDirectionWorld).applyQuaternion(worldToEye);
		drawMap();
		optics.render(scene, camera, lightInView, twilight, daylight, dust, gustTime);
	};
	function updateLighting() {
		const up = sunDirectionWorld.y;
		daylight = MathUtils.smoothstep(up, 0, 0.38);
		twilight = MathUtils.smoothstep(up, -0.21, 0.08);
		sun.intensity = 2.05 * MathUtils.smoothstep(up, 0, 0.48);
		sun.color.copy(lowSun).lerp(highSun, daylight);
		ambient.intensity = 0.045 + 0.42 * twilight + 1.02 * daylight;
		fog.color.copy(nightFog).lerp(duskFog, twilight).lerp(dayFog, daylight);
		fog.density = MathUtils.lerp(0.00042, 0.006, dust);
		if (dust > 0) {
			sun.intensity *= Math.exp(-2.8 * dust / Math.max(0.15, up));
			ambient.intensity *= MathUtils.lerp(1, 0.57, dust);
			fog.color.lerp(dustColor(dustFog, twilight, daylight), dust);
		}
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

	function setMissionView(view?: MissionView) {
		const wasActive = !!missionView;
		if (!wasActive && !view) return;
		missionView = view;
		if (view) explored = true;
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
			explored = true;
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
		if (!usingHighQuality) {
			terrainMaterial.map = texture;
			terrainMaterial.needsUpdate = true;
			draw();
		}
	}, undefined, () => {
		if (!abort.signal.aborted) console.warn('No se pudo cargar la ortoimagen HiRISE.');
	});
	let highTexture: Texture | undefined;
	let usingHighQuality = false;

	async function prepareHighQuality(gridUrl: string, imageUrl: string) {
		const response = await fetch(gridUrl, options);
		if (!response.ok) throw new Error('No se pudo descargar la cuadrícula HiRISE de alta resolución.');
		const grid = await response.arrayBuffer();
		if (abort.signal.aborted) return;
		const image = await new TextureLoader().loadAsync(imageUrl);
		try {
			if (abort.signal.aborted) return;
			const { width: imageWidth, height: imageHeight } = image.image;
			if (Math.max(imageWidth, imageHeight) > renderer.capabilities.maxTextureSize) {
				throw new Error('La ortoimagen supera el tamaño máximo de textura.');
			}
			const candidate = buildTerrain(grid);
			if (candidate.width !== width || candidate.length !== length ||
				!Number.isFinite(candidate.surfaceHeight(spawnX, spawnZ))) {
				candidate.geometry.dispose();
				throw new Error('La cuadrícula de alta resolución no coincide con el terreno.');
			}
			image.colorSpace = SRGBColorSpace;
			image.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
			highTexture?.dispose();
			highTerrain?.geometry.dispose();
			highTexture = image;
			highTerrain = candidate;
		} finally {
			if (highTexture !== image) image.dispose();
		}
	}

	function setQuality(high: boolean, restart = false) {
		if (missionView || (!restart && explored) || (high && !highTerrain)) return false;
		if (high === usingHighQuality) return true;
		const active = high ? highTerrain! : lightTerrain;
		usingHighQuality = high;
		spacing = active.spacing;
		surfaceHeight = active.surfaceHeight;
		mesh.geometry = active.geometry;
		terrainMaterial.map = high ? highTexture! : texture.image ? texture : null;
		terrainMaterial.needsUpdate = true;
		sun.shadow.dispose();
		sun.shadow.map = null;
		sun.shadow.mapSize.setScalar(high ? 4096 : 2048);
		for (const tile of rockTiles.values()) {
			for (const rocks of tile.meshes) {
				scene.remove(rocks);
				rocks.dispose();
			}
		}
		rockTiles.clear();
		lastRockTileX = lastRockTileZ = Number.NaN;
		mapX = Infinity;
		for (const { block, anchor, offset } of landmarkGrounding) {
			block.position.y = surfaceHeight(anchor.x, anchor.z) + offset;
		}
		if (explored) {
			keys.clear();
			cancelAnimationFrame(frame);
			frame = previous = velocityX = velocityZ = stride = 0;
			camera.position.x = spawnX;
			camera.position.z = spawnZ;
			camera.rotation.set(-0.085, 0.58, 0);
			explored = false;
		}
		camera.position.y = eyeY();
		atEdge = false;
		notify('ready');
		draw();
		return true;
	}

	return {
		supportsHighQuality: renderer.capabilities.maxTextureSize >= 8192,
		prepareHighQuality,
		setQuality,
		refresh: draw,
		setTime,
		setStorm: (enabled: boolean) => setDust(Number(enabled)),
		setDust,
		setMissionView,
		dispose() {
			abort.abort();
			cancelAnimationFrame(stormFrame);
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
			terrainMaterial.dispose();
			for (const rockGeometry of rockGeometries) rockGeometry.dispose();
			for (const material of rockMaterials) {
				material.dispose();
			}
			texture.dispose();
			hardware.dispose();
			cabin.dispose();
			frameMaterial.dispose();
			shale.dispose();
			optics.dispose();
			renderer.dispose();
		}
	};
}
