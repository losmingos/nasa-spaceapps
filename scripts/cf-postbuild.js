// Runs after `vite build` (see package.json "build"). @sveltejs/adapter-cloudflare generates the Worker entry
// but cannot export extra classes, so this appends the Durable Object export Wrangler needs for the
// JARVIS_CUE binding (wrangler.jsonc). Wrangler bundles the TypeScript source at deploy time.
import fs from 'node:fs';
import path from 'node:path';

const worker = path.resolve('.svelte-kit/cloudflare/_worker.js');
const source = path.resolve('src/lib/server/jarvis/cue-do.ts');
const line = `export { CueChannel } from './${path.relative(path.dirname(worker), source).split(path.sep).join('/')}';`;

if (!fs.existsSync(worker)) {
	console.error(`[cf-postbuild] ${worker} not found — did vite build run with @sveltejs/adapter-cloudflare?`);
	process.exit(1);
}
const code = fs.readFileSync(worker, 'utf8');
if (!code.includes('export { CueChannel }')) {
	fs.appendFileSync(worker, `\n// Added by scripts/cf-postbuild.js — Jarvis cue channel Durable Object.\n${line}\n`);
}
console.log(`[cf-postbuild] ${path.relative(process.cwd(), worker)} exports CueChannel`);
