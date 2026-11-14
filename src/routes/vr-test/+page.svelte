<script lang="ts">
	// Minimal WebXR harness for Jarvis: reference integration of the §3 contract for the scene team,
	// and the rig for the D18 recording test on the Quest. Query: ?mode=live|scripted&tts=elevenlabs|browser&ab=4&k=<token>
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import { createAssistant } from '#lib/jarvis/index.js';
	import type { Assistant, AssistantMode, AssistantStatus, MissionEvent, TtsMode } from '#lib/jarvis/types.js';
	import { createSaltationGrains, installSwirMaterialResponse } from '#lib/terrain.js';
import {
	drawSwirHud, mountHeadLockedHud, SWIR_DUST_TRANSMISSION, SWIR_STORM_VISIBLE_TAU, swirVisibilityForStorm,
	type SwirHudData
} from '#lib/visor-optics.js';
	import { HABITAT, ROUTE, SAMPLE, SPAWN, VISIBILITY_CLEAR_M, type Point } from '#lib/mission.js';
	import { SPEAKER_COLOR, STATUS_COLOR, STATUS_LABEL } from '#lib/jarvis/ui/shared.js';

	// ---- Query parameters --------------------------------------------------------------

	const params = new URLSearchParams(location.search);
	const mode: AssistantMode = params.get('mode') === 'scripted' ? 'scripted' : 'live';
	const tts: TtsMode = params.get('tts') === 'browser' ? 'browser' : 'elevenlabs';
	const abParam = Number(params.get('ab') ?? '');
	/** gamepad.buttons index of A on the right controller (xr-standard: 4). VERIFY ON THE HEADSET (§3.1). */
	const A_INDEX = params.has('ab') && Number.isInteger(abParam) && abParam >= 0 ? abParam : 4;
	/** gamepad.buttons index of X on the left controller (xr-standard: 4). */
	const X_INDEX = 4;
	/** Left Y is free; verify its index in the Quest controller panel before the demo. */
	const Y_INDEX = 5;

	const MODE_LABEL: Record<AssistantMode, string> = { live: 'En vivo', scripted: 'Guionizado' };
	const TTS_LABEL: Record<TtsMode, string> = { elevenlabs: 'ElevenLabs', browser: 'Navegador' };

	function variantHref(change: Record<string, string>) {
		const next = new URLSearchParams(location.search);
		for (const [key, value] of Object.entries(change)) next.set(key, value);
		return `?${next.toString()}`;
	}

	// ---- Scene constants ------------------------------------------------------------------

	const EYE_HEIGHT_M = 1.6;
	const CAMERA_FAR_M = 12000;
	/** Objects are never placed beyond the clear-weather fog far plane (and the camera far plane). */
	const MAX_PLACEMENT_M = Math.min(VISIBILITY_CLEAR_M, CAMERA_FAR_M) * 0.9;
	const SKY_CLEAR = new THREE.Color('#c99a72');
	const SKY_DUSTY = new THREE.Color('#8a4b2c');
	const SKY_STORM = new THREE.Color('#3b1a10');
	const ROUTE_POST_SPACING_M = 10;

	// ---- Reactive UI state ------------------------------------------------------------------

	let canvas: HTMLCanvasElement;
	let status = $state<AssistantStatus>('locked');
	let lastError = $state<string | null>(null);
	let lastAstronaut = $state('');
	let lastJarvis = $state('');
	let xrSupport = $state<'checking' | 'supported' | 'unsupported'>('checking');
	let inVR = $state(false);
	let swirEnabled = $state(false);
	let starting = $state(false);
	let notice = $state('');
	let panelOpen = $state(true);
	let placementNote = $state('');

	// ---- Non-reactive runtime state -----------------------------------------------------------

	let assistant: Assistant | null = null;
	let pttHeld = false;
	let prevRightA = false;
	let prevLeftX = false;
	let prevLeftY = false;
	let buttonsDebug = '';
	let lastAction = '';
	let enterSession: ((session: XRSession) => Promise<void>) | null = null;

	function pttDown() {
		if (!assistant || pttHeld) return;
		pttHeld = true;
		assistant.pttDown();
	}

	function pttUp() {
		if (!assistant || !pttHeld) return;
		pttHeld = false;
		assistant.pttUp();
	}

	function fire(event: MissionEvent, source: string) {
		lastAction = `${source} → ${event}`;
		assistant?.notify(event);
	}

	/** «Enter VR»: unlock() FIRST (same click), then requestSession (D20, D21). */
	async function enterVR() {
		if (!assistant || starting) return;
		starting = true;
		notice = '';
		try {
			// A retry after a failed requestSession skips this so the click's user activation goes to WebXR.
			if (assistant.getState().status === 'locked') await assistant.unlock();
		} catch (cause) {
			console.error(cause);
			notice = `No se pudo activar el audio o el micrófono: ${message(cause)}. `;
		}
		try {
			if (!navigator.xr) throw new Error('navigator.xr no existe en este navegador');
			const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
			await enterSession?.(session);
		} catch (cause) {
			console.error(cause);
			notice += `No se pudo entrar en VR: ${message(cause)}. Si es un problema de activación, vuelve a pulsar «Enter VR».`;
		} finally {
			starting = false;
		}
	}

	/** 2D-only test path: unlock audio + mic without WebXR. */
	async function unlockOnly() {
		if (!assistant || starting) return;
		starting = true;
		notice = '';
		try {
			await assistant.unlock();
		} catch (cause) {
			console.error(cause);
			notice = `No se pudo activar el audio o el micrófono: ${message(cause)}.`;
		} finally {
			starting = false;
		}
	}

	const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

	// ---- 2D keyboard fallback ------------------------------------------------------------------

	function onKeyDown(event: KeyboardEvent) {
		if (inVR || event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.code === 'KeyI') {
			event.preventDefault();
			swirEnabled = !swirEnabled;
			return;
		}
		if (event.code === 'Space') {
			event.preventDefault();
			if (!event.repeat) pttDown();
			return;
		}
		if (event.repeat) return;
		if (event.code === 'KeyM') fire('mission_start', 'tecla M');
		else if (event.code === 'KeyT') fire('storm_start', 'tecla T');
		else if (event.code === 'KeyS') fire('sample_collected', 'tecla S');
	}

	function onKeyUp(event: KeyboardEvent) {
		if (event.code !== 'Space') return;
		event.preventDefault();
		pttUp();
	}

	// ---- Helpers -----------------------------------------------------------------------------------

	function mulberry32(seed: number) {
		return () => {
			seed |= 0;
			seed = (seed + 0x6d2b79f5) | 0;
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	/** mission.ts point → scene position relative to SPAWN (1:1 metres, y = 0), clamped to MAX_PLACEMENT_M. */
	function toScene(p: Point): THREE.Vector3 {
		const v = new THREE.Vector3(p.x - SPAWN.x, 0, p.z - SPAWN.z);
		if (v.length() > MAX_PLACEMENT_M) v.setLength(MAX_PLACEMENT_M);
		return v;
	}

	function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
		const lines: string[] = [];
		let line = '';
		for (const word of text.split(/\s+/).filter(Boolean)) {
			const candidate = line ? `${line} ${word}` : word;
			if (line && ctx.measureText(candidate).width > maxWidth) {
				lines.push(line);
				line = word;
			} else {
				line = candidate;
			}
		}
		if (line) lines.push(line);
		if (lines.length > maxLines) {
			lines.length = maxLines;
			lines[maxLines - 1] = `${lines[maxLines - 1]}…`;
		}
		return lines;
	}

	function noiseTexture(): THREE.CanvasTexture {
		const size = 256;
		const c = document.createElement('canvas');
		c.width = c.height = size;
		const ctx = c.getContext('2d')!;
		const image = ctx.createImageData(size, size);
		const random = mulberry32(7);
		for (let i = 0; i < size * size; i++) {
			const v = 200 + random() * 55;
			image.data[i * 4] = v;
			image.data[i * 4 + 1] = v * 0.93;
			image.data[i * 4 + 2] = v * 0.88;
			image.data[i * 4 + 3] = 255;
		}
		ctx.putImageData(image, 0, 0);
		// A few darker pebbles so the ground reads at your feet in VR.
		for (let i = 0; i < 260; i++) {
			ctx.fillStyle = `rgba(90, 55, 38, ${0.15 + random() * 0.35})`;
			ctx.beginPath();
			ctx.arc(random() * size, random() * size, 0.6 + random() * 2.4, 0, Math.PI * 2);
			ctx.fill();
		}
		const texture = new THREE.CanvasTexture(c);
		texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
		texture.colorSpace = THREE.SRGBColorSpace;
		return texture;
	}

	onMount(() => {
		// ---- Assistant ---------------------------------------------------------------------------
		const a = createAssistant({ mode, tts });
		assistant = a;
		let targetVisibility = a.getState().telemetry.visibility_m;
		let targetWindMps = a.getState().telemetry.wind_ms ?? 7.4;
		const unsubscribers = [
			a.onState((s) => {
				status = s.status;
				lastError = s.lastError;
				targetVisibility = s.telemetry.visibility_m;
				targetWindMps = s.telemetry.wind_ms ?? 7.4;
			}),
			a.onSubtitle((s) => {
				if (s.speaker === 'astronaut') lastAstronaut = s.text;
				else lastJarvis = s.text;
			})
		];
		status = a.getState().status;

		// ---- Renderer, camera, scene ------------------------------------------------------------------
		const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
		renderer.setSize(innerWidth, innerHeight, false);
		renderer.xr.enabled = true;
		renderer.xr.setReferenceSpaceType('local-floor');

		const scene = new THREE.Scene();
		const sky = SKY_CLEAR.clone();
		scene.background = sky;
		const fog = new THREE.Fog(sky.clone(), VISIBILITY_CLEAR_M * 0.05, VISIBILITY_CLEAR_M);
		scene.fog = fog;

		const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, CAMERA_FAR_M);
		camera.position.set(0, EYE_HEIGHT_M, 0);
		camera.rotation.order = 'YXZ';
		scene.add(camera); // the HUD is a child of the camera, so the camera must be in the scene graph

		const hemi = new THREE.HemisphereLight('#ffd9b8', '#5a3020', 1.1);
		const sun = new THREE.DirectionalLight('#ffe6cc', 1.6);
		sun.position.set(-300, 500, 200);
		scene.add(hemi, sun);

		/** Everything on the ground. Shifted down by eye height if the session only grants a 'local' space. */
		const world = new THREE.Group();
		scene.add(world);
		const swirSetters: Array<(enabled: boolean, time?: number) => void> = [];
		const swirMaterial = (material: THREE.MeshStandardMaterial, albedo: number) => {
			swirSetters.push(installSwirMaterialResponse(material, albedo));
			return material;
		};
		const tagSurface = <T extends THREE.Object3D>(object: T, albedo: number, surface: string) => {
			object.userData.swirAlbedo = albedo;
			object.userData.swirSurface = surface;
			return object;
		};
		const saltationGrains = createSaltationGrains();
		scene.add(saltationGrains.object);

		const groundTexture = noiseTexture();
		groundTexture.repeat.set((CAMERA_FAR_M * 2) / 3, (CAMERA_FAR_M * 2) / 3); // one tile ≈ 3 m
		groundTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
		const groundMaterial = swirMaterial(new THREE.MeshStandardMaterial({ color: '#a0603d', map: groundTexture, roughness: 1, metalness: 0 }), 0.82);
		const ground = tagSurface(new THREE.Mesh(
			new THREE.PlaneGeometry(CAMERA_FAR_M * 2, CAMERA_FAR_M * 2),
			groundMaterial
		), 0.82, 'REGOLITH/DUST');
		ground.rotation.x = -Math.PI / 2;
		world.add(ground);

		// Rocks for depth cues and so the fog is visible closing in.
		const random = mulberry32(42);
		const rockCount = 700;
		const rockMaterial = swirMaterial(new THREE.MeshStandardMaterial({ color: '#6e3f29', roughness: 1, flatShading: true }), 0.22);
		const rocks = tagSurface(new THREE.InstancedMesh(
			new THREE.DodecahedronGeometry(1, 0),
			rockMaterial,
			rockCount
		), 0.22, 'EXPOSED ROCK');
		const dummy = new THREE.Object3D();
		for (let i = 0; i < rockCount; i++) {
			const radius = 4 + Math.pow(random(), 1.6) * 300;
			const angle = random() * Math.PI * 2;
			const scale = 0.08 + Math.pow(random(), 3) * 1.4;
			dummy.position.set(Math.cos(angle) * radius, scale * 0.25, Math.sin(angle) * radius);
			dummy.rotation.set(random() * 3, random() * 3, random() * 3);
			dummy.scale.set(scale * (0.8 + random() * 0.6), scale * (0.4 + random() * 0.4), scale * (0.8 + random() * 0.6));
			dummy.updateMatrix();
			rocks.setMatrixAt(i, dummy.matrix);
		}
		world.add(rocks);

		// Habitat, sample marker and marked route from mission.ts (relative to SPAWN).
		const notes: string[] = [];
		let habitatPos = toScene(HABITAT);
		if (habitatPos.length() < 3) {
			habitatPos = new THREE.Vector3(0, 0, -40);
			notes.push('HABITAT coincide con SPAWN en mission.ts (provisional): el hábitat se dibuja 40 m al norte.');
		} else if (Math.hypot(HABITAT.x - SPAWN.x, HABITAT.z - SPAWN.z) > MAX_PLACEMENT_M) {
			notes.push(`El hábitat está más lejos que ${Math.round(MAX_PLACEMENT_M)} m: se acerca a ese límite.`);
		}
		let samplePos = toScene(SAMPLE);
		const samplePlaceholder = samplePos.length() < 1;
		if (samplePlaceholder) samplePos = new THREE.Vector3(0.6, 0, -2.5);

		const habitat = new THREE.Group();
		const habitatModule = tagSurface(new THREE.Mesh(
			new THREE.BoxGeometry(6, 3, 10),
			swirMaterial(new THREE.MeshStandardMaterial({ color: '#e4ddd3', roughness: 0.6 }), 0.92)
		), 0.92, 'HARDWARE');
		habitatModule.position.y = 1.5;
		const airlock = tagSurface(new THREE.Mesh(
			new THREE.BoxGeometry(2.2, 2.4, 2.2),
			swirMaterial(new THREE.MeshStandardMaterial({ color: '#c9c1b5', roughness: 0.6 }), 0.92)
		), 0.92, 'HARDWARE');
		airlock.position.set(0, 1.2, 6);
		const pole = tagSurface(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6),
			swirMaterial(new THREE.MeshStandardMaterial({ color: '#888' }), 0.92)), 0.92, 'HARDWARE');
		pole.position.set(2.4, 6, 0);
		const beacon = tagSurface(new THREE.Mesh(
			new THREE.SphereGeometry(0.35, 16, 12),
			swirMaterial(new THREE.MeshStandardMaterial({ color: '#ff5533', emissive: '#5c1e11', fog: false }), 0.98)
		), 0.98, 'BEACON/HARDWARE');
		beacon.position.set(2.4, 9.2, 0);
		habitat.add(habitatModule, airlock, pole, beacon);
		habitat.position.copy(habitatPos);
		habitat.lookAt(new THREE.Vector3(samplePos.x, 0, samplePos.z)); // airlock faces the sample site
		world.add(habitat);

		const sampleMarker = tagSurface(new THREE.Mesh(
			new THREE.CylinderGeometry(0.05, 0.05, 0.25, 12),
			swirMaterial(new THREE.MeshStandardMaterial({ color: '#f3ab82', emissive: '#7a3a18' }), 0.72)
		), 0.72, 'SEDIMENT SAMPLE');
		sampleMarker.position.copy(samplePos).setY(0.125);
		world.add(sampleMarker);

		const routePoints =
			samplePlaceholder || habitatPos.length() < 3 || ROUTE.length < 2
				? [samplePos, habitatPos]
				: ROUTE.map(toScene);
		const posts: THREE.Vector3[] = [];
		for (let i = 1; i < routePoints.length && posts.length < 2000; i++) {
			const from = routePoints[i - 1];
			const to = routePoints[i];
			const length = from.distanceTo(to);
			for (let d = 0; d < length && posts.length < 2000; d += ROUTE_POST_SPACING_M) {
				posts.push(from.clone().lerp(to, d / length));
			}
		}
		const routePosts = tagSurface(new THREE.InstancedMesh(
			new THREE.BoxGeometry(0.08, 1.2, 0.08),
			swirMaterial(new THREE.MeshStandardMaterial({ color: '#ffcf6e', emissive: '#6b4a10' }), 0.92),
			Math.max(posts.length, 1)
		), 0.92, 'ROUTE BEACON');
		routePosts.count = posts.length;
		posts.forEach((p, i) => {
			dummy.position.set(p.x, 0.6, p.z);
			dummy.rotation.set(0, 0, 0);
			dummy.scale.set(1, 1, 1);
			dummy.updateMatrix();
			routePosts.setMatrixAt(i, dummy.matrix);
		});
		world.add(routePosts);
		placementNote = notes.join(' ');

		// Dust particles drifting east (storm front from the west), only visible in the storm.
		const dustCount = 2500;
		const dustBox = { x: 24, y: 7, z: 24 };
		const dustPositions = new Float32Array(dustCount * 3);
		for (let i = 0; i < dustCount; i++) {
			dustPositions[i * 3] = (random() - 0.5) * dustBox.x;
			dustPositions[i * 3 + 1] = random() * dustBox.y - 1.5;
			dustPositions[i * 3 + 2] = (random() - 0.5) * dustBox.z;
		}
		const dustGeometry = new THREE.BufferGeometry();
		dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
		const dustMaterial = new THREE.PointsMaterial({ color: '#c98a5e', size: 0.05, transparent: true, opacity: 0, depthWrite: false });
		const dust = new THREE.Points(dustGeometry, dustMaterial);
		dust.frustumCulled = false;
		dust.visible = false;
		scene.add(dust);

		// Shared transparent HUD plane, head-locked at the spec's comfortable 1.8 m.
		const visorHud = mountHeadLockedHud(camera);
		const swirRaycaster = new THREE.Raycaster();
		const reticleCenter = new THREE.Vector2(0, 0);
		const rayOrigin = new THREE.Vector3();
		const rayDirection = new THREE.Vector3();
		const eyeDirection = new THREE.Vector3();
		let stormIntensity = 0;
		let visibility = targetVisibility;
		let lastSwirRaycast = -Infinity;
		let swirTarget: { distance: number; albedo: number; surface: string } | undefined;
		const currentSwirHud = (now: number): SwirHudData => {
			if (swirEnabled && now - lastSwirRaycast >= 100) {
				lastSwirRaycast = now;
				if (renderer.xr.isPresenting) {
					const eyes = renderer.xr.getCamera().cameras;
					if (eyes.length >= 2) {
						rayOrigin.setFromMatrixPosition(eyes[0].matrixWorld).add(eyeDirection.setFromMatrixPosition(eyes[1].matrixWorld)).multiplyScalar(0.5);
						rayDirection.set(0, 0, -1).applyQuaternion(eyes[0].quaternion)
							.add(eyeDirection.set(0, 0, -1).applyQuaternion(eyes[1].quaternion)).normalize();
						swirRaycaster.set(rayOrigin, rayDirection);
					} else swirRaycaster.setFromCamera(reticleCenter, eyes[0] ?? camera);
				} else swirRaycaster.setFromCamera(reticleCenter, camera);
				const target = swirRaycaster.intersectObjects(world.children, true)
					.find((hit) => typeof hit.object.userData.swirAlbedo === 'number');
				swirTarget = target ? {
					distance: target.distance,
					albedo: target.object.userData.swirAlbedo as number,
					surface: String(target.object.userData.swirSurface ?? 'SURFACE')
				} : undefined;
			}
			return {
				active: swirEnabled,
				stormActive: stormIntensity > 0.05,
				tauVisible: SWIR_STORM_VISIBLE_TAU * stormIntensity,
				visibilityVisibleM: visibility,
				visibilitySwirM: swirVisibilityForStorm(stormIntensity),
				windMps: targetWindMps,
				windDirection: 'ENE ↗',
				distanceM: swirEnabled ? swirTarget?.distance ?? null : null,
				albedo: swirEnabled ? swirTarget?.albedo ?? null : null,
				surface: swirEnabled ? swirTarget?.surface : undefined
			};
		};

		let hudKey = '';
		function drawHud(now: number) {
			const astronaut = lastAstronaut;
			const jarvis = lastJarvis;
			const debug = `Mandos ${buttonsDebug || '(sin mandos)'} · A=${A_INDEX} · Y=${Y_INDEX}${lastAction ? ` · ${lastAction}` : ''}`;
			const error = lastError ?? '';
			const swirHud = currentSwirHud(now);
			const key = [status, astronaut, jarvis, debug, error, swirEnabled, swirHud.stormActive,
				swirHud.distanceM == null ? '' : Math.round(swirHud.distanceM), swirHud.albedo,
				Math.round(swirHud.tauVisible ?? 0), Math.round(targetWindMps * 10), Math.floor(now / 1000)].join('\u0000');
			if (key === hudKey) return; // redraw only on change
			hudKey = key;

			visorHud.redraw((hud, W, H) => {
				const pad = 30;
				drawSwirHud(hud, W, H, swirHud);
				hud.fillStyle = 'rgba(0,0,0,.38)';
				hud.beginPath();
				hud.roundRect(pad, H - 168, W - pad * 2, 138, 16);
				hud.fill();
				const label = STATUS_LABEL[status].toUpperCase();
				hud.lineWidth = 3;
				hud.strokeStyle = 'rgba(0,0,0,.6)';
				hud.fillStyle = STATUS_COLOR[status];
				hud.font = '600 22px ui-monospace, monospace';
				hud.strokeText(label, pad + 12, H - 138);
				hud.fillText(label, pad + 12, H - 138);
				hud.fillStyle = '#fff';
				hud.font = '22px ui-monospace, monospace';
				hud.textAlign = 'right';
				hud.strokeText(`JARVIS · ${MODE_LABEL[mode].toUpperCase()}`, W - pad - 12, H - 138);
				hud.fillText(`JARVIS · ${MODE_LABEL[mode].toUpperCase()}`, W - pad - 12, H - 138);
				hud.textAlign = 'left';
				let y = H - 105;
				for (const [who, text] of [['ASTRONAUTA', astronaut], ['JARVIS', jarvis]] as const) {
					if (!text) continue;
					hud.fillStyle = who === 'JARVIS' ? '#c6ffe5' : '#ffd2ae';
					hud.font = '20px system-ui, sans-serif';
					hud.strokeText(wrapText(hud, `${who}: ${text}`, W - pad * 2 - 24, 1)[0], pad + 12, y);
					hud.fillText(wrapText(hud, `${who}: ${text}`, W - pad * 2 - 24, 1)[0], pad + 12, y);
					y += 28;
				}
				hud.fillStyle = '#d8d8d8';
				hud.font = '15px ui-monospace, monospace';
				hud.strokeText(`SWIR ${swirEnabled ? 'ON' : 'OFF'} · Y / I · ${debug}`, pad + 12, H - pad - 10);
				hud.fillText(`SWIR ${swirEnabled ? 'ON' : 'OFF'} · Y / I · ${debug}`, pad + 12, H - pad - 10);
				if (error) {
					hud.fillStyle = '#ff9c8a';
					hud.strokeText(wrapText(hud, `Error: ${error}`, W - pad * 2, 1)[0], pad + 12, H - 176);
					hud.fillText(wrapText(hud, `Error: ${error}`, W - pad * 2, 1)[0], pad + 12, H - 176);
				}
			});
		}

		// ---- Storm visuals driven by telemetry.visibility_m ---------------------------------------------------
		let lastPoll = 0;
		const logClear = Math.log(VISIBILITY_CLEAR_M / 15);
		function updateStorm(dt: number, now: number) {
			if (now - lastPoll > 250) {
				lastPoll = now; // getState() recomputes telemetry on demand — poll in case onState is event-driven only
				targetVisibility = a.getState().telemetry.visibility_m;
			}
			const target = THREE.MathUtils.clamp(targetVisibility || VISIBILITY_CLEAR_M, 5, VISIBILITY_CLEAR_M);
			// Ease in log space (≈1 s) so resets and the onset look smooth.
			visibility = Math.exp(THREE.MathUtils.damp(Math.log(visibility), Math.log(target), 3, dt));
			const storm = THREE.MathUtils.clamp(1 - Math.log(visibility / 15) / logClear, 0, 1);
			stormIntensity = storm;
			if (swirEnabled) {
				sky.setRGB(0.018 + storm * 0.06, 0.018 + storm * 0.06, 0.018 + storm * 0.06);
			} else if (storm < 0.5) sky.lerpColors(SKY_CLEAR, SKY_DUSTY, storm * 2);
			else sky.lerpColors(SKY_DUSTY, SKY_STORM, (storm - 0.5) * 2);
			fog.color.copy(sky);
			if (swirEnabled) fog.color.setRGB(0.39, 0.39, 0.39);
			fog.far = Math.min(swirEnabled ? 10_000 + (165 - 10_000) * storm : visibility, CAMERA_FAR_M);
			fog.near = fog.far * 0.05;
			hemi.intensity = THREE.MathUtils.lerp(1.1, 0.35, storm);
			sun.intensity = THREE.MathUtils.lerp(1.6, 0.15, storm);
			dust.visible = storm > 0.05;
			dustMaterial.color.set(swirEnabled ? '#999999' : '#c98a5e');
			dustMaterial.opacity = THREE.MathUtils.clamp((storm - 0.05) * 1.1, 0, 0.9)
				* (swirEnabled ? SWIR_DUST_TRANSMISSION : 1);
			if (dust.visible) {
				const centre = camera.position;
				for (let i = 0; i < dustCount; i++) {
					const k = i * 3;
					dustPositions[k] += targetWindMps * 0.94 * dt;
					dustPositions[k + 2] += targetWindMps * 0.34 * dt;
					dustPositions[k + 1] += Math.sin(now * 0.001 + i) * 0.2 * dt;
					dustPositions[k] = centre.x + THREE.MathUtils.euclideanModulo(dustPositions[k] - centre.x + dustBox.x / 2, dustBox.x) - dustBox.x / 2;
					dustPositions[k + 2] = centre.z + THREE.MathUtils.euclideanModulo(dustPositions[k + 2] - centre.z + dustBox.z / 2, dustBox.z) - dustBox.z / 2;
				}
				dustGeometry.attributes.position.needsUpdate = true;
			}
		}

		// ---- Controllers (polled every XR frame) ---------------------------------------------------------------
		function pollControllers() {
			const session = renderer.xr.isPresenting ? renderer.xr.getSession() : null;
			if (!session) {
				buttonsDebug = '';
				return;
			}
			const parts: string[] = [];
			let rightA = false;
			let leftX = false;
			let leftY = false;
			for (let i = 0; i < session.inputSources.length; i++) {
				const source = session.inputSources[i];
				const gamepad = source.gamepad;
				if (!gamepad) continue;
				const pressed: number[] = [];
				gamepad.buttons.forEach((button, index) => {
					if (button.pressed) pressed.push(index);
				});
				const hand = source.handedness === 'left' ? 'I' : source.handedness === 'right' ? 'D' : '?';
				parts.push(`${hand}[${pressed.join(',')}]`);
				if (source.handedness === 'right') rightA = gamepad.buttons[A_INDEX]?.pressed ?? false;
				if (source.handedness === 'left') leftX = gamepad.buttons[X_INDEX]?.pressed ?? false;
				if (source.handedness === 'left') leftY = gamepad.buttons[Y_INDEX]?.pressed ?? false;
			}
			buttonsDebug = parts.sort().join(' ');
			if (rightA !== prevRightA) {
				prevRightA = rightA;
				if (rightA) {
					lastAction = `A (D${A_INDEX}) → hablar`;
					pttDown();
				} else {
					pttUp();
				}
			}
			if (leftX && !prevLeftX) fire('mission_start', `X (I${X_INDEX})`);
			prevLeftX = leftX;
			if (leftY && !prevLeftY) {
				swirEnabled = !swirEnabled;
				lastAction = `Y (I${Y_INDEX}) → SWIR ${swirEnabled ? 'ON' : 'OFF'}`;
			}
			prevLeftY = leftY;
		}

		function onSelect(event: XRInputSourceEvent) {
			// Trigger: right = pick up the sample, left = start the storm (test shortcut). A stays PTT-only (D25).
			if (event.inputSource.handedness === 'right') fire('sample_collected', 'gatillo D');
			else if (event.inputSource.handedness === 'left') fire('storm_start', 'gatillo I');
		}

		function resetDesktopCamera() {
			camera.position.set(0, EYE_HEIGHT_M, 0);
			camera.rotation.set(0, 0, 0);
			camera.fov = 70;
			camera.aspect = innerWidth / innerHeight;
			camera.updateProjectionMatrix();
		}

		function onSessionEnd(event: XRSessionEvent) {
			event.session.removeEventListener('select', onSelect);
			event.session.removeEventListener('end', onSessionEnd);
			pttUp();
			prevRightA = prevLeftX = prevLeftY = false;
			world.position.y = 0;
			inVR = false;
			resetDesktopCamera();
			onResize();
		}

		enterSession = async (session: XRSession) => {
			const floor = !session.enabledFeatures || session.enabledFeatures.includes('local-floor');
			renderer.xr.setReferenceSpaceType(floor ? 'local-floor' : 'local');
			world.position.y = floor ? 0 : -EYE_HEIGHT_M;
			session.addEventListener('select', onSelect);
			session.addEventListener('end', onSessionEnd);
			await renderer.xr.setSession(session);
			inVR = true;
		};

		// ---- Desktop preview: drag to look ------------------------------------------------------------------------
		let drag: { x: number; y: number } | null = null;
		function onPointerDown(event: PointerEvent) {
			if (renderer.xr.isPresenting) return;
			drag = { x: event.clientX, y: event.clientY };
			canvas.setPointerCapture(event.pointerId);
		}
		function onPointerMove(event: PointerEvent) {
			if (!drag || renderer.xr.isPresenting) return;
			camera.rotation.y += (event.clientX - drag.x) * 0.004;
			camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x + (event.clientY - drag.y) * 0.004, -1.4, 1.4);
			drag = { x: event.clientX, y: event.clientY };
		}
		function onPointerUp() {
			drag = null;
		}
		function onResize() {
			if (renderer.xr.isPresenting) return;
			renderer.setSize(innerWidth, innerHeight, false);
			camera.aspect = innerWidth / innerHeight;
			camera.updateProjectionMatrix();
		}
		canvas.addEventListener('pointerdown', onPointerDown);
		canvas.addEventListener('pointermove', onPointerMove);
		canvas.addEventListener('pointerup', onPointerUp);
		canvas.addEventListener('pointercancel', onPointerUp);
		addEventListener('resize', onResize);

		// ---- Loop -------------------------------------------------------------------------------------------------
		let previous = performance.now();
		renderer.setAnimationLoop((now) => {
			const dt = Math.min((now - previous) / 1000, 0.1);
			previous = now;
			pollControllers();
			updateStorm(dt, now);
			for (const setSwir of swirSetters) setSwir(swirEnabled, now / 1000);
			saltationGrains.update(camera.position, now / 1000, targetWindMps, swirEnabled && stormIntensity > 0.05);
			drawHud(now);
			renderer.render(scene, camera);
		});

		// ---- WebXR support ---------------------------------------------------------------------------------------
		let alive = true;
		if (!navigator.xr) {
			xrSupport = 'unsupported';
		} else {
			navigator.xr
				.isSessionSupported('immersive-vr')
				.then((ok) => alive && (xrSupport = ok ? 'supported' : 'unsupported'))
				.catch(() => alive && (xrSupport = 'unsupported'));
		}

		return () => {
			alive = false;
			enterSession = null;
			const session = renderer.xr.getSession();
			if (session) {
				session.removeEventListener('select', onSelect);
				session.removeEventListener('end', onSessionEnd);
				void session.end().catch(() => {});
			}
			renderer.setAnimationLoop(null);
			pttUp();
			for (const unsubscribe of unsubscribers) unsubscribe();
			a.dispose();
			visorHud.dispose();
			saltationGrains.dispose();
			assistant = null;
			canvas.removeEventListener('pointerdown', onPointerDown);
			canvas.removeEventListener('pointermove', onPointerMove);
			canvas.removeEventListener('pointerup', onPointerUp);
			canvas.removeEventListener('pointercancel', onPointerUp);
			removeEventListener('resize', onResize);
			scene.traverse((object) => {
				if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
					object.geometry.dispose();
					const materials = Array.isArray(object.material) ? object.material : [object.material];
					for (const material of materials) material.dispose();
				}
			});
			groundTexture.dispose();
			renderer.dispose();
		};
	});
