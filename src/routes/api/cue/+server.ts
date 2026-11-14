// GET/POST /api/cue — global operator cue channel (D28). GET → CueState; POST { id } → { seq }.

import type { CueState } from '#lib/jarvis/types.js';
import { isRecord, jsonError, readJson } from '#lib/server/http.js';
import { ALLOWED_CUES, getCue, isCueId, pushCue } from '#lib/server/jarvis/cue.js';
import type { RequestHandler } from './$types';

// The site is prerendered (src/routes/+layout.ts); API routes must stay dynamic in the Worker.
export const prerender = false;

const NO_STORE = { 'cache-control': 'no-store' };

export const GET: RequestHandler = async () => {
	return Response.json((await getCue()) satisfies CueState, { headers: NO_STORE });
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	const id = isRecord(body) ? body.id : undefined;
	if (!isCueId(id)) {
		return jsonError(400, 'Unknown cue id.', { allowed: [...ALLOWED_CUES] });
	}
	const { seq } = await pushCue(id);
	return Response.json({ seq }, { headers: NO_STORE });
};
