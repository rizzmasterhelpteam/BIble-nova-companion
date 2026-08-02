import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createChatCompletion,
  createReflection,
  createShadowNotes,
  classifySafetyRisk,
  EMOTIONAL_RESPONSE_FRAMEWORK,
} from "../chat-api";

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

  it("adds an attuned emotional response framework for serious distress", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "I'm here with you." } }] }),
        { status: 200 },
      ),
    );

    await createChatCompletion([{ role: "user", content: "I'm depressed, help me." }]);

    const requestBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    const systemPrompt = requestBody.messages[0].content as string;
    expect(systemPrompt).toContain(EMOTIONAL_RESPONSE_FRAMEWORK);
    expect(systemPrompt).toContain("ATTUNE → VALIDATE → ANCHOR → NEXT STEP → CHECK-IN");
    expect(systemPrompt).toContain("Use one concrete detail from the latest user message");
    expect(systemPrompt).toContain("Do not default to a stock list");
    expect(systemPrompt).toContain("ask directly whether they are safe");
    expect(systemPrompt.indexOf("ATTUNE")).toBeLessThan(systemPrompt.indexOf("VALIDATE"));
    expect(systemPrompt.indexOf("VALIDATE")).toBeLessThan(systemPrompt.indexOf("ANCHOR"));
    expect(systemPrompt.indexOf("ANCHOR")).toBeLessThan(systemPrompt.indexOf("NEXT STEP"));
    expect(systemPrompt.indexOf("NEXT STEP")).toBeLessThan(systemPrompt.indexOf("CHECK-IN"));
  });

  it.each([
    "I want to die",
    "main marna chahta hoon",
    "मैं मरना चाहता हूँ",
  ])("uses the deterministic crisis-safe path for typed Chat: %s", async (content) => {
    expect(classifySafetyRisk([{ role: "user", content }])).toBe("crisis-risk");
    await expect(createChatCompletion([{ role: "user", content }])).resolves.toMatch(/safe|सुरक्षित/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not make the extra memory-summary request without consent", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "A gentle response." } }] }),
        { status: 200 },
      ),
    );

    await expect(
      createReflection(
        [{ role: "user", content: "Help me reflect." }],
        null,
        { rememberUser: false },
      ),
    ).resolves.toEqual({
      message: "A gentle response.",
      shadowNotes: null,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("sends the latest 12 messages as individual raw conversation turns", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "A direct reply." } }] }),
        { status: 200 },
      ),
    );

    const messages = Array.from({ length: 14 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `raw-message-${index}`,
    }));

    await createChatCompletion(messages);

    const requestBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    const modelMessages = requestBody.messages.slice(1);
    expect(modelMessages).toHaveLength(12);
    expect(modelMessages[0].content).toContain("raw-message-2");
    expect(modelMessages.at(-1).content).toContain("raw-message-13");
    expect(modelMessages.some((message: { content: string }) =>
      message.content.includes("raw-message-1\n") || message.content === "raw-message-1",
    )).toBe(false);
    expect(modelMessages.some((message: { content: string }) =>
      message.content.includes("raw-message-0\n") || message.content === "raw-message-0",
    )).toBe(false);
  });

  it("formats shadow notes as compact bullet memory", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: "User memory:\n- Preferred tone: gentle and direct\n- Recurring emotional themes: anxiety at night",
            },
          }],
        }),
        { status: 200 },
      ),
    );

    const notes = await createShadowNotes([
      { role: "user", content: "Please remember that I prefer gentle, direct replies." },
    ]);

    expect(notes).toContain("User memory:");
    expect(notes).toContain("- Preferred tone: gentle and direct");
    expect(notes).toContain("- Recurring emotional themes: anxiety at night");
    expect(notes).toContain("- Recent unresolved thread:");
    const requestBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(requestBody.messages[1].content).toContain("Do not store every message");
    expect(requestBody.messages[1].content).toContain("stable preferences");
  });

  it("updates text shadow notes after the response when memory is enabled", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "A direct reply." } }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{
              message: {
                content: "User memory:\n- Preferred tone: concise and warm",
              },
            }],
          }),
          { status: 200 },
        ),
      );

    const result = await createReflection(
      [{ role: "user", content: "Please keep replies concise." }],
      null,
      { rememberUser: true },
    );

    expect(result.message).toBe("A direct reply.");
    expect(result.shadowNotes).toContain("- Preferred tone: concise and warm");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
