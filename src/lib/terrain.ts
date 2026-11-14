import {
	BoxGeometry, BufferAttribute, BufferGeometry, Group, Color, DirectionalLight, FogExp2, HemisphereLight, MathUtils,
	Mesh, MeshLambertMaterial, PerspectiveCamera, Quaternion, Scene, SRGBColorSpace,
	TextureLoader, Vector3, WebGLRenderer
} from 'three';
import { buildVisorOptics, dustColor } from './visor-optics.js';
import { solarPosition } from './mars-time.js';
import { BASE, HAZARD, ROVER, SAMPLE, type Point } from './ares/route.js';

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

	return { geometry, width, length, surfaceHeight };
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

export function mountTerrain(
	canvas: HTMLCanvasElement,
	map: HTMLCanvasElement,
	data: ArrayBuffer,
	orthoUrl: string,
	notify: (notice: TerrainNotice) => void,
	getNotice: () => string,
	getClock: () => string
) {
	const { geometry, width, length, surfaceHeight } = buildTerrain(data);
	let renderer: WebGLRenderer;
	try {
		renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
	} catch (error) {
		geometry.dispose();
		throw error;
	}

	const optics = buildVisorOptics(renderer, map, getNotice, getClock);
	const scene = new Scene();
	const fog = new FogExp2('#bb8867', 0.00042);
	scene.fog = fog;
	const material = new MeshLambertMaterial({ vertexColors: true });
	const orthoTint = new Color('#bf9d83');
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
			'#include <map_fragment>',
			`#ifdef USE_MAP
				vec4 ortho = texture2D(map, vMapUv);
				diffuseColor.rgb = mix(diffuseColor.rgb, ortho.rgb * orthoTint, ortho.a);
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
		shader.fragmentShader = 'uniform vec3 orthoTint;\n' + shader.fragmentShader;
	};
	const ambient = new HemisphereLight('#ffe4cc', '#82604c', 1.65);
	scene.add(new Mesh(geometry, material), ambient);
	const sun = new DirectionalLight('#fff0d9', 1.85);
	sun.position.set(-1, 0.59, -0.45);
	scene.add(sun);

	const camera = new PerspectiveCamera(66, 1, 0.08, Math.max(width, length) * 2);
	camera.rotation.order = 'YXZ';
	camera.rotation.set(-0.085, 0.58, 0);
	// Valid ground near the base of the western delta, facing its escarpment.
	const spawnX = width * 0.263;
	const spawnZ = length * 0.166;
	const eyeHeight = 1.68;
	camera.position.set(spawnX, surfaceHeight(spawnX, spawnZ) + eyeHeight, spawnZ);

	const landmarks = new Group();
	landmarks.visible = false;
	scene.add(landmarks);
	const hardware = new BoxGeometry(1, 1, 1);
	const cabin = new MeshLambertMaterial({ color: '#ccc6b7' });
	const frameMaterial = new MeshLambertMaterial({ color: '#332b25' });
	const shale = new MeshLambertMaterial({ color: '#6e4736' });
	function part(anchor: Point, dx: number, y: number, dz: number, w: number, h: number, d: number, paint: MeshLambertMaterial) {
		const block = new Mesh(hardware, paint);
		block.position.set(anchor.x + dx, surfaceHeight(anchor.x, anchor.z) + y, anchor.z + dz);
		block.scale.set(w, h, d);
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
		worldToEye.copy(camera.quaternion).invert();
		lightInView.copy(sun.position).applyQuaternion(worldToEye);
		drawMap();
		optics.render(scene, camera, lightInView, twilight, daylight, dust, gustTime, !!missionView);
	};
	function updateLighting() {
		const up = sun.position.y;
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
		sun.position.set(east, up, -north);
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
		material.map = texture;
		material.needsUpdate = true;
		draw();
	}, undefined, () => {
		if (!abort.signal.aborted) console.warn('No se pudo cargar la ortoimagen HiRISE.');
	});

	return {
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
			geometry.dispose();
			texture.dispose();
			material.dispose();
			hardware.dispose();
			cabin.dispose();
			frameMaterial.dispose();
			shale.dispose();
			optics.dispose();
			renderer.dispose();
		}
	};
}
