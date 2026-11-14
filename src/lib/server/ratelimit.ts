// In-memory sliding-window rate limiter (tunnel mode only, D15).

const buckets = new Map<string, number[]>();

/** Returns 0 if allowed (and records the hit), else the seconds until the next slot frees up. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): number {
	const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
	if (hits.length >= limit) {
		buckets.set(key, hits);
		return Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000));
	}
	hits.push(now);
	buckets.set(key, hits);
	if (buckets.size > 5000) {
		for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
	}
	return 0;
}
