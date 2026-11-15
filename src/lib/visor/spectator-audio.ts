import type { VoiceEvent, VoiceKind } from '../jarvis/voice-relay.js';
import { SHARE_VOICE_RATE } from './share-protocol.js';

export function createSpectatorAudio() {
	let context: AudioContext | undefined;
	let enabled = false;
	let utterance: SpeechSynthesisUtterance | undefined;
	const sources = new Set<AudioBufferSourceNode>();
	const nextStart: Record<VoiceKind, number> = { command: 0, reply: 0 };

	function stopSpeech() {
		if (utterance) window.speechSynthesis?.cancel();
		utterance = undefined;
	}

	function setEnabled(value: boolean) {
		enabled = value;
		if (enabled) {
			try {
				context ??= new AudioContext();
				void context.resume().catch(() => {});
			} catch {
				// The local speech voice may still be available.
			}
			return;
		}
		stopSpeech();
		for (const source of sources) source.stop();
		sources.clear();
		nextStart.command = nextStart.reply = 0;
	}

	return {
		setEnabled,
		receive(event: VoiceEvent) {
			if (!enabled) return;
			if (event.type === 'speech-stop') {
				stopSpeech();
			} else if (event.type === 'speech') {
				if (!window.speechSynthesis) return;
				stopSpeech();
				const speech = new SpeechSynthesisUtterance(event.text);
				if (event.lang) speech.lang = event.lang;
				speech.onend = speech.onerror = () => { if (utterance === speech) utterance = undefined; };
				utterance = speech;
				window.speechSynthesis.speak(speech);
			} else if (context?.state === 'running') {
				const now = context.currentTime;
				const next = nextStart[event.kind];
				if (next - now > 0.35) return;
				const start = Math.max(now + (next > now ? 0 : 0.08), next);
				const buffer = context.createBuffer(1, event.samples.length, SHARE_VOICE_RATE);
				const samples = buffer.getChannelData(0);
				for (let i = 0; i < samples.length; i++) samples[i] = event.samples[i] / 32768;
				const source = context.createBufferSource();
				source.buffer = buffer;
				source.connect(context.destination);
				source.onended = () => {
					source.disconnect();
					sources.delete(source);
				};
				sources.add(source);
				source.start(start);
				nextStart[event.kind] = start + buffer.duration;
			}
		},
		close() {
			setEnabled(false);
			void context?.close().catch(() => {});
			context = undefined;
		}
	};
}
