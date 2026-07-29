import { beforeEach, describe, expect, it, vi } from "vitest";

const transcribeAudio = vi.hoisted(() => vi.fn());
const enforceRateLimits = vi.hoisted(() => vi.fn());
const requireAuthenticatedRequest = vi.hoisted(() => vi.fn());

vi.mock("../server-api", () => ({ transcribeAudio }));
vi.mock("../server-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server-security")>();
  return {
    ...actual,
    enforceRateLimits,
    requireAuthenticatedRequest,
  };
});

import transcribeHandler from "../api/transcribe";

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

const createMultipartRequest = async (
  mimeType = "audio/webm;codecs=opus",
) => {
  const formData = new FormData();
  formData.append("file", new Blob(["recorded-audio"], { type: mimeType }), "speech.webm");
  formData.append("language", "en");
  const request = new Request("http://localhost/api/transcribe", {
    method: "POST",
    body: formData,
  });
  return {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") || "",
      "x-client-request-id": "turn-multipart",
    },
    body: Buffer.from(await request.arrayBuffer()),
  };
};

describe("transcription API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthenticatedRequest.mockResolvedValue({
      userId: "user-1",
      ip: "127.0.0.1",
    });
    enforceRateLimits.mockResolvedValue(undefined);
    transcribeAudio.mockResolvedValue("I feel anxious tonight.");
  });

  it("accepts multipart audio and forwards the file without base64", async () => {
    const response = createResponse();
    await transcribeHandler(await createMultipartRequest(), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ text: "I feel anxious tonight." });
    expect(transcribeAudio).toHaveBeenCalledOnce();
    const [audio, language] = transcribeAudio.mock.calls[0];
    expect(audio).toBeInstanceOf(Blob);
    expect(audio.type).toBe("audio/webm;codecs=opus");
    expect(language).toBe("en");
    expect(enforceRateLimits).toHaveBeenCalledWith([
      { key: "transcribe:user:user-1", limit: 30 },
      { key: "transcribe:ip:127.0.0.1", limit: 60 },
    ]);
  });

  it("retains base64 JSON compatibility for an older Android build", async () => {
    const response = createResponse();
    const audio = "data:audio/webm;codecs=opus;base64,U29tZSBhdWRpbw==";
    await transcribeHandler({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { audio, language: "en" },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(transcribeAudio).toHaveBeenCalledWith(audio, "en");
  });

  it("rejects unsupported multipart audio before provider upload", async () => {
    const response = createResponse();
    await transcribeHandler(await createMultipartRequest("audio/wav"), response);

    expect(response.statusCode).toBe(415);
    expect(transcribeAudio).not.toHaveBeenCalled();
  });
});
