import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { transcribeAudio } from "../server-api";

describe("speech transcription audio payloads", () => {
  const originalApiKey = process.env.GROQ_API_KEY;

  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-groq-key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalApiKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalApiKey;
  });

  it("accepts MediaRecorder data URLs with codec parameters", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ text: "hello from the microphone" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const text = await transcribeAudio(
      "data:audio/webm;codecs=opus;base64,U29tZSBhdWRpbyBkYXRh",
      "en",
    );

    expect(text).toBe("hello from the microphone");
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1];
    const body = request?.body as FormData;
    const file = body.get("file") as Blob;
    expect(file.type).toBe("audio/webm");
  });
});
