import { describe, expect, it, vi } from "vitest";
import {
  createIdempotentAsyncAction,
  createInitialHistoryPayload,
  createVoiceTurnDetectionState,
  getPcm16PeakAmplitude,
  getPcm16RmsAmplitude,
  getSafePlaybackGain,
  getLiveReconnectDelay,
  getLiveSessionDeadlineMs,
  getLiveSessionDurationMs,
  guardLiveTokenTiming,
  isLiveTokenTimingValid,
  mergeLiveTranscript,
  nextPlaybackGeneration,
  shouldReconnectLiveSession,
  shouldResumeListeningAfterPlayback,
  signalAudioStreamEnd,
  toPcmByteView,
  updateVoiceTurnDetection,
} from "../src/lib/liveProtocol";
import type { ConversationMessage } from "../src/types/live";

describe("Gemini Live protocol helpers", () => {
  it("waits after history that ends with a model response", () => {
    const history: ConversationMessage[] = [
      { id: "welcome", role: "ai", content: "Welcome" },
      { id: "1", role: "user", content: "I feel overwhelmed." },
      { id: "2", role: "ai", content: "Let us slow down." },
      { id: "3", role: "ai", content: "Temporary error", tone: "error" },
    ];

    expect(createInitialHistoryPayload(history)).toEqual({
      turns: [
        { role: "user", parts: [{ text: "I feel overwhelmed." }] },
        { role: "model", parts: [{ text: "Let us slow down." }] },
      ],
      turnComplete: false,
    });
  });

  it("does not send empty history and completes only an unanswered user turn", () => {
    expect(createInitialHistoryPayload([
      { id: "welcome", role: "ai", content: "Welcome" },
    ])).toBeNull();
    expect(createInitialHistoryPayload([
      { id: "1", role: "user", content: "Please help me." },
    ])).toEqual({
      turns: [{ role: "user", parts: [{ text: "Please help me." }] }],
      turnComplete: true,
    });
  });

  it("flushes a paused automatic-VAD stream only once", () => {
    const sendRealtimeInput = vi.fn();
    const session = { sendRealtimeInput };

    const ended = signalAudioStreamEnd(session, false);
    const endedAgain = signalAudioStreamEnd(session, ended);

    expect(endedAgain).toBe(true);
    expect(sendRealtimeInput).toHaveBeenCalledTimes(1);
    expect(sendRealtimeInput).toHaveBeenCalledWith({ audioStreamEnd: true });
  });

  it("does not duplicate cumulative transcription chunks", () => {
    expect(mergeLiveTranscript("Peace be", "Peace be with you")).toBe("Peace be with you");
    expect(mergeLiveTranscript("Peace be with you", "with you")).toBe("Peace be with you");
    expect(mergeLiveTranscript("I feel bad", "I feel very bad")).toBe("I feel very bad");
    expect(mergeLiveTranscript("I feel very", "very alone today")).toBe("I feel very alone today");
  });

  it("prevents ended playback from restoring the listening state", () => {
    expect(shouldResumeListeningAfterPlayback({
      playbackGeneration: 2,
      currentGeneration: 3,
      stopRequested: false,
      remainingSources: 0,
    })).toBe(false);
    expect(shouldResumeListeningAfterPlayback({
      playbackGeneration: 3,
      currentGeneration: 3,
      stopRequested: true,
      remainingSources: 0,
    })).toBe(false);
  });

  it("invalidates queued playback and bounds assistant output gain", () => {
    expect(nextPlaybackGeneration(4)).toBe(5);
    expect(getSafePlaybackGain(1.3)).toBe(1.3);
    expect(getSafePlaybackGain(5)).toBe(1.35);
    expect(getSafePlaybackGain(Number.NaN)).toBe(1);
  });

  it("runs concurrent stop requests through one in-flight action", async () => {
    const runIdempotently = createIdempotentAsyncAction();
    const stopTask = vi.fn(async () => {
      await Promise.resolve();
    });

    const first = runIdempotently(stopTask);
    const second = runIdempotently(stopTask);

    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(stopTask).toHaveBeenCalledOnce();
  });

  it("bounds reconnect attempts and applies backoff", () => {
    expect(shouldReconnectLiveSession(0, 2)).toBe(true);
    expect(shouldReconnectLiveSession(2, 2)).toBe(false);
    expect(getLiveReconnectDelay(1)).toBe(700);
    expect(getLiveReconnectDelay(2)).toBe(1_400);
  });

  it("accepts only live token timing bounded by the reservation", () => {
    const now = Date.parse("2026-07-23T11:50:00.000Z");
    expect(isLiveTokenTimingValid({
      expiresAt: "2026-07-23T11:59:00.000Z",
      reservationExpiresAt: "2026-07-23T12:00:00.000Z",
    }, now)).toBe(true);
    expect(isLiveTokenTimingValid({
      expiresAt: "2026-07-23T12:01:00.000Z",
      reservationExpiresAt: "2026-07-23T12:00:00.000Z",
    }, now)).toBe(false);
  });

  it("rejects an expired token response and invokes audio cleanup", () => {
    const releaseAudio = vi.fn();
    const accepted = guardLiveTokenTiming({
      expiresAt: "2026-07-23T11:49:59.000Z",
      reservationExpiresAt: "2026-07-23T12:00:00.000Z",
    }, releaseAudio, Date.parse("2026-07-23T11:50:00.000Z"));

    expect(accepted).toBe(false);
    expect(releaseAudio).toHaveBeenCalledOnce();
  });

  it("uses reservation remainingSeconds for the client session timer", () => {
    expect(getLiveSessionDurationMs({
      remainingSeconds: 45,
      maxMinutes: 10,
    })).toBe(45_000);
  });

  it("uses the earliest absolute expiry with a safety margin", () => {
    const now = Date.parse("2026-07-23T11:50:00.000Z");
    expect(getLiveSessionDeadlineMs({
      expiresAt: "2026-07-23T12:00:00.000Z",
      reservationExpiresAt: "2026-07-23T11:55:00.000Z",
    }, now)).toBe(295_000);
  });

  it("accepts transferred and typed-array microphone frames", () => {
    const samples = new Int16Array([0, 16_384, -32_768]);
    const transferred = samples.buffer.slice(0);

    expect(Array.from(toPcmByteView(transferred) || [])).toEqual(
      Array.from(new Uint8Array(samples.buffer)),
    );
    expect(toPcmByteView(samples)?.byteLength).toBe(samples.byteLength);
    expect(toPcmByteView("not audio")).toBeNull();
  });

  it("measures PCM activity without retaining or exposing audio", () => {
    const silence = new Uint8Array(new Int16Array([0, 0, 0]).buffer);
    const speech = new Uint8Array(new Int16Array([0, 8_192, -32_768]).buffer);

    expect(getPcm16PeakAmplitude(silence)).toBe(0);
    expect(getPcm16PeakAmplitude(speech)).toBe(1);
    expect(getPcm16RmsAmplitude(silence)).toBe(0);
    expect(getPcm16RmsAmplitude(speech)).toBeCloseTo(
      Math.sqrt((0 + 0.25 ** 2 + 1) / 3),
    );
  });

  it("flushes a real speech turn after sustained silence", () => {
    let state = createVoiceTurnDetectionState();
    const update = (rms: number, nowMs: number, frameDurationMs = 100) => {
      const result = updateVoiceTurnDetection({
        state,
        rms,
        frameDurationMs,
        nowMs,
        speechStartRms: 0.009,
        speechContinuationRms: 0.0045,
        minimumVoicedDurationMs: 180,
        silenceDurationMs: 1_100,
      });
      state = result.state;
      return result;
    };

    expect(update(0.03, 0).speechStarted).toBe(true);
    expect(update(0.025, 100).shouldFlush).toBe(false);
    expect(update(0.001, 1_100).shouldFlush).toBe(false);
    expect(update(0.001, 1_201).shouldFlush).toBe(true);
    expect(state).toEqual(createVoiceTurnDetectionState());
  });

  it("does not flush ambient silence or a short transient", () => {
    let state = createVoiceTurnDetectionState();
    const update = (rms: number, nowMs: number, frameDurationMs = 40) => {
      const result = updateVoiceTurnDetection({
        state,
        rms,
        frameDurationMs,
        nowMs,
        speechStartRms: 0.009,
        speechContinuationRms: 0.0045,
        minimumVoicedDurationMs: 180,
        silenceDurationMs: 1_100,
      });
      state = result.state;
      return result;
    };

    expect(update(0.002, 0).shouldFlush).toBe(false);
    expect(update(0.012, 100).speechStarted).toBe(true);
    expect(update(0.001, 1_250).shouldFlush).toBe(false);
    expect(state).toEqual(createVoiceTurnDetectionState());
  });
});
