import { describe, expect, it } from "vitest";
import {
  getVoiceLanguageInstruction,
  getWhisperLanguage,
  normalizeVoiceLanguage,
} from "../src/lib/voiceLanguage";

describe("Voice language selection", () => {
  it("maps English and Hindi to explicit Whisper languages", () => {
    expect(getWhisperLanguage("english")).toBe("en");
    expect(getWhisperLanguage("hindi")).toBe("hi");
  });

  it("leaves Auto and Hinglish for Whisper detection", () => {
    expect(getWhisperLanguage("auto")).toBeUndefined();
    expect(getWhisperLanguage("hinglish")).toBeUndefined();
  });

  it("never accepts an arbitrary client language option", () => {
    expect(normalizeVoiceLanguage("malicious-voice-name")).toBe("auto");
    expect(getVoiceLanguageInstruction("hinglish")).toContain("Hinglish");
  });
});
