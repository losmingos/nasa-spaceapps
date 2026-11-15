import { Box3, BoxGeometry, DodecahedronGeometry, Group, Mesh, MeshLambertMaterial, Texture, Vector3,
	type BufferGeometry, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ABRASION_HEIGHT, buildOutcrop } from './outcrop.js';
import { buildSamplingKit } from './sampling-kit.js';
import { BASE, HAZARD, HAZARD_RADIUS, ROVER, SAMPLING_KIT, type Point } from './route.js';

// The shared SEV mesh is 5.907 m long. NASA's surface concept is 14.7 ft long.
export const SEV_MODEL_SCALE = (14.7 * 0.3048) / 5.907;

export interface Ares01ModelUrls {
	rover: string;
	drill: string;
	tube: string;
}

export function buildAres01Scene(
	surfaceHeight: (x: number, z: number) => number,
	modelUrls: Ares01ModelUrls,
	refresh: () => void,
	registerSwirSurface: (object: Object3D, albedo: number, surface: string) => void
) {
	let disposed = false;
	const landmarks = new Group();
	landmarks.visible = false;
	const hardware = new BoxGeometry(1, 1, 1);
	const cabin = new MeshLambertMaterial({ color: '#ccc6b7' });
	const terrainAnchors: { object: Object3D; point: Point; heightOffset: number }[] = [];
	function part(anchor: Point, dx: number, y: number, dz: number, w: number, h: number, d: number, paint: MeshLambertMaterial) {
		const block = new Mesh(hardware, paint);
		block.position.set(anchor.x + dx, surfaceHeight(anchor.x, anchor.z) + y, anchor.z + dz);
		block.scale.set(w, h, d);
		registerSwirSurface(block, 0.92, 'HARDWARE');
		landmarks.add(block);
		terrainAnchors.push({ object: block, point: anchor, heightOffset: y });
	}
	const roverAnchor = new Group();
	roverAnchor.position.set(ROVER.x, surfaceHeight(ROVER.x, ROVER.z), ROVER.z);
	landmarks.add(roverAnchor);
	terrainAnchors.push({ object: roverAnchor, point: ROVER, heightOffset: 0 });
	let assetsRequested = false;
	const missionAssets: Object3D[] = [];

	function disposeModel(model: Object3D) {
		const geometries = new Set<BufferGeometry>();
		const materials = new Set<Material>();
		const textures = new Set<Texture>();
		model.traverse((object) => {
			if (!(object instanceof Mesh)) return;
			geometries.add(object.geometry);
			for (const material of [object.material].flat()) {
				materials.add(material);
				for (const value of Object.values(material)) {
					if (value instanceof Texture) textures.add(value);
				}
			}
		});
		for (const geometry of geometries) geometry.dispose();
		for (const material of materials) material.dispose();
		for (const texture of textures) texture.dispose();
	}

	function loadMissionAssets() {
		if (assetsRequested) return;
		assetsRequested = true;
		const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
		function load(url: string, place: (model: Object3D) => void) {
			loader.load(url, ({ scene: model }) => {
				if (disposed) {
					disposeModel(model);
					return;
				}
				model.traverse((object) => { if (object instanceof Mesh) object.castShadow = true; });
				registerSwirSurface(model, 0.92, 'HARDWARE');
				missionAssets.push(model);
				place(model);
				refresh();
			}, undefined, (error) => {
				if (!disposed) console.warn('Could not load a mission model.', url, error);
			});
		}

		load(modelUrls.rover, (model) => {
			model.scale.multiplyScalar(SEV_MODEL_SCALE);
			const bounds = new Box3().setFromObject(model);
			const center = bounds.getCenter(new Vector3());
			model.position.set(-center.x, -bounds.min.y, -center.z);
			roverAnchor.add(model);
		});
		load(modelUrls.drill, samplingKit.addDrill);
		load(modelUrls.tube, samplingKit.addTubes);
	}

	part(BASE, 0, 1.9, 8, 7, 3.8, 8, cabin);
	const outcrop = buildOutcrop();
	const rockX = SAMPLING_KIT.x - 0.13;
	const rockZ = SAMPLING_KIT.z - 0.76;
	outcrop.group.position.set(rockX, surfaceHeight(rockX, rockZ), rockZ);
	registerSwirSurface(outcrop.group, 0.22, 'EXPOSED ROCK');
	landmarks.add(outcrop.group);
	terrainAnchors.push({ object: outcrop.group, point: { x: rockX, z: rockZ }, heightOffset: 0 });
	const samplingKit = buildSamplingKit();
	const { x: kitX, z: kitZ } = SAMPLING_KIT;
	samplingKit.group.position.set(kitX, surfaceHeight(kitX, kitZ), kitZ);
	registerSwirSurface(samplingKit.group, 0.92, 'HARDWARE');
	landmarks.add(samplingKit.group);
	terrainAnchors.push({ object: samplingKit.group, point: SAMPLING_KIT, heightOffset: 0 });
	samplingKit.setContact(rockX - kitX,
		outcrop.group.position.y + ABRASION_HEIGHT - samplingKit.group.position.y, rockZ - kitZ);
	const boulder = new Mesh(
		new DodecahedronGeometry(1),
		new MeshLambertMaterial({ color: '#795443', flatShading: true })
	);
	const boulderHeightOffset = 0.35;
	boulder.position.set(HAZARD.x, surfaceHeight(HAZARD.x, HAZARD.z) + boulderHeightOffset, HAZARD.z);
	boulder.scale.set(HAZARD_RADIUS * 0.96, 3.8, HAZARD_RADIUS * 0.92);
	boulder.rotation.y = 0.55;
	boulder.castShadow = boulder.receiveShadow = true;
	registerSwirSurface(boulder, 0.22, 'EXPOSED ROCK');
	landmarks.add(boulder);
	terrainAnchors.push({ object: boulder, point: HAZARD, heightOffset: boulderHeightOffset });

	return {
		group: landmarks,
		reground() {
			for (const { object, point, heightOffset } of terrainAnchors) {
				object.position.y = surfaceHeight(point.x, point.z) + heightOffset;
			}
			samplingKit.setContact(rockX - kitX,
				outcrop.group.position.y + ABRASION_HEIGHT - samplingKit.group.position.y, rockZ - kitZ);
		},
		setView(active: boolean, samplesCollected: boolean, baseRoute: boolean) {
			landmarks.visible = active;
			if (active) loadMissionAssets();
			samplingKit.samples.visible = !samplesCollected;
			roverAnchor.visible = !baseRoute;
		},
		updateDrill: samplingKit.updateDrill,
		dispose() {
			disposed = true;
			hardware.dispose();
			cabin.dispose();
			samplingKit.dispose();
			outcrop.dispose();
			for (const model of missionAssets) disposeModel(model);
			boulder.geometry.dispose();
			boulder.material.dispose();
		}
	};
}
