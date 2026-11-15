// /api/chat logic: request validation + one Claude Haiku 5.5 call (spec §4.3).

import Anthropic from '@anthropic-ai/sdk';
import type { AssistantAction, ChatRequest, ChatResponse, ChatTurn, MapZoomAction, MedaCurve, Telemetry, VisorState } from '#lib/jarvis/types.js';
import type { Places } from '#lib/jarvis/places.js';
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, VOICE_ZOOM_FACTOR } from '#lib/jarvis/visor-control.js';
import { isRecord } from '../http.js';
import { SYSTEM_PROMPT } from './prompt.js';

export const CHAT_MODEL = 'claude-haiku-5-5';
const MAX_TURNS = 6;
const MAX_CHARS = 2000;

let client: Anthropic | null = null;
let clientKey = '';
function getClient(apiKey: string): Anthropic {
	if (!client || clientKey !== apiKey) {
		// Short timeout + one retry: a voice turn that takes longer is worse than the E02 fallback line.
		client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
		clientKey = apiKey;
	}
	return client;
}

type Validated = { ok: true; value: ChatRequest } | { ok: false; error: string };

const TELEMETRY_NUMBERS = ['t_s', 'o2_remaining_min', 'o2_remaining_pct', 'suit_power_pct', 'visibility_m', 'distance_to_habitat_m'] as const;
const TELEMETRY_NULLABLE = [
	'storm_t_s', 'air_temp_c', 'pressure_pa', 'wind_ms', 'dust_opacity', 'ground_temp_c', 'relative_humidity_pct',
	'mission_sol', 'ls', 'meda_sol', 'meda_latest_sol', 'meda_data_age_sols', 'latest_air_temp_c', 'latest_pressure_pa',
	'signal_delay_min'
] as const;
/** Every Telemetry key, in the order sent to the model. A key missing here is silently dropped. */
const TELEMETRY_KEYS = [
	't_s', 'storm_t_s', 'phase', 'protocolStep', 'o2_remaining_min', 'o2_remaining_pct', 'movement_mode', 'suit_power_pct', 'visibility_m',
	'distance_to_habitat_m', 'air_temp_c', 'pressure_pa', 'wind_ms', 'dust_opacity', 'ground_temp_c',
	'relative_humidity_pct', 'lmst', 'mission_sol', 'ls', 'meda_sol', 'meda_curve', 'meda_latest_sol',
	'meda_data_age_sols', 'latest_air_temp_c', 'latest_pressure_pa', 'signal_delay_min'
] as const satisfies readonly (keyof Telemetry)[];
// Compile-time check: adding a field to Telemetry without listing it above is a type error.
const allKeysListed: [Exclude<keyof Telemetry, (typeof TELEMETRY_KEYS)[number]>] extends [never] ? true : false = true;
void allKeysListed;
const MEDA_CURVES: readonly string[] = ['season', 'latest', 'storm-blend'] satisfies MedaCurve[];

function cleanTelemetry(raw: Record<string, unknown>): Telemetry {
	// A missing/invalid reading becomes null (the prompt says null = no reading), never a made-up 0.
	const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
	const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
	const phase = typeof raw.phase === 'string' && ['idle', 'sampling', 'storm', 'safe'].includes(raw.phase) ? raw.phase : 'idle';
	const step =
		typeof raw.protocolStep === 'string' && /^P[1-6]$/.test(raw.protocolStep) ? raw.protocolStep : null;
	// Fixed key order so the JSON we send is deterministic.
	const t: Record<string, unknown> = {};
	for (const k of TELEMETRY_KEYS) {
		if (k === 'phase') t[k] = phase;
		else if (k === 'protocolStep') t[k] = step;
		else if (k === 'lmst') t[k] = typeof raw.lmst === 'string' && /^\d\d:\d\d$/.test(raw.lmst) ? raw.lmst : null;
		else if (k === 'meda_curve') t[k] = typeof raw.meda_curve === 'string' && MEDA_CURVES.includes(raw.meda_curve) ? raw.meda_curve : null;
		else if (k === 'movement_mode') t[k] = ['resting', 'walking', 'running'].includes(String(raw[k])) ? raw[k] : 'resting';
		else if ((TELEMETRY_NUMBERS as readonly string[]).includes(k)) t[k] = num(raw[k]);
		else if ((TELEMETRY_NULLABLE as readonly string[]).includes(k)) t[k] = numOrNull(raw[k]);
	}
	return t as unknown as Telemetry;
}

/**
 * Keep only well-formed turns, enforce user/assistant alternation starting with 'user' and ending
 * with 'assistant' (the new user message is appended after), and keep the last MAX_TURNS.
 */
