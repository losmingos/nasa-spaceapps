// Shared helpers for the Jarvis test/operator pages (/operator, /vr-test).
import { LINES, buildLineVars, fillLine, type Line, type LineId } from '../lines.js';
import { PROTOCOL } from '../protocol.js';
import { HABITAT_BEARING, O2_START_MIN, ROUTE_LENGTH_M } from '../../missions/vr-rehearsal/route.js';
import meda from '../../data/meda-snapshot.json';
import type { AssistantStatus, CueId, CueState, Speaker, Telemetry } from '../types.js';

export const LINE_VARS = buildLineVars({
	routeLengthM: ROUTE_LENGTH_M,
	habitatBearing: HABITAT_BEARING,
	o2StartMin: O2_START_MIN,
	airTempC: meda.air_temp_c.value as number | null,
	pressurePa: meda.pressure_pa as number | null
});

/** The line's spoken text with {placeholders} filled from mission.ts + the MEDA snapshot. */
export function lineText(id: LineId): string {
	const line = LINES.find((l) => l.id === id);
	return line ? fillLine(line.template, LINE_VARS) : id;
}

/** The scripted question a Q-line answers, parsed from its trigger (`cue — "…"`). */
export function scriptedQuestion(line: Line): string {
	return /"(.+)"/.exec(line.trigger)?.[1] ?? line.trigger;
}

export const EVENT_LINES = LINES.filter((l) => l.kind === 'event');
export const ERROR_LINES = LINES.filter((l) => l.kind === 'error');
export const SCRIPTED_LINES = LINES.filter((l) => l.kind === 'scripted-answer');
export { PROTOCOL };

export const STATUS_LABEL: Record<AssistantStatus, string> = {
	locked: 'Audio locked',
	idle: 'Idle',
	recording: 'Recording',
	thinking: 'Thinking',
	speaking: 'Speaking'
};

export const STATUS_COLOR: Record<AssistantStatus, string> = {
	locked: '#8f7f78',
	idle: '#9fc49a',
	recording: '#ff6b5a',
	thinking: '#f0c46c',
	speaking: '#7fc3e8'
};

export const SPEAKER_LABEL: Record<Speaker, string> = { astronaut: 'Astronaut', jarvis: 'Sara' };
export const SPEAKER_COLOR: Record<Speaker, string> = { astronaut: '#f3ab82', jarvis: '#a9d4ec' };

/** `?k=<token>` from the page URL (tunnel mode, D15). */
export function demoToken(): string | null {
	if (typeof location === 'undefined') return null;
	return new URLSearchParams(location.search).get('k');
}

/** Operator cue channel (D28): POST /api/cue { id } → { seq }. */
export async function sendCue(id: CueId): Promise<CueState> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	const token = demoToken();
	if (token) headers['x-demo-token'] = token;
	const response = await fetch('/api/cue', { method: 'POST', headers, body: JSON.stringify({ id }) });
	if (!response.ok) throw new Error(`POST /api/cue → HTTP ${response.status}`);
	return (await response.json()) as CueState;
}

const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const fmt = (value: number | null, unit = '') =>
	value === null || !Number.isFinite(value) ? '—' : `${number.format(value).replace('-', '−')}${unit ? ` ${unit}` : ''}`;

const PHASE_LABEL: Record<Telemetry['phase'], string> = {
	idle: 'idle',
	sampling: 'sampling',
	storm: 'storm',
	safe: 'safe'
};

const MEDA_CURVE_LABEL: Record<NonNullable<Telemetry['meda_curve']>, string> = {
	season: 'same season',
	latest: 'latest published',
	'storm-blend': 'blend with sol 313 storm'
};

/** Telemetry as [label, value] rows for display. */
export function telemetryRows(t: Telemetry): [string, string][] {
	return [
		['Mission time', fmt(t.t_s, 's')],
		['Storm elapsed time', fmt(t.storm_t_s, 's')],
		['Phase', PHASE_LABEL[t.phase] ?? t.phase],
		['Protocol step', t.protocolStep ?? '—'],
		['O₂ remaining', fmt(t.o2_remaining_min, 'min')],
		['Suit power', fmt(t.suit_power_pct, '%')],
		['Visibility', fmt(t.visibility_m, 'm')],
		['Distance to habitat', fmt(t.distance_to_habitat_m, 'm')],
		['Air temperature', fmt(t.air_temp_c, '°C')],
		['Pressure', fmt(t.pressure_pa, 'Pa')],
		['Wind', fmt(t.wind_ms, 'm/s')],
		['Dust opacity', fmt(t.dust_opacity)],
		['Ground temperature', fmt(t.ground_temp_c, '°C')],
		['Relative humidity', fmt(t.relative_humidity_pct, '%')],
		['Local time (LMST)', t.lmst ?? '—'],
		['Mission sol · Ls', t.mission_sol === null ? '—' : `${t.mission_sol} · ${fmt(t.ls, '°')}`],
		['MEDA curve', t.meda_sol === null ? '—' : `sol ${t.meda_sol} (${MEDA_CURVE_LABEL[t.meda_curve ?? 'season']})`],
		['Latest published sol', t.meda_latest_sol === null ? '—' : `${t.meda_latest_sol} (${fmt(t.meda_data_age_sols)} sols ago)`],
		['Latest reading at this hour', `${fmt(t.latest_air_temp_c, '°C')} · ${fmt(t.latest_pressure_pa, 'Pa')}`],
		['Earth–Mars signal delay', fmt(t.signal_delay_min, 'min')]
	];
}
