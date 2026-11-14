// Build src/lib/data/meda-curves.json from the Mars 2020 MEDA archive on the NASA PDS Atmospheres Node.
//
//   npm run data:meda                         discover the newest sols, download what is missing, rebuild the JSON
//   npm run data:meda -- --cache <dir>        where downloads are cached (default .cache/meda, gitignored)
//   npm run data:meda -- --refresh            re-fetch directory listings even if cached (< 20 h old otherwise)
//   npm run data:meda -- --tries 6            max candidate sols evaluated per Ls bin and Mars year (default 6)
//
// Output (see src/lib/data/README.md): for each selected sol, 144 values (10-minute LMST bins, mean of
// the samples in the bin, null when there is no sample) of air temperature, pressure, relative humidity,
// ground temperature and wind (wind only exists up to sol 313). Curves: `latest` (newest usable sol),
// `season` (one sol per 10° Ls bin, newest Mars year first) and `storm` (sol 313, January 2022 storm).
//
// Polite to the server: one request at a time, a pause between requests, and every CSV is cached on
// disk by its versioned file name, so re-runs only download new products. Runs with plain Node 24.

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MISSION_SOL_OFFSET, lsAtLocalSol, marsYearAtLocalSol } from '../src/lib/mars-clock.ts';

const BASE = 'https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/';
const STEP_MIN = 10;
const BINS = 1440 / STEP_MIN;
const STORM_SOL = 313;
const LISTING_TTL_MS = 20 * 3600 * 1000;
const DELAY_MS = 400;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argValue = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
};
const cacheDir = path.resolve(argValue('--cache') ?? path.join(root, '.cache', 'meda'));
const outFile = path.resolve(argValue('--out') ?? path.join(root, 'src', 'lib', 'data', 'meda-curves.json'));
const refresh = args.includes('--refresh');
const maxTries = Number(argValue('--tries') ?? 6);

// ---- polite cached HTTP --------------------------------------------------------------------------

let lastRequest = 0;
let downloadedBytes = 0;
let requests = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET BASE+rel as text, cached under cacheDir. Listings (rel ending in '/') expire; files never do. Null on 404. */
async function get(rel: string): Promise<string | null> {
	const listing = rel.endsWith('/');
	const file = path.join(cacheDir, ...(listing ? [...rel.split('/').filter(Boolean), 'index.html'] : rel.split('/')));
	const missing = `${file}.404`;
	if (existsSync(file) && (!listing || (!refresh && Date.now() - statSync(file).mtimeMs < LISTING_TTL_MS))) {
		return readFileSync(file, 'utf8');
	}
	if (!listing && existsSync(missing)) return null;
	for (let attempt = 1; ; attempt++) {
		const wait = lastRequest + DELAY_MS - Date.now();
		if (wait > 0) await sleep(wait);
		lastRequest = Date.now();
		requests++;
		try {
			const res = await fetch(BASE + rel, { headers: { 'user-agent': 'meda-curves-build/1.0' } });
			if (res.status === 404) {
				mkdirSync(path.dirname(missing), { recursive: true });
				if (!listing) writeFileSync(missing, '');
				return null;
			}
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const text = await res.text();
			downloadedBytes += text.length;
			mkdirSync(path.dirname(file), { recursive: true });
			writeFileSync(`${file}.part`, text);
			renameSync(`${file}.part`, file);
			return text;
		} catch (err) {
			if (attempt >= 3) throw new Error(`GET ${rel} failed: ${err instanceof Error ? err.message : err}`);
			await sleep(2000 * attempt);
		}
	}
}

const hrefs = (html: string) =>
	[...html.matchAll(/href="([^"?/][^"]*)"/g)].map((m) => m[1]);

// ---- archive discovery ---------------------------------------------------------------------------

type Collection = 'data_calibrated_env' | 'data_derived_env';
/** mission sol → range folder (e.g. 'sol_1740_1859'), from the calibrated collection. */
const solFolder = new Map<number, string>();

