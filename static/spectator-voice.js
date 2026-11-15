// Mono voice packets use 40 ms of PCM at 16 kHz. The processor never writes to
// its output, so attaching it to the microphone does not enable local monitoring.
class SpectatorVoice extends AudioWorkletProcessor {
	constructor() {
		super();
		this.pcm = new Int16Array(640);
		this.length = 0;
		this.phase = 0;
		this.sum = 0;
		this.samples = 0;
		this.port.onmessage = ({ data }) => {
			if (data === 'flush' && this.length) this.send();
		};
	}

	send() {
		this.port.postMessage(this.pcm, [this.pcm.buffer]);
		this.pcm = new Int16Array(640);
		this.length = 0;
	}

	process(inputs) {
		const channels = inputs[0];
		if (!channels?.length) return true;
		for (let i = 0; i < channels[0].length; i++) {
			let sample = 0;
			for (const channel of channels) sample += channel[i];
			this.sum += sample / channels.length;
			this.samples++;
			this.phase += 16000;
			if (this.phase < sampleRate) continue;
			this.phase -= sampleRate;
			this.pcm[this.length++] = Math.round(Math.max(-1, Math.min(1, this.sum / this.samples)) * 32767);
			this.sum = 0;
			this.samples = 0;
			if (this.length === this.pcm.length) this.send();
		}
		return true;
	}
}

registerProcessor('spectator-voice', SpectatorVoice);
