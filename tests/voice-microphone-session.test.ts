import { describe, expect, it, vi } from "vitest";
import { VoiceMicrophoneSession } from "../src/lib/voiceMicrophoneSession";

const createFakeStream = () => {
  const track = {
    enabled: true,
    readyState: "live",
    stop: vi.fn(() => {
      track.readyState = "ended";
    }),
  };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
};

describe("warm Voice microphone session", () => {
  it("requests the microphone once and reuses it across normal turns", async () => {
    const microphone = new VoiceMicrophoneSession();
    const first = createFakeStream();
    const createStream = vi.fn(async () => first.stream);

    const initial = await microphone.acquire(createStream);
    const nextTurn = await microphone.acquire(createStream);

    expect(initial.reused).toBe(false);
    expect(nextTurn).toEqual({ stream: first.stream, reused: true });
    expect(createStream).toHaveBeenCalledOnce();
    expect(first.track.stop).not.toHaveBeenCalled();
  });

  it("pauses without releasing and releases only on session cleanup", async () => {
    const microphone = new VoiceMicrophoneSession();
    const captured = createFakeStream();
    await microphone.acquire(async () => captured.stream);

    microphone.setEnabled(false);
    expect(captured.track.enabled).toBe(false);
    expect(captured.track.stop).not.toHaveBeenCalled();

    microphone.setEnabled(true);
    expect(captured.track.enabled).toBe(true);
    expect(microphone.release()).toBe(true);
    expect(captured.track.stop).toHaveBeenCalledOnce();
    expect(microphone.current).toBeNull();
  });

  it("recreates a dead stream and safely releases a fatal stream", async () => {
    const microphone = new VoiceMicrophoneSession();
    const dead = createFakeStream();
    const replacement = createFakeStream();
    const createStream = vi.fn()
      .mockResolvedValueOnce(dead.stream)
      .mockResolvedValueOnce(replacement.stream);

    await microphone.acquire(createStream);
    dead.track.readyState = "ended";
    const recreated = await microphone.acquire(createStream);

    expect(recreated).toEqual({ stream: replacement.stream, reused: false });
    expect(dead.track.stop).toHaveBeenCalledOnce();
    microphone.release(replacement.stream);
    expect(replacement.track.stop).toHaveBeenCalledOnce();
  });
});
