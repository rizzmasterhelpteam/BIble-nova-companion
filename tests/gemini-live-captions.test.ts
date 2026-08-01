import { describe, expect, it, vi } from "vitest";
import {
  LiveCaptionController,
  reconcileTranscriptHypothesis,
  segmentLiveCaption,
  type LiveCaption,
} from "../src/lib/geminiLiveCaptions";

const createController = () => {
  const captions: Array<LiveCaption | null> = [];
  const users: string[] = [];
  const assistants: Array<{ text: string; status: string }> = [];
  const completed: string[] = [];
  const unavailable = vi.fn();
  const controller = new LiveCaptionController({
    onCaption: (caption) => captions.push(caption),
    onUserFinal: (text) => users.push(text),
    onAssistantFinal: (text, playback) => {
      assistants.push({ text, status: playback.playbackStatus });
      return "assistant-1";
    },
    onAssistantPlaybackComplete: (id) => completed.push(id),
    onTranscriptUnavailable: unavailable,
  });
  return { controller, captions, users, assistants, completed, unavailable };
};

describe("Gemini Live captions", () => {
  it("reconciles cumulative, revised, overlapping, and partial hypotheses", () => {
    expect(reconcileTranscriptHypothesis("I feel", "I feel anxious")).toBe("I feel anxious");
    expect(reconcileTranscriptHypothesis("hello Hello", "hello")).toBe("hello Hello");
    expect(reconcileTranscriptHypothesis("I am tired", "I'm tired today")).toBe("I'm tired today");
    expect(reconcileTranscriptHypothesis("I feel very", "very alone")).toBe("I feel very alone");
    expect(reconcileTranscriptHypothesis("I wor", "worry tonight")).toBe("I worry tonight");
    expect(reconcileTranscriptHypothesis("Hello there", "hello there!")).toBe("hello there!");
  });

  it("segments captions at word boundaries for long and unpunctuated speech", () => {
    const text = "one two three four five six seven eight nine ten eleven twelve";
    const caption = segmentLiveCaption(text, 24, 5);
    expect(caption).toBe("nine ten eleven twelve");
    expect(caption).not.toMatch(/^\w{1,2}$/);
    expect(segmentLiveCaption("नमस्ते दुनिया कैसे हो आप", 80, 8)).toContain("नमस्ते");
    expect(segmentLiveCaption("hello 👋 this is a longwordwithoutspaces", 24, 5)).toBe("a longwordwithoutspaces");
  });

  it("shows interim input quickly and commits the corrected final input once", () => {
    vi.useFakeTimers();
    try {
      const { controller, captions, users } = createController();
      controller.beginGeneration();
      controller.receiveUserInterim("I am feel");
      vi.advanceTimersByTime(120);
      expect(captions.at(-1)).toMatchObject({ speaker: "You", text: "I am feel", phase: "interim" });
      controller.receiveUserStable("I'm feeling anxious", true);
      controller.turnComplete();
      controller.receiveUserStable("I'm feeling anxious", true);
      expect(users).toEqual(["I'm feeling anxious"]);
      expect(captions.at(-1)).toMatchObject({ speaker: "You", text: "I'm feeling anxious", phase: "final" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a late assistant transcript in its completed turn after audio starts", () => {
    vi.useFakeTimers();
    try {
      const { controller, captions, assistants, completed } = createController();
      controller.beginGeneration();
      controller.assistantAudioStarted();
      controller.turnComplete();
      controller.receiveAssistantText("I hear how heavy this feels.");
      vi.advanceTimersByTime(120);
      expect(captions.at(-1)).toMatchObject({ speaker: "Bible Nova", text: "I hear how heavy this feels." });
      controller.assistantAudioDrained();
      vi.advanceTimersByTime(650);
      expect(assistants).toEqual([{ text: "I hear how heavy this feels.", status: "completed" }]);
      expect(completed).toEqual(["assistant-1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the user ordering grace independent from the assistant grace", () => {
    vi.useFakeTimers();
    try {
      const { controller, users, assistants } = createController();
      controller.beginGeneration();
      controller.receiveUserInterim("I feel overwhelmed");
      controller.assistantAudioStarted();
      controller.turnComplete();
      controller.receiveAssistantText("I am here with you.");
      vi.advanceTimersByTime(650);
      expect(users).toEqual(["I feel overwhelmed"]);
      expect(assistants).toEqual([{ text: "I am here with you.", status: "pending" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("prevents interrupted output from reviving while the next user turn captions", () => {
    vi.useFakeTimers();
    try {
      const { controller, captions, assistants } = createController();
      controller.beginGeneration();
      controller.assistantAudioStarted();
      controller.receiveAssistantText("First answer that should stop");
      controller.interruptAssistant();
      controller.receiveAssistantText("late trailing text");
      controller.receiveUserInterim("Actually I need help now");
      vi.advanceTimersByTime(120);
      expect(assistants).toEqual([{ text: "First answer that should stop", status: "interrupted" }]);
      expect(captions.at(-1)).toMatchObject({ speaker: "You", text: "Actually I need help now" });
      expect(captions.some((caption) => caption?.text.includes("late trailing"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels delayed visual updates when a session stops", () => {
    vi.useFakeTimers();
    try {
      const { controller, captions } = createController();
      controller.beginGeneration();
      controller.receiveUserInterim("this must not render later");
      controller.cleanup();
      vi.advanceTimersByTime(1_000);
      expect(captions).toEqual([null]);
    } finally {
      vi.useRealTimers();
    }
  });
});
