// Pre-recorded Jarvis lines (spec §5.4). Text templates use {placeholders} filled from mission.ts + the MEDA snapshot.
// scripts/gen_lines.ts renders each line to static/jarvis/<id>.mp3 with ElevenLabs (D24).
// DRAFT TEXTS — validate with the team. Keep this file import-free (Node imports it directly from the script).

export type LineId =
	| 'L01' | 'L02' | 'L03' | 'L04' | 'L05' | 'L06'
	| 'E01' | 'E02'
	| 'Q1' | 'Q2' | 'Q3' | 'Q4';

export type LineKind = 'event' | 'error' | 'scripted-answer';

export interface Line {
	id: LineId;
	kind: LineKind;
	/** What triggers it (documentation; the client wires event lines to mission events). */
	trigger: string;
	template: string;
}

export const LINES: readonly Line[] = [
	{ id: 'L01', kind: 'event', trigger: 'mission_start', template: 'Jarvis online. Sample site is ahead. Air temperature {air_temp_c} degrees Celsius, pressure {pressure_hpa} hectopascals. Conditions nominal.' },
	{ id: 'L02', kind: 'event', trigger: 'sample_collected', template: 'Sample logged. Seal it and prepare to head back.' },
	{ id: 'L03', kind: 'event', trigger: 'storm_start', template: 'Warning: dust storm front approaching from the west. Protocol step one: stop sampling and secure the sample now.' },
	{ id: 'L04', kind: 'event', trigger: 'storm_start + 30 s', template: 'Visibility is dropping fast. Switch on your lights and beacon, and save suit power.' },
	{ id: 'L05', kind: 'event', trigger: 'P5', template: 'Visibility under twenty metres. Hold position. I have your beacon.' },
	{ id: 'L06', kind: 'event', trigger: 'P6', template: 'Airlock in range. Dust off before you enter. Well done.' },
	{ id: 'E01', kind: 'error', trigger: 'empty transcript', template: "Say again, I didn't copy." },
	{ id: 'E02', kind: 'error', trigger: 'chat error or refusal', template: 'Comms are degraded. Follow the protocol: return to the habitat.' },
	{ id: 'Q1', kind: 'scripted-answer', trigger: 'cue — "Jarvis, what do I do?"', template: 'Protocol step one: stop sampling, seal the sample tube and stow it. Then check your helmet seal and switch on your lights.' },
	{ id: 'Q2', kind: 'scripted-answer', trigger: 'cue — "How far is the habitat?"', template: 'The habitat is {route_length_m} metres {habitat_bearing}, along the marked route. Stay on the route; no shortcuts across the scarps.' },
	{ id: 'Q3', kind: 'scripted-answer', trigger: 'cue — "How much oxygen do I have?"', template: 'About {o2_start_min} minutes at normal effort, less while you walk in the storm. That is enough to reach the habitat.' },
	{ id: 'Q4', kind: 'scripted-answer', trigger: 'cue — "Is the wind going to knock me over?"', template: 'No. At {pressure_hpa} hectopascals the air is far too thin to knock you over. The danger is visibility and suit power, so stay on the route.' }
] as const;

export const LINE_IDS = LINES.map((l) => l.id);

/** Public URL of the pre-generated mp3 for a line. */
export const lineUrl = (id: LineId) => `/jarvis/${id}.mp3`;

export interface LineVarInputs {
	routeLengthM: number;
	habitatBearing: string;
	o2StartMin: number;
	airTempC: number | null;
	pressurePa: number | null;
}

/** Build template variables. Fallbacks are typical published Jezero values, used only if the MEDA snapshot lacks data. */
export function buildLineVars(i: LineVarInputs): Record<string, string> {
	const airTemp = i.airTempC ?? -20;
	const pressureHpa = (i.pressurePa ?? 650) / 100;
	return {
		route_length_m: String(Math.round(i.routeLengthM / 10) * 10),
		habitat_bearing: i.habitatBearing,
		o2_start_min: String(Math.round(i.o2StartMin)),
		air_temp_c: airTemp < 0 ? `minus ${Math.round(-airTemp)}` : String(Math.round(airTemp)),
		pressure_hpa: pressureHpa.toFixed(1).replace(/\.0$/, '')
	};
}

export function fillLine(template: string, vars: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

export function getLine(id: LineId): Line {
	const line = LINES.find((l) => l.id === id);
	if (!line) throw new Error(`Unknown line ${id}`);
	return line;
}
