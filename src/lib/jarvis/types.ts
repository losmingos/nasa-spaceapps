// Shared contract for the Jarvis voice assistant (spec-jarvis-voice-assistant.md).
// Client module, server endpoints and pages all code against these types. Change only by agreement.

import type { LineId } from './lines.js';
import type { Places } from './places.js';

export type Exertion = 'resting' | 'walking' | 'running';

export type MissionEvent = 'mission_start' | 'sample_collected' | 'storm_start';
export type Phase = 'idle' | 'sampling' | 'storm' | 'safe';
export type ProtocolStepId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6';

/** Simulated telemetry, computed on the client (D10, D23). Sent with every /api/chat request. */
export interface Telemetry {
	/** Seconds since mission_start (0 before it). */
	t_s: number;
	/** Seconds since storm_start, or null before the storm. */
	storm_t_s: number | null;
	phase: Phase;
	protocolStep: ProtocolStepId | null;
	o2_remaining_min: number;
	o2_remaining_pct: number;
	movement_mode: Exertion;
	suit_power_pct: number;
	visibility_m: number;
	distance_to_habitat_m: number;
	/**
	 * Weather: real MEDA curves replayed at the scene's local time (weather.ts, meda-curves.json), blended
	 * to the sol-313 storm curve after storm_start. Null when MEDA has no reading for that time.
	 */
	air_temp_c: number | null;
	pressure_pa: number | null;
	/** Only the sol-313 storm curve has wind (sensor damaged that day); null otherwise. */
	wind_ms: number | null;
	/** Null in clear weather (not measured by MEDA); ramps 0.33 → ~2 during the storm (Lemmon et al. 2022). */
	dust_opacity: number | null;
	ground_temp_c: number | null;
	relative_humidity_pct: number | null;
	/** Scene clock: Jezero local mean solar time "HH:MM", Mars 2020 mission sol, solar longitude (deg). */
	lmst: string | null;
	mission_sol: number | null;
	ls: number | null;
	/** Mission sol whose MEDA curve is being replayed, and which curve. */
	meda_sol: number | null;
	meda_curve: MedaCurve | null;
	/** Newest MEDA sol published in the PDS at build time, and how many sols old it is today. */
	meda_latest_sol: number | null;
	meda_data_age_sols: number | null;
	/** Newest published sol's values at the same local time (for "latest reading" questions). */
	latest_air_temp_c: number | null;
	latest_pressure_pa: number | null;
	/** One-way Earth–Mars light time (minutes) at the scene date. */
	signal_delay_min: number | null;
}

/** 'season' = sol from the same season as the scene; 'latest' = that sol is the newest published one. */
export type MedaCurve = 'season' | 'latest' | 'storm-blend';

export interface ChatTurn {
	role: 'user' | 'assistant';
	content: string;
}

export interface TemperatureForecastPoint {
	hours_ahead: number;
	air_temp_c: number | null;
	lmst: string;
}

// ---- HTTP API -------------------------------------------------------------
// All /api/* requests from the client send header `x-demo-token` when the page URL has `?k=<token>`
// (only enforced when DEMO_TOKEN is set on the server, i.e. tunnel mode — D15).

/** POST /api/stt — body: raw audio bytes, Content-Type: audio/webm (or the recorder's mimeType). NOT FormData (CSRF). */
export interface SttResponse {
	/** Empty string when silence / too short / known Whisper hallucination (client then plays E01). */
	text: string;
}

/** POST /api/chat — JSON. Server is stateless; client sends the last 6 turns. */
export interface ChatRequest {
	history: ChatTurn[];
	text: string;
	telemetry: Telemetry;
	missionContext?: string;
	/** Live straight-line distance and bearing from the astronaut to named places (see places.ts). */
	places?: Places;
	/** Current visor state (minimap zoom, infrared), so Sara knows limits and what is already on. */
	visor?: VisorState;
	/** Nearby hazards measured from the terrain at the moment the astronaut starts speaking. */
	hazards?: string[];
	/** MEDA replay samples ahead of the scene clock, for grounded temperature estimates. */
	temperature_forecast?: TemperatureForecastPoint[];
}
export interface ChatResponse {
	reply: string;
	/** Set when the server could not get a model answer; client plays this fixed line instead. */
	fallback?: 'E02';
	/** Things Sara asked the visor to do (via Claude tool use), executed by the page. */
	actions?: AssistantAction[];
}

/** What the visor reports to Sara at question time. */
export interface VisorState {
	/** Helmet minimap zoom: 1 = default, higher = closer (less area, more detail), lower = wider. */
	map_zoom: number;
	map_min_zoom: number;
	map_max_zoom: number;
	/** SWIR infrared view currently on. */
	infrared_on: boolean;
	/** Whether the infrared view can be used right now (the visor allows it only in free exploration). */
	infrared_available: boolean;
	/** Terrain danger layer currently on (only one view at a time: relief, danger or infrared). */
	danger_on: boolean;
	/** Whether the danger layer can be used right now (same rule as its buttons in the visor). */
	danger_available: boolean;
	/** Danger score at the astronaut's position, 0 (low) to 1 (high); null when the layer is off. */
	danger_risk: number | null;
	/** Helmet flashlight currently on (always available). */
	flashlight_on: boolean;
}

