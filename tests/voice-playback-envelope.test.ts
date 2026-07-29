import { describe, expect, it, vi } from "vitest";
import {
  applyVoicePlaybackFadeIn,
  stopVoicePlaybackSource,
  VOICE_PLAYBACK_FADE_IN_MS,
  VOICE_PLAYBACK_INTERRUPT_FADE_OUT_MS,
} from "../src/lib/voicePlaybackEnvelope";

const createPlaybackNodes = () => {
  const gain = {
    gain: {
      value: 1,
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    disconnect: vi.fn(),
  };
  const source = {
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
  return { gain, source };
};

describe("Voice playback envelope", () => {
  it("fades in quickly to prevent an Android start click", () => {
    const { gain } = createPlaybackNodes();

    applyVoicePlaybackFadeIn({ currentTime: 2 }, gain);

    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 2);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      1,
      2 + VOICE_PLAYBACK_FADE_IN_MS / 1_000,
    );
  });

  it("cancels interrupted audio with a short fade and deterministic cleanup", () => {
    const { gain, source } = createPlaybackNodes();
    const cleanups: Array<() => void> = [];
    const scheduleCleanup = vi.fn((cleanup: () => void) => {
      cleanups.push(cleanup);
    });

    stopVoicePlaybackSource({
      context: { currentTime: 4 },
      source,
      gain,
      fadeOut: true,
      scheduleCleanup,
    });

    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.0001,
      4 + VOICE_PLAYBACK_INTERRUPT_FADE_OUT_MS / 1_000,
    );
    expect(source.stop).toHaveBeenCalledWith(
      4 + VOICE_PLAYBACK_INTERRUPT_FADE_OUT_MS / 1_000,
    );
    expect(scheduleCleanup).toHaveBeenCalledWith(
      expect.any(Function),
      VOICE_PLAYBACK_INTERRUPT_FADE_OUT_MS + 20,
    );
    cleanups[0]();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(gain.disconnect).toHaveBeenCalledOnce();
  });

  it("stops superseded audio immediately without leaving connected nodes", () => {
    const { gain, source } = createPlaybackNodes();

    stopVoicePlaybackSource({
      context: { currentTime: 4 },
      source,
      gain,
      fadeOut: false,
    });

    expect(source.stop).toHaveBeenCalledWith();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(gain.disconnect).toHaveBeenCalledOnce();
  });
});
