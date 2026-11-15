export type VoiceKind = 'command' | 'reply';
export type VoiceEvent =
	| { type: 'pcm'; kind: VoiceKind; samples: Int16Array }
	| { type: 'speech'; text: string; lang?: string }
	| { type: 'speech-stop' };
export type VoiceRelay = () => ((event: VoiceEvent) => void) | undefined;
