// Render the pre-recorded Jarvis lines (src/lib/jarvis/lines.ts) to static/jarvis/<id>.mp3 with ElevenLabs (D24).
//
//   npm run gen:lines                    generate missing mp3s
//   npm run gen:lines -- --force         regenerate all
//   npm run gen:lines -- --only L03,Q2   only these ids (combine with --force to overwrite)
//   npm run gen:lines -- --dry-run       print the filled texts only (no key needed)
//
// Runs with plain Node 24 (native type stripping): imports use explicit .ts extensions.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINES, buildLineVars, fillLine } from '../src/lib/jarvis/lines.ts';
import { HABITAT_BEARING, O2_START_MIN, ROUTE_LENGTH_M } from '../src/lib/mission.ts';
import { DEFAULT_ELEVENLABS_MODEL_ID, elevenLabsTts } from '../src/lib/server/jarvis/elevenlabs.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'static', 'jarvis');

const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const onlyIdx = args.indexOf('--only');
const onlyArg = onlyIdx >= 0 ? args[onlyIdx + 1] : args.find((a) => a.startsWith('--only='))?.slice(7);
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim()).filter(Boolean)) : null;

if (only) {
	const known = new Set<string>(LINES.map((l) => l.id));
	const unknown = [...only].filter((id) => !known.has(id));
	if (unknown.length) {
		console.error(`Unknown line id(s): ${unknown.join(', ')}. Known: ${[...known].join(', ')}`);
		process.exit(1);
	}
}

// .env (same file SvelteKit reads). Shell variables take precedence.
try {
	process.loadEnvFile(path.join(root, '.env'));
} catch {
	// no .env — fine for --dry-run
}

const meda = JSON.parse(readFileSync(path.join(root, 'src', 'lib', 'data', 'meda-snapshot.json'), 'utf8')) as {
	air_temp_c?: { value?: number | null } | null;
	pressure_pa?: number | null;
};

const vars = buildLineVars({
	routeLengthM: ROUTE_LENGTH_M,
	habitatBearing: HABITAT_BEARING,
	o2StartMin: O2_START_MIN,
	airTempC: meda.air_temp_c?.value ?? null,
	pressurePa: meda.pressure_pa ?? null
});

const lines = LINES.filter((l) => !only || only.has(l.id)).map((l) => ({
	id: l.id,
	text: fillLine(l.template, vars),
	file: path.join(outDir, `${l.id}.mp3`)
}));

const warnings: string[] = [];
if (ROUTE_LENGTH_M <= 0) warnings.push('ROUTE_LENGTH_M is 0 (placeholder mission.ts) — Q2 will say "0 metres".');
if (meda.air_temp_c?.value == null) warnings.push('MEDA air_temp_c is null — L01 uses the fallback -20 °C.');
if (meda.pressure_pa == null) warnings.push('MEDA pressure_pa is null — L01/Q4 use the fallback 650 Pa.');
for (const l of lines) {
	const left = l.text.match(/\{\w+\}/g);
	if (left) warnings.push(`${l.id} has unfilled placeholders: ${left.join(', ')}`);
}

const printHeader = () => {
	console.log('id   | status   | text');
	console.log('-----|----------|' + '-'.repeat(60));
};
const printRow = (id: string, status: string, text: string) => console.log(`${id.padEnd(4)} | ${status.padEnd(8)} | ${text}`);

if (dryRun) {
	printHeader();
	for (const l of lines) printRow(l.id, existsSync(l.file) ? 'exists' : 'missing', l.text);
	for (const w of warnings) console.warn(`WARNING: ${w}`);
	process.exit(0);
}

const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_ELEVENLABS_MODEL_ID;
const missing = [!apiKey && 'ELEVENLABS_API_KEY', !voiceId && 'ELEVENLABS_VOICE_ID'].filter(Boolean);
if (!apiKey || !voiceId) {
	console.error(`Missing ${missing.join(' and ')} in .env (see .env.example). Use --dry-run to only print the texts.`);
	process.exit(1);
}

for (const w of warnings) console.warn(`WARNING: ${w}`);
mkdirSync(outDir, { recursive: true });
printHeader();

let failed = 0;
for (const l of lines) {
	if (!force && existsSync(l.file)) {
		printRow(l.id, 'skipped', l.text);
		continue;
	}
	try {
		const audio = await elevenLabsTts({ apiKey, voiceId, modelId, text: l.text });
		writeFileSync(l.file, audio);
		printRow(l.id, 'written', l.text);
	} catch (err) {
		failed++;
		printRow(l.id, 'FAILED', `${l.text}  [${err instanceof Error ? err.message : String(err)}]`);
	}
}

console.log(`\nmodel ${modelId}, voice ${voiceId} → ${path.relative(root, outDir)}${failed ? ` — ${failed} failed` : ''}`);
process.exit(failed ? 1 : 0);
