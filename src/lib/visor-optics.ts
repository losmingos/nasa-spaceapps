import {
	HalfFloatType, ShaderMaterial, Vector2, WebGLRenderTarget,
	type Camera, type Scene, type WebGLRenderer
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export function buildVisorOptics(renderer: WebGLRenderer) {
	const target = new WebGLRenderTarget(1, 1, {
		type: HalfFloatType,
		samples: Math.min(4, renderer.capabilities.maxSamples)
	});
	const size = new Vector2();
	const material = new ShaderMaterial({
		depthTest: false,
		depthWrite: false,
		uniforms: {
			terrain: { value: target.texture },
			aspect: { value: 1 },
			sunInView: { value: new Vector2() },
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
			uniform sampler2D terrain;
			uniform float aspect;
			uniform vec2 sunInView;
			uniform float reflection;
			varying vec2 imageUV;

			void main() {
				vec2 p = imageUV * 2.0 - 1.0;
				vec2 lens = p * vec2(1.0, 0.87);
				float r2 = dot(lens, lens) / 1.7569;

				// Inverse radial mapping. Preserve central scale and compress peripheral rays.
				vec2 sampleUV = 0.5 + 0.5 * p * (0.91 + 0.088 * r2);
				vec2 dispersion = p * r2 * 0.00075;
				vec4 world = texture2D(terrain, sampleUV);
				vec3 sceneColor = world.rgb / max(world.a, 0.001);
				vec4 red = texture2D(terrain, sampleUV + dispersion);
				vec4 blue = texture2D(terrain, sampleUV - dispersion);
				sceneColor.r = mix(sceneColor.r, red.r / max(red.a, 0.001), red.a);
				sceneColor.b = mix(sceneColor.b, blue.b / max(blue.a, 0.001), blue.a);

				vec3 sky = mix(vec3(0.49, 0.265, 0.157), vec3(0.143, 0.089, 0.067),
					smoothstep(0.40, 1.0, sampleUV.y));
				vec3 transmitted = mix(sky, sceneColor, world.a);
				float falloff = smoothstep(0.26, 1.0, r2);
				transmitted *= mix(vec3(1.015, 0.985, 0.935), vec3(0.57, 0.50, 0.46), falloff);
				transmitted *= 1.0 - 0.18 * smoothstep(0.55, 1.05, -p.y)
					* smoothstep(0.20, 0.95, abs(p.x));

				// A broad reflection catches the upper shoulder of the glass as the head turns.
				vec2 glass = (p - sunInView) * vec2(clamp(aspect, 0.85, 1.9), 1.0);
				float flare = exp(-dot(glass, glass) * 2.1) * reflection;
				float grazing = 0.18 + 0.82 * smoothstep(0.18, 1.0, r2);
				float arcY = 1.13 - 0.40 * (p.x + 0.16) * (p.x + 0.16);
				float arc = exp(-pow((p.y - arcY) / 0.14, 2.0));
				float sideLight = smoothstep(0.05, 0.98, abs(p.x)) * smoothstep(-0.65, 0.9, p.y);
				vec3 coatedGlass = vec3(0.54, 0.38, 0.23);
				transmitted += coatedGlass * (flare * grazing + arc * sideLight * (0.15 + reflection));
				transmitted *= 1.0 - 0.14 * smoothstep(0.58, 1.0, r2) * smoothstep(0.15, 1.0, -p.y);
				gl_FragColor = vec4(transmitted, 1.0);
				#include <colorspace_fragment>
			}
		`
	});
	const screen = new FullScreenQuad(material);

	return {
		resize(width: number, height: number) {
			renderer.getDrawingBufferSize(size);
			target.setSize(size.x, size.y);
			material.uniforms.aspect.value = width / height;
		},
		render(scene: Scene, camera: Camera, sunX: number, sunFacing: number) {
			material.uniforms.sunInView.value.set(sunX, 0.99);
			material.uniforms.reflection.value = 0.065 + 0.26 * Math.max(sunFacing, 0);
			renderer.setRenderTarget(target);
			renderer.render(scene, camera);
			renderer.setRenderTarget(null);
			screen.render(renderer);
		},
		dispose() {
			screen.dispose();
			material.dispose();
			target.dispose();
		}
	};
}
