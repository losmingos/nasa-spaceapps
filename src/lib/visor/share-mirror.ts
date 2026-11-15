import { Vector4, type WebGLRenderer } from 'three';

const FPS = 30;

export function createMirror(onError: () => void) {
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d', { alpha: false });
	if (!context) throw new Error('Canvas capture unavailable');
	canvas.width = 640;
	canvas.height = 640;
	let stream: MediaStream | undefined;
	let frameRequest: ((frame: Blob) => void) | undefined;
	let closed = false;

	const viewport = new Vector4();
	let nextFrame = 0;
	return {
		getStream() {
			if (stream) return stream;
			stream = canvas.captureStream(FPS);
			const track = stream.getVideoTracks()[0];
			if (!track) throw new Error('Canvas capture unavailable');
			track.contentHint = 'motion';
			return stream;
		},
		requestFrame(send: (frame: Blob) => void) {
			frameRequest = send;
		},
		capture(renderer: WebGLRenderer, eyeWidth: number, eyeHeight: number, compositeEye: () => void) {
			const now = performance.now();
			if ((!stream && !frameRequest) || now < nextFrame || !eyeWidth || !eyeHeight) return;
			const source = renderer.domElement;
			if (source.width < 2 || source.height < 2) return;
			const interval = 1000 / (stream ? FPS : 15);
			nextFrame = Math.max(nextFrame, now - interval / 2) + interval;
			const maxWidth = Math.min(source.width, stream ? 960 : 640);
			const maxHeight = Math.min(source.height, stream ? 720 : 480);
			const scale = Math.min(maxWidth / eyeWidth, maxHeight / eyeHeight, 1);
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
				const send = frameRequest;
				frameRequest = undefined;
				if (send) canvas.toBlob((frame) => {
					if (!closed && frame) send(frame);
				}, 'image/jpeg', 0.65);
			} catch {
				onError();
			} finally {
				renderer.setViewport(viewport);
				renderer.setRenderTarget(target);
			}
		},
		close() {
			closed = true;
			frameRequest = undefined;
			for (const track of stream?.getTracks() ?? []) track.stop();
		}
	};
}

export type ShareMirror = ReturnType<typeof createMirror>;
