// POST /api/chat — ChatRequest JSON → Claude Haiku 5.5 → ChatResponse (spec §4.3).
// Model errors and refusals return 200 { reply: '', fallback: 'E02' } so the client plays the fixed line.

import { ANTHROPIC_API_KEY } from '$app/env/private';
import type { ChatResponse } from '#lib/jarvis/types.js';
import { jsonError, missingEnv, readJson } from '#lib/server/http.js';
import { runChat, validateChatRequest } from '#lib/server/jarvis/chat.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	if (!ANTHROPIC_API_KEY) return missingEnv('ANTHROPIC_API_KEY');

	const parsed = validateChatRequest(await readJson(request));
	if (!parsed.ok) return jsonError(400, parsed.error);

	const result: ChatResponse = await runChat(ANTHROPIC_API_KEY, parsed.value);
	return Response.json(result, { headers: { 'cache-control': 'no-store' } });
};
