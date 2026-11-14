import {
	BoxGeometry, CanvasTexture, Color, DoubleSide, Group, Mesh, MeshBasicMaterial,
	PlaneGeometry, SpotLight, SRGBColorSpace
} from 'three';
import type { VisorMessage } from './optics.js';

export function buildRoverCabin(map: HTMLCanvasElement) {
	const group = new Group();
	group.visible = false;
	const box = new BoxGeometry(1, 1, 1);
	const frame = new MeshBasicMaterial({ color: '#343e42' });
	const trim = new MeshBasicMaterial({ color: '#121a1e' });
	const hardware = new MeshBasicMaterial({ color: '#738487' });
	const glass = new MeshBasicMaterial({
		color: '#a5d7dc', transparent: true, opacity: 0.035, depthWrite: false, side: DoubleSide
	});
	function part(material: MeshBasicMaterial, x: number, y: number, z: number, w: number, h: number, d: number) {
		const mesh = new Mesh(box, material);
		mesh.position.set(x, y, z);
		mesh.scale.set(w, h, d);
		group.add(mesh);
		return mesh;
	}

	// Driver eye is the origin. The hull, windows, instruments and lights all share the rover frame.
	part(trim, 0, -1.14, 0.1, 2.5, 0.14, 3);
	part(frame, 0, 0.84, 0.1, 2.5, 0.14, 3);
	part(frame, 0, -0.91, -1.19, 2.5, 0.45, 0.15);
	part(frame, 0, -0.13, 1.56, 2.5, 1.98, 0.15);
	part(trim, 0, -0.70, -0.99, 2.45, 0.20, 0.57);
	part(glass, 0, 0.17, -1.28, 2.4, 1.20, 0.012);
	part(frame, 0, 0.73, -1.29, 2.48, 0.10, 0.09);
	for (const side of [-1, 1]) {
		const x = side * 1.20;
		part(frame, x, 0.13, -1.25, 0.13, 1.28, 0.16);
		part(frame, x, 0.13, 0.60, 0.13, 1.28, 0.14);
		part(frame, x, -0.85, 0.12, 0.14, 0.58, 2.88);
		part(glass, x, 0.12, -0.35, 0.012, 1.25, 1.74);
		part(trim, x, 0.04, 1.12, 0.14, 1.43, 0.87);
		part(hardware, x * 0.94, -0.55, 1.00, 0.08, 0.25, 0.04);
		const lamp = new SpotLight('#fff3df', 0, 100, Math.PI / 6, 0.6, 2);
		lamp.position.set(side * 0.78, -0.94, -1.47);
		lamp.target.position.set(side * 0.78, -5.25, -31.47);
		group.add(lamp, lamp.target);
	}
	// Twin displays sit on the dashboard and stay there when the driver looks aside.
	const panel = document.createElement('canvas');
	panel.width = 640;
	panel.height = 208;
	const ctx = panel.getContext('2d')!;
	const texture = new CanvasTexture(panel);
	texture.colorSpace = SRGBColorSpace;
	const display = new MeshBasicMaterial({ map: texture, color: new Color('#ffffff') });
	const screen = new PlaneGeometry(1.39, 0.45);
	const console = new Mesh(screen, display);
	console.position.set(0, -0.34, -0.92);
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
			ctx.drawImage(map, 16, 22, 165, 165);
			ctx.strokeStyle = '#4d746f';
			ctx.strokeRect(15, 21, 167, 167);
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
			for (const material of [frame, trim, hardware, glass, display]) material.dispose();
			texture.dispose();
		}
	};
}
