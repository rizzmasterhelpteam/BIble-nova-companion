import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createVoiceResponse,
  VOICE_RESPONSE_INSTRUCTIONS,
} from "../chat-api";

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

  it("uses one blocking GPT-OSS request with low reasoning and short speech constraints", async () => {
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
    expect(body.messages[0].content).toContain("Stay below 45 words");
    expect(body.messages[0].content).toContain("no Markdown");
  });

  it("keeps the Voice prompt concise and spoken-language focused", () => {
    expect(VOICE_RESPONSE_INSTRUCTIONS).toContain("one or two short sentences");
    expect(VOICE_RESPONSE_INSTRUCTIONS).toContain("below 45 words");
    expect(VOICE_RESPONSE_INSTRUCTIONS).toContain("no Markdown");
    expect(VOICE_RESPONSE_INSTRUCTIONS).toContain("at most one short follow-up");
  });
});
