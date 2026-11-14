import {
	CanvasTexture, Color, DepthTexture, LinearFilter, HalfFloatType, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, ShaderMaterial,
	SRGBColorSpace,
	Vector2, Vector3, WebGLRenderTarget,
	type Camera, type PerspectiveCamera, type Scene, type WebGLRenderer
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const stormNight = new Color('#101017');
const stormDusk = new Color('#67402f');
const stormDay = new Color('#a67755');

export function dustColor(color: Color, twilight: number, daylight: number) {
	return color.copy(stormNight).lerp(stormDusk, twilight).lerp(stormDay, daylight);
}

export interface VisorMessage {
	title: string;
	detail?: string;
	kind?: 'warning' | 'danger';
}

export interface SwirHudData {
	active: boolean;
	stormActive: boolean;
	tauVisible: number | null;
	visibilityVisibleM: number;
	visibilitySwirM: number;
	windMps: number | null;
	windDirection: string;
	distanceM?: number | null;
	albedo?: number | null;
	surface?: string;
}

export const SWIR_DUST_TRANSMISSION = 0.15;
export const SWIR_STORM_VISIBLE_TAU = 4.2;
export const SWIR_STORM_VISIBLE_RANGE_M = 4.5;
export const SWIR_STORM_RANGE_M = 165;

export function swirTauFromVisible(tauVisible: number) {
	return tauVisible * SWIR_DUST_TRANSMISSION;
}

export function swirVisibilityForStorm(intensity: number) {
	const level = Math.max(0, Math.min(1, intensity));
	return 10_000 + (SWIR_STORM_RANGE_M - 10_000) * level;
}

export function visibleRangeForStorm(intensity: number) {
	const level = Math.max(0, Math.min(1, intensity));
	return 10_000 + (SWIR_STORM_VISIBLE_RANGE_M - 10_000) * level;
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

export function drawSwirHud(context: CanvasRenderingContext2D, width: number, height: number, data: SwirHudData) {
	if (!data.active) return;
	const pad = Math.max(10, width * 0.035);
	const font = Math.max(10, Math.min(20, width * 0.018));
	const line = font * 1.35;
	context.save();
	context.font = `500 ${font}px ui-monospace, monospace`;
	context.textBaseline = 'top';
	context.lineWidth = Math.max(2, font * 0.18);
	context.strokeStyle = 'rgba(0,0,0,.6)';
	context.fillStyle = 'rgba(255,255,255,.8)';
	const text = (value: string, x: number, y: number, align: CanvasTextAlign = 'left') => {
		context.textAlign = align;
		context.strokeText(value, x, y);
		context.fillText(value, x, y);
	};
	text('SENSOR: InGaAs SWIR-1', pad, pad);
	text('WAVELENGTH: λ = 1.65 µm (1650 nm)', pad, pad + line);
	text('AGC GAIN: AUTO (+12 dB)', pad, pad + line * 2);
	text('SIMULATION · NOT MEASURED SPECTRA', pad, pad + line * 3);
	const tau = data.tauVisible;
	const right = width - pad;
	text(`STORM STATUS: ${data.stormActive ? 'ACTIVE DUST EVENT' : 'CLEAR'}`, right, pad, 'right');
	text(`OPTICAL DEPTH (τ): VIS ${tau === null ? '—' : tau.toFixed(2)} → SWIR ${tau === null ? '—' : swirTauFromVisible(tau).toFixed(2)}`,
		right, pad + line, 'right');
	text(`VISIBILITY: ${Math.round(data.visibilitySwirM)} m SWIR (VIS ${Math.round(data.visibilityVisibleM)} m)`,
		right, pad + line * 2, 'right');
	text(`WIND VECTOR: ${data.windMps === null ? '—' : data.windMps.toFixed(1)} m/s ${data.windDirection}`,
		right, pad + line * 3, 'right');
	const cx = width / 2, cy = height / 2, arm = Math.max(4, font * 0.38);
	context.beginPath();
	context.moveTo(cx - arm, cy); context.lineTo(cx + arm, cy);
	context.moveTo(cx, cy - arm); context.lineTo(cx, cy + arm);
	context.strokeStyle = 'rgba(0,0,0,.6)'; context.lineWidth = Math.max(3, font * 0.25); context.stroke();
	context.strokeStyle = 'rgba(255,255,255,.8)'; context.lineWidth = Math.max(1, font * 0.08); context.stroke();
	const distance = data.distanceM === null || data.distanceM === undefined ? '—' : `${data.distanceM.toFixed(1)} m`;
	const albedo = data.albedo === null || data.albedo === undefined ? '—' : data.albedo.toFixed(2);
	text(`DIST: ${distance}`, cx, cy + arm + 5, 'center');
	text(`SWIR ALBEDO: ${albedo}${data.surface ? ` [${data.surface}]` : ''}`, cx, cy + arm + 5 + line, 'center');
	context.restore();
}

export function mountHeadLockedHud(camera: Camera) {
	const canvas = document.createElement('canvas');
	canvas.width = 1024;
	canvas.height = 512;
	const context = canvas.getContext('2d')!;
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	texture.anisotropy = 4;
	const geometry = new PlaneGeometry(1.7, 0.85);
	const material = new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false,
		fog: false, toneMapped: false });
	const plane = new Mesh(geometry, material);
	plane.position.set(0, -0.04, -1.8);
	plane.renderOrder = 999;
	camera.add(plane);
	return {
		canvas,
		context,
		redraw(paint: (context: CanvasRenderingContext2D, width: number, height: number) => void) {
			context.clearRect(0, 0, canvas.width, canvas.height);
			paint(context, canvas.width, canvas.height);
			texture.needsUpdate = true;
		},
		dispose() {
			camera.remove(plane);
			geometry.dispose();
			material.dispose();
			texture.dispose();
		}
	};
}

