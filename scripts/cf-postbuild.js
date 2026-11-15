// Runs after `vite build` (see package.json "build"). @sveltejs/adapter-cloudflare generates the Worker entry
// but cannot export extra classes, so append the Durable Object exports for Wrangler.
import fs from 'node:fs';
import path from 'node:path';

const worker = path.resolve('.svelte-kit/cloudflare/_worker.js');

if (!fs.existsSync(worker)) {
	console.error(`[cf-postbuild] ${worker} not found — did vite build run with @sveltejs/adapter-cloudflare?`);
	process.exit(1);
}
const code = fs.readFileSync(worker, 'utf8');
for (const [name, file] of [
	['CueChannel', 'src/lib/server/jarvis/cue-do.ts'],
	['ShareRoom', 'src/lib/server/vr-share-room.ts']
]) {
	const source = path.relative(path.dirname(worker), path.resolve(file)).split(path.sep).join('/');
	const line = `export { ${name} } from './${source}';`;
	if (!code.includes(line)) fs.appendFileSync(worker, `\n${line}\n`);
}
