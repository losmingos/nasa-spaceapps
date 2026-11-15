// Persistent microphone stream + one MediaRecorder per push-to-talk press (spec §4.1, D21, D22).
// Browser globals are only touched inside methods (SSR-safe import).

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
const MIC_PERMISSION_TIMEOUT_MS = 20_000;

export interface Clip {
	blob: Blob;
	durationMs: number;
}

function pickMimeType(): string | undefined {
	if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
	return MIME_CANDIDATES.find((m) => {
		try {
			return MediaRecorder.isTypeSupported(m);
		} catch {
			return false;
		}
	});
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Recorder {
	private stream: MediaStream | null = null;
	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private startedAt = 0;
	private stopped: Promise<Blob | null> | null = null;
	private armSafety: (() => void) | null = null;

	get hasStream(): boolean {
		return this.stream !== null && this.stream.getAudioTracks().some((t) => t.readyState === 'live');
	}

	get recording(): boolean {
		return this.recorder !== null;
	}

	get recordingStream(): MediaStream | null {
		return this.recorder ? this.stream : null;
	}

	/** Open the persistent mic stream once (called from unlock(), inside the «Enter VR» gesture). */
	async open(): Promise<void> {
		if (this.hasStream) return;
		if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
			throw new Error('getUserMedia not available (needs a secure context: https or localhost)');
		}
		if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder not available');
		const request = navigator.mediaDevices.getUserMedia({
			audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
		});
		let timedOut = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			this.stream = await Promise.race([
				request.then((stream) => {
					if (timedOut) stream.getTracks().forEach((track) => track.stop());
					return stream;
				}),
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => {
						timedOut = true;
						reject(new Error('Microphone permission request timed out'));
					}, MIC_PERMISSION_TIMEOUT_MS);
				})
			]);
		} finally {
			clearTimeout(timer);
		}
	}

	/** Start a new recording on the persistent stream. Returns false if not possible. */
	start(): boolean {
		if (this.recorder || !this.stream || !this.hasStream) return false;
		const mimeType = pickMimeType();
		let rec: MediaRecorder;
		try {
			rec = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
		} catch (err) {
			console.error('[jarvis] MediaRecorder failed', err);
			return false;
		}
		this.chunks = [];
		const chunks = this.chunks;
		rec.ondataavailable = (e) => {
			if (e.data && e.data.size > 0) chunks.push(e.data);
		};
		// Resolves on 'stop', which fires after the final 'dataavailable'. Safety timeout once stop() is requested.
		let safety: ReturnType<typeof setTimeout> | undefined;
		this.stopped = new Promise<Blob | null>((resolve) => {
			const done = () => {
				clearTimeout(safety);
				const type = mimeType || rec.mimeType || 'audio/webm';
				resolve(chunks.length ? new Blob(chunks, { type }) : null);
			};
			rec.onstop = done;
			rec.onerror = () => resolve(null);
			this.armSafety = () => {
				safety = setTimeout(done, 2000);
			};
		});
		try {
			rec.start();
		} catch (err) {
			console.error('[jarvis] MediaRecorder.start failed', err);
			this.stopped = null;
			this.armSafety = null;
			return false;
		}
		this.recorder = rec;
		this.startedAt = now();
		return true;
	}

	/** Stop the current recording and wait for the final data. Null if nothing was recorded. */
	async stop(): Promise<Clip | null> {
		const rec = this.recorder;
		const stopped = this.stopped;
		this.recorder = null;
		this.stopped = null;
		if (!rec || !stopped) return null;
		const durationMs = now() - this.startedAt;
		this.armSafety?.();
		this.armSafety = null;
		try {
			if (rec.state !== 'inactive') rec.stop();
		} catch {
			/* ignore */
		}
		const blob = await stopped;
		return blob ? { blob, durationMs } : null;
	}

	/** Press duration so far (ms), 0 if not recording. */
	elapsedMs(): number {
		return this.recorder ? now() - this.startedAt : 0;
	}

	/** Stop recording (discarding it) and release the microphone. */
	close(): void {
		void this.stop();
		this.stream?.getTracks().forEach((t) => t.stop());
		this.stream = null;
	}
}