function cleanHistory(raw: unknown[]): ChatTurn[] {
	const turns: ChatTurn[] = [];
	for (const item of raw) {
		if (!isRecord(item)) continue;
		const { role, content } = item;
		if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue;
		const text = content.trim().slice(0, MAX_CHARS);
		if (!text) continue;
		const last = turns[turns.length - 1];
		if (last && last.role === role) {
			turns[turns.length - 1] = { role, content: text }; // keep the most recent of a same-role run
		} else {
			turns.push({ role, content: text });
		}
	}
	let out = turns.slice(-MAX_TURNS);
	while (out.length && out[0].role !== 'user') out = out.slice(1);
	while (out.length && out[out.length - 1].role !== 'assistant') out = out.slice(0, -1);
	return out;
}

export function validateChatRequest(body: unknown): Validated {
	if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object { history, text, telemetry }.' };
	const { history, text, telemetry, missionContext, places, visor } = body;
	if (missionContext !== undefined && (typeof missionContext !== 'string' || missionContext.length > 4000)) {
		return { ok: false, error: 'Invalid mission context.' };
	}
	if (typeof text !== 'string' || !text.trim()) return { ok: false, error: '`text` must be a non-empty string.' };
	if (text.length > MAX_CHARS) return { ok: false, error: `\`text\` must be at most ${MAX_CHARS} characters.` };
	if (history !== undefined && !Array.isArray(history)) return { ok: false, error: '`history` must be an array.' };
	if (Array.isArray(history) && history.length > 50) return { ok: false, error: '`history` is too long.' };
	if (!isRecord(telemetry)) return { ok: false, error: '`telemetry` object is required.' };
	return {
		ok: true,
		value: {
			text: text.trim(),
			history: cleanHistory(history ?? []),
			telemetry: cleanTelemetry(telemetry),
			missionContext: missionContext as string | undefined,
			places: cleanPlaces(places),
			visor: cleanVisor(visor)
		}
	};
}

/** Keep at most 8 well-formed place fixes ({ distance_m, bearing_deg, direction }); drop anything else. */
function cleanPlaces(raw: unknown): Places | undefined {
	if (!isRecord(raw)) return undefined;
	const out: Places = {};
	for (const [name, fix] of Object.entries(raw).slice(0, 8)) {
		if (!/^[a-z_]{1,20}$/.test(name) || !isRecord(fix)) continue;
		const { distance_m, bearing_deg, direction } = fix;
		if (typeof distance_m !== 'number' || !Number.isFinite(distance_m) || distance_m < 0 || distance_m > 1e6) continue;
		if (typeof bearing_deg !== 'number' || !Number.isFinite(bearing_deg)) continue;
		if (typeof direction !== 'string' || direction.length > 20) continue;
		out[name] = { distance_m: Math.round(distance_m), bearing_deg: Math.round(bearing_deg) % 360, direction };
	}
	return Object.keys(out).length ? out : undefined;
}

/**
 * One system prompt for every turn (the team's prompt + mission briefing, D37). During ARES-01 the scene's
 * mission state arrives as `missionContext` (a JSON string); it is passed to the model as DATA, nested under
 * `mission` inside the telemetry — never as instructions and never as a different prompt.
 */
function telemetryWithMission(req: ChatRequest): Record<string, unknown> {
	const out: Record<string, unknown> = { ...req.telemetry };
	if (req.places) out.places = req.places;
	if (req.visor) out.visor = req.visor;
	if (!req.missionContext) return out;
	let mission: unknown = req.missionContext;
	try {
		mission = JSON.parse(req.missionContext);
	} catch {
		// Not JSON: keep it as an opaque string.
	}
	out.mission = mission;
	return out;
}


/** Sara's tools. Static, so they stay inside the cached prompt prefix (tools render before the system prompt). */
const MAP_TOOL: Anthropic.Tool = {
	name: 'set_map_zoom',
	description:
		'Zoom the helmet minimap. Use it only when the astronaut asks to zoom, enlarge, reduce, get closer, see more area or reset the map. ' +
		`"in" makes the view ${VOICE_ZOOM_FACTOR} times closer (less area, more detail); "out" makes it ${VOICE_ZOOM_FACTOR} times wider (more area); ` +
		`"reset" returns to the default zoom of 1; "set" goes to an exact level between ${MAP_MIN_ZOOM} and ${MAP_MAX_ZOOM}.`,
	input_schema: {
		type: 'object',
		properties: {
			action: { type: 'string', enum: ['in', 'out', 'reset', 'set'] },
			level: { type: 'number', description: `Only for "set": the target zoom level, ${MAP_MIN_ZOOM} to ${MAP_MAX_ZOOM}.` }
		},
		required: ['action'],
		additionalProperties: false
	},
	strict: true
};

