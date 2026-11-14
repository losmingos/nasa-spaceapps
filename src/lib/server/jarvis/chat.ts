// /api/chat logic: request validation + one Claude Haiku 5.5 call (spec §4.3).

import Anthropic from '@anthropic-ai/sdk';
import type { ChatRequest, ChatResponse, ChatTurn, Telemetry } from '#lib/jarvis/types.js';
import { isRecord } from '../http.js';
import { ARES_PROMPT } from '#lib/missions/ares01/jarvis-prompt.js';
import { NIGHTFALL_PROMPT } from '#lib/missions/ares02/jarvis-prompt.js';
import { SYSTEM_PROMPT } from './prompt.js';

function missionPrompt(context?: string) {
	if (!context) return SYSTEM_PROMPT;
	try {
		const data: unknown = JSON.parse(context);
		if (isRecord(data) && data.scenario === 'ARES-02') return NIGHTFALL_PROMPT;
	} catch {
		// Earlier clients may pass a plain-text mission context.
	}
	return ARES_PROMPT;
}

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

const TELEMETRY_NUMBERS = ['t_s', 'o2_remaining_min', 'suit_power_pct', 'visibility_m', 'distance_to_habitat_m'] as const;
const TELEMETRY_NULLABLE = ['storm_t_s', 'air_temp_c', 'pressure_pa', 'wind_ms', 'dust_opacity'] as const;

function cleanTelemetry(raw: Record<string, unknown>): Telemetry {
	// A missing/invalid reading becomes null (the prompt says null = no reading), never a made-up 0.
	const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
	const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
	const phase = typeof raw.phase === 'string' && ['idle', 'sampling', 'storm', 'safe'].includes(raw.phase) ? raw.phase : 'idle';
	const step =
		typeof raw.protocolStep === 'string' && /^P[1-6]$/.test(raw.protocolStep) ? raw.protocolStep : null;
	// Fixed key order so the JSON we send is deterministic.
	const t: Record<string, unknown> = {};
	for (const k of ['t_s', 'storm_t_s', 'phase', 'protocolStep', 'o2_remaining_min', 'suit_power_pct', 'visibility_m', 'distance_to_habitat_m', 'air_temp_c', 'pressure_pa', 'wind_ms', 'dust_opacity']) {
		if (k === 'phase') t[k] = phase;
		else if (k === 'protocolStep') t[k] = step;
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
	const { history, text, telemetry, missionContext } = body;
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
		value: { text: text.trim(), history: cleanHistory(history ?? []), telemetry: cleanTelemetry(telemetry), missionContext: missionContext as string | undefined }
	};
}

export async function runChat(apiKey: string, req: ChatRequest): Promise<ChatResponse> {
	const messages: Anthropic.MessageParam[] = [
		...req.history.map((t): Anthropic.MessageParam => ({ role: t.role, content: t.content })),
		{ role: 'user', content: `<telemetry>${JSON.stringify(req.missionContext ? { mission: req.missionContext } : req.telemetry)}</telemetry>\nAstronaut: ${req.text}` }
	];

	try {
		const res = await getClient(apiKey).messages.create({
			model: CHAT_MODEL,
			max_tokens: 2000,
			output_config: { effort: 'low' },
			system: [{ type: 'text', text: missionPrompt(req.missionContext), cache_control: { type: 'ephemeral' } }],
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