export function buildVisorOptics(renderer: WebGLRenderer, map: HTMLCanvasElement,
	getNotice: () => string, getClock: () => string, getMessage: () => VisorMessage, getSwir: () => SwirHudData) {
	// A single emissive image is sampled through the curved inner visor, before the gasket.
	const display = document.createElement('canvas');
	const context = display.getContext('2d')!;
	const displayTexture = new CanvasTexture(display);
	displayTexture.minFilter = LinearFilter;
	displayTexture.generateMipmaps = false;
	let displayWidth = 1;
	let displayHeight = 1;
	function drawDisplay() {
		const w = displayWidth, h = displayHeight;
		context.clearRect(0, 0, w, h);
		const edge = Math.max(40, Math.min(180, w * 0.12));
		const bottom = Math.max(30, Math.min(160, h * 0.18));
		const mapSize = Math.max(80, Math.min(128, w * 0.095));
		const mapLeft = edge;
		const y = h - bottom - mapSize;
		context.globalAlpha = 0.7;
		context.drawImage(map, mapLeft, y, mapSize, mapSize);
		context.globalAlpha = 1;
		context.strokeStyle = '#a4dfc8';
		context.lineWidth = 0.8;
		// Open registration corners keep the map on the glass without a panel backing.
		for (const [x, yy, dx, dy] of [[mapLeft, y, 1, 1], [mapLeft + mapSize, y, -1, 1],
			[mapLeft, y + mapSize, 1, -1], [mapLeft + mapSize, y + mapSize, -1, -1]]) {
			context.beginPath(); context.moveTo(x, yy + dy * 9);
			context.lineTo(x, yy); context.lineTo(x + dx * 9, yy); context.stroke();
		}
		const fontSize = Math.max(22, Math.min(31, w * 0.025));
		context.fillStyle = '#c6ffe5';
		context.textAlign = 'right';
		context.font = `400 ${fontSize}px monospace`;
		const right = w - edge;
		context.fillText('96', right - 52, h - bottom - 40);
		context.fillText('−63', right - 52, h - bottom - 5);
		context.font = '13px monospace';
		context.fillText('% O₂', right, h - bottom - 40);
		context.fillText('°C', right, h - bottom - 5);
		context.font = '12px system-ui, sans-serif';
		context.textAlign = 'center';
		context.fillStyle = '#ffe0a6';
		const notice = getNotice();
		const message = getMessage();
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
		context.fillStyle = '#c6ffe5';
		context.font = '14px monospace';
		context.fillText(getClock(), w / 2, h - Math.max(40, h * 0.045), textWidth);
		drawSwirHud(context, w, h, getSwir());
		displayTexture.needsUpdate = true;
	}
	const target = new WebGLRenderTarget(1, 1, {
		type: HalfFloatType,
		samples: Math.min(4, renderer.capabilities.maxSamples),
		depthTexture: new DepthTexture(1, 1)
	});
	const size = new Vector2();
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
			viewScale: { value: new Vector2() },
			twilight: { value: 1 },
			daylight: { value: 1 },
			storm: { value: 0 },
			gustTime: { value: 0 },
			windMps: { value: 7.4 },
			dustColor: { value: new Color() },
			eyeRotation: { value: new Matrix4() },
			eyePosition: { value: new Vector3() },
			reflection: { value: 0 },
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
			uniform vec2 viewScale;
			uniform float twilight;
			uniform float daylight;
			uniform float storm;
			uniform float gustTime;
			uniform float windMps;
			uniform vec3 dustColor;
			uniform mat4 eyeRotation;
			uniform vec3 eyePosition;
			uniform float reflection;
			uniform float swirMode;
			uniform float swirTime;
			varying vec2 imageUV;
			${SWIR_NOISE_GLSL}
			${SWIR_DEPTH_RESPONSE_GLSL}
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

			vec3 scatterDust(vec3 background, vec3 ray, vec2 uv, float sunAngle) {
				float depth = texture2D(terrainDepth, uv).r;
				float near = cameraPlanes.x;
				float far = cameraPlanes.y;
				float distance = near * far / mix(far, near, depth) / -ray.z;
				float extent = min(distance, 125.0);
				vec3 direction = (eyeRotation * vec4(ray, 0.0)).xyz;
				vec3 wind = vec3(0.94, 0.0, 0.34) * windMps * gustTime;
				float glare = pow(max(0.0, sunAngle), 10.0) * twilight;
				float transmission = 1.0;
				vec3 scattered = vec3(0.0);
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
					vec3 litDust = dustColor * (0.60 + 0.47 * bank + 0.22 * glare
						+ 0.28 * groundLayer * streak);
					scattered += transmission * opacity * litDust;
					transmission *= 1.0 - opacity;
				}
				return scattered + background * transmission;
			}

			void main() {
				vec2 p = imageUV * 2.0 - 1.0;
				vec2 lens = p * vec2(1.0, 0.87);
				float r2 = dot(lens, lens) / 1.7569;

				// Inverse radial mapping. Preserve central scale and compress peripheral rays.
				vec2 sampleUV = 0.5 + 0.5 * p * (0.965 + 0.034 * r2);
				vec2 dispersion = p * r2 * 0.00075;
				vec4 world = texture2D(terrain, sampleUV);
				vec3 sceneColor = world.rgb / max(world.a, 0.001);
				vec4 red = texture2D(terrain, sampleUV + dispersion);
				vec4 blue = texture2D(terrain, sampleUV - dispersion);
				sceneColor.r = mix(sceneColor.r, red.r / max(red.a, 0.001), red.a);
				sceneColor.b = mix(sceneColor.b, blue.b / max(blue.a, 0.001), blue.a);
				vec3 ray = normalize(vec3((sampleUV * 2.0 - 1.0) * viewScale, -1.0));
				float depth = texture2D(terrainDepth, sampleUV).r;
				float sceneDistance = cameraPlanes.x * cameraPlanes.y
					/ max(mix(cameraPlanes.y, cameraPlanes.x, depth), 0.0001) / max(-ray.z, 0.1);
				if (world.a < 0.01) sceneDistance = cameraPlanes.y;
				if (swirMode > 0.5 && world.a > 0.01) {
					vec2 offset = displayPixel * 1.6;
					vec4 n0 = texture2D(terrain, clamp(sampleUV + vec2(offset.x, 0.0), 0.0, 1.0));
					vec4 n1 = texture2D(terrain, clamp(sampleUV - vec2(offset.x, 0.0), 0.0, 1.0));
					vec4 n2 = texture2D(terrain, clamp(sampleUV + vec2(0.0, offset.y), 0.0, 1.0));
					vec4 n3 = texture2D(terrain, clamp(sampleUV - vec2(0.0, offset.y), 0.0, 1.0));
					vec3 localAverage = (n0.rgb / max(n0.a, 0.001) + n1.rgb / max(n1.a, 0.001)
						+ n2.rgb / max(n2.a, 0.001) + n3.rgb / max(n3.a, 0.001)) * 0.25;
					float foreground = swirNearSharpness(sceneDistance);
					float midFalloff = swirMidHaze(sceneDistance);
					float farBlur = swirFarBlur(sceneDistance);
					sceneColor += (sceneColor - localAverage) * 0.16 * foreground;
					sceneColor = mix(sceneColor, localAverage, midFalloff * 0.18 + farBlur * 0.64);
					float gray = dot(sceneColor, vec3(0.2126, 0.7152, 0.0722));
					sceneColor = vec3(mix(gray, 0.42, farBlur * 0.76));
				}

				float skyHeight = smoothstep(0.34, 0.90, sampleUV.y);
				vec3 horizon = vec3(0.60, 0.39, 0.25);
				vec3 zenith = vec3(0.32, 0.21, 0.17);

				vec3 sky = mix(horizon, zenith, skyHeight);
				float sunAngle = dot(ray, sunDirection);
				vec3 dusk = mix(vec3(0.20, 0.082, 0.047), vec3(0.18, 0.27, 0.42),
					smoothstep(0.94, 1.0, sunAngle));
				sky = mix(vec3(0.008, 0.012, 0.024), mix(dusk, sky, daylight), twilight);
				sky += (1.0 - storm) * vec3(1.0, 0.89, 0.72) * 2.0 * smoothstep(0.999978, 0.999987, sunAngle);
				sky = mix(sky, dustColor * (0.74 + 0.26 * twilight
					+ 0.20 * twilight * pow(max(0.0, sunAngle), 12.0)), storm);
				if (swirMode > 0.5) sky = vec3(dot(sky, vec3(0.2126, 0.7152, 0.0722)) * 0.55);
				vec3 transmitted = mix(sky, sceneColor, world.a);
				if (storm > 0.0) {
					transmitted = mix(transmitted, scatterDust(transmitted, ray, sampleUV, sunAngle), storm);
				}
				if (swirMode > 0.5) {
					float signal = dot(transmitted, vec3(0.2126, 0.7152, 0.0722));
					float shadowGain = 1.0 - smoothstep(0.025, 0.48, signal);
					float readout = (swirSensorNoise(gl_FragCoord.xy, swirTime) - 0.5) * 0.045 * shadowGain;
					transmitted = vec3(max(0.0, signal + readout));
				}
				// Smoked bronze solar filter. Longer oblique paths absorb more light;
				// the interior HUD is added afterward, so it stays luminous and readable.
				float opticalPath = inversesqrt(max(0.42, 1.0 - 0.55 * r2));
				vec3 solarTransmission = mix(exp(-vec3(0.48, 0.57, 0.72) * opticalPath),
					vec3(exp(-0.57 * opticalPath)), swirMode);
				transmitted *= solarTransmission;
				transmitted *= 1.0 - 0.10 * smoothstep(0.35, 1.0, r2);

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
				vec3 ink = emission(hudUV);
				vec2 spread = displayPixel * 1.25;
				vec3 bloom = (emission(hudUV + vec2(spread.x, 0.0))
					+ emission(hudUV - vec2(spread.x, 0.0))
					+ emission(hudUV + vec2(0.0, spread.y))
					+ emission(hudUV - vec2(0.0, spread.y))) * 0.25;
				// Faint displaced reflection from the second surface of the laminated visor.
				vec3 ghost = emission(hudUV + displayPixel * vec2(2.4, -1.6));
				float coupling = 0.78 - 0.18 * smoothstep(0.35, 1.0, r2);
				transmitted += (ink * 0.72 + bloom * 0.13 + ghost * 0.045) * coupling;
				// One continuous oval: no joined brow/cheek curves or squared corners.
				// A slightly fuller ellipse preserves peripheral vision on wide screens.
				vec2 aperture = vec2(1.025, 0.965);
				vec2 oval = abs((p - vec2(0.0, 0.008)) / aperture);
				float exponent = 2.4;
				float radius = pow(pow(oval.x, exponent) + pow(oval.y, exponent), 1.0 / exponent);
				// Normalize the implicit curve gradient for a consistent gasket thickness.
				vec2 gradient = pow(max(oval, vec2(0.0001)), vec2(exponent - 1.0))
					* pow(max(radius, 0.0001), 1.0 - exponent) / aperture;
				float rim = (radius - 1.0) / max(length(gradient / vec2(aspect, 1.0)), 0.001);
				float padding = smoothstep(-0.012, 0.014, rim);
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
				gl_FragColor = vec4(transmitted, 1.0);
				#include <colorspace_fragment>
			}
		`
	});
	const screen = new FullScreenQuad(material);

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
		},
	render(scene: Scene, camera: PerspectiveCamera, sun: Vector3, twilight: number, daylight: number,
			storm: number, gustTime: number, swir = false, windMps = 7.4) {
			drawDisplay();
			const height = Math.tan(camera.fov * Math.PI / 360);
			material.uniforms.viewScale.value.set(height * camera.aspect, height);
			material.uniforms.sunDirection.value.copy(sun);
			material.uniforms.sunInView.value.set(Math.max(-1.1, Math.min(1.1, sun.x * 1.4)), 0.99);
			material.uniforms.twilight.value = twilight;
			material.uniforms.daylight.value = daylight;
			material.uniforms.storm.value = storm;
			material.uniforms.swirMode.value = Number(swir);
			material.uniforms.swirTime.value = performance.now() / 1000;
			material.uniforms.windMps.value = windMps;
			material.uniforms.cameraPlanes.value.set(camera.near, camera.far);
			if (storm > 0) {
				material.uniforms.gustTime.value = gustTime;
				if (swir) material.uniforms.dustColor.value.set('#777777');
				else dustColor(material.uniforms.dustColor.value, twilight, daylight);
				material.uniforms.eyeRotation.value.makeRotationFromQuaternion(camera.quaternion);
				material.uniforms.eyePosition.value.copy(camera.position);
			}
			material.uniforms.reflection.value = twilight * (0.065 + 0.26 * Math.max(-sun.z, 0))
				* (1 - 0.85 * storm);
			renderer.setRenderTarget(target);
			renderer.render(scene, camera);
			renderer.setRenderTarget(null);
			screen.render(renderer);
		},
		dispose() {
			displayTexture.dispose();
			screen.dispose();
			material.dispose();
			target.dispose();
		}
	};
}
