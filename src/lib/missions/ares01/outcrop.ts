import { BufferGeometry, CircleGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from 'three';

// Low ledge of fine-grained sedimentary bedrock. Heights and offsets are in metres.
const beds = [
	{ y: -0.13, width: 1, color: '#765440' },
	{ y: 0.06, width: 1.04, color: '#84634c' },
	{ y: 0.125, width: 1, color: '#a47d60' },
	{ y: 0.15, width: 0.99, color: '#634d40' },
	{ y: 0.215, width: 0.95, color: '#967259' },
	{ y: 0.245, width: 0.94, color: '#b08b6e' },
	{ y: 0.293, width: 0.92, color: '#80604d' },
	{ y: 0.33, width: 0.87, color: '#997962' }
];
const outline = [
	[0.69, 0.07], [0.45, 0.43], [0.06, 0.48], [-0.38, 0.38], [-0.67, 0.22],
	[-0.72, -0.09], [-0.49, -0.36], [-0.08, -0.41], [0.31, -0.36], [0.61, -0.23]
];

export function buildOutcrop() {
	const group = new Group();
	const positions: number[] = [];
	const colors: number[] = [];
	const rings = beds.map(({ y, width }, layer) => outline.map(([x, z], edge) => [
		x * width + 0.025 * Math.sin(edge * 2.2 + layer),
		y + 0.045 * x + 0.012 * Math.sin(edge * 2.1 + layer * 0.14),
		z * width + 0.02 * Math.cos(edge * 2.4 + layer)
	]));
	function triangle(a: number[], b: number[], c: number[], tint: string, shade: number) {
		positions.push(...a, ...b, ...c);
		const color = new Color(tint).multiplyScalar(shade);
		for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
	}

	// Broken edges are staggered across beds and vary in brightness by face.
	for (let layer = 0; layer < rings.length - 1; layer++) {
		for (let edge = 0; edge < outline.length; edge++) {
			const next = (edge + 1) % outline.length;
			const lower = rings[layer];
			const upper = rings[layer + 1];
			const shade = 0.88 + 0.17 * Math.sin(edge * 3.8 + layer * 0.45) ** 2;
			triangle(lower[edge], upper[edge], lower[next], beds[layer].color, shade);
			triangle(lower[next], upper[edge], upper[next], beds[layer].color, shade * 0.95);
		}
	}
	const top = rings[rings.length - 1];
	for (let edge = 0; edge < outline.length; edge++) {
		triangle([0, 0.34, 0], top[(edge + 1) % top.length], top[edge],
			'#a17e64', 0.84 + 0.21 * Math.cos(edge * 2.4) ** 2);
	}
	const rockGeometry = new BufferGeometry();
	rockGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
	rockGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
	rockGeometry.computeVertexNormals();
	const rockMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.96 });
	const rock = new Mesh(rockGeometry, rockMaterial);
	rock.castShadow = rock.receiveShadow = true;
	group.add(rock);

	// The pale 5 cm patch exposes fresh rock beneath the weathered surface.
	const patchGeometry = new CircleGeometry(0.025, 18);
	patchGeometry.rotateX(-Math.PI / 2);
	const patchMaterial = new MeshStandardMaterial({ color: '#c8ad91', roughness: 0.91 });
	const patch = new Mesh(patchGeometry, patchMaterial);
	patch.position.y = 0.342;
	patch.rotation.z = 0.045;
	group.add(patch);

	return {
		group,
		dispose() {
			rockGeometry.dispose();
			rockMaterial.dispose();
			patchGeometry.dispose();
			patchMaterial.dispose();
		}
	};
}
