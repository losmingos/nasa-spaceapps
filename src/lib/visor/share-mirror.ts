import { Vector4, type WebGLRenderer } from 'three';

const FPS = 30;

export function createMirror(onError: () => void) {
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d', { alpha: false });
	if (!context || typeof canvas.captureStream !== 'function') throw new Error('Canvas capture unavailable');
	canvas.width = 640;
	canvas.height = 640;
	const stream = canvas.captureStream(FPS);
	const track = stream.getVideoTracks()[0];
	if (!track) throw new Error('Canvas capture unavailable');
	track.contentHint = 'motion';

	const viewport = new Vector4();
	let nextFrame = 0;
	return {
		stream,
		capture(renderer: WebGLRenderer, eyeWidth: number, eyeHeight: number, compositeEye: () => void) {
			const now = performance.now();
			if (now < nextFrame || !eyeWidth || !eyeHeight) return;
			const interval = 1000 / FPS;
			nextFrame = Math.max(nextFrame, now - interval / 2) + interval;
			const source = renderer.domElement;
			const scale = Math.min(960 / eyeWidth, 720 / eyeHeight, 1);
			const width = Math.max(2, 2 * Math.floor(eyeWidth * scale / 2));
			const height = Math.max(2, 2 * Math.floor(eyeHeight * scale / 2));
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width;
				canvas.height = height;
			}

			// The headset framebuffer belongs to WebXR. Reuse the finished eye's postprocessing
			// on the regular WebGL canvas, then copy it before the drawing buffer is cleared.
			const target = renderer.getRenderTarget();
			renderer.getViewport(viewport);
			try {
				renderer.setRenderTarget(null);
				const pixelRatio = renderer.getPixelRatio();
				renderer.setViewport(0, 0, width / pixelRatio, height / pixelRatio);
				compositeEye();
				context.drawImage(source, 0, source.height - height, width, height, 0, 0, width, height);
			} catch {
				onError();
			} finally {
				renderer.setViewport(viewport);
				renderer.setRenderTarget(target);
			}
		},
		close() {
			track.stop();
		}
	};
}

export type ShareMirror = ReturnType<typeof createMirror>;
