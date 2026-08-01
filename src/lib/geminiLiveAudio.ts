export const GEMINI_INPUT_SAMPLE_RATE = 16_000;
export const GEMINI_OUTPUT_SAMPLE_RATE = 24_000;

export const resampleFloat32 = (
  input: Float32Array,
  sourceRate: number,
  targetRate = GEMINI_INPUT_SAMPLE_RATE,
) => {
  if (!input.length || sourceRate <= 0 || targetRate <= 0) return new Float32Array();
  if (sourceRate === targetRate) return new Float32Array(input);
  const outputLength = Math.max(1, Math.round(input.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] = input[left] + (input[right] - input[left]) * fraction;
  }
  return output;
};

export const float32ToPcm16 = (input: Float32Array) => {
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
};

export const pcm16ToFloat32 = (bytes: Uint8Array) => {
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 0x8000;
  }
  return samples;
};

export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

export const base64ToBytes = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

export const mergeLiveTranscript = (current: string, next: string) => {
  const normalized = next.trim().replace(/\s+/g, " ");
  if (!normalized) return current;
  if (!current || normalized.startsWith(current)) return normalized;
  if (current.endsWith(normalized)) return current;
  const currentWords = current.split(" ");
  const nextWords = normalized.split(" ");
  for (let overlap = Math.min(currentWords.length, nextWords.length); overlap > 0; overlap -= 1) {
    if (
      currentWords.slice(-overlap).join(" ").toLowerCase() ===
      nextWords.slice(0, overlap).join(" ").toLowerCase()
    ) {
      return `${current} ${nextWords.slice(overlap).join(" ")}`.trim();
    }
  }
  return `${current} ${normalized}`;
};

// Captions should follow the latest utterance, rather than pinning the first
// words of an accumulating Live transcript on screen.
export const getLatestLiveCaption = (transcript: string, maxChars = 180) => {
  const normalized = transcript.trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  const latestSentence = normalized.split(/(?<=[.!?])\s+/).at(-1) || normalized;
  return latestSentence.slice(-maxChars);
};

export class LiveTranscriptAccumulator {
  private text = "";
  private committed = false;

  append(fragment: string) {
    this.text = mergeLiveTranscript(this.text, fragment);
    return this.text;
  }

  finalize(commit: (text: string) => void) {
    const value = this.text.trim();
    if (!value || this.committed) return false;
    this.committed = true;
    commit(value);
    return true;
  }

  reset() {
    this.text = "";
    this.committed = false;
  }
}

type PlaybackContext = Pick<AudioContext, "currentTime" | "createBuffer" | "createBufferSource" | "destination">;

export class GeminiPcmPlaybackQueue {
  private nextTime = 0;
  private generation = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private startTimers = new Map<AudioBufferSourceNode, ReturnType<typeof setTimeout>>();

  constructor(private readonly context: PlaybackContext) {}

  enqueue(base64: string, onStart?: () => void, onDrained?: () => void) {
    const samples = pcm16ToFloat32(base64ToBytes(base64));
    if (!samples.length) return;
    const generation = this.generation;
    const buffer = this.context.createBuffer(1, samples.length, GEMINI_OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const startAt = Math.max(this.context.currentTime + 0.035, this.nextTime);
    this.nextTime = startAt + buffer.duration;
    this.sources.add(source);
    const startTimer = setTimeout(() => {
      this.startTimers.delete(source);
      if (generation === this.generation && this.sources.has(source)) onStart?.();
    }, Math.max(0, (startAt - this.context.currentTime) * 1_000));
    this.startTimers.set(source, startTimer);
    source.onended = () => {
      const pendingTimer = this.startTimers.get(source);
      if (pendingTimer) clearTimeout(pendingTimer);
      this.startTimers.delete(source);
      source.disconnect();
      this.sources.delete(source);
      if (generation === this.generation && this.sources.size === 0) onDrained?.();
    };
    source.start(startAt);
  }

  clear() {
    this.generation += 1;
    for (const source of this.sources) {
      const pendingTimer = this.startTimers.get(source);
      if (pendingTimer) clearTimeout(pendingTimer);
      source.onended = null;
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    this.sources.clear();
    this.startTimers.clear();
    this.nextTime = this.context.currentTime;
  }

  get size() { return this.sources.size; }
}
