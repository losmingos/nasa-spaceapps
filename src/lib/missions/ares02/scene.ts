import { asset } from '$app/paths';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Box3, BoxGeometry, CanvasTexture, Group, MathUtils, Mesh, MeshStandardMaterial, PointLight, Raycaster, SRGBColorSpace, Texture, Vector3, type Object3D } from 'three';
import type { MissionSceneFactory, RoverService } from '../../visor/terrain.js';
import { handoff } from './route.js';

export const createNightfallScene: MissionSceneFactory = (ground, refresh) => {
	const group = new Group();
	group.visible = false;
	const rover = new Group();
	rover.visible = false;
	group.add(rover);
	let model: Object3D | undefined;
	let requested = false;
	let disposed = false;
	function release(object: Object3D) {
		object.traverse((part) => {
			if (!(part instanceof Mesh)) return;
			part.geometry.dispose();
			for (const material of [part.material].flat()) {
				for (const value of Object.values(material)) {
					if (value instanceof Texture) value.dispose();
				}
				material.dispose();
			}
		});
	}
	function loadRover() {
		if (requested) return;
		requested = true;
		new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
			.load(asset('models/missions/ares01/sev.glb'), ({ scene }) => {
				if (disposed) {
					release(scene);
					return;
				}
				const bounds = new Box3().setFromObject(scene);
				const center = bounds.getCenter(new Vector3());
				scene.position.set(-center.x, -bounds.min.y, -center.z);
				model = scene;
				rover.add(scene);
				// Locate the side skin above the running gear in the centered SEV mesh.
				scene.updateMatrixWorld(true);
				const section = panel.getWorldPosition(new Vector3());
				const ray = new Raycaster(new Vector3(section.x + 4, section.y, section.z), new Vector3(-1, 0, 0));
				const skin = ray.intersectObject(scene, true)[0];
				if (skin) panel.position.x = rover.worldToLocal(skin.point.clone()).x + 0.025;
				panel.visible = !!service;
				refresh();
			}, undefined, (error) => {
				if (!disposed) console.warn('Could not load the rover model.', error);
			});
	}

	const station = new Group();
	group.add(station);
	const box = new BoxGeometry(1, 1, 1);
	const panel = new Group();
	panel.position.set(1.8, 1.65, 1.35);
	panel.rotation.y = Math.PI / 2;
	panel.visible = false;
	rover.add(panel);
	let service: RoverService | undefined;
	const cover = new MeshStandardMaterial({ color: '#b4bdba', metalness: 0.55, roughness: 0.44 });
	const cavity = new MeshStandardMaterial({ color: '#171c20', roughness: 0.86 });
	const rail = new MeshStandardMaterial({ color: '#66777a', metalness: 0.7, roughness: 0.42 });
	const moduleCase = new MeshStandardMaterial({ color: '#b9a264', metalness: 0.25, roughness: 0.58 });
	const indicator = new MeshStandardMaterial({ color: '#ffb45f', emissive: '#ff951e', emissiveIntensity: 2 });
	const labelCanvas = document.createElement('canvas');
	labelCanvas.width = 320;
	labelCanvas.height = 64;
	const labelContext = labelCanvas.getContext('2d')!;
	labelContext.fillStyle = '#171d20';
	labelContext.fillRect(0, 0, 320, 64);
	labelContext.fillStyle = '#ffe4aa';
	labelContext.font = 'bold 27px monospace';
	labelContext.fillText('BATTERY A', 15, 31);
	labelContext.font = '15px monospace';
	labelContext.fillText('SERVICE MODULE', 15, 53);
	const labelTexture = new CanvasTexture(labelCanvas);
	labelTexture.colorSpace = SRGBColorSpace;
	const label = new MeshStandardMaterial({ map: labelTexture, emissive: '#d4b274', emissiveMap: labelTexture, emissiveIntensity: 0.22 });
	function component(parent: Group, material: MeshStandardMaterial, x: number, y: number, z: number, w: number, h: number, d: number) {
		const mesh = new Mesh(box, material);
		mesh.position.set(x, y, z);
		mesh.scale.set(w, h, d);
		parent.add(mesh);
		return mesh;
	}
	// A low-profile recess housing shares the body surface. The tray moves along its rails.
	component(panel, cavity, 0, 0, 0.035, 0.88, 0.70, 0.10);
	for (const side of [-1, 1]) {
		component(panel, cover, side * 0.45, 0, 0.072, 0.055, 0.79, 0.14);
		component(panel, cover, 0, side * 0.37, 0.072, 0.94, 0.055, 0.14);
		component(panel, rail, side * 0.30, -0.18, 0.16, 0.044, 0.055, 0.27);
		component(panel, rail, side * 0.45, 0.37, 0.15, 0.04, 0.04, 0.025);
		component(panel, rail, side * 0.45, -0.37, 0.15, 0.04, 0.04, 0.025);
	}
	component(panel, indicator, 0.35, 0.28, 0.16, 0.07, 0.044, 0.023);
	const battery = new Group();
	battery.position.z = 0.15;
	panel.add(battery);
	component(battery, moduleCase, 0, -0.06, 0, 0.55, 0.37, 0.20);
	component(battery, label, 0, -0.04, 0.104, 0.41, 0.12, 0.007);
	component(battery, rail, 0, -0.175, 0.137, 0.22, 0.04, 0.069);
	for (let i = -2; i <= 2; i++) component(battery, cavity, i * 0.066, 0.08, 0.105, 0.04, 0.025, 0.008);
	const hatch = new Group();
	hatch.position.set(0, 0.36, 0.28);
	panel.add(hatch);
	component(hatch, cover, 0, -0.36, 0, 0.88, 0.71, 0.045);
	component(hatch, cavity, 0, -0.59, 0.03, 0.23, 0.065, 0.044);
	component(hatch, label, 0, -0.32, 0.025, 0.46, 0.14, 0.009);
	for (const side of [-1, 1]) component(hatch, rail, side * 0.29, -0.02, 0.01, 0.16, 0.085, 0.077);
	const serviceBeacon = new PointLight('#ffdda9', 11, 5);
	serviceBeacon.position.set(0.26, 0.55, 0.54);
	panel.add(serviceBeacon);
	const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
	let animationFrame = 0;
	let transition: { started: number; fromAngle: number; toAngle: number; fromDepth: number; toDepth: number } | undefined;
	function updateService(now: number) {
		if (!transition) return;
		const t = reducedMotion.matches ? 1 : MathUtils.clamp((now - transition.started) / 720, 0, 1);
		const ease = MathUtils.smoothstep(t, 0, 1);
		hatch.rotation.x = MathUtils.lerp(transition.fromAngle, transition.toAngle, ease);
		battery.position.z = MathUtils.lerp(transition.fromDepth, transition.toDepth, ease);
		if (t === 1) transition = undefined;
	}
	function refreshService() {
		updateService(performance.now());
		refresh();
		if (transition) animationFrame = requestAnimationFrame(refreshService);
	}
	function animateService(next?: RoverService) {
		if (service?.open === next?.open && service?.seated === next?.seated) return;
		service = next;
		cancelAnimationFrame(animationFrame);
		panel.visible = !!next && !!model;
		indicator.color.set(next?.seated ? '#9be5ba' : '#ffb45f');
		indicator.emissive.copy(indicator.color);
		if (!next) {
			transition = undefined;
			hatch.rotation.x = 0;
			battery.position.z = 0.15;
			return;
		}
		transition = {
			started: performance.now(),
			fromAngle: hatch.rotation.x,
			toAngle: next.open ? -Math.PI * 0.68 : 0,
			fromDepth: battery.position.z,
			toDepth: next.seated ? 0.117 : next.open ? 0.30 : 0.15
		};
		animationFrame = requestAnimationFrame(refreshService);
	}
	const housing = new MeshStandardMaterial({ color: '#9faba6', roughness: 0.82 });
	const apron = new MeshStandardMaterial({ color: '#373e3e', roughness: 0.9 });
	const light = new MeshStandardMaterial({ color: '#d8fff4', emissive: '#8bffd7', emissiveIntensity: 2 });
	function part(material: MeshStandardMaterial, x: number, y: number, z: number, width: number, height: number, depth: number) {
		const mesh = new Mesh(box, material);
		mesh.position.set(x, y, z);
		mesh.scale.set(width, height, depth);
		station.add(mesh);
	}
	part(housing, 0, 1.65, 5.5, 8, 3.3, 8);
	part(apron, 0, 1.1, 1.48, 2.2, 2.2, 0.2);
	part(light, 0, 2.45, 1.38, 1.8, 0.12, 0.16);
	part(light, -3.55, 2.45, 1.38, 0.18, 0.18, 0.14);
	part(light, 3.55, 2.45, 1.38, 0.18, 0.18, 0.14);
	part(apron, 0, 0.03, 0.1, 3.5, 0.08, 2.6);
	const parkingLight = new PointLight('#e1fff1', 170, 42);
	parkingLight.position.set(-3, 4, -13);
	station.add(parkingLight);
	const porchLight = new PointLight('#c8ffeb', 95, 32);
	porchLight.position.set(0, 2.43, 0.95);
	station.add(porchLight);
	function reground() {
		station.position.set(handoff.x, ground(handoff.x, handoff.z), handoff.z);
	}
	reground();
	return {
		group, reground,
		setView(active) {
			group.visible = active;
			if (active) loadRover();
		},
		setParkedRover(position, nextService) {
			rover.visible = !!position;
			if (position) rover.position.set(position.x, ground(position.x, position.z), position.z);
			animateService(nextService);
		},
		updateDrill() {},
		updateService,
		dispose() {
			disposed = true;
			if (model) release(model);
			box.dispose();
			cancelAnimationFrame(animationFrame);
			labelTexture.dispose();
			for (const material of [cover, cavity, rail, moduleCase, indicator, label]) material.dispose();
			housing.dispose();
			apron.dispose();
			light.dispose();
		}
	};
};
