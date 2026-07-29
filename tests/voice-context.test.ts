import { describe, expect, it } from "vitest";
import { normalizeVoiceContextMessages } from "../src/lib/voiceContext";

describe("Voice playback context", () => {
  it("keeps an interrupted assistant reply visible while marking it as only partially heard", () => {
    const messages = normalizeVoiceContextMessages([
      {
        id: "assistant-1",
        role: "ai",
        content: "Here is the full response that remains available in Chat.",
        source: "voice",
        playbackStatus: "interrupted",
      },
      {
        id: "user-2",
        role: "user",
        content: "No, this is actually about my family.",
        source: "voice",
      },
    ]);

    expect(messages[0].content).toContain("interrupted before the user necessarily heard all of it");
    expect(messages[0].content).toContain("full response that remains available in Chat");
    expect(messages[1].content).toBe("No, this is actually about my family.");
  });

  it("does not annotate a fully completed reply", () => {
    const messages = normalizeVoiceContextMessages([
      {
        id: "assistant-1",
        role: "ai",
        content: "A completed response.",
        source: "voice",
        playbackStatus: "completed",
      },
    ]);

    expect(messages[0].content).toBe("A completed response.");
  });
});
