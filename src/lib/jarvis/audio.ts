// Single AudioContext + single playback queue with priorities (spec §4.5, D20, D26).
// Nothing here touches browser globals until a method is called, so it is safe to import during SSR.

export type Priority = 'high' | 'normal';

export type Playable =
	| { type: 'buffer'; buffer: AudioBuffer }
	| { type: 'speech'; text: string; lang?: string }
	/** Nothing audible (no audio path available); the subtitle still shows. */
	| { type: 'none' };

export interface PlayRequest {
	/** Items whose turnId is ≤ the last cancelled turn are dropped. */
	turnId: number;
	priority: Priority;
	playable: Playable;
	/** Called when the item actually starts (use it to show the subtitle in sync). */
	onStart?: () => void;
}

interface QueueItem extends PlayRequest {
	done: boolean;
	stop?: () => void;
	resolve: (played: boolean) => void;
}

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
	if (typeof window === 'undefined') return null;
	const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
	return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function synth(): SpeechSynthesis | null {
	if (typeof window === 'undefined') return null;
	return typeof window.speechSynthesis === 'object' && window.speechSynthesis ? window.speechSynthesis : null;
}

export const speechAvailable = () => synth() !== null;

/** English voice, preferring a calm male/neutral one when the platform has it. */
function pickVoice(s: SpeechSynthesis): SpeechSynthesisVoice | null {
	const voices = s.getVoices().filter((v) => /^en[-_]/i.test(v.lang) || v.lang.toLowerCase() === 'en');
	if (voices.length === 0) return null;
	const preferred = [
		/google uk english male/i,
		/daniel/i,
		/microsoft (ryan|guy|george|david|christopher|andrew|brian)/i,
		/\bmale\b/i,
		/alex|fred|arthur|oliver/i
	];
	for (const re of preferred) {
		const v = voices.find((x) => re.test(x.name));
		if (v) return v;
	}
	return (
		voices.find((v) => /en[-_]gb/i.test(v.lang)) ?? voices.find((v) => /en[-_]us/i.test(v.lang)) ?? voices[0]
	);
}

export class AudioEngine {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private queue: QueueItem[] = [];
	private current: QueueItem | null = null;
	private cancelledThrough = 0;
	private lastBusy = false;

	constructor(private onBusyChange: (busy: boolean) => void = () => {}) {}

	get unlocked(): boolean {
		return this.ctx !== null;
	}

	/** True while something is playing or queued. */
	get busy(): boolean {
		return this.current !== null || this.queue.length > 0;
	}

	/**
	 * Create + resume the single AudioContext and play a silent buffer (D20). MUST run synchronously
	 * inside a user gesture: everything gesture-sensitive happens before the first await.
	 */
	unlock(): Promise<void> {
		const Ctor = audioContextCtor();
		if (!Ctor) return Promise.resolve();
		if (!this.ctx) {
			this.ctx = new Ctor();
			this.master = this.ctx.createGain();
			this.master.gain.value = 1;
			this.master.connect(this.ctx.destination);
		}
		const ctx = this.ctx;
		const resumed = ctx.state === 'suspended' ? ctx.resume().catch(() => {}) : Promise.resolve();
		try {
			const silent = ctx.createBuffer(1, Math.max(1, Math.round(ctx.sampleRate * 0.05)), ctx.sampleRate);
			const src = ctx.createBufferSource();
			src.buffer = silent;
			src.connect(ctx.destination);
			src.start(0);
		} catch {
			/* ignore */
		}
		// Prime speechSynthesis inside the gesture too (Chrome requires activation for the first speak()).
		const s = synth();
		if (s) {
			try {
				s.getVoices(); // triggers async voice loading
				const u = new SpeechSynthesisUtterance(' ');
				u.volume = 0;
				s.speak(u);
			} catch {
				/* ignore */
			}
		}
		// Autoplay restrictions can leave resume() pending until the next browser gesture.
		let timer: ReturnType<typeof setTimeout> | undefined;
		return Promise.race([
			resumed,
			new Promise<void>((resolve) => { timer = setTimeout(resolve, 3000); })
		]).finally(() => clearTimeout(timer));
	}

	async decode(data: ArrayBuffer): Promise<AudioBuffer> {
		if (!this.ctx) throw new Error('AudioContext not unlocked');
		return this.ctx.decodeAudioData(data);
	}

	/** Fetch + decode an mp3. Returns null on 404 / decode failure. */
	async load(url: string): Promise<AudioBuffer | null> {
		if (!this.ctx) return null;
		try {
			const res = await fetch(url);
			if (!res.ok) return null;
			return await this.decode(await res.arrayBuffer());
		} catch {
			return null;
		}
	}

	/**
	 * Queue a playback. High priority stops whatever is playing and clears the queue; normal priority
	 * waits its turn. Resolves true when it finished playing, false when it was dropped or interrupted.
	 */
	play(req: PlayRequest): Promise<boolean> {
		if (req.turnId <= this.cancelledThrough) return Promise.resolve(false);
		return new Promise<boolean>((resolve) => {
			const item: QueueItem = { ...req, done: false, resolve };
			if (req.priority === 'high') {
				this.stopCurrent();
				this.dropQueue();
				this.queue.push(item);
			} else {
				this.queue.push(item);
			}
			this.pump();
		});
	}

	/** Drop every item with turnId ≤ throughTurnId (playing or queued) and refuse them later. */
	cancel(throughTurnId: number): void {
		this.cancelledThrough = Math.max(this.cancelledThrough, throughTurnId);
		if (this.current && this.current.turnId <= this.cancelledThrough) this.stopCurrent();
		const keep: QueueItem[] = [];
		for (const item of this.queue) {
			if (item.turnId <= this.cancelledThrough) {
				item.done = true;
				item.resolve(false);
			} else keep.push(item);
		}
		this.queue = keep;
		this.pump();
		this.emitBusy();
	}

