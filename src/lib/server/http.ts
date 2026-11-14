// Small helpers shared by the /api/* endpoints.

/** JSON error response: { error, ...extra }. */
export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}): Response {
	return Response.json({ error, ...extra }, { status, headers: { 'cache-control': 'no-store' } });
}

/** 503 for a missing env variable, naming it so the operator knows what to put in .env. */
export function missingEnv(name: string): Response {
	return jsonError(503, `Server is missing ${name}. Add it to .env and restart the dev server.`, {
		missing: name
	});
}

/** Parse a JSON body, returning undefined when it is not valid JSON. */
export async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return undefined;
	}
}

export function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
