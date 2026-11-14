// Jarvis client module — public API (spec §3.1). See types.ts for the contract.
//
//   const assistant = createAssistant({ mode: 'live' });
//   enterVrButton.onclick = async () => { await assistant.unlock(); await navigator.xr.requestSession(...) };
//
// SSR-safe: no browser API is touched at import time, and timers only start in the browser.
import * as api from './api.js';
import { AudioEngine, speechAvailable, type Playable } from './audio.js';
import { LINE_IDS, buildLineVars, fillLine, getLine, lineUrl, type LineId } from './lines.js';
import { Recorder, type Clip } from './recorder.js';
import { MEDA, createTelemetry } from './telemetry.js';
import { HABITAT_BEARING, O2_START_MIN, ROUTE_LENGTH_M } from '../mission.js';
import type {
	Assistant,
	AssistantOptions,
	AssistantState,
	AssistantStatus,
	ChatTurn,
	CueId,
	MissionEvent,
	ProtocolStepId,
	Subtitle
} from './types.js';

export type * from './types.js';
export type { LineId } from './lines.js';
export { getCue, postCue } from './api.js';

/** Presses shorter than this are accidental taps and are discarded (D22). */
const MIN_CLIP_MS = 600;
/** Chat history sent to /api/chat (D23). */
const HISTORY_TURNS = 6;
const TICK_MS = 500;
const CUE_POLL_MS = 500;
const L04_DELAY_MS = 30_000;