	/** Stop everything now (barge-in, reset). */
	stopAll(): void {
		this.stopCurrent();
		this.dropQueue();
		synth()?.cancel();
		this.emitBusy();
	}

	/** Short rising "received" chirp (pttUp). Plays outside the queue. */
	chirp(): void {
		this.tone([
			{ type: 'sine', from: 880, to: 1480, start: 0, dur: 0.09, gain: 0.12 },
			{ type: 'sine', from: 1480, to: 1480, start: 0.1, dur: 0.06, gain: 0.08 }
		]);
	}

	/** Two short low beeps: press ignored (busy). Plays outside the queue. */
	busyBeep(): void {
		this.tone([
			{ type: 'square', from: 330, to: 330, start: 0, dur: 0.07, gain: 0.05 },
			{ type: 'square', from: 330, to: 330, start: 0.12, dur: 0.07, gain: 0.05 }
		]);
	}

	dispose(): void {
		this.stopAll();
		const ctx = this.ctx;
		this.ctx = null;
		this.master = null;
		if (ctx) ctx.close().catch(() => {});
	}

	// ---- internals ----------------------------------------------------------

	private tone(
		parts: { type: OscillatorType; from: number; to: number; start: number; dur: number; gain: number }[]
	): void {
		const ctx = this.ctx;
		const out = this.master;
		if (!ctx || !out) return;
		if (ctx.state === 'suspended') ctx.resume().catch(() => {});
		try {
			const t0 = ctx.currentTime + 0.01;
			for (const p of parts) {
				const osc = ctx.createOscillator();
				const g = ctx.createGain();
				osc.type = p.type;
				osc.frequency.setValueAtTime(p.from, t0 + p.start);
				if (p.to !== p.from) osc.frequency.exponentialRampToValueAtTime(p.to, t0 + p.start + p.dur);
				g.gain.setValueAtTime(0.0001, t0 + p.start);
				g.gain.exponentialRampToValueAtTime(p.gain, t0 + p.start + 0.01);
				g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.start + p.dur);
				osc.connect(g).connect(out);
				osc.start(t0 + p.start);
				osc.stop(t0 + p.start + p.dur + 0.02);
			}
		} catch {
			/* ignore */
		}
	}

	private pump(): void {
		if (this.current || this.queue.length === 0) {
			this.emitBusy();
			return;
		}
		const item = this.queue.shift()!;
		if (item.turnId <= this.cancelledThrough) {
			item.done = true;
			item.resolve(false);
			this.pump();
			return;
		}
		this.current = item;
		this.emitBusy();
		try {
			item.onStart?.();
		} catch (err) {
			console.error('[jarvis] onStart failed', err);
		}
		this.start(item);
	}

	private start(item: QueueItem): void {
		const p = item.playable;
		if (p.type === 'buffer' && this.ctx && this.master) {
			const ctx = this.ctx;
			if (ctx.state === 'suspended') ctx.resume().catch(() => {});
			const src = ctx.createBufferSource();
			src.buffer = p.buffer;
			src.connect(this.master);
			src.onended = () => this.finish(item, true);
			item.stop = () => {
				src.onended = null;
				try {
					src.stop();
				} catch {
					/* already stopped */
				}
			};
			src.start();
			return;
		}
		if (p.type === 'speech' || p.type === 'buffer') {
			const text = p.type === 'speech' ? p.text : '';
			const s = synth();
			if (s && text.trim()) {
				this.speak(item, s, text, p.type === 'speech' ? p.lang : undefined);
				return;
			}
		}
		// Nothing audible: finish on the next tick.
		setTimeout(() => this.finish(item, true), 0);
	}

	private speak(item: QueueItem, s: SpeechSynthesis, text: string, lang?: string): void {
		s.cancel();
		const u = new SpeechSynthesisUtterance(text);
		const voice = lang
			? s.getVoices().find((candidate) => candidate.lang.toLowerCase() === lang.toLowerCase())
				?? s.getVoices().find((candidate) => candidate.lang.split('-')[0] === lang.split('-')[0])
			: pickVoice(s);
		if (voice) u.voice = voice;
		u.lang = voice?.lang ?? lang ?? 'en-GB';
		u.rate = 1;
		u.pitch = 0.95;
		// Chrome sometimes never fires onend: safety timeout based on text length.
		const safety = setTimeout(() => this.finish(item, true), 4000 + text.length * 90);
		const end = () => {
			clearTimeout(safety);
			this.finish(item, true);
		};
		u.onend = end;
		u.onerror = end;
		item.stop = () => {
			clearTimeout(safety);
			u.onend = null;
			u.onerror = null;
			s.cancel();
		};
		s.speak(u);
	}

	private finish(item: QueueItem, played: boolean): void {
		if (item.done) return;
		item.done = true;
		if (this.current === item) this.current = null;
		item.resolve(played);
		this.pump();
	}

	private stopCurrent(): void {
		const item = this.current;
		if (!item) return;
		this.current = null;
		item.stop?.();
		item.done = true;
		item.resolve(false);
	}

	private dropQueue(): void {
		const items = this.queue;
		this.queue = [];
		for (const item of items) {
			item.done = true;
			item.resolve(false);
		}
	}

	private emitBusy(): void {
		const busy = this.busy;
		if (busy !== this.lastBusy) {
			this.lastBusy = busy;
			this.onBusyChange(busy);
		}
	}
}
