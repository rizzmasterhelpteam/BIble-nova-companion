import { describe, expect, it, vi } from "vitest";
import {
  createInitialHistoryPayload,
  getLiveReconnectDelay,
  mergeLiveTranscript,
  shouldReconnectLiveSession,
  shouldResumeListeningAfterPlayback,
  signalAudioStreamEnd,
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

  it("bounds reconnect attempts and applies backoff", () => {
    expect(shouldReconnectLiveSession(0, 2)).toBe(true);
    expect(shouldReconnectLiveSession(2, 2)).toBe(false);
    expect(getLiveReconnectDelay(1)).toBe(700);
    expect(getLiveReconnectDelay(2)).toBe(1_400);
  });
});
