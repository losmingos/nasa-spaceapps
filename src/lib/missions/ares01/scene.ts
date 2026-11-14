import { Box3, BoxGeometry, Group, Mesh, MeshLambertMaterial, Texture, Vector3,
	type BufferGeometry, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ABRASION_HEIGHT, buildOutcrop } from './outcrop.js';
import { buildSamplingKit } from './sampling-kit.js';
import { BASE, LOOSE_ROCK, ROVER, SAMPLING_KIT, type Point } from './route.js';

export interface Ares01ModelUrls {
	rover: string;
	drill: string;
	tube: string;
}

export function buildAres01Scene(
	surfaceHeight: (x: number, z: number) => number,
	modelUrls: Ares01ModelUrls,
	refresh: () => void
) {
	let disposed = false;
	const landmarks = new Group();
	landmarks.visible = false;
	const hardware = new BoxGeometry(1, 1, 1);
	const cabin = new MeshLambertMaterial({ color: '#ccc6b7' });
	const shale = new MeshLambertMaterial({ color: '#6e4736' });
	function part(anchor: Point, dx: number, y: number, dz: number, w: number, h: number, d: number, paint: MeshLambertMaterial) {
		const block = new Mesh(hardware, paint);
		block.position.set(anchor.x + dx, surfaceHeight(anchor.x, anchor.z) + y, anchor.z + dz);
		block.scale.set(w, h, d);
		landmarks.add(block);
	}
	const roverAnchor = new Group();
	roverAnchor.position.set(ROVER.x, surfaceHeight(ROVER.x, ROVER.z), ROVER.z);
	landmarks.add(roverAnchor);
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
				missionAssets.push(model);
				place(model);
				refresh();
			}, undefined, (error) => {
				if (!disposed) console.warn('Could not load a mission model.', url, error);
			});
		}

		load(modelUrls.rover, (model) => {
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
	landmarks.add(outcrop.group);
	const samplingKit = buildSamplingKit();
	const { x: kitX, z: kitZ } = SAMPLING_KIT;
	samplingKit.group.position.set(kitX, surfaceHeight(kitX, kitZ), kitZ);
	landmarks.add(samplingKit.group);
	samplingKit.setContact(rockX - kitX,
		outcrop.group.position.y + ABRASION_HEIGHT - samplingKit.group.position.y, rockZ - kitZ);
	part(LOOSE_ROCK, 0, 0.18, 0, 0.65, 0.36, 0.48, shale);

	return {
		group: landmarks,
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
			shale.dispose();
		}
	};
}
