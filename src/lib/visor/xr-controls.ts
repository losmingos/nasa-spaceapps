import { Quaternion, Raycaster, Vector3, type Object3D } from 'three';

export interface XrMenuItem {
	id: string;
	label: string;
	run: () => void;
	disabled?: boolean;
	active?: boolean;
	close?: boolean;
	direct?: boolean;
}

export interface XrMenuPage {
	title: string;
	items: XrMenuItem[];
	hint?: string;
	lines?: string[];
}

export function xrStick(x = 0, y = 0) {
	const length = Math.hypot(x, y);
	if (length <= 0.2) return { x: 0, y: 0 };
	const scale = Math.min(1, (length - 0.2) / 0.8) / length;
	return { x: x * scale, y: y * scale };
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
		if (uv) return { x: uv.x, y: 1 - uv.y };
	};
}

type Point = { x: number; y: number };
const menuWidth = 1024;
const menuHeight = 640;
const panelWidth = 908;
const padding = 28;
const gap = 14;
const buttonHeight = 68;
const lineHeight = 32;

function menuLayout(page: XrMenuPage) {
	const count = page.items.length;
	const columns = count <= 3 ? 1 : count <= 8 ? 2 : 3;
	const rows = Math.ceil(count / columns);
	const lines = page.lines ?? [];
	const height = 152 + lines.length * lineHeight + rows * (buttonHeight + gap);
	const left = (menuWidth - panelWidth) / 2;
	const top = (menuHeight - height) / 2;
	const gridWidth = columns === 1 ? 520 : panelWidth - padding * 2;
	const buttonWidth = (gridWidth - (columns - 1) * gap) / columns;
	const buttons = page.items.map((item, index) => {
		const row = Math.floor(index / columns);
		const inRow = Math.min(columns, count - row * columns);
		return {
			item,
			x: (menuWidth - inRow * (buttonWidth + gap) + gap) / 2 + (index % columns) * (buttonWidth + gap),
			y: top + 84 + lines.length * lineHeight + row * (buttonHeight + gap)
		};
	});
	return { left, top, height, lines, buttonWidth, buttons };
}

function contains(point: Point, x: number, y: number, width: number) {
	return point.x >= x && point.x < x + width && point.y >= y && point.y < y + buttonHeight;
}

export function xrMenuItemAt(page: XrMenuPage, point: Point) {
	const { buttonWidth, buttons } = menuLayout(page);
	const pixel = { x: point.x * menuWidth, y: point.y * menuHeight };
	return buttons.find(({ x, y }) => contains(pixel, x, y, buttonWidth))?.item;
}

export function mountXrControls() {
	const canvas = document.createElement('canvas');
	canvas.width = menuWidth;
	canvas.height = menuHeight;
	const context = canvas.getContext('2d')!;

	return {
		canvas,
		drawMenu(page: XrMenuPage, points: Point[]) {
			const { left, top, height, lines, buttonWidth, buttons } = menuLayout(page);
			const pointers = points.map(({ x, y }) => ({ x: x * menuWidth, y: y * menuHeight }));
			context.clearRect(0, 0, menuWidth, menuHeight);
			context.fillStyle = '#081719';
			context.beginPath();
			context.roundRect(left, top, panelWidth, height, 16);
			context.fill();

			context.textAlign = 'center';
			context.textBaseline = 'middle';
			context.font = '600 36px system-ui';
			context.fillStyle = '#e5fff5';
			context.fillText(page.title, menuWidth / 2, top + 41, panelWidth - padding * 2);

			context.font = '25px system-ui';
			context.fillStyle = '#b5dfd4';
			lines.forEach((line, index) => {
				context.fillText(line, menuWidth / 2, top + 77 + index * lineHeight, panelWidth - padding * 2);
			});

			for (const { item, x, y } of buttons) {
				const hovered = !item.disabled && pointers.some((point) => contains(point, x, y, buttonWidth));
				const primary = item.id === 'start' && !item.disabled;
				context.fillStyle = primary ? (hovered ? '#d7fff0' : '#a0e9cd')
					: hovered ? '#28625b' : item.active ? '#214e45' : '#142b2d';
				context.beginPath();
				context.roundRect(x, y, buttonWidth, buttonHeight, 10);
				context.fill();
				if (hovered || item.active) {
					context.strokeStyle = '#a0ffda';
					context.lineWidth = 2;
					context.stroke();
				}
				context.fillStyle = primary ? '#0a251c' : item.disabled ? '#8aa19e' : '#f3fff9';
				context.font = primary ? '700 34px system-ui' : '500 28px system-ui';
				context.fillText(item.label, x + buttonWidth / 2, y + buttonHeight / 2, buttonWidth - 24);
			}

			context.font = '24px system-ui';
			context.fillStyle = '#b5dfd4';
			context.fillText(page.hint ?? 'Trigger to select', menuWidth / 2, top + height - 34, panelWidth - padding * 2);
			for (const { x, y } of pointers) {
				context.beginPath();
				context.arc(x, y, 6, 0, Math.PI * 2);
				context.fillStyle = '#f4ffdb';
				context.fill();
				context.strokeStyle = '#173531';
				context.lineWidth = 2;
				context.stroke();
			}
		}
	};
}
