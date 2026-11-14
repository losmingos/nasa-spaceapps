import {
	BufferAttribute, BufferGeometry, Color, DirectionalLight, FogExp2, HemisphereLight, MathUtils,
	Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer
} from 'three';
import { buildVisorOptics } from './visor-optics.js';

const elevationColors = ['#92563a', '#b47a54', '#c29169'];

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

	return { geometry, width, length, surfaceHeight };
}

export type TerrainNotice = 'ready' | 'edge';

const mapSize = 96;
const mapSpan = 160;
const metresPerPixel = mapSpan / mapSize;
const walkKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

export function mountTerrain(
	canvas: HTMLCanvasElement,
	map: HTMLCanvasElement,
	data: ArrayBuffer,
	notify: (notice: TerrainNotice) => void
) {
	const { geometry, width, length, surfaceHeight } = buildTerrain(data);
	let renderer: WebGLRenderer;
	try {
		renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
	} catch (error) {
		geometry.dispose();
		throw error;
	}
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = PCFSoftShadowMap;

	const optics = buildVisorOptics(renderer);
	const scene = new Scene();
	scene.fog = new FogExp2('#bb8867', 0.00042);
	const material = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
	// Meter-scale detail is illustrative. The HiRISE grid determines the geometry.
	material.onBeforeCompile = (shader) => {
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
	};
	const mesh = new Mesh(geometry, material);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	scene.add(mesh, new HemisphereLight('#f6dfc5', '#38231c', 1.15));
	const span = Math.max(width, length);
	const sun = new DirectionalLight('#fff0d9', 2.4);
	sun.position.set(-span * 0.72, span * 1.25, -span * 0.58);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.camera.left = -span * 0.72;
	sun.shadow.camera.right = span * 0.72;
	sun.shadow.camera.top = span * 0.72;
	sun.shadow.camera.bottom = -span * 0.72;
	sun.shadow.camera.near = 1;
	sun.shadow.camera.far = span * 3;
	sun.shadow.camera.updateProjectionMatrix();
	sun.shadow.bias = -0.0001;
	sun.shadow.normalBias = 0.03;
	scene.add(sun);

	const camera = new PerspectiveCamera(66, 1, 0.08, Math.max(width, length) * 2);
	camera.rotation.order = 'YXZ';
	camera.rotation.set(-0.085, 0.58, 0);
	// Valid ground near the base of the western delta, facing its escarpment.
	const spawnX = width * 0.263;
	const spawnZ = length * 0.166;
	const eyeHeight = 1.68;
	camera.position.set(spawnX, surfaceHeight(spawnX, spawnZ) + eyeHeight, spawnZ);

	const mapContext = map.getContext('2d');
	const relief = document.createElement('canvas');
	relief.width = relief.height = mapSize;
	const reliefContext = relief.getContext('2d');
	const pixels = reliefContext?.createImageData(mapSize, mapSize);
	let mapX = Infinity;
	let mapZ = Infinity;
	function drawMap() {
		if (!mapContext || !reliefContext || !pixels) return;
		const { x, z } = camera.position;
		if (Math.hypot(x - mapX, z - mapZ) >= metresPerPixel) {
			mapX = x;
			mapZ = z;
			for (let row = 0; row < mapSize; row++) {
				for (let col = 0; col < mapSize; col++) {
					const groundX = x + (col + 0.5 - mapSize / 2) * metresPerPixel;
					const groundZ = z + (row + 0.5 - mapSize / 2) * metresPerPixel;
					const h = surfaceHeight(groundX, groundZ);
					const slope = surfaceHeight(groundX - metresPerPixel, groundZ - metresPerPixel) - h;
					const shade = MathUtils.clamp(55 + slope * 43, 28, 108);
					const contour = h % 3 < 0.28 ? 19 : 0;
					const i = (row * mapSize + col) * 4;
					const tint = Number.isFinite(shade) ? shade + contour : 25;
					pixels.data[i] = tint - 14;
					pixels.data[i + 1] = tint;
					pixels.data[i + 2] = tint - 6;
					pixels.data[i + 3] = 255;
				}
			}
			reliefContext.putImageData(pixels, 0, 0);
		}
		mapContext.setTransform(2, 0, 0, 2, 0, 0);
		mapContext.drawImage(relief, 0, 0);
		mapContext.save();
		mapContext.translate(mapSize / 2, mapSize / 2);
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
	const sunDirection = sun.position.clone().normalize();
	const draw = () => {
		worldToEye.copy(camera.quaternion).invert();
		lightInView.copy(sunDirection).applyQuaternion(worldToEye);
		optics.render(scene, camera, MathUtils.clamp(lightInView.x * 1.4, -1.1, 1.1), -lightInView.z);
		drawMap();
	};
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
	const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
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
		const blocked = !Number.isFinite(nextHeight) || Math.abs(nextHeight + eyeHeight - eyeY()) > distance * 0.72;
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
		if (event.button !== 0 || drag || document.pointerLockElement === canvas) return;
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
		if (event.pointerType === 'mouse' && !dragged) void captureLook();
	}, options);
	canvas.addEventListener('lostpointercapture', () => { drag = undefined; }, options);

	const observer = new ResizeObserver(resize);
	observer.observe(canvas);
	resize();

	return {
		dispose() {
			abort.abort();
			if (document.pointerLockElement === canvas) document.exitPointerLock();
			cancelAnimationFrame(frame);
			observer.disconnect();
			geometry.dispose();
			material.dispose();
			optics.dispose();
			renderer.dispose();
		}
	};
}
