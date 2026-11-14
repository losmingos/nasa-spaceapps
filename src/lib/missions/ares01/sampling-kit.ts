import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three';

export function buildSamplingKit() {
	const group = new Group();
	const samples = new Group();
	const drill = new Group();
	const rest = new Vector3();
	const contact = new Vector3();
	let drillTipOffset = 0;
	group.add(drill);
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
			rest.set(-center.x, center.y - bounds.min.y, 0);
			model.position.set(0, -center.y, -center.z);
			drill.add(model);
			drill.position.copy(rest);
			// The chuck points along the model's negative X axis.
			drillTipOffset = -bounds.min.x;
		},
		setContact(x: number, y: number, z: number) {
			contact.set(x, y, z);
		},
		updateDrill(engaged: boolean, seconds: number) {
			drill.position.copy(engaged ? contact : rest);
			drill.rotation.z = engaged ? Math.PI / 2 : 0;
			if (engaged) drill.position.y += drillTipOffset + 0.005 + Math.sin(seconds * 35) * 0.004;
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