async function discover(): Promise<number> {
	const top = await get('data_calibrated_env/');
	if (!top) throw new Error('Cannot list data_calibrated_env/');
	const ranges = hrefs(top).filter((h) => /^sol_\d{4}_\d{4}\/$/.test(h)).map((h) => h.slice(0, -1));
	for (const range of ranges) {
		const html = await get(`data_calibrated_env/${range}/`);
		for (const h of hrefs(html ?? '')) {
			const m = /^sol_(\d{4})\/$/.exec(h);
			if (m) solFolder.set(Number(m[1]), range);
		}
	}
	return Math.max(...solFolder.keys());
}

const productCache = new Map<string, string[]>();
async function products(collection: Collection, sol: number): Promise<string[]> {
	const range = solFolder.get(sol);
	if (!range) return [];
	const rel = `${collection}/${range}/sol_${String(sol).padStart(4, '0')}/`;
	let list = productCache.get(rel);
	if (!list) {
		list = hrefs((await get(rel)) ?? '').filter((h) => /\.(CSV|xml)$/i.test(h));
		productCache.set(rel, list);
	}
	return list;
}

/** Relative path of the newest version (highest Pnn) of a product, e.g. kind 'CAL_ATS'. */
async function product(collection: Collection, sol: number, kind: string, ext = 'CSV'): Promise<string | null> {
	const re = new RegExp(`^WE__${String(sol).padStart(4, '0')}_+${kind}_+P(\\d+)\\.${ext}$`, 'i');
	const names = (await products(collection, sol)).filter((n) => re.test(n)).sort();
	const name = names.at(-1);
	return name ? `${collection}/${solFolder.get(sol)}/sol_${String(sol).padStart(4, '0')}/${name}` : null;
}

// ---- CSV reduction -------------------------------------------------------------------------------

type Bins = (number | null)[];

/**
 * Mean per 10-minute LMST bin of `pick(row)`, only for rows of this sol (LMST "01859M13:42:15.123").
 * Values outside [lo, hi] (fill values such as 999999999, glitches) are ignored.
 */
