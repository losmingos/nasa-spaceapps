import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, type BufferGeometry } from 'three';

/** Compact ARES coring stand and empty sample tubes, with dimensions in metres. */
export function buildSamplingKit() {
	const group = new Group();
	const metal = new MeshStandardMaterial({ color: '#a6adb3', metalness: 0.48, roughness: 0.42 });
	const housing = new MeshStandardMaterial({ color: '#daba79', roughness: 0.68 });
	const rubber = new MeshStandardMaterial({ color: '#28292b', roughness: 0.9 });
	const caseMaterial = new MeshStandardMaterial({ color: '#e2e7df', roughness: 0.68 });
	const geometries: BufferGeometry[] = [];
	function part(geometry: BufferGeometry, material: MeshStandardMaterial, x: number, y: number, z: number) {
		geometries.push(geometry);
		const mesh = new Mesh(geometry, material);
		mesh.position.set(x, y, z);
		mesh.castShadow = true;
		group.add(mesh);
		return mesh;
	}
	const box = (x: number, y: number, z: number, w: number, h: number, d: number, material: MeshStandardMaterial) =>
		part(new BoxGeometry(w, h, d), material, x, y, z);
	const cylinder = (x: number, y: number, z: number, radius: number, height: number, material: MeshStandardMaterial, open = false) =>
		part(new CylinderGeometry(radius, radius, height, 12, 1, open), material, x, y, z);

	// Dual rails guide the rotary-percussive head above the exposed rock.
	for (const side of [-1, 1]) {
		box(side * 0.28, 0.08, 0, 0.11, 0.11, 0.56, rubber);
		cylinder(side * 0.22, 0.42, 0, 0.021, 0.64, metal);
	}
	box(0, 0.17, 0, 0.55, 0.07, 0.21, metal);
	box(0, 0.74, 0, 0.53, 0.07, 0.14, housing);
	box(0, 0.54, 0, 0.48, 0.20, 0.24, housing);
	box(0.13, 0.54, -0.125, 0.12, 0.07, 0.025, rubber);
	cylinder(0, 0.40, 0, 0.072, 0.10, rubber);
	cylinder(0, 0.28, 0, 0.025, 0.18, metal, true);

	// Open carrier with titanium-colored tubes. The mission aborts before a core is collected.
	box(0.60, 0.08, 0.12, 0.33, 0.12, 0.24, caseMaterial);
	box(0.60, 0.18, 0.23, 0.33, 0.18, 0.026, caseMaterial);
	box(0.60, 0.143, 0.12, 0.28, 0.014, 0.19, rubber);
	for (const x of [0.52, 0.60, 0.68]) {
		const tube = cylinder(x, 0.167, 0.11, 0.012, 0.105, metal, true);
		tube.rotation.x = Math.PI / 2;
	}

	return {
		group,
		dispose() {
			for (const geometry of geometries) geometry.dispose();
			for (const material of [metal, housing, rubber, caseMaterial]) material.dispose();
		}
	};
}
