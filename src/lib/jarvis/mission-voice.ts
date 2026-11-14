import { tts } from './api.js';
import { AudioEngine, type Playable } from './audio.js';

/** Mission lines have fixed text and never go through the conversational model. */
export function createMissionVoice(useBrowserVoice: boolean) {
	const audio = new AudioEngine();
	let request: AbortController | undefined;
	let turnId = 0;
	let unlocked: Promise<void> = Promise.resolve();

	function stop() {
		request?.abort();
		request = undefined;
		audio.cancel(turnId);
	}

	async function speak(text: string, lang?: string) {
		stop();
		const id = ++turnId;
		const controller = new AbortController();
		request = controller;
		let playable: Playable = { type: 'speech', text, lang };
		await unlocked;
		if (controller.signal.aborted) return;
		if (!useBrowserVoice && audio.unlocked) {
			try {
				const data = await tts(text, AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]));
				if (controller.signal.aborted) return;
				playable = { type: 'buffer', buffer: await audio.decode(data) };
			} catch {
				// A missing token, backend or audio response falls back to the OS browser voice.
			}
		}
		if (!controller.signal.aborted) await audio.play({ turnId: id, priority: 'high', playable });
	}

	return {
		unlock() {
			try {
				unlocked = audio.unlock().catch(() => {});
			} catch {
				unlocked = Promise.resolve();
			}
		},
		speak,
		stop,
		dispose() {
			stop();
			audio.dispose();
		}
	};
}