const MISSION_EVENTS: readonly MissionEvent[] = ['mission_start', 'sample_collected', 'storm_start'];
const STEP_CUE = /^step:(P[1-6])$/;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createAssistant(options: AssistantOptions): Assistant {
	const mode = options.mode;
	const ttsMode = options.tts ?? 'elevenlabs';
	const inBrowser = typeof window !== 'undefined';

	const lineVars = buildLineVars({
		routeLengthM: ROUTE_LENGTH_M,
		habitatBearing: HABITAT_BEARING,
		o2StartMin: O2_START_MIN,
		airTempC: MEDA.air_temp_c,
		pressurePa: MEDA.pressure_pa
	});

	const subtitleListeners = new Set<(s: Subtitle) => void>();
	const stateListeners = new Set<(s: AssistantState) => void>();

	const audio = new AudioEngine(() => emitState());
	const recorder = new Recorder();
	const telemetry = createTelemetry();

	let disposed = false;
	let unlocked = false;
	let unlocking: Promise<void> | null = null;
	let lastError: string | null = null;
	let history: ChatTurn[] = [];
	let turnCounter = 0;
	/** The live request (STT → chat → TTS) currently running, if any. */
	let inFlight: { turnId: number; abort: AbortController } | null = null;
	/** A press ignored while busy: its release must be ignored too. */
	let ignoringPress = false;
	let lastStep: ProtocolStepId | null = null;
	const lineBuffers = new Map<LineId, Promise<AudioBuffer | null>>();

	let tickTimer: ReturnType<typeof setInterval> | null = null;
	let cueTimer: ReturnType<typeof setTimeout> | null = null;
	let l04Timer: ReturnType<typeof setTimeout> | null = null;
	let cueSeq: number | null = null;

	// ---- state + listeners ----------------------------------------------------

	function status(): AssistantStatus {
		if (!unlocked) return 'locked';
		if (recorder.recording) return 'recording';
		if (inFlight) return 'thinking';
		if (audio.busy) return 'speaking';
		return 'idle';
	}

	function getState(): AssistantState {
		return { status: status(), telemetry: telemetry.get(), lastError };
	}

	function emitState(): void {
		if (disposed) return;
		const s = getState();
		for (const cb of stateListeners) {
			try {
				cb(s);
			} catch (err) {
				console.error('[jarvis] onState listener failed', err);
			}
		}
	}

	function emitSubtitle(s: Subtitle): void {
		if (disposed) return;
		for (const cb of subtitleListeners) {
			try {
				cb(s);
			} catch (err) {
				console.error('[jarvis] onSubtitle listener failed', err);
			}
		}
	}

	function setError(msg: string): void {
		lastError = msg;
		console.warn('[jarvis]', msg);
	}

	/** Cancel everything playing/queued and any in-flight request (barge-in, event lines, reset). */
	function cancelPending(): void {
		audio.cancel(turnCounter);
		if (inFlight) {
			inFlight.abort.abort();
			inFlight = null;
		}
	}

	const speechOrNone = (text: string): Playable =>
		speechAvailable() ? { type: 'speech', text } : { type: 'none' };

	// ---- pre-recorded lines -----------------------------------------------------

	function lineBuffer(id: LineId): Promise<AudioBuffer | null> {
		if (!audio.unlocked) return Promise.resolve(null);
		let p = lineBuffers.get(id);
		if (!p) {
			p = audio.load(lineUrl(id)).then((buf) => {
				if (!buf) console.info(`[jarvis] ${lineUrl(id)} missing — using speechSynthesis for ${id}`);
				return buf;
			});
			lineBuffers.set(id, p);
		}
		return p;
	}

	async function playLineInternal(id: LineId, turnId?: number): Promise<void> {
		if (disposed || !LINE_IDS.includes(id)) return;
		const line = getLine(id);
		const high = line.kind === 'event';
		let tid: number;
		if (high) {
			cancelPending(); // event lines cut playback and cancel pending answers (D26)
			tid = ++turnCounter;
		} else {
			tid = turnId ?? ++turnCounter;
		}
		const text = fillLine(line.template, lineVars);
		if (line.kind === 'scripted-answer') {
			const question = /"(.+)"/.exec(line.trigger)?.[1];
			if (question) emitSubtitle({ speaker: 'astronaut', text: question, turnId: tid });
		}
		const buffer = await lineBuffer(id);
		const playable: Playable = buffer ? { type: 'buffer', buffer } : speechOrNone(text);
		const played = audio.play({
			turnId: tid,
			priority: high ? 'high' : 'normal',
			playable,
			onStart: () => emitSubtitle({ speaker: 'jarvis', text, turnId: tid })
		});
		emitState();
		await played;
		emitState();
	}

	// ---- live turn pipeline ------------------------------------------------------

	const isCurrent = (turnId: number) => !disposed && inFlight?.turnId === turnId;

	/** Mark the request finished without publishing state (the playback that follows publishes it). */
	function finishRequest(turnId: number): void {
		if (inFlight?.turnId === turnId) inFlight = null;
	}

	async function runTurn(turnId: number, signal: AbortSignal, clipPromise: Promise<Clip | null>): Promise<void> {
		try {
			const clip = await clipPromise;
			if (!isCurrent(turnId)) return;
			if (!clip || clip.blob.size === 0) {
				finishRequest(turnId);
				void playLineInternal('E01', turnId);
				return;
			}

			const { text } = await api.stt(clip.blob, signal);
			if (!isCurrent(turnId)) return;
			const question = text.trim();
			if (!question) {
				finishRequest(turnId);
				void playLineInternal('E01', turnId);
				return;
			}
			emitSubtitle({ speaker: 'astronaut', text: question, turnId });

			const res = await api.chat(
				{ history: history.slice(-HISTORY_TURNS), text: question, telemetry: telemetry.get() },
				signal
			);
			if (!isCurrent(turnId)) return;
			const reply = res.reply.trim();
			if (res.fallback || !reply) {
				finishRequest(turnId);
				void playLineInternal(res.fallback ?? 'E02', turnId);
				return;
			}
			history = [
				...history,
				{ role: 'user' as const, content: question },
				{ role: 'assistant' as const, content: reply }
			].slice(-HISTORY_TURNS);

			let playable: Playable = speechOrNone(reply);
			if (ttsMode === 'elevenlabs' && audio.unlocked) {
				try {
					const mp3 = await api.tts(reply, signal);
					if (!isCurrent(turnId)) return;
					playable = { type: 'buffer', buffer: await audio.decode(mp3) };
				} catch (err) {
					if (!isCurrent(turnId)) return;
					setError(`TTS failed, falling back to speechSynthesis: ${errorMessage(err)}`);
				}
			}
			if (!isCurrent(turnId)) return;

			// Request done → status becomes 'speaking' (no 'idle' flicker); a new press now barges in.
			finishRequest(turnId);
			const played = audio.play({
				turnId,
				priority: 'normal',
				playable,
				onStart: () => emitSubtitle({ speaker: 'jarvis', text: reply, turnId })
			});
			emitState();
			await played;
			emitState();
		} catch (err) {
			if (!isCurrent(turnId)) return; // cancelled (barge-in / event line / reset): drop silently
			setError(errorMessage(err));
			finishRequest(turnId);
			void playLineInternal('E02', turnId);
		}
	}

	// ---- mission events, protocol steps, cues --------------------------------------

	function clearL04(): void {
		if (l04Timer !== null) clearTimeout(l04Timer);
		l04Timer = null;
	}

	/** 500 ms tick: detect protocol step transitions (P5 → L05, P6 → L06) and publish state. */
	function tick(): void {
		if (disposed) return;
		const step = telemetry.get().protocolStep;
		if (step !== lastStep) {
			lastStep = step;
			if (step === 'P5') void playLineInternal('L05');
			else if (step === 'P6') void playLineInternal('L06');
		}
		emitState();
	}

	function reset(): void {
		if (disposed) return;
		cancelPending();
		audio.stopAll();
		if (recorder.recording) void recorder.stop();
		ignoringPress = false;
		history = [];
		telemetry.reset();
		clearL04();
		lastStep = null;
		lastError = null;
		emitState();
	}

	function notify(event: MissionEvent): void {
		if (disposed) return;
		switch (event) {
			case 'mission_start':
				reset();
				telemetry.missionStart();
				void playLineInternal('L01');
				break;
			case 'sample_collected':
				if (!telemetry.missionStarted) telemetry.missionStart();
				void playLineInternal('L02');
				break;
			case 'storm_start':
				if (!telemetry.stormStart()) return; // storm already running: ignore duplicates
				void playLineInternal('L03');
				clearL04();
				l04Timer = setTimeout(() => {
					l04Timer = null;
					void playLineInternal('L04');
				}, L04_DELAY_MS);
				break;
			default:
				return;
		}
		tick();
	}

	function setStep(step: ProtocolStepId): void {
		if (disposed) return;
		telemetry.setStep(step);
		tick();
	}

	function handleCue(id: CueId): void {
		if ((LINE_IDS as readonly string[]).includes(id)) void playLineInternal(id as LineId);
		else if ((MISSION_EVENTS as readonly string[]).includes(id)) notify(id as MissionEvent);
		else if (id === 'reset') reset();
		else {
			const m = STEP_CUE.exec(id);
			if (m) setStep(m[1] as ProtocolStepId);
		}
	}

	async function pollCue(): Promise<void> {
		cueTimer = null;
		if (disposed) return;
		try {
			const cue = await api.getCue();
			if (disposed) return;
			if (cueSeq === null || cue.seq < cueSeq) {
				cueSeq = cue.seq; // first poll (or server restarted): don't replay old cues
			} else if (cue.seq > cueSeq) {
				cueSeq = cue.seq;
				if (cue.id) handleCue(cue.id);
			}
		} catch {
			/* network hiccup: try again next time */
		} finally {
			if (!disposed) cueTimer = setTimeout(() => void pollCue(), CUE_POLL_MS);
		}
	}

	// ---- push-to-talk ------------------------------------------------------------

	function pttDown(): void {
		if (disposed || mode !== 'live') return;
		if (!unlocked) {
			setError('pttDown() before unlock()');
			emitState();
			return;
		}
		if (recorder.recording) return;
		if (inFlight) {
			ignoringPress = true;
			audio.busyBeep();
			return;
		}
		ignoringPress = false;
		cancelPending(); // barge-in: Jarvis stops talking
		if (!recorder.start()) {
			setError(recorder.hasStream ? 'Could not start recording' : 'Microphone unavailable');
			audio.busyBeep();
			emitState();
			return;
		}
		emitState();
	}

	function pttUp(): void {
		if (disposed || mode !== 'live') return;
		if (ignoringPress) {
			ignoringPress = false;
			return;
		}
		if (!recorder.recording) return;
		const pressMs = recorder.elapsedMs();
		const clip = recorder.stop();
		if (pressMs < MIN_CLIP_MS) {
			void clip; // accidental tap: discard without any request
			emitState();
			return;
		}
		audio.chirp();
		const turnId = ++turnCounter;
		const abort = new AbortController();
		inFlight = { turnId, abort };
		lastError = null;
		emitState();
		void runTurn(turnId, abort.signal, clip);
	}

	// ---- unlock / lifecycle ---------------------------------------------------------

	function unlock(): Promise<void> {
		if (disposed) return Promise.resolve();
		if (unlocking) return unlocking;
		if (unlocked && (mode !== 'live' || recorder.hasStream)) return Promise.resolve();

		// Synchronous part runs inside the user gesture (D20): create/resume AudioContext, silent buffer.
		const audioReady = audio.unlock();
		for (const id of LINE_IDS) void lineBuffer(id); // preload + decode all line mp3s in the background
		const micReady =
			mode === 'live'
				? recorder.open().catch((err) => setError(`Microphone unavailable: ${errorMessage(err)}`))
				: Promise.resolve();

		unlocking = Promise.all([audioReady, micReady])
			.then(() => {
				unlocked = true;
				emitState();
			})
			.finally(() => {
				unlocking = null;
			});
		return unlocking;
	}

	function dispose(): void {
		if (disposed) return;
		cancelPending();
		disposed = true;
		if (tickTimer !== null) clearInterval(tickTimer);
		if (cueTimer !== null) clearTimeout(cueTimer);
		clearL04();
		tickTimer = cueTimer = null;
		audio.dispose();
		recorder.close();
		subtitleListeners.clear();
		stateListeners.clear();
	}

	if (inBrowser) {
		tickTimer = setInterval(tick, TICK_MS);
		if (options.cuePolling !== false) void pollCue();
	}

	return {
		unlock,
		pttDown,
		pttUp,
		notify,
		setStep,
		reset,
		playLine: (id) => void playLineInternal(id),
		onSubtitle(cb) {
			subtitleListeners.add(cb);
			return () => subtitleListeners.delete(cb);
		},
		onState(cb) {
			stateListeners.add(cb);
			return () => stateListeners.delete(cb);
		},
		getState,
		dispose
	};
}
