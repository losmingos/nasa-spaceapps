import adapter from '@sveltejs/adapter-auto';
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

				// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
				// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
				// See https://svelte.dev/docs/kit/adapters for more information about adapters.
				adapter: adapter()
			})
		]
	};
});
