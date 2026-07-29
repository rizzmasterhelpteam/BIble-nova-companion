import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const synthesizeSpeech = vi.hoisted(() => vi.fn());
const enforceRateLimits = vi.hoisted(() => vi.fn());
const requireAuthenticatedRequest = vi.hoisted(() => vi.fn());

vi.mock("../server-api", () => ({ synthesizeSpeech }));
vi.mock("../server-security", () => ({
  assertStringLength: vi.fn(),
  enforceRateLimits,
  getHttpErrorDetails: (error: Error & { statusCode?: number }) => ({
    statusCode: error.statusCode || 500,
    message: error.message,
  }),
  requireAuthenticatedRequest,
}));

import ttsHandler from "../api/tts";

const serverApiSource = readFileSync(new URL("../server-api.ts", import.meta.url), "utf8");

const createResponse = () => {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: vi.fn(),
    status: vi.fn((statusCode: number) => {
      response.statusCode = statusCode;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      response.body = body;
      return response;
    }),
    end: vi.fn(),
  };
  return response;
};

describe("Text-to-Speech API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthenticatedRequest.mockResolvedValue({ userId: "user-1", ip: "127.0.0.1" });
    enforceRateLimits.mockResolvedValue(undefined);
  });

  it("uses the selected Australian Chirp 3 HD male voice by default", () => {
    expect(serverApiSource).toContain(
      'DEFAULT_GOOGLE_TTS_VOICE = "en-AU-Chirp3-HD-Algenib"',
    );
    expect(serverApiSource).toContain('DEFAULT_GOOGLE_TTS_LANGUAGE = "en-AU"');
  });

  it("returns authenticated Google TTS audio", async () => {
    synthesizeSpeech.mockResolvedValue({
      audioContent: "base64-audio",
      mimeType: "audio/mpeg",
      voiceName: "en-AU-Chirp3-HD-Algenib",
    });
    const response = createResponse();

    await ttsHandler({ method: "POST", body: { text: "You matter." } }, response);

    expect(response.statusCode).toBe(200);
    expect(synthesizeSpeech).toHaveBeenCalledWith("You matter.");
    expect(response.body).toMatchObject({
      audioContent: "base64-audio",
      voiceName: "en-AU-Chirp3-HD-Algenib",
    });
  });

  it("does not expose provider failures to the client", async () => {
    synthesizeSpeech.mockRejectedValue(new Error("private provider detail"));
    const response = createResponse();

    await ttsHandler({ method: "POST", body: { text: "Hello" } }, response);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      error: "The voice response could not be generated. The reply is still saved in Chat.",
    });
  });
});
