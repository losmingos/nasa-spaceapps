// Minimal typing for the `cloudflare:workers` module (provided by workerd in production and by
// @sveltejs/adapter-cloudflare's virtual module in dev). Only what this app uses.
declare module 'cloudflare:workers' {
	interface DurableObjectStubLike {
		fetch(input: Request | string, init?: RequestInit): Promise<Response>;
	}
	interface DurableObjectNamespaceLike {
		idFromName(name: string): unknown;
		get(id: unknown): DurableObjectStubLike;
	}
	export const env: {
		JARVIS_CUE?: DurableObjectNamespaceLike;
		[key: string]: unknown;
	};
}
