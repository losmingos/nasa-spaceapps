import {
	CanvasTexture, Color, DepthTexture, LinearFilter, HalfFloatType, Matrix4, ShaderMaterial, SRGBColorSpace,
	Quaternion, Vector2, Vector3, Vector4, WebGLRenderTarget,
	PerspectiveCamera, type Object3D, type Scene, type WebGLRenderer
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const stormNight = new Color('#101017');
const stormDusk = new Color('#67402f');
const stormDay = new Color('#a67755');

// Fraction of the minimap's width from its center to the compass ring.
export const MINIMAP_COMPASS_RADIUS = 44 / 96;

export function dustColor(color: Color, twilight: number, daylight: number) {
	return color.copy(stormNight).lerp(stormDusk, twilight).lerp(stormDay, daylight);
}

export interface VisorMessage {
	title: string;
	detail?: string;
	kind?: 'warning' | 'danger';
	readouts?: readonly { value: string; unit: string }[];
}

export interface SwirHudData {
	active: boolean;
	distanceM?: number | null;
	albedo?: number | null;
	surface?: string;
}

export interface VisorReadings {
	o2Percent: number;
	airTempC: number | null;
}

export type XrVoiceStatus = 'locked' | 'idle' | 'recording' | 'thinking' | 'speaking' | 'unavailable';

interface XrHudControls {
	showControlsHint: boolean;
	actions: ReadonlyArray<{ hand: 'right' | 'left'; label: string }>;
	voice?: XrVoiceStatus;
	time: number;
}

function drawVoiceIndicator(ctx: CanvasRenderingContext2D, x: number, y: number, status: XrVoiceStatus, time: number) {
	const recording = status === 'recording';
	const speaking = status === 'speaking';
	const thinking = status === 'thinking';
	const unavailable = status === 'unavailable';
	const color = recording ? '#ffe0a6' : unavailable ? '#ffb4a1' : speaking ? '#e5fff5' : '#b5dfd4';

	ctx.save();
	ctx.translate(x, y);
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.lineWidth = 2;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.beginPath();
	ctx.moveTo(0, -4);
	ctx.lineTo(5, -4);
	ctx.lineTo(12, -10);
	ctx.lineTo(12, 10);
	ctx.lineTo(5, 4);
	ctx.lineTo(0, 4);
	ctx.closePath();
	ctx.stroke();
	if (unavailable) {
		ctx.beginPath();
		ctx.moveTo(17, -5);
		ctx.lineTo(25, 5);
		ctx.moveTo(25, -5);
		ctx.lineTo(17, 5);
		ctx.stroke();
	} else if (speaking || recording || thinking) {
		for (let index = 0; index < 3; index++) {
			const barX = 18 + index * 5;
			const beat = (1 + Math.sin(time * (speaking ? 15 : 9) - index * 1.4)) / 2;
			const radius = thinking ? 1 : 2 + beat * 7;
			ctx.globalAlpha = thinking ? 0.35 + beat * 0.65 : 1;
			ctx.beginPath();
			ctx.moveTo(barX, -radius);
			ctx.lineTo(barX, radius);
			ctx.stroke();
		}
	} else {
		ctx.beginPath();
		ctx.arc(12, 0, 7, -0.8, 0.8);
		ctx.stroke();
	}
	ctx.restore();
}


export const SWIR_NOISE_GLSL = `
	float swirHash(vec2 p) {
		return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
	}
	float swirSensorNoise(vec2 p, float seconds) {
		float frame = floor(seconds * 72.0);
		return swirHash(floor(p) + vec2(frame * 0.754877, frame * 0.569841));
	}
`;

export const SWIR_DEPTH_RESPONSE_GLSL = `
	float swirNearSharpness(float distanceM) { return 1.0 - smoothstep(0.0, 20.0, distanceM); }
	float swirMidHaze(float distanceM) { return smoothstep(20.0, 80.0, distanceM); }
	float swirFarBlur(float distanceM) { return smoothstep(80.0, 150.0, distanceM); }
`;

export function drawHudTime(context: CanvasRenderingContext2D, width: number, y: number, time: string, swir = false) {
	context.save();
	context.textAlign = 'center';
	context.textBaseline = 'alphabetic';
	context.font = `400 ${Math.max(12, Math.min(18, width * 0.016))}px monospace`;
	context.lineWidth = 2;
	context.strokeStyle = 'rgba(0,0,0,.6)';
	context.fillStyle = 'rgba(255,255,255,.8)';
	const label = `${time}${swir ? '  ·  λ = 1.65 µm' : ''}`;
	context.strokeText(label, width / 2, y);
	context.fillText(label, width / 2, y);
	context.restore();
}

export function drawSwirHud(context: CanvasRenderingContext2D, width: number, height: number, data: SwirHudData, drawCrosshair = true) {
	if (!data.active) return;
	const font = Math.max(10, Math.min(20, width * 0.018));
	const line = font * 1.35;
	context.save();
	context.font = `500 ${font}px ui-monospace, monospace`;
	context.textBaseline = 'middle';
	context.lineWidth = Math.max(2, font * 0.18);
	context.strokeStyle = 'rgba(0,0,0,.6)';
	context.fillStyle = 'rgba(255,255,255,.8)';
	const text = (value: string, x: number, y: number, align: CanvasTextAlign = 'left') => {
		context.textAlign = align;
		context.strokeText(value, x, y);
		context.fillText(value, x, y);
	};
	const cx = width / 2, cy = height / 2, arm = Math.max(4, font * 0.38);
	if (drawCrosshair) {
		context.beginPath();
		context.moveTo(cx - arm, cy); context.lineTo(cx + arm, cy);
		context.moveTo(cx, cy - arm); context.lineTo(cx, cy + arm);
		context.strokeStyle = 'rgba(0,0,0,.6)'; context.lineWidth = Math.max(3, font * 0.25); context.stroke();
		context.strokeStyle = 'rgba(255,255,255,.8)'; context.lineWidth = Math.max(1, font * 0.08); context.stroke();
	}
	const distance = data.distanceM === null || data.distanceM === undefined ? '—' : `${data.distanceM.toFixed(1)} m`;
	const albedo = data.albedo === null || data.albedo === undefined ? '—' : data.albedo.toFixed(2);
	text(`DIST: ${distance}`, cx, cy + arm + line * 0.8, 'center');
	text(`SWIR ALBEDO: ${albedo}${data.surface ? ` [${data.surface}]` : ''}`, cx, cy + arm + line * 1.8, 'center');
	context.restore();
}

export function buildVisorOptics(renderer: WebGLRenderer, map: HTMLCanvasElement,
	getNotice: () => string, getClock: () => string, getMessage: () => VisorMessage, getSwir: () => SwirHudData,
	getReadings: () => VisorReadings) {
	// A single emissive image is sampled through the curved inner visor, before the gasket.
	const display = document.createElement('canvas');
	const context = display.getContext('2d')!;
	const displayTexture = new CanvasTexture(display);
	displayTexture.minFilter = LinearFilter;
	displayTexture.generateMipmaps = false;
	const helmet = document.createElement('canvas');
	helmet.width = 1024;
	helmet.height = 768;
	const helmetContext = helmet.getContext('2d')!;
	const helmetTexture = new CanvasTexture(helmet);
	helmetTexture.colorSpace = SRGBColorSpace;
	helmetTexture.minFilter = LinearFilter;
	helmetTexture.generateMipmaps = false;
	let displayWidth = 1;
	let displayHeight = 1;
	let displayDirty = true;
	let lastDisplayAt = 0;
	const DISPLAY_REFRESH_MS = 400;
	function drawHelmet(swir: SwirHudData, controls: XrHudControls) {
		const ctx = helmetContext;
		const { width, height } = helmet;
		ctx.clearRect(0, 0, width, height);
		const message = getMessage();
		const readings = getReadings();
		const panel = (x: number, y: number, w: number, h: number, border = '#65998c') => {
			ctx.beginPath();
			ctx.roundRect(x, y, w, h, 12);
			ctx.fillStyle = '#071714eb';
			ctx.fill();
			ctx.lineWidth = 2;
			ctx.strokeStyle = border;
			ctx.stroke();
		};

		const mapSize = 170;
		const mapX = 269;
		const mapY = 519;
		ctx.save();
		ctx.beginPath();
		ctx.arc(mapX, mapY, mapSize * MINIMAP_COMPASS_RADIUS, 0, Math.PI * 2);
		ctx.clip();
		ctx.fillStyle = '#071714eb';
		ctx.fillRect(mapX - mapSize / 2, mapY - mapSize / 2, mapSize, mapSize);
		ctx.drawImage(map, mapX - mapSize / 2, mapY - mapSize / 2, mapSize, mapSize);
		ctx.restore();
		ctx.strokeStyle = '#65998c';
		ctx.lineWidth = 2;
		ctx.stroke();
		ctx.textBaseline = 'middle';

		const readouts = message.readouts ?? [
			{ value: readings.o2Percent.toFixed(1), unit: '% O₂' },
			{ value: readings.airTempC === null ? '—' : String(Math.round(readings.airTempC)), unit: '°C' }
		];
		const statusHeight = 49 + 36 * readouts.length;
		const statusTop = 602 - statusHeight;
		panel(650, statusTop, 210, statusHeight);
		ctx.textAlign = 'right';
		ctx.font = '22px monospace';
		ctx.fillStyle = '#c6ffe5';
		ctx.fillText(getClock(), 842, statusTop + 25, 174);
		ctx.font = '26px monospace';
		readouts.forEach(({ value, unit }, index) => {
			ctx.fillText(`${value} ${unit}`, 842, statusTop + 60 + index * 36, 174);
		});

		const notice = getNotice();
		if (notice || message.title || message.detail) {
			const color = message.kind === 'danger' ? '#ffb4a1' : message.kind === 'warning' ? '#ffe0a6' : '#c6ffe5';
			const lines = [
				{ text: notice, color: '#ffe0a6', font: '22px system-ui' },
				{ text: message.title, color, font: '600 29px system-ui' },
				{ text: message.detail ?? '', color, font: '23px system-ui' }
			].filter(({ text }) => text);
			panel(168, 100, 688, 24 + lines.length * 36, color);
			ctx.textAlign = 'center';
			lines.forEach(({ text, color, font }, index) => {
				ctx.fillStyle = color;
				ctx.font = font;
				ctx.fillText(text, width / 2, 130 + index * 36, 650);
			});
		}
		for (const [index, { hand, label }] of controls.actions.entries()) {
			const y = 319 + index * 58;
			const center = width / 2;
			ctx.font = '600 26px system-ui';
			const labelWidth = Math.min(ctx.measureText(label).width, 340);
			const groupWidth = labelWidth + 144;
			const x = center - groupWidth / 2;
			panel(x, y, groupWidth, 49);
			ctx.textAlign = 'left';
			ctx.fillStyle = '#e5fff5';
			ctx.fillText(label, x + 16, y + 25, 340);
			const keyX = x + groupWidth - 112;
			ctx.fillStyle = '#23483c';
			ctx.beginPath();
			ctx.roundRect(keyX, y + 8, 102, 33, 6);
			ctx.fill();
			ctx.textAlign = 'center';
			ctx.font = '600 17px system-ui';
			ctx.fillStyle = '#e5fff5';
			ctx.fillText(hand === 'right' ? 'R TRIGGER' : 'L TRIGGER', keyX + 51, y + 25);
		}
		if (controls.voice) {
			const x = width / 2 - 61;
			const y = 471;
			panel(x, y, 122, 42);
			drawVoiceIndicator(ctx, x + 13, y + 21, controls.voice, controls.time);
			ctx.fillStyle = '#23483c';
			ctx.beginPath();
			ctx.roundRect(x + 51, y + 7, 64, 28, 6);
			ctx.fill();
			ctx.font = '600 16px system-ui';
			ctx.textAlign = 'center';
			ctx.fillStyle = '#e5fff5';
			ctx.fillText('R GRIP', x + 83, y + 21);
		}
		if (controls.showControlsHint) {
			ctx.textAlign = 'center';
			ctx.font = '500 18px system-ui';
			ctx.lineWidth = 3;
			ctx.strokeStyle = '#071714eb';
			ctx.fillStyle = '#b5dfd4';
			ctx.strokeText('A · Controls', width / 2, 568);
			ctx.fillText('A · Controls', width / 2, 568);
		}
		drawSwirHud(ctx, width, height, swir, false);
		helmetTexture.needsUpdate = true;
	}

	function drawDisplay() {
		const w = displayWidth, h = displayHeight;
		context.clearRect(0, 0, w, h);
		const edge = Math.max(40, Math.min(180, w * 0.12));
		const bottom = Math.max(30, Math.min(160, h * 0.18));
		const mapSize = Math.max(96, Math.min(154, w * 0.115));
		const mapWidth = mapSize * 1.52;
		const mapHeight = mapSize;
		const mapLeft = edge;
		const y = h - bottom - mapHeight;
		const message = getMessage();
		const readings = getReadings();

		context.save();
		context.beginPath();
		context.ellipse(mapLeft + mapWidth / 2, y + mapHeight / 2, mapWidth / 2, mapHeight / 2, 0, 0, Math.PI * 2);
		context.fillStyle = '#07130f88';
		context.fill();
		context.clip();
		context.globalAlpha = 0.7;
		context.drawImage(map, mapLeft, y, mapWidth, mapHeight);
		context.restore();

		context.save();
		context.strokeStyle = '#a4dfc8';
		context.lineWidth = 1.2;
		context.beginPath();
		context.ellipse(mapLeft + mapWidth / 2, y + mapHeight / 2, mapWidth / 2, mapHeight / 2, 0, 0, Math.PI * 2);
		context.stroke();
		context.restore();

		context.save();
		const fontSize = Math.max(22, Math.min(31, w * 0.025));
		context.fillStyle = '#c6ffe5';
		context.textAlign = 'right';
		context.font = `400 ${fontSize}px monospace`;
		const right = w - edge;
		const readouts = message.readouts ?? [
			{ value: readings.o2Percent.toFixed(1), unit: '% O₂' },
			{ value: readings.airTempC === null ? '—' : String(Math.round(readings.airTempC)), unit: '°C' }
		];
		for (const [index, readout] of readouts.entries()) {
			const lineY = h - bottom - 40 + index * 35;
			context.font = '13px monospace';
			context.fillText(readout.unit, right, lineY);
			const offset = Math.max(52, context.measureText(readout.unit).width + 10);
			context.font = `400 ${fontSize}px monospace`;
			context.fillText(readout.value, right - offset, lineY);
		}
		context.restore();

		context.save();
		context.font = '12px system-ui, sans-serif';
		context.textAlign = 'center';
		context.fillStyle = '#ffe0a6';
		const notice = getNotice();
		const textWidth = Math.min(w * 0.84, 640);
		const top = Math.max(96, h * 0.11);
		if (notice) context.fillText(notice, w / 2, top, textWidth);
		const messageY = top + (notice ? 22 : 0);
		context.fillStyle = message.kind === 'danger' ? '#ffb4a1'
			: message.kind === 'warning' ? '#ffe0a6' : '#c6ffe5';
		context.font = `500 ${w < 500 ? 15 : 19}px monospace`;
		context.fillText(message.title, w / 2, messageY, textWidth);
		if (message.detail) {
			context.font = '13px monospace';
			context.fillText(message.detail, w / 2, messageY + 21, textWidth);
		}
		context.restore();

		const swir = getSwir();
		context.save();
		drawHudTime(context, w, h - Math.max(40, h * 0.045), getClock(), swir.active);
		context.restore();
		context.save();
		drawSwirHud(context, w, h, swir, false);
		context.restore();
		displayTexture.needsUpdate = true;
	}
	const target = new WebGLRenderTarget(1, 1, {
		type: HalfFloatType,
		samples: Math.min(4, renderer.capabilities.maxSamples),
		depthTexture: new DepthTexture(1, 1)
	});
	const size = new Vector2();
	const xrTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthTexture: new DepthTexture(1, 1) });
	const worldRotation = new Quaternion();
	const inverseRotation = new Quaternion();
	const eyePosition = new Vector3();
	const eyeSun = new Vector3();
	const eyePhobos = new Vector3();
	const eyeDeimos = new Vector3();
	const material = new ShaderMaterial({
		depthTest: false,
		depthWrite: false,
		uniforms: {
			display: { value: displayTexture },
			displayPixel: { value: new Vector2(1, 1) },
			terrain: { value: target.texture },
			terrainDepth: { value: target.depthTexture },
			cameraPlanes: { value: new Vector2() },
			aspect: { value: 1 },
			sunInView: { value: new Vector2() },
			sunDirection: { value: new Vector3() },
			sunElevation: { value: 0 },
			phobosDirection: { value: new Vector3() },
			deimosDirection: { value: new Vector3() },
			moonLightDirection: { value: new Vector3() },
			phobosElevation: { value: 0 },
			deimosElevation: { value: 0 },
			phobosRadius: { value: 0 },
			deimosRadius: { value: 0 },
			viewScale: { value: new Vector2() },
			viewOffset: { value: new Vector2() },
			controls: { value: null },
			controlFromEye: { value: new Matrix4() },
			helmet: { value: helmetTexture },
			helmetScale: { value: new Vector2() },
			menuOpen: { value: false },
			immersive: { value: false },
			twilight: { value: 1 },
			daylight: { value: 1 },
			storm: { value: 0 },
			gustTime: { value: 0 },
			windMps: { value: 7.4 },
			dustColor: { value: new Color() },
			eyeRotation: { value: new Matrix4() },
			eyePosition: { value: new Vector3() },
			reflection: { value: 0 },
			cabinView: { value: false },
			swirMode: { value: 0 },
			swirTime: { value: 0 }
		},
		vertexShader: `
			varying vec2 imageUV;
			void main() {
				imageUV = uv;
				gl_Position = vec4(position.xy, 0.0, 1.0);
			}
		`,
		fragmentShader: `
			uniform sampler2D display;
			uniform vec2 displayPixel;
			uniform sampler2D terrain;
			uniform sampler2D terrainDepth;
			uniform vec2 cameraPlanes;
			uniform float aspect;
			uniform vec2 sunInView;
			uniform vec3 sunDirection;
			uniform float sunElevation;
			uniform vec3 phobosDirection;
			uniform vec3 deimosDirection;
			uniform vec3 moonLightDirection;
			uniform float phobosElevation;
			uniform float deimosElevation;
			uniform float phobosRadius;
			uniform float deimosRadius;
			uniform vec2 viewScale;
			uniform vec2 viewOffset;
			uniform sampler2D controls;
			uniform mat4 controlFromEye;
			uniform sampler2D helmet;
			uniform vec2 helmetScale;
			uniform bool menuOpen;
			uniform bool immersive;
			uniform float twilight;
			uniform float daylight;
			uniform float storm;
			uniform float gustTime;
			uniform float windMps;
			uniform vec3 dustColor;
			uniform mat4 eyeRotation;
			uniform vec3 eyePosition;
			uniform float reflection;
			uniform bool cabinView;
			uniform float swirMode;
			uniform float swirTime;
			varying vec2 imageUV;
			${SWIR_NOISE_GLSL}
			vec3 emission(vec2 uv) {
				vec4 ink = texture2D(display, uv);
				return ink.rgb * ink.a;
			}

			float dustHash(vec3 cell) {
				return fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
			}

			float dustNoise(vec3 p) {
				vec3 i = floor(p);
				vec3 f = smoothstep(0.0, 1.0, fract(p));
				float a = mix(dustHash(i), dustHash(i + vec3(1,0,0)), f.x);
				float b = mix(dustHash(i + vec3(0,1,0)), dustHash(i + vec3(1,1,0)), f.x);
				float c = mix(dustHash(i + vec3(0,0,1)), dustHash(i + vec3(1,0,1)), f.x);
				float d = mix(dustHash(i + vec3(0,1,1)), dustHash(i + vec3(1,1,1)), f.x);
				return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
			}

			vec3 scatterDust(vec3 background, vec3 ray, vec3 direction, vec2 uv, float sunAngle) {
				float depth = texture2D(terrainDepth, uv).r;
				float near = cameraPlanes.x;
				float far = cameraPlanes.y;
				float distance = near * far / mix(far, near, depth) / -ray.z;
				float extent = min(distance, 125.0);
				vec3 wind = vec3(0.94, 0.0, 0.34) * windMps * gustTime;
				float glare = pow(max(0.0, sunAngle), 10.0) * twilight;
				float transmission = 1.0;
				float scattered = 0.0;
				for (int i = 0; i < 8; i++) {
					float start = float(i) / 8.0;
					float end = float(i + 1) / 8.0;
					float stepLength = extent * (end * end - start * start);
					float t = extent * start * start + stepLength * 0.5;
					vec3 position = eyePosition + direction * t;
					vec3 advected = position - wind;
					float height = max(0.0, 1.68 + direction.y * t);
					float groundLayer = exp(-height * 0.62);
					float bank = dustNoise(advected * vec3(0.048, 0.15, 0.085));
					float streak = dustNoise(advected * vec3(0.19, 1.45, 0.47));
					float gust = smoothstep(0.28, 0.76, bank * 0.76 + streak * 0.24);
					float density = 0.004 + 0.022 * bank
						+ groundLayer * (0.004 + 0.13 * gust * gust);
					float opacity = 1.0 - exp(-density * stepLength);
					float light = 0.60 + 0.47 * bank + 0.22 * glare + 0.28 * groundLayer * streak;
					scattered += transmission * opacity * light;
					transmission *= 1.0 - opacity;
				}
				return dustColor * scattered + background * transmission;
			}

			vec3 drawMoon(vec3 background, vec3 ray, vec3 direction, vec3 lightDirection,
				float angularRadius, float elevation, float visibility) {
				float angle = acos(clamp(dot(ray, direction), -1.0, 1.0));
				float edge = max(fwidth(angle), 0.00004);
				float disc = 1.0 - smoothstep(angularRadius - edge, angularRadius + edge, angle);
				vec3 tangent = cross(direction, vec3(0.0, 1.0, 0.0));
				if (dot(tangent, tangent) < 0.0001) tangent = cross(direction, vec3(1.0, 0.0, 0.0));
				tangent = normalize(tangent);
				vec3 bitangent = normalize(cross(direction, tangent));
				vec3 offset = ray - direction * dot(ray, direction);
				float radius = max(angularRadius, 0.000001);
				vec2 point = vec2(dot(offset, tangent), dot(offset, bitangent)) / radius;
				float r2 = dot(point, point);
				vec3 normal = direction * sqrt(max(0.0, 1.0 - r2))
					+ tangent * point.x + bitangent * point.y;
				float phase = max(0.0, dot(normal, lightDirection));
				float aboveHorizon = smoothstep(-0.006, 0.002, elevation);
				vec3 moon = vec3(0.56, 0.48, 0.39) * (0.14 + phase * 0.86);
				return mix(background, moon, disc * aboveHorizon * visibility);
			}

			float visorRim(vec2 p) {
				// One continuous oval: no joined brow/cheek curves or squared corners.
				// A slightly fuller ellipse preserves peripheral vision on wide screens.
				vec2 aperture = vec2(1.025, 0.965);
				vec2 oval = abs((p - vec2(0.0, 0.008)) / aperture);
				float exponent = 2.4;
				float radius = pow(pow(oval.x, exponent) + pow(oval.y, exponent), 1.0 / exponent);
				// Normalize the implicit curve gradient for a consistent gasket thickness.
				vec2 gradient = pow(max(oval, vec2(0.0001)), vec2(exponent - 1.0))
					* pow(max(radius, 0.0001), 1.0 - exponent) / aperture;
				return (radius - 1.0) / max(length(gradient / vec2(aspect, 1.0)), 0.001);
			}

			void main() {
				vec2 p = imageUV * 2.0 - 1.0;
				float rim = cabinView ? 0.0 : visorRim(p);
				float padding = cabinView ? 0.0 : smoothstep(-0.012, 0.014, rim);
				vec2 lens = p * vec2(1.0, 0.87);
				float r2 = dot(lens, lens) / 1.7569;

				// Inverse radial mapping. Preserve central scale and compress peripheral rays.
				vec2 sampleUV = immersive ? imageUV : 0.5 + 0.5 * p * (0.965 + 0.034 * r2);
				vec4 world = texture2D(terrain, sampleUV);
				vec3 sceneColor = world.rgb / max(world.a, 0.001);
				vec3 ray = normalize(vec3((sampleUV * 2.0 - 1.0) * viewScale + viewOffset, -1.0));

				vec3 worldRay = (eyeRotation * vec4(ray, 0.0)).xyz;
				float skyHeight = smoothstep(0.0, 0.55, normalize(worldRay).y);
				vec3 horizon = vec3(0.60, 0.39, 0.25);
				vec3 zenith = vec3(0.32, 0.21, 0.17);
				vec3 duskHorizon = vec3(0.38, 0.20, 0.16);
				vec3 duskZenith = vec3(0.055, 0.073, 0.12);
				vec3 daySky = mix(horizon, zenith, skyHeight);
				vec3 twilightSky = mix(duskHorizon, duskZenith, skyHeight);
				float sunAngle = dot(ray, sunDirection);
				float solarVisibility = smoothstep(-0.0032, -0.0020, sunElevation);
				float sunDisc = smoothstep(0.9999932, 0.9999969, sunAngle) * solarVisibility;
				float sunHalo = exp(-acos(clamp(sunAngle, -1.0, 1.0)) * 34.0) * solarVisibility;
				vec3 sky = mix(vec3(0.008, 0.012, 0.024), mix(twilightSky, daySky, daylight), twilight);
				// Fine airborne dust forward-scatters blue light into a compact halo around the Sun.
				sky += vec3(0.035, 0.075, 0.18) * sunHalo * (1.0 - daylight) * (1.0 - storm);
				vec3 solarDisk = mix(vec3(1.0, 0.55, 0.30), vec3(1.0, 0.88, 0.66), daylight);
				sky = mix(sky, solarDisk * (1.0 - 0.82 * storm), sunDisc * (1.0 - 0.82 * storm));
				sky = mix(sky, dustColor * (0.74 + 0.26 * twilight
					+ 0.20 * twilight * pow(max(0.0, sunAngle), 12.0)), storm);
				if (swirMode > 0.5) sky = vec3(dot(sky, vec3(0.2126, 0.7152, 0.0722)) * 0.55);
				vec3 transmitted = mix(sky, sceneColor, world.a);
				// The opaque gasket will replace these pixels in the final composite.
				if (storm > 0.0 && swirMode < 0.5 && padding < 1.0) {
					transmitted = mix(transmitted, scatterDust(transmitted, ray, worldRay, sampleUV, sunAngle), storm);
				}
				float skyPixel = 1.0 - world.a;
				float moonVisibility = (1.0 - 0.78 * daylight) * (1.0 - 0.55 * storm);
				transmitted = drawMoon(transmitted, ray, phobosDirection, moonLightDirection,
					phobosRadius, phobosElevation, moonVisibility * skyPixel);
				transmitted = drawMoon(transmitted, ray, deimosDirection, moonLightDirection,
					deimosRadius, deimosElevation, moonVisibility * skyPixel);
				if (swirMode > 0.5) {
					float signal = dot(transmitted, vec3(0.2126, 0.7152, 0.0722));
					float shadowGain = 1.0 - smoothstep(0.025, 0.48, signal);
					float readout = (swirSensorNoise(gl_FragCoord.xy, swirTime) - 0.5) * 0.03 * shadowGain;
					transmitted = vec3(max(0.0, signal + readout));
				}
				// Smoked bronze solar filter. Longer oblique paths absorb more light;
				// the interior HUD is added afterward, so it stays luminous and readable.
				float opticalPath = inversesqrt(max(0.42, 1.0 - 0.55 * r2));
				vec3 solarTransmission = mix(exp(-vec3(0.48, 0.57, 0.72) * opticalPath),
					vec3(exp(-0.57 * opticalPath)), swirMode);
				transmitted *= solarTransmission;
				transmitted *= 1.0 - 0.10 * smoothstep(0.35, 1.0, r2);

				if (!cabinView) {
					// A broad reflection catches the upper shoulder of the glass as the head turns.
					vec2 glass = (p - sunInView) * vec2(clamp(aspect, 0.85, 1.9), 1.0);
					float flare = exp(-dot(glass, glass) * 2.1) * reflection;
					float grazing = 0.18 + 0.82 * smoothstep(0.18, 1.0, r2);
					float arcY = 1.13 - 0.40 * (p.x + 0.16) * (p.x + 0.16);
					float arc = exp(-pow((p.y - arcY) / 0.14, 2.0));
					float sideLight = smoothstep(0.05, 0.98, abs(p.x)) * smoothstep(-0.65, 0.9, p.y);
					vec3 coatedGlass = mix(vec3(0.54, 0.38, 0.23), vec3(0.24), swirMode);
					transmitted += coatedGlass * (flare * grazing * 0.55
						+ arc * sideLight * (0.06 + reflection * 0.5));
					// Inner-surface projection: continuous barrel curvature, not tilted HTML cards.
					vec2 hudUV = 0.5 + 0.5 * p * (1.0 + 0.085 * r2);
					hudUV.y += 0.022 * p.x * p.x;
					vec3 ink = immersive ? vec3(0.0) : emission(hudUV);
					// Faint displaced reflection from the second surface of the laminated visor.
					vec3 ghost = vec3(0.0);
					if (!immersive && swirMode < 0.5 && reflection > 0.001) ghost = emission(hudUV + displayPixel * vec2(2.4, -1.6));
					float coupling = 0.78 - 0.18 * smoothstep(0.35, 1.0, r2);
					transmitted += (ink * 0.72 + ghost * 0.045) * coupling;
					float innerShadow = exp(-max(-rim, 0.0) * 33.0);
					transmitted *= 1.0 - 0.28 * innerShadow;
					float lip = exp(-pow((rim - 0.015) / 0.010, 2.0));
					float groove = exp(-pow((rim - 0.037) / 0.008, 2.0));
					float rubber = exp(-pow((rim - 0.057) / 0.031, 2.0));
					float light = 0.44 + 0.56 * exp(-abs(p.x - sunInView.x) * 1.6);
					light *= mix(0.7, 1.0, smoothstep(-1.0, 1.0, p.y));
					vec3 lining = vec3(0.012, 0.011, 0.010);
					lining += light * (vec3(0.082, 0.066, 0.052) * lip
						+ vec3(0.029, 0.025, 0.019) * rubber);
					lining *= 1.0 - 0.48 * groove;
					transmitted = mix(transmitted, lining, padding);
				}
				if (immersive) {
					vec3 point = controlFromEye[3].xyz;
					vec3 direction = mat3(controlFromEye) * ray;
					if (direction.z < -0.0001 && point.z > 0.0) {
						vec2 hit = point.xy - direction.xy * point.z / direction.z;
						vec2 helmetUV = hit * helmetScale + 0.5;
						if (!menuOpen && all(greaterThanEqual(helmetUV, vec2(0.0))) && all(lessThanEqual(helmetUV, vec2(1.0)))) {
							vec4 hud = texture2D(helmet, helmetUV);
							transmitted = mix(transmitted, hud.rgb, hud.a);
						}
						vec2 uv = hit + 0.5;
						if (menuOpen && all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
							vec4 ui = texture2D(controls, uv);
							transmitted = mix(transmitted, ui.rgb, ui.a);
						}
					}
				}
				gl_FragColor = vec4(transmitted, 1.0);
				#include <colorspace_fragment>
			}
		`
	});
	const screen = new FullScreenQuad(material);
	const savedViewport = new Vector4();
	const eyeScale = new Vector3();
	const renderEye = new PerspectiveCamera();
	renderEye.matrixAutoUpdate = false;
	const controlMatrix = new Matrix4();

	function setView(camera: PerspectiveCamera, sun: Vector3, sunElevation: number,
		phobos: Vector3, phobosElevation: number, phobosRadius: number,
		deimos: Vector3, deimosElevation: number, deimosRadius: number,
		twilight: number, daylight: number, storm: number, gustTime: number, swir: boolean, windMps: number) {
		material.uniforms.sunDirection.value.copy(sun);
		material.uniforms.sunElevation.value = sunElevation;
		material.uniforms.phobosDirection.value.copy(phobos);
		material.uniforms.deimosDirection.value.copy(deimos);
		material.uniforms.moonLightDirection.value.copy(sun);
		material.uniforms.phobosElevation.value = phobosElevation;
		material.uniforms.deimosElevation.value = deimosElevation;
		material.uniforms.phobosRadius.value = Math.max(phobosRadius, 0.00065);
		// Deimos is sub-pixel in many VR views; this display floor keeps its point visible.
		material.uniforms.deimosRadius.value = Math.max(deimosRadius, 0.00065);
		material.uniforms.sunInView.value.set(Math.max(-1.1, Math.min(1.1, sun.x * 1.4)), 0.99);
		material.uniforms.twilight.value = twilight;
		material.uniforms.daylight.value = daylight;
		material.uniforms.storm.value = storm;
		material.uniforms.swirMode.value = Number(swir);
		material.uniforms.swirTime.value = performance.now() / 1000;
		material.uniforms.windMps.value = windMps;
		material.uniforms.cameraPlanes.value.set(camera.near, camera.far);
		material.uniforms.eyeRotation.value.makeRotationFromQuaternion(worldRotation);
		if (storm > 0) {
			material.uniforms.gustTime.value = gustTime;
			if (swir) material.uniforms.dustColor.value.set('#777777');
			else dustColor(material.uniforms.dustColor.value, twilight, daylight);
			material.uniforms.eyePosition.value.copy(eyePosition);
		}
		material.uniforms.reflection.value = twilight * (0.065 + 0.26 * Math.max(-sun.z, 0))
			* (1 - 0.85 * storm);
	}

	return {
		resize(width: number, height: number) {
			displayWidth = width;
			displayHeight = height;
			const ratio = Math.min(renderer.getPixelRatio(), 2);
			display.width = Math.round(width * ratio);
			display.height = Math.round(height * ratio);
			context.setTransform(ratio, 0, 0, ratio, 0, 0);
			material.uniforms.displayPixel.value.set(1 / width, 1 / height);
			renderer.getDrawingBufferSize(size);
			target.setSize(size.x, size.y);
			material.uniforms.aspect.value = width / height;
			displayDirty = true;
		},
		invalidate() {
			displayDirty = true;
		},
		render(scene: Scene, camera: PerspectiveCamera, sun: Vector3, sunElevation: number,
		phobos: Vector3, phobosElevation: number, phobosRadius: number,
		deimos: Vector3, deimosElevation: number, deimosRadius: number,
		twilight: number, daylight: number, storm: number, gustTime: number, swir = false, windMps = 7.4, cabinView = false) {
			material.uniforms.cabinView.value = cabinView;
			if (!cabinView) {
				const displayNow = performance.now();
				if (displayDirty || displayNow - lastDisplayAt >= DISPLAY_REFRESH_MS) {
					drawDisplay();
					displayDirty = false;
					lastDisplayAt = displayNow;
				}
			}
			material.uniforms.viewOffset.value.set(0, 0);
			const height = Math.tan(camera.fov * Math.PI / 360);
			material.uniforms.viewScale.value.set(height * camera.aspect, height);
			camera.getWorldQuaternion(worldRotation);
			camera.getWorldPosition(eyePosition);
			setView(camera, sun, sunElevation, phobos, phobosElevation, phobosRadius, deimos, deimosElevation,
				deimosRadius, twilight, daylight, storm, gustTime, swir, windMps);
			renderer.setRenderTarget(target);
			renderer.render(scene, camera);
			renderer.setRenderTarget(null);
			screen.render(renderer);
		},
		updateXrHud(swir: SwirHudData, controls: XrHudControls) {
			drawHelmet(swir, controls);
		},
		renderXr(scene: Scene, camera: PerspectiveCamera, controlPlane: Object3D, controlTexture: CanvasTexture, menuOpen: boolean,
			sun: Vector3, phobos: Vector3, phobosRadius: number, deimos: Vector3, deimosRadius: number,
			twilight: number, daylight: number, storm: number, gustTime: number, swir: boolean, windMps: number, cabinView: boolean) {
			// The XR manager binds the compositor framebuffer before running this callback.
			const output = renderer.getRenderTarget();
			if (!output) return;
			renderer.xr.updateCamera(camera);
			const eyes = renderer.xr.getCamera().cameras;
			controlMatrix.copy(controlPlane.matrixWorld).invert();
			// Map the same stereo intersection onto a fixed-size, headset-relative display.
			material.uniforms.helmetScale.value.set(controlPlane.scale.x / 1.9, controlPlane.scale.y / 1.425);
			material.uniforms.menuOpen.value = menuOpen;
			const autoClear = renderer.autoClear;
			const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
			renderer.xr.enabled = false;
			material.uniforms.immersive.value = true;
			material.uniforms.cabinView.value = cabinView;
			material.uniforms.controls.value = controlTexture;
			try {
				for (const [index, eye] of eyes.entries()) {
					const { x, y, z: width, w: height } = eye.viewport;
					xrTarget.setSize(width, height);
					material.uniforms.displayPixel.value.set(1 / width, 1 / height);
					material.uniforms.aspect.value = width / height;
					const projection = eye.projectionMatrix.elements;
					material.uniforms.viewScale.value.set(1 / projection[0], 1 / projection[5]);
					material.uniforms.viewOffset.value.set(projection[8] / projection[0], projection[9] / projection[5]);
					material.uniforms.controlFromEye.value.multiplyMatrices(controlMatrix, eye.matrixWorld);
					eye.matrixWorld.decompose(eyePosition, worldRotation, eyeScale);
					inverseRotation.copy(worldRotation).invert();
					setView(camera, eyeSun.copy(sun).applyQuaternion(inverseRotation), Math.asin(sun.y),
						eyePhobos.copy(phobos).applyQuaternion(inverseRotation), phobos.y, phobosRadius,
						eyeDeimos.copy(deimos).applyQuaternion(inverseRotation), deimos.y, deimosRadius,
						twilight, daylight, storm, gustTime, swir, windMps);
					renderer.shadowMap.autoUpdate = shadowAutoUpdate && index === 0;
					renderer.autoClear = true;
					renderer.setRenderTarget(xrTarget);
					renderEye.matrix.copy(eye.matrixWorld);
					renderEye.matrixWorldNeedsUpdate = true;
					renderEye.projectionMatrix.copy(eye.projectionMatrix);
					renderEye.projectionMatrixInverse.copy(eye.projectionMatrixInverse);
					renderEye.layers.mask = eye.layers.mask;
					renderer.render(scene, renderEye);
					renderer.autoClear = false;
					const previousViewport = savedViewport.copy(output.viewport);
					output.viewport.set(x, y, width, height);
					renderer.setRenderTarget(output);
					output.viewport.copy(previousViewport);
					material.uniforms.terrain.value = xrTarget.texture;
					material.uniforms.terrainDepth.value = xrTarget.depthTexture;
					screen.render(renderer);
				}
			} finally {
				renderer.setRenderTarget(output);
				renderer.xr.enabled = true;
				renderer.autoClear = autoClear;
				renderer.shadowMap.autoUpdate = shadowAutoUpdate;
				material.uniforms.immersive.value = false;
				material.uniforms.terrain.value = target.texture;
				material.uniforms.terrainDepth.value = target.depthTexture;
			}
		},
		dispose() {
			xrTarget.dispose();
			helmetTexture.dispose();
			displayTexture.dispose();
			screen.dispose();
			material.dispose();
			target.dispose();
		}
	};
}
