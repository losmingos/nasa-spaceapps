import {
	BoxGeometry, CanvasTexture, CylinderGeometry, DoubleSide, Group, LatheGeometry, Mesh, MeshStandardMaterial,
	PointLight, SRGBColorSpace, Vector2, type BufferGeometry
} from 'three';
import { handoff } from './route.js';

export function buildBravoStation(ground: (x: number, z: number) => number) {
	const group = new Group();
	const habitat = new Group();
	habitat.position.set(0, -0.15, 1.85);
	group.add(habitat);

	const box = new BoxGeometry(1, 1, 1);
	const cylinder = new CylinderGeometry(0.5, 0.5, 1, 32);
	const reflector = new LatheGeometry([
		new Vector2(0, 0), new Vector2(0.20, 0.01), new Vector2(0.42, 0.07),
		new Vector2(0.66, 0.17), new Vector2(0.87, 0.31)
	], 40);
	const frame = new MeshStandardMaterial({ color: '#343d41', metalness: 0.35, roughness: 0.64 });
	const panel = new MeshStandardMaterial({ color: '#a8a69a', metalness: 0.22, roughness: 0.73 });
	const orange = new MeshStandardMaterial({ color: '#d58549', roughness: 0.65 });
	const glass = new MeshStandardMaterial({ color: '#172c35', emissive: '#2f655f', emissiveIntensity: 0.45, roughness: 0.21 });
	const guide = new MeshStandardMaterial({ color: '#b4f5e6', emissive: '#76dbc4', emissiveIntensity: 2 });
	const amber = new MeshStandardMaterial({ color: '#ffe1b3', emissive: '#ffb268', emissiveIntensity: 2 });
	const solarCell = new MeshStandardMaterial({ color: '#1d3248', metalness: 0.3, roughness: 0.38 });
	const dishMetal = new MeshStandardMaterial({ color: '#9ea6a1', metalness: 0.22, roughness: 0.64, side: DoubleSide });

	const signCanvas = document.createElement('canvas');
	signCanvas.width = 512;
	signCanvas.height = 96;
	const paint = signCanvas.getContext('2d')!;
	paint.fillStyle = '#152326';
	paint.fillRect(0, 0, 512, 96);
	paint.fillStyle = '#eab174';
	paint.fillRect(12, 14, 8, 68);
	paint.fillRect(492, 14, 8, 68);
	paint.fillStyle = '#fff1db';
	paint.textAlign = 'center';
	paint.font = 'bold 52px monospace';
	paint.fillText('B R A V O', 256, 61);
	const signTexture = new CanvasTexture(signCanvas);
	signTexture.colorSpace = SRGBColorSpace;
	const sign = new MeshStandardMaterial({ map: signTexture, emissiveMap: signTexture, emissive: '#ffffff', emissiveIntensity: 1 });

	function part(parent: Group, material: MeshStandardMaterial, x: number, y: number, z: number, w: number, h: number, d: number, geometry: BufferGeometry = box) {
		const mesh = new Mesh(geometry, material);
		mesh.position.set(x, y, z);
		mesh.scale.set(w, h, d);
		parent.add(mesh);
		return mesh;
	}

	const anchors: Group[] = [];
	function onGround(x: number, z: number) {
		const anchor = new Group();
		anchor.position.set(x, 0, z);
		anchors.push(anchor);
		group.add(anchor);
		return anchor;
	}

	// The transfer point is in front of the pressure hatch, on the rover's approach axis.
	part(group, frame, 0, -0.31, 1.25, 2.8, 0.73, 2);
	part(group, frame, 0, -0.58, 11.35, 6.35, 0.90, 6.6, cylinder);
	part(group, frame, 0, 1.7, 1.82, 2.45, 2.95, 0.55);
	part(group, frame, 0, 0.08, 0.90, 1.98, 0.29, 0.85);
	part(group, panel, 0, 0.29, 1.16, 1.92, 0.26, 0.56);
	part(group, panel, 0, 1.64, 1.502, 1.54, 2.28, 0.13);
	part(group, frame, 0, 1.64, 1.43, 0.027, 2.13, 0.02);
	part(group, frame, 0, 2.11, 1.424, 0.69, 0.07, 0.69, cylinder).rotation.x = Math.PI / 2;
	part(group, glass, 0, 2.11, 1.386, 0.53, 0.025, 0.53, cylinder).rotation.x = Math.PI / 2;
	part(group, sign, 0, 3.11, 1.498, 2.12, 0.39, 0.06);
	for (const side of [-1, 1]) {
		part(group, frame, side * 0.19, 1.57, 1.407, 0.075, 0.23, 0.07);
		part(group, orange, side * 0.99, 1.61, 1.521, 0.17, 2.38, 0.12);
		part(group, amber, side * 1.21, 2.70, 1.49, 0.08, 0.26, 0.10);
		for (const z of [-17, -11, -5, -1.5]) {
			const beacon = onGround(side * 2.05, z);
			part(beacon, frame, 0, 0.09, 0, 0.23, 0.34, 0.23);
			part(beacon, guide, 0, 0.28, 0, 0.16, 0.09, 0.16);
		}
	}
	const parkingLight = new PointLight('#d6f2ff', 160, 31);
	parkingLight.position.set(-2.65, 3.6, -14);
	group.add(parkingLight);
	const porchLight = new PointLight('#ffcc91', 105, 21);
	porchLight.position.set(0, 3.0, -0.4);
	group.add(porchLight);
	const exteriorLight = new PointLight('#bedcff', 185, 21);
	exteriorLight.position.set(0, 3.27, 0);
	const exteriorFixture = onGround(-3.8, 6.65);
	exteriorFixture.add(exteriorLight);
	part(exteriorFixture, frame, 0, 1.6, 0, 0.13, 3.2, 0.13);
	part(exteriorFixture, guide, 0, 3.23, 0, 0.32, 0.12, 0.25);

	const mast = onGround(5.6, 7.6);
	part(mast, frame, 0, 0.05, 0, 1.15, 0.31, 1.15, cylinder);
	part(mast, panel, 0, 2.45, 0, 0.20, 5, 0.20, cylinder);
	part(mast, orange, 0, 4.33, 0, 0.28, 0.21, 0.28, cylinder);
	const antenna = new Group();
	antenna.position.y = 4.89;
	antenna.rotation.set(-0.98, 0, -0.30);
	mast.add(antenna);
	part(antenna, dishMetal, 0, 0, 0, 1, 1, 1, reflector);
	part(antenna, frame, 0, 0.22, 0, 0.075, 0.48, 0.075, cylinder);
	part(antenna, panel, 0, 0.48, 0, 0.20, 0.18, 0.20, cylinder);

	for (const z of [5.7, 9.5]) {
		const power = onGround(-5.6, z);
		part(power, frame, 0, 0.12, 0, 1.5, 0.32, 0.75);
		part(power, panel, 0, 1.12, 0, 0.16, 2.1, 0.16, cylinder);
		const array = new Group();
		array.position.y = 2.12;
		array.rotation.x = -0.52;
		power.add(array);
		part(array, frame, 0, 0, 0, 3.42, 0.10, 1.79);
		for (const x of [-1.24, -0.41, 0.41, 1.24]) {
			for (const row of [-0.43, 0.43]) part(array, solarCell, x, 0.058, row, 0.79, 0.022, 0.81);
		}
	}

	return {
		group,
		habitat,
		reground() {
			group.position.set(handoff.x, ground(handoff.x, handoff.z), handoff.z);
			for (const anchor of anchors) {
				const { x, z } = anchor.position;
				anchor.position.y = ground(handoff.x + x, handoff.z + z) - group.position.y;
			}
		},
		dispose() {
			signTexture.dispose();
			for (const geometry of [box, cylinder, reflector]) geometry.dispose();
			for (const material of [frame, panel, orange, glass, guide, amber, solarCell, dishMetal, sign]) material.dispose();
		}
	};
}
