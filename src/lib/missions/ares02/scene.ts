import { asset } from '$app/paths';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, PointLight, Texture, Vector3, type Object3D } from 'three';
import type { MissionSceneFactory } from '../../visor/terrain.js';
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
				refresh();
			}, undefined, (error) => {
				if (!disposed) console.warn('Could not load the rover model.', error);
			});
	}

	const station = new Group();
	group.add(station);
	const box = new BoxGeometry(1, 1, 1);
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
		setParkedRover(position) {
			rover.visible = !!position;
			if (position) rover.position.set(position.x, ground(position.x, position.z), position.z);
		},
		updateDrill() {},
		dispose() {
			disposed = true;
			if (model) release(model);
			box.dispose();
			housing.dispose();
			apron.dispose();
			light.dispose();
		}
	};
};
