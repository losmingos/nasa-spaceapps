import {
	BoxGeometry, BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial,
	PlaneGeometry, SpotLight, SRGBColorSpace
} from 'three';
import type { VisorMessage, VisorReadings, XrHudControls } from './optics.js';

export function buildRoverCabin(map: HTMLCanvasElement) {
	const group = new Group();
	group.visible = false;
	const box = new BoxGeometry(1, 1, 1);
	const frame = new MeshBasicMaterial({ color: '#b7bcb3', side: DoubleSide });
	const trim = new MeshBasicMaterial({ color: '#182326', side: DoubleSide });
	const liner = new MeshBasicMaterial({ color: '#687471', side: DoubleSide });
	const hardware = new MeshBasicMaterial({ color: '#899995' });
	const upholstery = new MeshBasicMaterial({ color: '#303d3e' });
	const recess = new MeshBasicMaterial({ color: '#0a1317' });
	const amber = new MeshBasicMaterial({ color: '#dca262' });
	const light = new MeshBasicMaterial({ color: '#c6e5dc' });
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
	// Recessed window gaskets, continuous sill and overhead task-light diffusers.
	band(trim, [-0.43, 1.29, 1.52], [-0.37, 1.30, 1.52]);
	band(trim, [0.55, 1.17, 1.33], [0.61, 1.17, 1.33]);
	band(light, [0.77, 0.95, 1.12], [0.79, 0.93, 1.10], -1.55, 1.55);
	const seams = [-1.91, -0.91, -0.46, 0.46, 0.91, 1.91];
	for (let i = 1; i < seams.length; i++) band(glass, sill, brow, seams[i - 1], seams[i]);
	for (const seam of seams) band(frame, sill, brow, seam - 0.024, seam + 0.024);
	band(liner, sill, brow, 1.91, 2 * Math.PI - 1.91);

	// Sloping dashboard follows the curved front of the cabin, below the window sill.
	band(trim, [-0.76, 1.20, 1.33], [-0.59, 0.84, 0.76], -1.44, 1.44);
	band(frame, [-0.79, 1.23, 1.41], [-0.76, 1.20, 1.33], -1.44, 1.44);
	const hatch = part(trim, 0, -0.12, 1.43, 0.68, 1.10, 0.07);
	hatch.rotation.x = -0.10;
	part(liner, 0, -0.12, 1.375, 0.56, 0.96, 0.035).rotation.x = -0.10;
	part(amber, 0, 0.30, 1.30, 0.22, 0.035, 0.025);
	part(hardware, 0.19, -0.14, 1.28, 0.035, 0.20, 0.06);
	// A low seat and two side consoles leave the forward view and footwell clear.
	part(trim, 0, -0.93, 0.30, 0.62, 0.27, 0.69);
	part(upholstery, 0, -0.76, 0.27, 0.58, 0.12, 0.63);
	part(upholstery, 0, -0.40, 0.62, 0.58, 0.67, 0.12).rotation.x = -0.12;
	part(upholstery, 0, 0.03, 0.68, 0.32, 0.22, 0.13);
	for (const side of [-1, 1]) {
		part(trim, side * 0.68, -0.77, -0.12, 0.29, 0.38, 0.86);
		part(liner, side * 0.68, -0.56, -0.12, 0.30, 0.045, 0.87);
		part(upholstery, side * 0.48, -0.49, 0.28, 0.13, 0.09, 0.40);
		part(recess, side * 0.68, -0.53, -0.35, 0.21, 0.025, 0.29);
		part(hardware, side * 0.68, -0.44, -0.33, 0.035, 0.17, 0.035).rotation.x = -0.18;
		part(trim, side * 0.68, -0.35, -0.35, 0.085, 0.065, 0.10);
		part(amber, side * 0.68, -0.315, -0.35, 0.035, 0.008, 0.035);
		// Ribbed floor plates and wall equipment lockers are actual cabin geometry.
		part(recess, side * 0.38, -1.085, -0.48, 0.29, 0.015, 0.66);
		for (let i = 0; i < 9; i++) {
			part(hardware, side * 0.38, -1.073, -0.75 + i * 0.065, 0.25, 0.009, 0.015);
		}
		part(trim, side * 0.87, -0.53, 0.73, 0.32, 0.48, 0.38);
		part(liner, side * 0.87, -0.51, 0.52, 0.27, 0.39, 0.025);
		part(hardware, side * 0.87, -0.39, 0.49, 0.12, 0.025, 0.035);
		part(light, side * 0.83, -0.90, -0.10, 0.012, 0.025, 0.61);
	}
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
	panel.width = 960;
	panel.height = 360;
	const ctx = panel.getContext('2d')!;
	const texture = new CanvasTexture(panel);
	texture.colorSpace = SRGBColorSpace;
	const display = new MeshBasicMaterial({ map: texture });
	const screen = new PlaneGeometry(1.39, 0.52);
	const console = new Mesh(screen, display);
	const bezel = part(recess, 0, -0.41, -0.95, 1.47, 0.60, 0.065);
	bezel.rotation.x = -0.32;
	// Offset along the tilted bezel's normal, beyond its 32.5 mm half-depth.
	// A world-Z offset alone leaves the display occluded by its own housing.
	console.position.set(0, -0.41 + Math.sin(0.32) * 0.04, -0.95 + Math.cos(0.32) * 0.04);
	console.rotation.x = -0.32;
	group.add(console);
	for (const side of [-1, 1]) {
		for (let i = 0; i < 5; i++) {
			part(recess, side * (0.81 + i * 0.035), -0.54, -0.96, 0.014, 0.018, 0.13);
		}
		for (const y of [-0.62, -0.20]) {
			part(hardware, side * 0.715, y, -0.92 + (y + 0.41) * -0.33, 0.012, 0.012, 0.008);
		}
	}
	for (let i = 0; i < 7; i++) {
		part(i === 0 ? hardware : frame, -0.39 + i * 0.13, -0.63, -0.78, 0.075, 0.035, 0.08);
	}
	let lastUpdate = -Infinity;
	let hud: XrHudControls | undefined;

	return {
		group,
		setHud(controls: XrHudControls | undefined) { hud = controls; },
		setLights(power: number) {
			for (const child of group.children) {
				if (child instanceof SpotLight) {
					child.visible = power > 0;
					child.intensity = power * 720;
				}
			}
		},
		update(now: number, message: VisorMessage, speed: number, heading: number, lights: number, clock: string,
			readings: VisorReadings, notice: string, swir: boolean) {
			if (now - lastUpdate < 0.08) return;
			lastUpdate = now;
			ctx.fillStyle = '#0a171c';
			ctx.fillRect(0, 0, 960, 360);
			ctx.save();
			ctx.scale(1.5, 1.5);
			ctx.fillStyle = '#172d32';
			ctx.fillRect(192, 18, 1, 172);
			ctx.fillRect(205, 128, 418, 1);
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
			ctx.fillText('SEV / NAVIGATION', 205, 27);
			ctx.fillText(`HEADING ${heading}°   LAMPS ${lights ? 'ON' : 'OFF'}`, 205, 56);
			ctx.font = 'bold 34px monospace';
			ctx.fillText(`${Math.round(speed)} km/h`, 205, 94);
			ctx.font = '15px monospace';
			ctx.fillText(clock, 205, 119, 418);
			ctx.fillStyle = message.kind === 'danger' ? '#ffb1a2' : '#bbf5df';
			ctx.fillText(message.title, 205, 145, 418);
			ctx.fillText(message.detail ?? '', 205, 166, 418);
			ctx.fillStyle = '#bbf5df';
			ctx.fillText(message.readouts?.map(({ value, unit }) => `${value} ${unit}`.trim()).join('  ·  ') ?? 'CABIN PRESSURIZED', 205, 189, 418);
			ctx.restore();
			ctx.font = '20px monospace';
			ctx.fillStyle = '#bbf5df';
			ctx.fillText(`O₂ ${readings.o2Percent.toFixed(1)}%  ·  ${readings.airTempC === null ? '—' : Math.round(readings.airTempC)}°C  ·  ${swir ? 'SWIR 1.65 µm' : 'VISIBLE'}`, 24, 315, 680);
			ctx.fillText(`SARA · ${hud?.voice?.toUpperCase() ?? 'COMMS'}`, 735, 315, 200);
			const actions = hud?.actions.map(({ hand, label }) => `${hand === 'right' ? 'R' : 'L'} TRIGGER · ${label}`).join('    ');
			ctx.fillStyle = notice ? '#ffe0a6' : '#bbf5df';
			ctx.fillText(notice || actions || (hud ? 'A · Controls   B · Lamps   R GRIP · SARA' : 'F · Lamps   Hold Space · SARA'), 24, 345, 912);
			texture.needsUpdate = true;
		},
		dispose() {
			box.dispose();
			screen.dispose();
			for (const geometry of hull) geometry.dispose();
			for (const material of [frame, trim, liner, hardware, glass, display, upholstery, recess, amber, light]) material.dispose();
			texture.dispose();
		}
	};
}