export type MapZoomAction = 'in' | 'out' | 'reset' | 'set';

/** An action Sara requests from the visor (via Claude tool use). The page decides how to apply it. */
export type AssistantAction =
	| { type: 'map_zoom'; action: MapZoomAction; /** Target zoom level, only for action 'set'. */ level?: number }
	| { type: 'infrared'; on: boolean }
	| { type: 'danger_layer'; on: boolean }
	| { type: 'flashlight'; on: boolean };

/** POST /api/tts — JSON { text } → audio/mpeg bytes (cached server-side by sha1(text)). */
export interface TtsRequest {
	text: string;
}

/** Operator cue channel for level 0 (D28). */
export type CueId = LineId | MissionEvent | 'reset' | `step:${ProtocolStepId}`;
/** GET /api/cue → latest cue (id null if none yet). POST /api/cue { id } → { seq }. */
export interface CueState {
	seq: number;
	id: CueId | null;
}

// ---- Client module API (src/lib/jarvis/index.ts) ---------------------------

export type AssistantMode = 'live' | 'scripted';
export type TtsMode = 'elevenlabs' | 'browser';
export type Speaker = 'astronaut' | 'jarvis';
export type AssistantStatus = 'locked' | 'idle' | 'recording' | 'thinking' | 'speaking';

export interface Subtitle {
	speaker: Speaker;
	text: string;
	turnId: number;
}

export interface AssistantState {
	status: AssistantStatus;
	telemetry: Telemetry;
	lastError: string | null;
}

export interface AssistantOptions {
	/** 'scripted' = level 0 (cues + pre-generated mp3 only); 'live' = levels 1–2 (full pipeline). */
	mode: AssistantMode;
	/** 'browser' = speechSynthesis (dev, no credits); 'elevenlabs' = /api/tts (recording). Default 'elevenlabs'. */
	tts?: TtsMode;
	/** Poll /api/cue every 500 ms and act on new cues. Default true. */
	cuePolling?: boolean;
}

export interface NotifyOptions {
	/**
	 * Update telemetry only; play no pre-recorded line (L01–L06). Used during ARES-01, which speaks its own
	 * scripted lines, so the assistant knows about the storm without talking over the mission.
	 */
	silent?: boolean;
}

export interface Assistant {
	/** MUST be called inside the «Enter VR» click handler, BEFORE navigator.xr.requestSession() (D20, D21). */
	unlock(): Promise<void>;
	setMissionContext(context?: string): void;
	/** Called at question time to get live distances to named places; return null when the position is unknown. */
	setPlacesProvider(provider: (() => Places | null) | null): void;
	/** Called at question time to report nearby rocks, steep slopes and mapped loose-sand zones. */
	setHazardsProvider(provider: (() => string[] | null) | null): void;
	setTemperatureForecastProvider(provider: (() => TemperatureForecastPoint[] | null) | null): void;
	/** Called at question time to report the visor state (minimap zoom, infrared) to Sara. */
	setVisorStateProvider(provider: (() => VisorState | null) | null): void;
	/** Visor actions Sara requests (zoom the minimap, infrared on/off). Fired when the reply arrives, before speech. */
	onAction(cb: (action: AssistantAction) => void): () => void;
	/** Start telemetry without playing the scripted mission-start line. */
	startMissionClock(): void;
	setExertion(level: Exertion): void;
	/** Push-to-talk: A button rising edge (or spacebar on the laptop). Interrupts current playback (D26). */
	pttDown(): void;
	/** Push-to-talk release: stops recording and runs STT → chat → TTS. */
	pttUp(): void;
	/** Mission events from the scene. mission_start also resets history + telemetry (D23). */
	notify(event: MissionEvent, options?: NotifyOptions): void;
	/** Force the current protocol step (operator keys 1–6). */
	setStep(step: ProtocolStepId): void;
	/** Clear history, telemetry clock and audio queue. */
	reset(): void;
	/**
	 * Scene clock for the weather replay: the visor's local sol (mars-time.ts scale — Mars Sol Date at
	 * Jezero LMST, the value passed to terrain.setTime). Undefined/null = real current Jezero time.
	 */
	setSceneClock(localSol?: number | null): void;
	/** Play a pre-generated line (high priority if it is an event line). */
	playLine(id: LineId): void;
	/** Speak a short proactive safety alert without interrupting an existing reply. */
	announce(text: string): void;
	onSubtitle(cb: (s: Subtitle) => void): () => void;
	onState(cb: (s: AssistantState) => void): () => void;
	getState(): AssistantState;
	dispose(): void;
}
