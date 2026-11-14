import { Quaternion, Raycaster, Vector3, type Object3D } from 'three';

export interface XrMenuItem {
	id: string;
	label: string;
	run: () => void;
	disabled?: boolean;
	active?: boolean;
	close?: boolean;
}

export interface XrMenuPage {
	title: string;
	items: XrMenuItem[];
	hint?: string;
	lines?: string[];
}

const columns = 2;
const left = 42;
const top = 82;
const gap = 12;
const buttonWidth = 464;
const buttonHeight = 48;

export function xrStick(x = 0, y = 0) {
	const length = Math.hypot(x, y);
	if (length <= 0.2) return { x: 0, y: 0 };
	const scale = Math.min(1, (length - 0.2) / 0.8) / length;
	return { x: x * scale, y: y * scale };
}

export function xrMenuIndex(x: number, y: number) {
	const dx = x - left;
	const dy = y - top;
	const col = Math.floor(dx / (buttonWidth + gap));
	const row = Math.floor(dy / (buttonHeight + gap));
	if (col < 0 || col >= columns || row < 0 ||
		dx % (buttonWidth + gap) >= buttonWidth || dy % (buttonHeight + gap) >= buttonHeight) return -1;
	return row * columns + col;
}

export function createXrPointer(origin: Object3D, plane: Object3D) {
	const ray = new Raycaster();
	const start = new Vector3();
	const direction = new Vector3();
	const rotation = new Quaternion();
	return (frame: XRFrame, source: XRInputSource, space: XRReferenceSpace) => {
		const pose = frame.getPose(source.targetRaySpace, space);
		if (!pose) return;
		const { position, orientation } = pose.transform;
		start.set(position.x, position.y, position.z);
		rotation.set(orientation.x, orientation.y, orientation.z, orientation.w);
		direction.set(0, 0, -1).applyQuaternion(rotation);
		ray.set(origin.localToWorld(start), direction.transformDirection(origin.matrixWorld));
		const uv = ray.intersectObject(plane, false)[0]?.uv;
		if (uv) return { x: uv.x * 1024, y: (1 - uv.y) * 512 };
	};
}

export function drawXrMenu(context: CanvasRenderingContext2D, page: XrMenuPage,
	pointers: Array<{ x: number; y: number }>) {
	context.fillStyle = '#081719';
	context.fillRect(24, 16, 976, 478);
	context.strokeStyle = '#69aaa2';
	context.strokeRect(24, 16, 976, 478);
	context.font = '600 34px sans-serif';
	context.textBaseline = 'middle';
	context.fillStyle = '#e5fff5';
	context.fillText(page.title, left, 50, 940);

	page.items.forEach((item, index) => {
		const x = left + (index % columns) * (buttonWidth + gap);
		const y = top + Math.floor(index / columns) * (buttonHeight + gap);
		const hovered = !item.disabled && pointers.some((point) => xrMenuIndex(point.x, point.y) === index);
		context.fillStyle = hovered ? '#28625b' : item.active ? '#214e45' : '#142b2d';
		context.fillRect(x, y, buttonWidth, buttonHeight);
		if (hovered || item.active) {
			context.strokeStyle = '#a0ffda';
			context.strokeRect(x, y, buttonWidth, buttonHeight);
		}
		context.fillStyle = item.disabled ? '#8aa19e' : '#f3fff9';
		context.font = '500 25px sans-serif';
		context.fillText(item.label, x + 13, y + buttonHeight / 2, buttonWidth - 26);
	});
	context.font = '500 22px sans-serif';
	context.fillStyle = '#b5dfd4';
	page.lines?.forEach((line, index) => context.fillText(line, left, 190 + index * 48, 940));
	context.fillText(page.hint ?? 'Point and press trigger  ·  A: close', left, 464, 940);
	for (const { x, y } of pointers) {
		context.beginPath();
		context.arc(x, y, 6, 0, Math.PI * 2);
		context.fillStyle = '#f4ffdb';
		context.fill();
		context.strokeStyle = '#173531';
		context.stroke();
	}
}
