import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	// JARVIS_RECORDING=1 (shell or .env) disables HMR so a stray file save can't kick the headset out of VR (spec §8.1).
	const recording = Boolean(process.env.JARVIS_RECORDING || loadEnv(mode, process.cwd(), '').JARVIS_RECORDING);

	return {
		server: {
			// Cloudflare quick tunnel fallback (spec §8.2). localhost keeps working.
			allowedHosts: ['.trycloudflare.com'],
			hmr: recording ? false : undefined
		},
		plugins: [
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},

				// Cloudflare Workers: prerendered pages are served as static assets, /api/* runs in the Worker.
				// Worker entry, assets directory and bindings are configured in wrangler.jsonc.
				// `npm run dev` uses wrangler.dev.jsonc (no Durable Object; cues stay in memory).
				adapter: adapter({ platformProxy: { configPath: 'wrangler.dev.jsonc' } })
			})
		]
	};
});
