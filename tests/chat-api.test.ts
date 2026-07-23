import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createChatCompletion } from "../chat-api";

describe("chat provider reliability", () => {
  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-groq-key";
    delete process.env.GROQ_MODEL;
    delete process.env.GROQ_FALLBACK_MODEL;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_MODEL;
    delete process.env.GROQ_FALLBACK_MODEL;
    vi.unstubAllGlobals();
  });

  it("falls back to the next configured provider", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "temporary failure" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Peace be with you." } }] }), { status: 200 }));

    await expect(createChatCompletion([{ role: "user", content: "Help me pray." }])).resolves.toBe(
      "Peace be with you.",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sends the strengthened companion persona to the active text model", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "You do not have to carry this alone." } }] }), { status: 200 }),
    );

    await createChatCompletion([{ role: "user", content: "I feel overwhelmed." }]);

    const requestBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    const systemPrompt = requestBody.messages[0].content as string;
    expect(systemPrompt).toContain("Help the user feel genuinely seen");
    expect(systemPrompt).toContain("Never invent an exact quotation or reference");
    expect(systemPrompt).toContain("do not share internal model details");
  });
});