const INFRARED_TOOL: Anthropic.Tool = {
	name: 'set_infrared',
	description:
		'Turn the helmet SWIR infrared view on or off. Infrared sees through dust better than visible light. ' +
		'Use it only when the astronaut asks for infrared, thermal or SWIR vision, or to switch it off, and only if visor.infrared_available is true.',
	input_schema: {
		type: 'object',
		properties: { on: { type: 'boolean', description: 'true to turn infrared on, false to turn it off.' } },
		required: ['on'],
		additionalProperties: false
	},
	strict: true
};

const TOOLS: Anthropic.Tool[] = [MAP_TOOL, INFRARED_TOOL];

const MAP_CONFIRMATION: Record<MapZoomAction, string> = {
	in: 'Copy, zooming the map in.',
	out: 'Copy, zooming the map out.',
	reset: 'Copy, map back to the default zoom.',
	set: 'Copy, map zoom set.'
};

function confirmation(action: AssistantAction): string {
	if (action.type === 'infrared') return action.on ? 'Copy, infrared on.' : 'Copy, infrared off.';
	return MAP_CONFIRMATION[action.action];
}

/** Tool calls → visor actions (validated; anything malformed is dropped). At most one action per kind. */
function actionsFrom(content: Anthropic.ContentBlock[]): AssistantAction[] {
	let map: AssistantAction | undefined;
	let infrared: AssistantAction | undefined;
	for (const block of content) {
		if (block.type !== 'tool_use' || !isRecord(block.input)) continue;
		if (block.name === MAP_TOOL.name && !map) {
			const { action, level } = block.input;
			if (action !== 'in' && action !== 'out' && action !== 'reset' && action !== 'set') continue;
			if (action === 'set') {
				if (typeof level !== 'number' || !Number.isFinite(level)) continue;
				map = { type: 'map_zoom', action, level: Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, level)) };
			} else {
				map = { type: 'map_zoom', action };
			}
		} else if (block.name === INFRARED_TOOL.name && !infrared && typeof block.input.on === 'boolean') {
			infrared = { type: 'infrared', on: block.input.on };
		}
	}
	return [map, infrared].filter((a): a is AssistantAction => !!a);
}

function cleanVisor(raw: unknown): VisorState | undefined {
	if (!isRecord(raw) || typeof raw.map_zoom !== 'number' || !Number.isFinite(raw.map_zoom)) return undefined;
	return {
		map_zoom: Math.round(raw.map_zoom * 100) / 100,
		map_min_zoom: MAP_MIN_ZOOM,
		map_max_zoom: MAP_MAX_ZOOM,
		infrared_on: raw.infrared_on === true,
		infrared_available: raw.infrared_available === true
	};
}

export async function runChat(apiKey: string, req: ChatRequest): Promise<ChatResponse> {
	const messages: Anthropic.MessageParam[] = [
		...req.history.map((t): Anthropic.MessageParam => ({ role: t.role, content: t.content })),
		{ role: 'user', content: `<telemetry>${JSON.stringify(telemetryWithMission(req))}</telemetry>\nAstronaut: ${req.text}` }
	];

	try {
		const res = await getClient(apiKey).messages.create({
			model: CHAT_MODEL,
			max_tokens: 2000,
			output_config: { effort: 'low' },
			tools: TOOLS,
			system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
			messages
		});

		const u = res.usage;
		console.log(
			`[chat] ${res.stop_reason} in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`
		);

		if (res.stop_reason === 'refusal') {
			console.warn('[chat] refusal', res.stop_details ?? '');
			return { reply: '', fallback: 'E02' };
		}

		const reply = res.content
			.filter((b): b is Anthropic.TextBlock => b.type === 'text')
			.map((b) => b.text)
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
		// The tool call is executed by the visor; we don't send a tool_result back (one round trip keeps latency
		// low), so a reply with only a tool call gets a fixed spoken confirmation.
		const actions = actionsFrom(res.content);
		if (actions.length) return { reply: reply || actions.map(confirmation).join(" "), actions };
		if (!reply) return { reply: '', fallback: 'E02' };
		return { reply };
	} catch (err) {
		if (err instanceof Anthropic.RateLimitError) {
			console.error('[chat] rate limited:', err.message);
		} else if (err instanceof Anthropic.AuthenticationError) {
			console.error('[chat] invalid ANTHROPIC_API_KEY:', err.message);
		} else if (err instanceof Anthropic.APIConnectionError) {
			// Includes APIConnectionTimeoutError. Checked before APIError because it extends it.
			console.error('[chat] connection error:', err.message);
		} else if (err instanceof Anthropic.APIError) {
			console.error(`[chat] API error ${err.status}:`, err.message);
		} else {
			console.error('[chat] unexpected error:', err);
		}
		return { reply: '', fallback: 'E02' };
	}
}
