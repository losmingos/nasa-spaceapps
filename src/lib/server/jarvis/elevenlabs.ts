// ElevenLabs text-to-speech call (spec §4.4, D24). Import-free and free of TS-only runtime syntax,
// so scripts/gen_lines.ts can import it directly with Node's type stripping.

export const DEFAULT_ELEVENLABS_MODEL_ID = 'eleven_flash_v2_5';
export const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';

export class ElevenLabsError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export interface TtsParams {
	apiKey: string;
	voiceId: string;
	modelId: string;
	text: string;
}

/** Returns MP3 bytes. Throws ElevenLabsError on a non-2xx response. */
export async function elevenLabsTts({ apiKey, voiceId, modelId, text }: TtsParams): Promise<Uint8Array> {
	const url =
		`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
		`?output_format=${ELEVENLABS_OUTPUT_FORMAT}`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'xi-api-key': apiKey,
			'content-type': 'application/json',
			accept: 'audio/mpeg'
		},
		body: JSON.stringify({ text, model_id: modelId }),
		signal: AbortSignal.timeout(20_000)
	});
	if (!res.ok) {
		const detail = (await res.text().catch(() => '')).slice(0, 500);
		throw new ElevenLabsError(res.status, detail || res.statusText);
	}
	return new Uint8Array(await res.arrayBuffer());
}