function reduce(csv: string, sol: number, columns: string[], lo: number, hi: number, combine: (v: number[]) => number): Bins {
	const lines = csv.split(/\r?\n/);
	const header = lines[0].split(',');
	const lmstIdx = header.indexOf('LMST');
	const idx = columns.map((c) => header.indexOf(c));
	if (lmstIdx < 0 || idx.some((i) => i < 0)) throw new Error(`Missing column(s) ${columns.join('/')} in ${header.join(',')}`);
	const sum = new Float64Array(BINS);
	const count = new Uint32Array(BINS);
	for (let r = 1; r < lines.length; r++) {
		const f = lines[r].split(',');
		const lmst = f[lmstIdx];
		if (!lmst) continue;
		const m = /^(\d+)M(\d\d):(\d\d):(\d\d)/.exec(lmst);
		if (!m || Number(m[1]) !== sol) continue;
		const vals: number[] = [];
		for (const i of idx) {
			const v = f[i] === '' || f[i] === undefined ? NaN : Number(f[i]);
			if (Number.isFinite(v) && v >= lo && v <= hi) vals.push(v);
		}
		if (!vals.length) continue;
		const bin = Math.floor((Number(m[2]) * 60 + Number(m[3])) / STEP_MIN);
		if (bin < 0 || bin >= BINS) continue;
		sum[bin] += combine(vals);
		count[bin]++;
	}
	return Array.from(sum, (s, i) => (count[i] ? s / count[i] : null));
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const filled = (b: Bins | null) => (b ? b.filter((v) => v !== null).length : 0);
/** Longest run of empty bins, wrapping around midnight. */
function maxGap(b: Bins): number {
	if (!filled(b)) return BINS;
	let best = 0;
	let run = 0;
	for (let i = 0; i < 2 * BINS; i++) {
		run = b[i % BINS] === null ? run + 1 : 0;
		best = Math.max(best, Math.min(run, BINS));
	}
	return best;
}
const roundBins = (b: Bins | null, k: (v: number) => number = (v) => v) =>
	b && filled(b) ? b.map((v) => (v === null ? null : Math.round(k(v) * 10) / 10)) : null;

// ---- per-sol evaluation --------------------------------------------------------------------------

interface SolData {
	sol: number;
	files: Record<string, string>;
	air: Bins | null;
	pressure: Bins | null;
}

/** Download (or read from cache) air temperature + pressure and judge whether the sol is usable. */
async function evaluate(sol: number): Promise<SolData & { good: boolean }> {
	const files: Record<string, string> = {};
	const ats = await product('data_calibrated_env', sol, 'CAL_ATS');
	const ps = await product('data_derived_env', sol, 'DER_PS');
	let air: Bins | null = null;
	let pressure: Bins | null = null;
	if (ats) {
		const csv = await get(ats);
		// ATS 1–3: the three sensors on the Remote Sensing Mast booms (~1.45 m); 4–5 sit on the rover body.
		if (csv) air = reduce(csv, sol, ['ATS_LOCAL_TEMP1', 'ATS_LOCAL_TEMP2', 'ATS_LOCAL_TEMP3'], 100, 350, mean);
		files.air_temp = ats;
	}
	if (ps) {
		const csv = await get(ps);
		if (csv) pressure = reduce(csv, sol, ['PRESSURE'], 300, 1300, mean);
		files.pressure = ps;
	}
	const ok = (b: Bins | null) => !!b && filled(b) >= 48 && maxGap(b) <= 12;
	return { sol, files, air, pressure, good: ok(air) && ok(pressure) };
}

interface Curve {
	sol: number;
	mars_year: number;
	ls: number;
	ls_bin: number;
	utc_start: string | null;
	utc_end: string | null;
	region: string;
	files: Record<string, string>;
	sensors_missing: string[];
	air_temp_c: Bins | null;
	pressure_pa: Bins | null;
	relative_humidity_pct: Bins | null;
	ground_temp_c: Bins | null;
	wind_ms: Bins | null;
}

const labelLs: { sol: number; label: number; computed: number }[] = [];

/** Rover setting by mission sol (approximate; Perseverance crossed Jezero's rim in December 2024, ~sol 1355). */
function region(sol: number): string {
	if (sol < 1250) return 'inside Jezero crater (crater floor and western delta)';
	if (sol < 1355) return "climbing Jezero's western rim";
	return "on Jezero's western rim, outside the crater floor";
}

async function complete(d: SolData): Promise<Curve> {
	const { sol } = d;
	const files = { ...d.files };
	const rhs = await product('data_derived_env', sol, 'DER_RHS');
	const tirs = await product('data_calibrated_env', sol, 'CAL_TIRS');
	const ws = await product('data_derived_env', sol, 'DER_WS');
	const label = await product('data_calibrated_env', sol, 'CAL_ATS', 'xml');
	let rh: Bins | null = null;
	let ground: Bins | null = null;
	let wind: Bins | null = null;
	if (rhs) {
		const csv = await get(rhs);
		if (csv) rh = reduce(csv, sol, ['LOCAL_RELATIVE_HUMIDITY'], 0, 100, mean);
		files.humidity = rhs;
	}
	if (tirs) {
		const csv = await get(tirs);
		if (csv) ground = reduce(csv, sol, ['GROUND_TEMP'], 100, 350, mean);
		files.ground_temp = tirs;
	}
	if (ws) {
		const csv = await get(ws);
		if (csv) wind = reduce(csv, sol, ['HORIZONTAL_WIND_SPEED'], 0, 60, mean);
		files.wind = ws;
	}
	let utcStart: string | null = null;
	let utcEnd: string | null = null;
	if (label) {
		const xml = (await get(label)) ?? '';
		utcStart = /<start_date_time>([^<]+)</.exec(xml)?.[1] ?? null;
		utcEnd = /<stop_date_time>([^<]+)</.exec(xml)?.[1] ?? null;
		const l = Number(/start_solar_longitude[^>]*>([^<]+)</.exec(xml)?.[1]);
		if (Number.isFinite(l)) labelLs.push({ sol, label: l, computed: lsAtLocalSol(sol + MISSION_SOL_OFFSET) });
	}
	const missing = (
		[['ATS', d.air], ['PS', d.pressure], ['RHS', rh], ['TIRS', ground], ['WS', wind]] as const
	).filter(([, b]) => !filled(b)).map(([n]) => n);
	const mid = sol + MISSION_SOL_OFFSET + 0.5;
	const ls = lsAtLocalSol(mid);
	const k2c = (v: number) => v - 273.15;
	return {
		sol,
		mars_year: marsYearAtLocalSol(mid),
		ls: Math.round(ls * 10) / 10,
		ls_bin: Math.floor(ls / 10),
		utc_start: utcStart,
		utc_end: utcEnd,
		region: region(sol),
		files,
		sensors_missing: missing,
		air_temp_c: roundBins(d.air, k2c),
		pressure_pa: roundBins(d.pressure),
		relative_humidity_pct: roundBins(rh),
		ground_temp_c: roundBins(ground, k2c),
		wind_ms: roundBins(wind)
	};
}

// ---- main ----------------------------------------------------------------------------------------

async function main() {
	console.log(`MEDA curves build — cache ${cacheDir}`);
	const newest = await discover();
	const sols = [...solFolder.keys()].sort((a, b) => a - b);
	console.log(`Archive: ${sols.length} sol folders, sols ${sols[0]}–${newest}`);

	const evaluated = new Map<number, Awaited<ReturnType<typeof evaluate>>>();
	const evalSol = async (sol: number) => {
		let e = evaluated.get(sol);
		if (!e) {
			e = await evaluate(sol);
			evaluated.set(sol, e);
			const g = (b: Bins | null) => `${filled(b)}/${BINS}`;
			console.log(`  sol ${sol}: air ${g(e.air)} pressure ${g(e.pressure)} → ${e.good ? 'usable' : 'skip'}`);
		}
		return e;
	};

	// (a) latest: newest sol with usable temperature + pressure.
	let latest: SolData | null = null;
	for (const sol of [...sols].reverse().slice(0, 15)) {
		const e = await evalSol(sol);
		if (e.good) {
			latest = e;
			break;
		}
	}
	if (!latest) throw new Error('No usable sol among the newest 15.');

	// (b) season library: one sol per 10° Ls bin, newest Mars year first, closest to the bin centre.
	const info = sols.map((sol) => {
		const mid = sol + MISSION_SOL_OFFSET + 0.5;
		const ls = lsAtLocalSol(mid);
		return { sol, ls, bin: Math.floor(ls / 10), my: marsYearAtLocalSol(mid) };
	});
	const season: SolData[] = [];
	const emptyBins: number[] = [];
	for (let bin = 0; bin < 36; bin++) {
		const centre = bin * 10 + 5;
		// Up to `maxTries` sols per Mars year (newest year first), so a sparse year falls back to an older one.
		const inBin = info.filter((i) => i.bin === bin && i.sol !== STORM_SOL);
		const candidates = [...new Set(inBin.map((i) => i.my))]
			.sort((a, b) => b - a)
			.flatMap((my) =>
				inBin
					.filter((i) => i.my === my)
					.sort((a, b) => Math.abs(a.ls - centre) - Math.abs(b.ls - centre))
					.slice(0, maxTries)
			);
		let pick: SolData | null = null;
		for (const c of candidates) {
			const e = await evalSol(c.sol);
			if (e.good) {
				pick = e;
				break;
			}
		}
		if (pick) season.push(pick);
		else emptyBins.push(bin);
	}

	// (c) storm: sol 313, the January 2022 regional dust storm (includes wind until ~13:08 LMST).
	const storm = await evalSol(STORM_SOL);

	console.log('Completing selected sols (humidity, ground temperature, wind, labels)…');
	const done = new Map<number, Curve>();
	const finish = async (d: SolData) => {
		let c = done.get(d.sol);
		if (!c) {
			c = await complete(d);
			done.set(d.sol, c);
		}
		return c;
	};
	const latestCurve = await finish(latest);
	const stormCurve = await finish(storm);
	const seasonCurves: Curve[] = [];
	for (const d of season) seasonCurves.push(await finish(d));

	const out = {
		schema: 1,
		built_utc: new Date().toISOString().slice(0, 19) + 'Z',
		source: 'NASA PDS Atmospheres Node — Mars 2020 MEDA bundle (calibrated + derived environmental data)',
		base_url: BASE,
		step_min: STEP_MIN,
		latest_published_sol: latestCurve.sol,
		newest_archive_sol: newest,
		method:
			'Mean of all samples in each 10-minute LMST bin (bin i covers minutes 10i to 10i+10 after local midnight); null = no sample. ' +
			'air_temp_c = mean of ATS_LOCAL_TEMP1-3 (mast booms, ~1.45 m) from CAL_ATS; pressure_pa = PRESSURE from DER_PS; ' +
			'relative_humidity_pct = LOCAL_RELATIVE_HUMIDITY from DER_RHS; ground_temp_c = GROUND_TEMP (TIRS brightness temperature) from CAL_TIRS; ' +
			'wind_ms = HORIZONTAL_WIND_SPEED from DER_WS (only exists up to sol 313). Ls and Mars year: Allison & McEwen (2000) / Mars24, mission sol 0 = local sol 52304.',
		caveats: [
			'MEDA data is released to the PDS in batches (about three times a year); this is not a live feed.',
			'MEDA normally samples about 30 minutes of every hour, so many bins are null; clients interpolate across gaps.',
			"Wind: derived wind ends on sol 313 at about 13:08 LMST (sensor damaged by wind-blown debris); there is no wind afterwards.",
			"Perseverance crossed Jezero's rim in December 2024 (about sol 1355): recent curves are from the crater rim, not the crater floor or the delta.",
			'No dust optical depth in these curves (MEDA RDS would need a radiative-transfer retrieval).'
		],
		dust_opacity: {
			pre_storm_sol_311: 0.327,
			storm_peak_approx: 2,
			sources: [
				'Lemmon, M. T. (2026), Mastcam-Z Visible Aerosol Optical Depth Record v2, Mendeley Data, doi:10.17632/gktjp9jptb.2 (sol 311: tau 0.327 at 544 nm, preliminary)',
				'Lemmon, M. T., et al. (2022), Dust, Sand, and Winds Within an Active Martian Storm in Jezero Crater, GRL 49, e2022GL100126, doi:10.1029/2022GL100126 (peak visible optical depth ~2)'
			]
		},
		empty_ls_bins: emptyBins,
		curves: { latest: latestCurve, storm: stormCurve, season: seasonCurves }
	};

	const json = JSON.stringify(out, null, '\t').replace(/\[\s+([-\d.,\snul]+?)\s+\]/g, (_m, inner: string) => `[${inner.replace(/\s+/g, '')}]`);
	mkdirSync(path.dirname(outFile), { recursive: true });
	writeFileSync(outFile, json + '\n');

	// ---- summary ----
	console.log('\nSeason library (Ls bin → sol):');
	for (const c of seasonCurves) {
		const f = (b: Bins | null) => String(filled(b)).padStart(3);
		console.log(
			`  Ls ${String(c.ls_bin * 10).padStart(3)}–${String(c.ls_bin * 10 + 10).padEnd(3)} sol ${String(c.sol).padStart(4)}  MY ${c.mars_year}  Ls ${c.ls.toFixed(1).padStart(5)}  bins T${f(c.air_temp_c)} P${f(c.pressure_pa)} RH${f(c.relative_humidity_pct)} G${f(c.ground_temp_c)}  missing [${c.sensors_missing.join(',')}]`
		);
	}
	const dLs = labelLs.map((l) => Math.abs(((l.computed - l.label + 540) % 360) - 180));
	console.log(`\nLatest usable sol: ${latestCurve.sol} (MY ${latestCurve.mars_year}, Ls ${latestCurve.ls}, ${latestCurve.utc_start} → ${latestCurve.utc_end})`);
	console.log(`Storm sol: ${stormCurve.sol} (Ls ${stormCurve.ls}), wind bins ${filled(stormCurve.wind_ms)}`);
	console.log(`Season bins filled: ${seasonCurves.length}/36${emptyBins.length ? ` (empty: ${emptyBins.map((b) => b * 10).join(', ')})` : ''}`);
	console.log(`Ls check vs PDS labels (sol start): max |Δ| = ${Math.max(...dLs).toFixed(3)}° over ${dLs.length} sols (label start_solar_longitude vs Mars24 at LMST 00:00)`);
	console.log(`Wrote ${path.relative(root, outFile)} (${(json.length / 1024).toFixed(1)} KB). Requests: ${requests}, downloaded ${(downloadedBytes / 1e6).toFixed(1)} MB.`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
