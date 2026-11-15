// SvelteKit 3 environment variables (see @sveltejs/kit/env). Values come from `.env` in dev/build
// and from the process environment at runtime. All are private: import them from `$app/env/private`
// in server-only code. Every key is optional at startup so the app boots without keys; each endpoint
// returns HTTP 503 naming the missing variable instead (see src/lib/server/http.ts).

import { defineEnvVars } from '@sveltejs/kit/env';

/** Optional string: empty or whitespace-only counts as unset. */
const optional = (value: string | undefined): string | undefined => {
	const v = value?.trim();
	return v ? v : undefined;
};

export const variables = defineEnvVars({
	ANTHROPIC_API_KEY: {
		schema: optional,
		description: 'Anthropic API key for /api/chat (Claude Haiku 5.5). console.anthropic.com → API keys.'
	},
	GROQ_API_KEY: {
		schema: optional,
		description: 'Groq API key for /api/stt (Whisper). console.groq.com → API keys (free tier).'
	},
	ELEVENLABS_API_KEY: {
		schema: optional,
		description: 'ElevenLabs API key for /api/tts and scripts/gen_lines.ts.'
	},
	ELEVENLABS_VOICE_ID: {
		schema: optional,
		description: 'ElevenLabs premade voice id (not a Voice Library voice).'
	},
	ELEVENLABS_MODEL_ID: {
		schema: (value: string | undefined): string => optional(value) ?? 'eleven_flash_v2_5',
		description: 'ElevenLabs TTS model. Default eleven_flash_v2_5 (low latency).'
	},
	DEMO_TOKEN: {
		schema: optional,
		description: 'Tunnel mode only: when set, /api/* requires x-demo-token (or ?k=) and is rate limited.'
	},
	JARVIS_RECORDING: {
		schema: optional,
		description: 'Set to 1 while recording: disables Vite HMR (read in vite.config.ts via process.env).'
	}
});
