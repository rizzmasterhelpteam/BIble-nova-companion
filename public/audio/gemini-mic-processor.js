class GeminiMicProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = options.processorOptions?.targetSampleRate || 16000;
    this.batchSize = options.processorOptions?.batchSize || 640;
    this.ratio = sampleRate / this.targetSampleRate;
    this.source = new Float32Array(8192);
    this.sourceLength = 0;
    this.readPosition = 0;
  }

  ensureCapacity(requiredLength) {
    if (requiredLength <= this.source.length) return;
    const next = new Float32Array(Math.max(requiredLength, this.source.length * 2));
    next.set(this.source.subarray(0, this.sourceLength));
    this.source = next;
  }

  compactSource() {
    const consumed = Math.max(0, Math.floor(this.readPosition) - 1);
    if (!consumed) return;
    this.source.copyWithin(0, consumed, this.sourceLength);
    this.sourceLength -= consumed;
    this.readPosition -= consumed;
  }

  emitAvailableBatches() {
    const requiredSpan = (this.batchSize - 1) * this.ratio + 1;

    while (this.readPosition + requiredSpan <= this.sourceLength) {
      const pcm = new Int16Array(this.batchSize);

      for (let index = 0; index < this.batchSize; index += 1) {
        const sourcePosition = this.readPosition + index * this.ratio;
        const lower = Math.floor(sourcePosition);
        const upper = Math.min(lower + 1, this.sourceLength - 1);
        const weight = sourcePosition - lower;
        const interpolated =
          this.source[lower] * (1 - weight) + this.source[upper] * weight;
        const sample = Math.max(-1, Math.min(1, interpolated));
        pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }

      this.readPosition += this.batchSize * this.ratio;
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
      this.compactSource();
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (!input?.length) return true;

    this.compactSource();
    this.ensureCapacity(this.sourceLength + input.length);
    this.source.set(input, this.sourceLength);
    this.sourceLength += input.length;
    this.emitAvailableBatches();
    return true;
  }
}

registerProcessor("gemini-mic-processor", GeminiMicProcessor);
