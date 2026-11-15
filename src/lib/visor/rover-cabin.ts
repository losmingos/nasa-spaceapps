import {
	BoxGeometry, BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial,
	PlaneGeometry, SpotLight, SRGBColorSpace
} from 'three';
import type { VisorMessage } from './optics.js';

export function buildRoverCabin(map: HTMLCanvasElement) {
	const group = new Group();
	group.visible = false;
	const box = new BoxGeometry(1, 1, 1);
	const frame = new MeshBasicMaterial({ color: '#909d9d', side: DoubleSide });
	const trim = new MeshBasicMaterial({ color: '#273538', side: DoubleSide });
	const liner = new MeshBasicMaterial({ color: '#586768', side: DoubleSide });
	const hardware = new MeshBasicMaterial({ color: '#738487' });
	const glass = new MeshBasicMaterial({
		color: '#a5d7dc', transparent: true, opacity: 0.035, depthWrite: false, side: DoubleSide
	});
	const hull: BufferGeometry[] = [];
	function part(material: MeshBasicMaterial, x: number, y: number, z: number, w: number, h: number, d: number) {
		const mesh = new Mesh(box, material);
		mesh.position.set(x, y, z);
		mesh.scale.set(w, h, d);
		group.add(mesh);
		return mesh;
	}

	// Each level is an ellipse around the driver. The narrower crown and chin round
	// the cabin in profile as well as in plan, and the glazing shares the hull seams.
	type Ring = readonly [height: number, width: number, depth: number];
	const floor: Ring = [-1.10, 0.97, 1.13];
	const hip: Ring = [-0.79, 1.24, 1.43];
	const sill: Ring = [-0.40, 1.31, 1.54];
	const brow: Ring = [0.59, 1.18, 1.34];
	const crown: Ring = [0.88, 0.85, 1.02];
	const ceiling: Ring = [1.00, 0, 0];
	function point([y, x, z]: Ring, angle: number) {
		return [Math.sin(angle) * x, y, 0.11 - Math.cos(angle) * z];
	}
	function band(material: MeshBasicMaterial, low: Ring, high: Ring, start = -Math.PI, end = Math.PI) {
		const positions: number[] = [];
		const steps = Math.max(1, Math.ceil((end - start) / (Math.PI / 32)));
		for (let i = 0; i < steps; i++) {
			const from = start + (end - start) * i / steps;
			const to = start + (end - start) * (i + 1) / steps;
			const a = point(low, from), b = point(low, to);
			const c = point(high, from), d = point(high, to);
			positions.push(...a, ...b, ...c, ...c, ...b, ...d);
		}
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
		hull.push(geometry);
		group.add(new Mesh(geometry, material));
	}
	band(trim, [-1.10, 0, 0], floor);
	band(liner, floor, hip);
	band(liner, hip, sill);
	band(liner, brow, crown);
	band(frame, crown, ceiling);
	const seams = [-1.91, -0.91, -0.46, 0.46, 0.91, 1.91];
	for (let i = 1; i < seams.length; i++) band(glass, sill, brow, seams[i - 1], seams[i]);
	for (const seam of seams) band(frame, sill, brow, seam - 0.024, seam + 0.024);
	band(liner, sill, brow, 1.91, 2 * Math.PI - 1.91);

	// Sloping dashboard follows the curved front of the cabin, below the window sill.
	band(trim, [-0.76, 1.20, 1.33], [-0.59, 0.84, 0.76], -1.44, 1.44);
	band(frame, [-0.79, 1.23, 1.41], [-0.76, 1.20, 1.33], -1.44, 1.44);
	const hatch = part(trim, 0, -0.12, 1.43, 0.68, 1.10, 0.07);
	hatch.rotation.x = -0.10;
	for (const side of [-1, 1]) {
		const grab = part(hardware, side * 0.45, -0.15, 1.28, 0.045, 0.31, 0.055);
		grab.rotation.z = side * 0.12;
		const lamp = new SpotLight('#fff3df', 0, 100, Math.PI / 6, 0.6, 2);
		lamp.position.set(side * 0.78, -0.94, -1.47);
		lamp.target.position.set(side * 0.78, -5.25, -31.47);
		group.add(lamp, lamp.target);
	}
	// The instrument display is fixed to the dashboard.
	const panel = document.createElement('canvas');
	panel.width = 640;
	panel.height = 208;
	const ctx = panel.getContext('2d')!;
	const texture = new CanvasTexture(panel);
	texture.colorSpace = SRGBColorSpace;
	const display = new MeshBasicMaterial({ map: texture });
	const screen = new PlaneGeometry(1.39, 0.45);
	const console = new Mesh(screen, display);
	console.position.set(0, -0.41, -0.92);
	console.rotation.x = -0.32;
	group.add(console);
	for (let i = 0; i < 7; i++) {
		part(i === 0 ? hardware : frame, -0.39 + i * 0.13, -0.63, -0.78, 0.075, 0.035, 0.08);
	}
	let lastUpdate = -Infinity;

	return {
		group,
		setLights(power: number) {
			for (const child of group.children) {
				if (child instanceof SpotLight) {
					child.visible = power > 0;
					child.intensity = power * 720;
				}
			}
		},
		update(now: number, message: VisorMessage, speed: number, heading: number, lights: number, clock: string) {
			if (now - lastUpdate < 0.08) return;
			lastUpdate = now;
			ctx.fillStyle = '#102024';
			ctx.fillRect(0, 0, 640, 208);
			const mapRadius = 82.5;
			ctx.save();
			ctx.beginPath();
			ctx.arc(16 + mapRadius, 22 + mapRadius, mapRadius, 0, Math.PI * 2);
			ctx.clip();
			ctx.drawImage(map, 16, 22, mapRadius * 2, mapRadius * 2);
			ctx.restore();
			ctx.strokeStyle = '#4d746f';
			ctx.lineWidth = 2;
			ctx.stroke();
			ctx.fillStyle = '#bbf5df';
			ctx.font = '16px monospace';
			ctx.fillText('SEV / ROVER CABIN', 205, 27);
			ctx.fillText(`HEADING ${heading}°   LAMPS ${lights ? 'ON' : 'OFF'}`, 205, 56);
			ctx.font = '29px monospace';
			ctx.fillText(`${Math.round(speed)} km/h`, 205, 94);
			ctx.font = '15px monospace';
			ctx.fillText(clock, 205, 119, 418);
			ctx.fillStyle = message.kind === 'danger' ? '#ffb1a2' : '#bbf5df';
			ctx.fillText(message.title, 205, 145, 418);
			ctx.fillText(message.detail ?? '', 205, 166, 418);
			ctx.fillStyle = '#bbf5df';
			ctx.fillText(message.readouts?.map(({ value, unit }) => `${value} ${unit}`.trim()).join('  ·  ') ?? 'CABIN PRESSURIZED', 205, 189, 418);
			texture.needsUpdate = true;
		},
		dispose() {
			box.dispose();
			screen.dispose();
			for (const geometry of hull) geometry.dispose();
			for (const material of [frame, trim, liner, hardware, glass, display]) material.dispose();
			texture.dispose();
		}
	};
}
