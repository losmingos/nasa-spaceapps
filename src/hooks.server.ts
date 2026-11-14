// Demo token + rate limit for the Cloudflare tunnel fallback (spec §8.2, §9, D15).
// Only active when DEMO_TOKEN is set. Over USB + adb reverse (the main path) nothing here applies.
// Pages are never blocked; only /api/*.

import { createHash, timingSafeEqual } from 'node:crypto';
import type { Handle } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { DEMO_TOKEN } from '$app/env/private';
import { jsonError } from '#lib/server/http.js';
import { rateLimit } from '#lib/server/ratelimit.js';

const COOKIE = 'jarvis_k';
const LIMITED = new Set(['/api/stt', '/api/chat', '/api/tts']);
const LIMIT_PER_MIN = 10;

const digest = (s: string) => createHash('sha256').update(s).digest();
function tokenMatches(candidate: string | null | undefined, token: string): boolean {
	if (!candidate) return false;
	return timingSafeEqual(digest(candidate), digest(token));
}

export const handle: Handle = async ({ event, resolve }) => {
	// Prerendering (npm run build) has no runtime env and no query string — nothing to protect.
	if (building) return resolve(event);
	const token = DEMO_TOKEN;
	if (!token) return resolve(event);

	const { url } = event;
	const queryToken = url.searchParams.get('k');

	// Opening any page with ?k=<token> stores it in a cookie, so later API calls pass even without the header.
	if (tokenMatches(queryToken, token)) {
		event.cookies.set(COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 12 });
	}

	if (!url.pathname.startsWith('/api/')) return resolve(event);

	const authorized =
		tokenMatches(event.request.headers.get('x-demo-token'), token) ||
		tokenMatches(queryToken, token) ||
		tokenMatches(event.cookies.get(COOKIE), token);
	if (!authorized) return jsonError(401, 'Missing or invalid demo token (x-demo-token header or ?k=).');

	// /api/cue is polled every 500 ms and must not count.
	if (LIMITED.has(url.pathname)) {
		// Through cloudflared every request arrives from localhost; prefer the real client IP header.
		const ip = event.request.headers.get('cf-connecting-ip') ?? event.getClientAddress();
		const retryAfter = rateLimit(`${ip} ${url.pathname}`, LIMIT_PER_MIN, 60_000);
		if (retryAfter) {
			const res = jsonError(429, `Rate limit: ${LIMIT_PER_MIN} requests per minute.`, { retryAfter });
			res.headers.set('retry-after', String(retryAfter));
			return res;
		}
	}

	return resolve(event);
};
