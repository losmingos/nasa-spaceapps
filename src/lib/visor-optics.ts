import {
	CanvasTexture, LinearFilter, HalfFloatType, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget,
	type PerspectiveCamera, type Scene, type WebGLRenderer
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export function buildVisorOptics(renderer: WebGLRenderer, map: HTMLCanvasElement,
	getNotice: () => string, getClock: () => string) {
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
		const bottom = Math.max(52, Math.min(160, h * 0.18));
		const mapSize = Math.max(80, Math.min(128, w * 0.095));
		const y = h - bottom - mapSize;
		context.globalAlpha = 0.7;
		context.drawImage(map, edge, y, mapSize, mapSize);
		context.globalAlpha = 1;
		context.strokeStyle = '#a4dfc8';
		context.lineWidth = 0.8;
		// Open registration corners keep the map on the glass without a panel backing.
		for (const [x, yy, dx, dy] of [[edge, y, 1, 1], [edge + mapSize, y, -1, 1],
			[edge, y + mapSize, 1, -1], [edge + mapSize, y + mapSize, -1, -1]]) {
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
		context.fillText(getNotice(), w / 2, Math.max(34, h * 0.075));
		context.fillStyle = '#c6ffe5';
		context.font = '14px monospace';
		context.fillText(getClock(), w / 2, h * 0.91);
		displayTexture.needsUpdate = true;
	}
	const target = new WebGLRenderTarget(1, 1, {
		type: HalfFloatType,
		samples: Math.min(4, renderer.capabilities.maxSamples)
	});
	const size = new Vector2();
	const material = new ShaderMaterial({
		depthTest: false,
		depthWrite: false,
		uniforms: {
			display: { value: displayTexture },
			displayPixel: { value: new Vector2(1, 1) },
			terrain: { value: target.texture },
			aspect: { value: 1 },
			sunInView: { value: new Vector2() },
			sunDirection: { value: new Vector3() },
			viewScale: { value: new Vector2() },
			twilight: { value: 1 },
			daylight: { value: 1 },
			reflection: { value: 0 }
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
			uniform float aspect;
			uniform vec2 sunInView;
			uniform vec3 sunDirection;
			uniform vec2 viewScale;
			uniform float twilight;
			uniform float daylight;
			uniform float reflection;
			varying vec2 imageUV;
			vec3 emission(vec2 uv) {
				vec4 ink = texture2D(display, uv);
				return ink.rgb * ink.a;
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

				vec3 sky = mix(vec3(0.49, 0.265, 0.157), vec3(0.143, 0.089, 0.067),
					smoothstep(0.40, 1.0, sampleUV.y));
				vec3 ray = normalize(vec3((sampleUV * 2.0 - 1.0) * viewScale, -1.0));
				float sunAngle = dot(ray, sunDirection);
				vec3 dusk = mix(vec3(0.20, 0.082, 0.047), vec3(0.18, 0.27, 0.42),
					smoothstep(0.94, 1.0, sunAngle));
				sky = mix(vec3(0.008, 0.012, 0.024), mix(dusk, sky, daylight), twilight);
				sky += vec3(1.0, 0.89, 0.72) * 2.0 * smoothstep(0.999978, 0.999987, sunAngle);
				vec3 transmitted = mix(sky, sceneColor, world.a);
				// Smoked bronze solar filter. Longer oblique paths absorb more light;
				// the interior HUD is added afterward, so it stays luminous and readable.
				float opticalPath = inversesqrt(max(0.42, 1.0 - 0.55 * r2));
				vec3 solarTransmission = exp(-vec3(0.48, 0.57, 0.72) * opticalPath);
				transmitted *= solarTransmission;
				transmitted *= 1.0 - 0.10 * smoothstep(0.35, 1.0, r2);

				// A broad reflection catches the upper shoulder of the glass as the head turns.
				vec2 glass = (p - sunInView) * vec2(clamp(aspect, 0.85, 1.9), 1.0);
				float flare = exp(-dot(glass, glass) * 2.1) * reflection;
				float grazing = 0.18 + 0.82 * smoothstep(0.18, 1.0, r2);
				float arcY = 1.13 - 0.40 * (p.x + 0.16) * (p.x + 0.16);
				float arc = exp(-pow((p.y - arcY) / 0.14, 2.0));
				float sideLight = smoothstep(0.05, 0.98, abs(p.x)) * smoothstep(-0.65, 0.9, p.y);
				vec3 coatedGlass = vec3(0.54, 0.38, 0.23);
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
	render(scene: Scene, camera: PerspectiveCamera, sun: Vector3, twilight: number, daylight: number) {
			drawDisplay();
			const height = Math.tan(camera.fov * Math.PI / 360);
			material.uniforms.viewScale.value.set(height * camera.aspect, height);
			material.uniforms.sunDirection.value.copy(sun);
			material.uniforms.sunInView.value.set(Math.max(-1.1, Math.min(1.1, sun.x * 1.4)), 0.99);
			material.uniforms.twilight.value = twilight;
			material.uniforms.daylight.value = daylight;
			material.uniforms.reflection.value = twilight * (0.065 + 0.26 * Math.max(-sun.z, 0));
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