</script>

<svelte:head>
	<title>Jarvis | Prueba VR</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} onblur={pttUp} />

<main>
	<canvas bind:this={canvas} aria-label="Vista previa de la escena de prueba. Arrastra para mirar alrededor."></canvas>

	{#if panelOpen}
		<section class="landing" aria-labelledby="title">
			<div class="identity">
				<span class="planet" aria-hidden="true">◉</span> JARVIS<span class="divider"></span><span class="subtle">PRUEBA VR</span>
				<button class="link close" onclick={() => (panelOpen = false)}>Ocultar</button>
			</div>
			<h1 id="title">Jarvis en VR</h1>
			<p class="lead">
				Pulsa <strong>Enter VR</strong>: primero se activan el audio y el micrófono (acepta el permiso si aparece) y después
				se entra en VR. Mantén <strong>A</strong> para hablar y pulsa <strong>Y</strong> para alternar SWIR.
			</p>

			<div class="chips">
				<span class="chip" style:--chip={STATUS_COLOR[status]} role="status"><span class="dot"></span>{STATUS_LABEL[status]}</span>
				<span class="chip neutral">Modo: {MODE_LABEL[mode]}</span>
				<span class="chip neutral">Voz: {TTS_LABEL[tts]}</span>
				<span class="chip neutral">A = botón {A_INDEX}</span>
				<span class="chip neutral">SWIR: {swirEnabled ? 'ON' : 'OFF'}</span>
			</div>
			<p class="variants">
				Cambiar:
				<a data-sveltekit-reload href={variantHref({ mode: mode === 'live' ? 'scripted' : 'live' })}>
					modo {mode === 'live' ? 'guionizado' : 'en vivo'}
				</a>
				·
				<a data-sveltekit-reload href={variantHref({ tts: tts === 'elevenlabs' ? 'browser' : 'elevenlabs' })}>
					voz {tts === 'elevenlabs' ? 'del navegador' : 'ElevenLabs'}
				</a>
			</p>

			<div class="actions">
				<button class="secondary" aria-pressed={swirEnabled} aria-keyshortcuts="I"
					onclick={() => { swirEnabled = !swirEnabled; }}>SWIR sim. · I</button>
				<button class="enter" onclick={enterVR} disabled={starting || inVR || xrSupport === 'unsupported'}>
					{inVR ? 'En VR…' : starting ? 'Activando…' : 'Enter VR'}
				</button>
				{#if status === 'locked'}
					<button class="secondary" onclick={unlockOnly} disabled={starting}>Solo activar audio (prueba 2D)</button>
				{/if}
			</div>

			{#if xrSupport === 'checking'}
				<p class="muted">Comprobando WebXR…</p>
			{:else if xrSupport === 'unsupported'}
				<p class="warning" role="status">
					Este navegador no ofrece WebXR <code>immersive-vr</code>. Puedes probar en 2D: activa el audio y usa el teclado.
				</p>
			{/if}
			{#if notice}<p class="error" role="alert">{notice}</p>{/if}
			{#if lastError}<p class="error">Jarvis: {lastError}</p>{/if}
			{#if placementNote}<p class="muted">{placementNote}</p>{/if}

			<div class="mapping">
				<div>
					<h2>Mandos (VR)</h2>
					<dl>
						<dt>A (dcho, mantener)</dt><dd>Hablar con Jarvis</dd>
						<dt>Gatillo dcho</dt><dd>sample_collected</dd>
						<dt>Gatillo izdo</dt><dd>storm_start</dd>
						<dt>X (izdo)</dt><dd>mission_start (reset)</dd>
						<dt>Y (izdo)</dt><dd>Alternar SWIR · botón {Y_INDEX}</dd>
					</dl>
				</div>
				<div>
					<h2>Teclado (2D)</h2>
					<dl>
						<dt><kbd>Espacio</kbd></dt><dd>Hablar (mantener)</dd>
						<dt><kbd>M</kbd></dt><dd>mission_start</dd>
						<dt><kbd>T</kbd></dt><dd>storm_start</dd>
						<dt><kbd>S</kbd></dt><dd>sample_collected</dd>
						<dt><kbd>I</kbd></dt><dd>Alternar SWIR</dd>
					</dl>
				</div>
			</div>
			<p class="muted small">
				El panel de subtítulos muestra en su última línea los índices de los botones pulsados en cada mando (D = derecho, I =
				izquierdo). Si A no aparece como {A_INDEX}, abre la página con <code>?ab=&lt;índice&gt;</code>.
			</p>
		</section>
	{:else}
		<button class="reopen" onclick={() => (panelOpen = true)}>Mostrar panel</button>
	{/if}
</main>

<style>
	:global(*) { box-sizing: border-box; }
	:global(body) { margin: 0; background: #100e0e; color: #f6eade; font-family: system-ui, sans-serif; overflow: hidden; }
	main { position: fixed; inset: 0; }
	canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
	canvas:active { cursor: grabbing; }
	.landing { position: absolute; top: 16px; left: 16px; width: min(460px, calc(100% - 32px)); max-height: calc(100% - 32px); overflow-y: auto; padding: 22px; border: 1px solid #47352c; border-radius: 16px; background: rgba(23, 19, 18, 0.92); backdrop-filter: blur(6px); }
	.identity, .chip, kbd, code, dt { font-family: ui-monospace, monospace; }
	.identity { display: flex; align-items: center; gap: 12px; font-size: 12px; letter-spacing: 0.11em; font-weight: 700; }
	.planet { color: #ed9d71; font-size: 20px; }
	.divider { height: 16px; width: 1px; background: #50392e; }
	.subtle { color: #bcaeaa; font-weight: 400; }
	.close { margin-left: auto; letter-spacing: 0; font-family: system-ui, sans-serif; font-weight: 400; }
	h1 { font-family: Georgia, serif; font-size: clamp(34px, 6vw, 52px); font-weight: 400; letter-spacing: -0.05em; line-height: 1; margin: 18px 0 12px; }
	h2 { font-family: Georgia, serif; font-weight: 400; font-size: 17px; margin: 0 0 8px; }
	.lead { color: #d9c2b4; line-height: 1.5; margin: 0 0 14px; font-size: 15px; }
	.chips { display: flex; flex-wrap: wrap; gap: 8px; }
	.chip { --chip: #9fc49a; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--chip); color: var(--chip); font-size: 12px; letter-spacing: 0.06em; }
	.chip.neutral { --chip: #b19a8c; }
	.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--chip); }
	.variants { font-size: 13px; color: #b19a8c; margin: 10px 0 16px; }
	a, .link { color: #f6bf98; text-underline-offset: 3px; }
	button { font: inherit; cursor: pointer; }
	button:disabled { cursor: default; opacity: 0.5; }
	button:focus-visible, a:focus-visible { outline: 2px solid #ffb689; outline-offset: 2px; }
	.link { border: 0; background: none; text-decoration: underline; padding: 0; font-size: 13px; }
	.actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
	.enter { padding: 14px 28px; border-radius: 10px; border: 2px solid #ed9d71; background: #5d392b; color: #fff0df; font-family: Georgia, serif; font-size: 22px; }
	.enter:hover:not(:disabled) { background: #74462f; }
	.secondary { padding: 10px 14px; border-radius: 8px; border: 1px solid #67483a; background: #1d1715; color: #f3dace; font-size: 14px; }
	.secondary:hover:not(:disabled) { border-color: #ed9d71; }
	.muted { color: #b19a8c; font-size: 13px; line-height: 1.45; }
	.small { font-size: 12px; }
	.warning { color: #f0c46c; font-size: 13px; line-height: 1.45; }
	.error { color: #ff9c8a; font-size: 13px; line-height: 1.45; }
	code { color: #f6bf98; font-size: 0.92em; }
	.mapping { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-top: 16px; padding-top: 16px; border-top: 1px solid #2c221e; }
	dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; margin: 0; font-size: 13px; }
	dt { color: #f3ab82; font-size: 12px; }
	dd { margin: 0; color: #d9c2b4; }
	kbd { display: inline-block; padding: 1px 6px; border: 1px solid #67483a; border-bottom-width: 2px; border-radius: 4px; background: #100e0e; }
	.reopen { position: absolute; top: 16px; left: 16px; padding: 8px 14px; border-radius: 8px; border: 1px solid #67483a; background: rgba(23, 19, 18, 0.92); color: #f3dace; }
</style>
