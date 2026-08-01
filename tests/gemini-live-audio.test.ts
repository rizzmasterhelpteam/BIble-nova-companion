import { describe, expect, it, vi } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  float32ToPcm16,
  GeminiPcmPlaybackQueue,
  getLatestLiveCaption,
  LiveTranscriptAccumulator,
  mergeLiveTranscript,
  pcm16ToFloat32,
  resampleFloat32,
} from "../src/lib/geminiLiveAudio";

describe("Gemini Live audio", () => {
  it("resamples device audio to the Gemini input rate", () => {
    const input = Float32Array.from({ length: 4_800 }, (_, index) => Math.sin(index / 20));
    expect(resampleFloat32(input, 48_000)).toHaveLength(1_600);
  });

  it("encodes clamped little-endian PCM16 and decodes it", () => {
    const bytes = float32ToPcm16(new Float32Array([-2, -0.5, 0, 0.5, 2]));
    expect(Array.from(bytes.slice(0, 2))).toEqual([0, 128]);
    const decoded = pcm16ToFloat32(bytes);
    expect(decoded[0]).toBe(-1);
    expect(decoded[2]).toBe(0);
    expect(decoded[4]).toBeCloseTo(1, 3);
  });

  it("round-trips binary audio through base64 without a data URL wrapper", () => {
    const input = new Uint8Array([0, 1, 127, 128, 255]);
    const encoded = bytesToBase64(input);
    expect(encoded).not.toContain("data:");
    expect(base64ToBytes(encoded)).toEqual(input);
  });

  it("merges overlapping transcription fragments", () => {
    expect(mergeLiveTranscript("I feel very", "very anxious today")).toBe(
      "I feel very anxious today",
    );
  });

  it("uses the latest live sentence for a compact caption", () => {
    expect(getLatestLiveCaption("First thought. This is the current thought.")).toBe(
      "This is the current thought.",
    );
    expect(getLatestLiveCaption("one two three four", 8)).toBe("ree four");
  });

  it("waits until queued audio starts before updating playback state", () => {
    vi.useFakeTimers();
    try {
      const source = {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      } as unknown as AudioBufferSourceNode;
      const context = {
        currentTime: 0,
        destination: {},
        createBuffer: vi.fn(() => ({ duration: 0.1, copyToChannel: vi.fn() })),
        createBufferSource: vi.fn(() => source),
      } as unknown as AudioContext;
      const onStart = vi.fn();

      new GeminiPcmPlaybackQueue(context).enqueue(bytesToBase64(new Uint8Array([0, 0])), onStart);

      expect(onStart).not.toHaveBeenCalled();
      vi.advanceTimersByTime(35);
      expect(onStart).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("commits each finalized transcript exactly once", () => {
    const commit = vi.fn();
    const transcript = new LiveTranscriptAccumulator();
    transcript.append("hello");
    expect(transcript.finalize(commit)).toBe(true);
    expect(transcript.finalize(commit)).toBe(false);
    expect(commit).toHaveBeenCalledOnce();
    transcript.reset();
    transcript.append("again");
    expect(transcript.finalize(commit)).toBe(true);
    expect(commit).toHaveBeenCalledTimes(2);
  });
});
