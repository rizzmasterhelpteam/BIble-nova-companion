import { describe, expect, it } from "vitest";
import {
  createGoogleTtsSsml,
  escapeSsml,
  GOOGLE_TTS_BIBLE_REFERENCE_BREAK_MS,
  GOOGLE_TTS_EMOTIONAL_BREAK_MS,
  isGoogleTtsSsmlEnabled,
  normalizeVoiceSpeech,
  parseGoogleTtsPitch,
  parseGoogleTtsSpeakingRate,
} from "../src/lib/voiceSpeechFormatter";

describe("Voice speech formatting", () => {
  it("removes Markdown and awkward URL formatting without adding content", () => {
    const formatted = normalizeVoiceSpeech(`
      # A gentle response
      - **I hear you.**
      - Read [John 3:16](https://example.com/reference) and \`take one breath\`.
      More help is at https://example.com/private/path.
    `);

    expect(formatted).toBe(
      "A gentle response. I hear you. Read John 3:16 and take one breath. More help is at the link.",
    );
    expect(formatted).not.toMatch(/[#*`\[\]()]|https?:\/\//);
  });

  it("turns semicolon-heavy and long clauses into spoken sentences", () => {
    const formatted = normalizeVoiceSpeech(
      "This feels overwhelming; however, you can pause here, take one slow breath, notice what feels heaviest, and bring that one honest thought to God before deciding what comes next or how tomorrow needs to look.",
    );

    expect(formatted).not.toContain(";");
    expect(formatted.split(".").filter((part) => part.trim()).length).toBeGreaterThan(2);
    expect(formatted).toContain("bring that one honest thought to God");
  });

  it("escapes untrusted SSML characters", () => {
    expect(escapeSsml('Stay <close> & say "hello".')).toBe(
      "Stay &lt;close&gt; &amp; say &quot;hello&quot;.",
    );
  });

  it("adds conservative sentence and Bible-reference pauses", () => {
    const ssml = createGoogleTtsSsml(
      "I hear you. John 3:16 reminds us that God is near. Take one slow breath.",
      { speakingRate: 0.94, pitch: -1 },
    );

    expect(ssml).toContain('<prosody rate="94%" pitch="-1st">');
    expect(ssml).toContain(`<break time="${GOOGLE_TTS_EMOTIONAL_BREAK_MS}ms"/>`);
    expect(ssml).toContain(
      `John 3:16<break time="${GOOGLE_TTS_BIBLE_REFERENCE_BREAK_MS}ms"/>`,
    );
    expect(ssml).not.toContain("<break time=\"450ms\"/><break");
  });

  it("preserves normalized meaning when SSML tags are removed", () => {
    const text =
      "You're not alone in this. Take one slow breath, and let's walk through it together.";
    const normalized = normalizeVoiceSpeech(text);
    const spoken = createGoogleTtsSsml(text)
      .replace(/<break\b[^>]*\/>/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    expect(spoken).toBe(normalized);
    expect(spoken).not.toMatch(/\b(?:hmm|umm|uh)\b/i);
  });

  it("parses safe environment controls and defaults SSML on", () => {
    expect(parseGoogleTtsSpeakingRate(undefined)).toBe(0.94);
    expect(parseGoogleTtsSpeakingRate("0.95")).toBe(0.95);
    expect(parseGoogleTtsSpeakingRate("0.2")).toBe(0.9);
    expect(parseGoogleTtsSpeakingRate("fast")).toBe(0.94);
    expect(parseGoogleTtsPitch(undefined)).toBe(-1);
    expect(parseGoogleTtsPitch("2")).toBe(2);
    expect(parseGoogleTtsPitch("-20")).toBe(-5);
    expect(isGoogleTtsSsmlEnabled(undefined)).toBe(true);
    expect(isGoogleTtsSsmlEnabled("false")).toBe(false);
    expect(isGoogleTtsSsmlEnabled(" FALSE ")).toBe(false);
  });
});
