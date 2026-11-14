import {
	BufferAttribute, BufferGeometry, Color, DirectionalLight, HemisphereLight,
	Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, Scene, WebGLRenderer
} from 'three';
// MeshStandardMaterial responde mejor a la luz
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const elevationColors = ['#633321', '#ab6643', '#e5ad77'];

function buildTerrain(data: ArrayBuffer) {
	const header = new DataView(data);
	const columns = header.getUint32(0, true);
	const rows = header.getUint32(4, true);
	const spacing = header.getFloat32(8, true);
	const count = columns * rows;
	if (columns < 2 || rows < 2 || data.byteLength !== 12 + count * 4 || !(spacing > 0)) {
		throw new Error('La cuadrícula de elevación no es válida.');
	}

	const elevations = new Float32Array(data, 12);
	let low = Infinity;
	let high = -Infinity;
	for (const height of elevations) {
		if (!Number.isFinite(height)) continue;
		low = Math.min(low, height);
		high = Math.max(high, height);
	}
	if (!(high > low)) throw new Error('No hay elevaciones válidas.');

	const width = (columns - 1) * spacing;
	const length = (rows - 1) * spacing;
	const positions = new Float32Array(count * 3);
	const colors = new Float32Array(count * 3);
	const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
	const [base, middle, peak] = elevationColors.map((hex) => new Color(hex));
	const color = new Color();
	let index = 0;
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < columns; col++) {
			const i = row * columns + col;
			const elevation = elevations[i];
			const present = Number.isFinite(elevation);
			const height = present ? elevation - low : 0;
			positions.set([col * spacing - width / 2, height, row * spacing - length / 2], i * 3);

			const t = (height / (high - low)) ** 0.65;
			if (t < 0.5) color.copy(base).lerp(middle, t * 2);
			else color.copy(middle).lerp(peak, t * 2 - 1);
			color.toArray(colors, i * 3);

			if (row === rows - 1 || col === columns - 1) continue;
			const east = i + 1;
			const south = i + columns;
			const southeast = south + 1;
			const hasEast = Number.isFinite(elevations[east]);
			const hasSouth = Number.isFinite(elevations[south]);
			if (hasEast && hasSouth) {
				if (present) {
					indices.set([i, south, east], index);
					index += 3;
				}
				if (Number.isFinite(elevations[southeast])) {
					indices.set([east, south, southeast], index);
					index += 3;
				}
			}
		}
	}

	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(positions, 3));
	geometry.setAttribute('color', new BufferAttribute(colors, 3));
	geometry.setIndex(new BufferAttribute(indices.subarray(0, index), 1));
	geometry.computeVertexNormals();
	return { geometry, width, length, low, high, spacing };
}

export function mountTerrain(canvas: HTMLCanvasElement, data: ArrayBuffer) {
	const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = PCFSoftShadowMap;
	let model;
	try {
		model = buildTerrain(data);
	} catch (error) {
		renderer.dispose();
		throw error;
	}
	const { geometry, width, length, low, high, spacing } = model;
	const scene = new Scene();
	const material = new MeshStandardMaterial({
		vertexColors: true,
		roughness: 1,
		metalness: 0
	});
	const mesh = new Mesh(geometry, material);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	scene.add(mesh, new HemisphereLight('#f6dfc5', '#38231c', 1.15));
	const span = Math.max(width, length);
	const sun = new DirectionalLight('#fff0d9', 2.4);
	sun.position.set(-span * 0.72, span * 1.25, -span * 0.58);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.camera.left = -span * 0.72;
	sun.shadow.camera.right = span * 0.72;
	sun.shadow.camera.top = span * 0.72;
	sun.shadow.camera.bottom = -span * 0.72;
	sun.shadow.camera.near = 1;
	sun.shadow.camera.far = span * 3;
	sun.shadow.camera.updateProjectionMatrix();
	sun.shadow.bias = -0.0001;
	sun.shadow.normalBias = 0.03;
	scene.add(sun);

	const camera = new PerspectiveCamera(38, 1, 10, span * 12);
	const controls = new OrbitControls(camera, canvas);
	controls.minDistance = 450;
	controls.maxDistance = span * 5;
	controls.maxPolarAngle = Math.PI / 2 - 0.07;
	controls.screenSpacePanning = false;
	controls.listenToKeyEvents(canvas);
	const draw = () => renderer.render(scene, camera);
	controls.addEventListener('change', draw);

	function view(overhead = false) {
		const fit = Math.max(1, 1.18 / camera.aspect);
		controls.target.set(0, 180, 0);
		if (overhead) camera.position.set(0, span * 1.6 * fit, 1);
		else camera.position.set(span * -0.94 * fit, span * 0.88 * fit, span * 0.61 * fit);
		controls.update();
		draw();
	}

	function resize() {
		const { clientWidth, clientHeight } = canvas;
		if (!clientWidth || !clientHeight) return;
		camera.aspect = clientWidth / clientHeight;
		camera.updateProjectionMatrix();
		renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
		renderer.setSize(clientWidth, clientHeight, false);
		draw();
	}

	const observer = new ResizeObserver(resize);
	observer.observe(canvas);
	resize();
	view();

	return {
		low, high, width, length, spacing, view,
		setExaggeration(factor: number) {
			mesh.scale.y = factor;
			draw();
		},
		dispose() {
			observer.disconnect();
			controls.removeEventListener('change', draw);
			controls.dispose();
			geometry.dispose();
			material.dispose();
			renderer.dispose();
		}
	};
}
