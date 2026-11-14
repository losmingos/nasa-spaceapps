import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three';

export function buildSamplingKit() {
	const group = new Group();
	const samples = new Group();
	group.add(samples);
	const caseGeometry = new BoxGeometry(0.25, 0.031, 0.23);
	const caseMaterial = new MeshStandardMaterial({ color: '#494638', roughness: 0.8 });
	const tray = new Mesh(caseGeometry, caseMaterial);
	tray.position.set(0.27, 0.016, 0);
	group.add(tray);

	return {
		group,
		samples,
		addDrill(model: Object3D) {
			const bounds = new Box3().setFromObject(model);
			const center = bounds.getCenter(new Vector3());
			model.rotation.y = Math.PI / 2;
			model.position.set(-center.z, -bounds.min.y, center.x);
			group.add(model);
		},
		addTubes(model: Object3D) {
			for (const x of [0.20, 0.27, 0.34]) {
				const tube = model.clone(true);
				tube.position.set(x, 0.044, 0);
				samples.add(tube);
			}
		},
		dispose() {
			caseGeometry.dispose();
			caseMaterial.dispose();
		}
	};
}
