import { Quaternion, Raycaster, Vector3, type Object3D } from 'three';

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
type Hit = { element: HTMLButtonElement | HTMLInputElement; rect: DOMRectReadOnly };
const controlSelector = '.visor-controls, .scene-controls';

export function mountXrControls(visor: HTMLElement, setClockInput: (name: string, value: string) => void,
	talkStart: () => void, talkEnd: () => void) {
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d')!;
	let bounds: DOMRect;
	let hits: Hit[] = [];
	let speaking: XRInputSource | undefined;
	let gripTalking = false;
	const iconPaths = new Map<string, Path2D>();
	const hitAt = (point: Point) => hits.find(({ rect }) =>
		point.x * bounds.width >= rect.left - bounds.left && point.x * bounds.width <= rect.right - bounds.left &&
		point.y * bounds.height >= rect.top - bounds.top && point.y * bounds.height <= rect.bottom - bounds.top
	)?.element;

	function draw(points: Point[]) {
		bounds = visor.getBoundingClientRect();
		if (!bounds.width || !bounds.height) return;
		const width = Math.min(1280, Math.round(bounds.width));
		const height = Math.round(width * bounds.height / bounds.width);
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		context.setTransform(width / bounds.width, 0, 0, height / bounds.height, 0, 0);
		context.clearRect(0, 0, bounds.width, bounds.height);
		hits = [];
		const textRange = document.createRange();
		const visible = (element: Element) => !element.closest('[hidden], [inert], [aria-hidden="true"]');
		const paint = (element: HTMLElement) => {
			if (!visible(element)) return;
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			if (style.display === 'contents') {
				for (const child of element.children) if (child instanceof HTMLElement) paint(child);
				return;
			}
			if (style.display === 'none' || style.visibility === 'hidden' || !rect.width || !rect.height) return;
			const x = rect.x - bounds.x;
			const y = rect.y - bounds.y;
			context.save();
			context.globalAlpha *= Number(style.opacity);
			const button = element instanceof HTMLButtonElement;
			const input = element instanceof HTMLInputElement;
			if ((button || input) && !element.disabled) {
				const panel = element.closest('.scene-controls-panel, .mission-options');
				const clip = panel?.getBoundingClientRect() ?? bounds;
				const left = Math.max(clip.left, rect.left);
				const top = Math.max(clip.top, rect.top);
				const right = Math.min(clip.right, rect.right);
				const bottom = Math.min(clip.bottom, rect.bottom);
				if (right > left && bottom > top) hits.push({ element, rect: new DOMRect(left, top, right - left, bottom - top) });
			}
			const hovered = points.some((point) => hitAt(point) === element);
			const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius]
				.map((radius) => parseFloat(radius) || 0);
			context.beginPath();
			context.roundRect(x, y, rect.width, rect.height, radii);
			context.fillStyle = hovered && button ? '#23483c' : style.backgroundColor;
			context.fill();
			const roundBorder = radii.some((radius) => radius > 0) &&
				style.borderTopWidth === style.borderBottomWidth && style.borderTopWidth === style.borderLeftWidth &&
				style.borderTopWidth === style.borderRightWidth;
			if (roundBorder && parseFloat(style.borderTopWidth)) {
				context.lineWidth = parseFloat(style.borderTopWidth);
				context.strokeStyle = style.borderTopColor;
				context.stroke();
			}
			if (!roundBorder) for (const [side, x1, y1, x2, y2] of [
				['Top', x, y, x + rect.width, y], ['Bottom', x, y + rect.height, x + rect.width, y + rect.height],
				['Left', x, y, x, y + rect.height], ['Right', x + rect.width, y, x + rect.width, y + rect.height]
			] as const) {
				const lineWidth = parseFloat(style[`border${side}Width`]);
				if (!lineWidth) continue;
				context.beginPath();
				context.moveTo(x1, y1);
				context.lineTo(x2, y2);
				context.lineWidth = lineWidth;
				context.strokeStyle = style[`border${side}Color`];
				context.stroke();
			}
			if (hovered) {
				context.strokeStyle = '#ecfff7';
				context.lineWidth = 1;
				context.beginPath();
				context.roundRect(x, y, rect.width, rect.height, radii);
				context.stroke();
			}
			context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
			context.fillStyle = style.color;
			context.textBaseline = 'middle';
			if (input) {
				context.textAlign = 'center';
				const value = element.name === 'time' ? '−  ' + element.value.replace(':', '  + : −  ') + '  +' : '−  ' + element.value + '  +';
				context.fillText(value, x + rect.width / 2, y + rect.height / 2, rect.width - 12);
				context.textAlign = 'left';
			}
			if (style.overflowY === 'auto' || style.overflowY === 'hidden') {
				context.beginPath();
				context.rect(x, y, rect.width, rect.height);
				context.clip();
			}
			for (const child of element.childNodes) {
				if (child instanceof HTMLElement) paint(child);
				else if (child instanceof SVGSVGElement && child.classList.contains('visor-icon')) {
					const path = child.querySelector('path')?.getAttribute('d');
					if (!path) continue;
					let stroke = iconPaths.get(path);
					if (!stroke) {
						stroke = new Path2D(path);
						iconPaths.set(path, stroke);
					}
					const icon = child.getBoundingClientRect();
					const { width, height } = child.viewBox.baseVal;
					context.save();
					context.translate(icon.x - bounds.x, icon.y - bounds.y);
					context.scale(icon.width / width, icon.height / height);
					context.strokeStyle = style.color;
					context.lineWidth = Number(child.getAttribute('stroke-width'));
					context.lineCap = 'round';
					context.lineJoin = 'round';
					context.stroke(stroke);
					context.restore();
				} else if (child instanceof Text && child.data.trim()) {
					// DOM ranges provide the browser's actual positions, including wrapped text.
					for (const word of child.data.matchAll(/\S+/g)) {
						textRange.setStart(child, word.index);
						textRange.setEnd(child, word.index + word[0].length);
						const ink = textRange.getBoundingClientRect();
						context.fillText(word[0], ink.x - bounds.x, ink.y - bounds.y + ink.height / 2);
					}
				}
			}
			context.restore();
		};
		visor.querySelectorAll<HTMLElement>(controlSelector).forEach(paint);
		for (const point of points) {
			context.beginPath();
			context.arc(point.x * bounds.width, point.y * bounds.height, 3, 0, 2 * Math.PI);
			context.fillStyle = '#ecfff7';
			context.fill();
		}
	}

	return {
		canvas,
		draw,
		toggleScene() {
			visor.querySelector<HTMLButtonElement>('.scene-controls-trigger')?.click();
		},
		setGripTalking(active: boolean) {
			if (active === gripTalking) return;
			gripTalking = active;
			if (speaking) return;
			if (active) talkStart();
			else talkEnd();
		},
		start(point: Point | undefined, source: XRInputSource) {
			if (!point || speaking || !hitAt(point)?.classList.contains('voice-control')) return;
			speaking = source;
			if (!gripTalking) talkStart();
		},
		end(source?: XRInputSource) {
			if (!speaking || (source && speaking !== source)) return;
			speaking = undefined;
			if (!gripTalking) talkEnd();
		},
		select(point: Point, source: XRInputSource) {
			const element = hitAt(point);
			if (!element?.isConnected || element.disabled || element.closest('[hidden], [inert]')) return;
			if (element instanceof HTMLButtonElement) {
				if (!element.classList.contains('voice-control')) element.click();
				return;
			}
			// Preserve the existing time controls. Opposite halves decrease/increase the value.
			const rect = element.getBoundingClientRect();
			const fraction = (point.x * bounds.width + bounds.left - rect.left) / rect.width;
			const step = fraction < 0.5 ? -1 : 1;
			if (element.name === 'sol') {
				const value = Math.min(99999, Math.max(0, Number(element.value) + step * (source.gamepad?.buttons[1]?.pressed ? 100 : 1)));
				setClockInput('sol', String(value));
			} else {
				const [hours, minutes] = element.value.split(':').map(Number);
				const delta = (fraction < 0.5 ? 60 : 1) * (fraction % 0.5 < 0.25 ? -1 : 1);
				const total = (hours * 60 + minutes + delta + 1440) % 1440;
				setClockInput('time', String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0'));
			}
		}
	};
}
