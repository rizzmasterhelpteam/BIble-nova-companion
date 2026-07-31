class GeminiMicProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions?.targetSampleRate || 16000;
    this.batchSize = options.processorOptions?.batchSize || 640;
    this.pending = [];
    this.phase = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;
    const ratio = sampleRate / this.targetRate;
    while (this.phase < channel.length) {
      const left = Math.floor(this.phase);
      const right = Math.min(channel.length - 1, left + 1);
      const fraction = this.phase - left;
      const value = channel[left] + (channel[right] - channel[left]) * fraction;
      this.pending.push(Math.max(-1, Math.min(1, value)));
      this.phase += ratio;
    }
    this.phase -= channel.length;
    while (this.pending.length >= this.batchSize) {
      const samples = this.pending.splice(0, this.batchSize);
      const pcm = new Int16Array(samples.length);
      for (let index = 0; index < samples.length; index += 1) {
        pcm[index] = samples[index] < 0 ? samples[index] * 0x8000 : samples[index] * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor("gemini-mic-processor", GeminiMicProcessor);
