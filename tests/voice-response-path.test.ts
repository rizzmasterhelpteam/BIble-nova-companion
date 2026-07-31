import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  classifyVoiceResponseIntensity,
  createVoiceResponse,
  normalizeVoiceResponse,
  VOICE_RESPONSE_INSTRUCTIONS,
} from "../chat-api";

const serverApiSource = readFileSync(
  new URL("../server-api.ts", import.meta.url),
  "utf8",
);
const voiceShadowNotesSource = readFileSync(
  new URL("../api/voice/shadow-notes.ts", import.meta.url),
  "utf8",
);

describe("fast Voice response path", () => {
  const previousApiKey = process.env.GROQ_API_KEY;
  const previousModel = process.env.GROQ_MODEL;
  const previousFallback = process.env.GROQ_FALLBACK_MODEL;

  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
    process.env.GROQ_MODEL = "openai/gpt-oss-120b";
    process.env.GROQ_FALLBACK_MODEL = "openai/gpt-oss-20b";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: "You're not alone in this. Take one slow breath and tell God what hurts.",
        },
      }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
  });

  afterEach(() => {
    if (previousApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previousApiKey;
    if (previousModel === undefined) delete process.env.GROQ_MODEL;
    else process.env.GROQ_MODEL = previousModel;
    if (previousFallback === undefined) delete process.env.GROQ_FALLBACK_MODEL;
    else process.env.GROQ_FALLBACK_MODEL = previousFallback;
    vi.unstubAllGlobals();
  });

  it("uses one blocking GPT-OSS request with a reflective spoken-response budget", async () => {
    const result = await createVoiceResponse([
      { role: "user", content: "I feel overwhelmed." },
    ], "User appreciates calm guidance.");

    expect(result).toContain("not alone");
    expect(fetch).toHaveBeenCalledOnce();
    const init = vi.mocked(fetch).mock.calls[0][1]!;
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("openai/gpt-oss-120b");
    expect(body.reasoning_effort).toBe("low");
    expect(body.include_reasoning).toBe(false);
    expect(body.max_tokens).toBe(180);
    expect(body.messages[0].content).toContain("Voice turn profile: reflective");
    expect(body.messages[0].content).toContain("no Markdown");
    expect(body.messages[0].content).toContain("Practical-first response policy");
    expect(body.messages[0].content).toContain("Do not redirect ordinary questions");
    expect(body.messages[0].content).toContain("Do not replace mental-health support with spiritual language");
  });

  it("keeps the Voice prompt concise and spoken-language focused", () => {
    expect(VOICE_RESPONSE_INSTRUCTIONS).toContain("one or two short sentences");
    expect(VOICE_RESPONSE_INSTRUCTIONS).toContain("20 to 45 words");
    expect(VOICE_RESPONSE_INSTRUCTIONS).toContain("no Markdown");
    expect(VOICE_RESPONSE_INSTRUCTIONS).toContain("ATTUNE → VALIDATE → ANCHOR");
    expect(VOICE_RESPONSE_INSTRUCTIONS).toContain("Reflect one specific detail");
    expect(VOICE_RESPONSE_INSTRUCTIONS).toContain("If the user may be unsafe");
    expect(VOICE_RESPONSE_INSTRUCTIONS).toContain("at most one short follow-up");
  });

  it("enforces a speech-first sentence and word limit", () => {
    const response = normalizeVoiceResponse(
      `# Reflection
      - ${Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ")}.
      This third sentence should not be spoken.`,
    );

    expect(response).not.toContain("#");
    expect(response).not.toContain("- ");
    expect(response.split(/\s+/)).toHaveLength(45);
    expect(response).not.toContain("third sentence");
  });

  it("gives distress and crisis-risk turns more room without another model call", async () => {
    expect(classifyVoiceResponseIntensity([
      { role: "user", content: "I'm depressed, help me." },
    ])).toBe("distress");
    expect(classifyVoiceResponseIntensity([
      { role: "user", content: "I don't want to live." },
    ])).toBe("crisis-risk");

    await createVoiceResponse([
      { role: "user", content: "I'm depressed, help me." },
    ]);
    const distressRequest = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
    expect(distressRequest.reasoning_effort).toBe("medium");
    expect(distressRequest.max_tokens).toBe(240);

    const crisis = normalizeVoiceResponse(
      "You should keep going.",
      false,
      "crisis-risk",
    );
    expect(crisis).toContain("Are you safe right now");
    expect(crisis).toContain("emergency services");
  });

  it("does not block the fast response on shadow-note database work", () => {
    const voiceResponsePath = serverApiSource.slice(
      serverApiSource.indexOf("export async function createVoiceReflectionResponse"),
      serverApiSource.indexOf("export async function transcribeAudio"),
    );

    expect(voiceResponsePath).not.toContain("loadStoredShadowNotes");
    expect(voiceResponsePath).not.toContain("saveShadowNotes");
    expect(voiceResponsePath).not.toContain("createShadowNotes");
    expect(voiceResponsePath).toContain("createVoiceResponse");
  });

  it("does not log transcript or private note contents", () => {
    expect(serverApiSource).not.toMatch(/console\.(log|info|warn|error)[^\n]*(messages|shadowNotes|content)/i);
    expect(voiceShadowNotesSource).not.toMatch(/console\.(log|info|warn|error)[^\n]*(messages|shadowNotes|content)/i);
  });
});
