import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const createVoiceReflectionResponse = vi.hoisted(() => vi.fn());
const createReflectionResponse = vi.hoisted(() => vi.fn());
const enforceRateLimits = vi.hoisted(() => vi.fn());
const requireAuthenticatedRequest = vi.hoisted(() => vi.fn());

vi.mock("../chat-api", () => ({
  getClientErrorMessage: (error: Error) => error.message,
}));
vi.mock("../server-api", () => ({
  createReflectionResponse,
  createVoiceReflectionResponse,
}));
vi.mock("../server-security", () => ({
  assertStringLength: vi.fn(),
  enforceRateLimits,
  getHttpErrorDetails: (error: Error & { statusCode?: number }) => ({
    statusCode: error.statusCode || 500,
    message: error.message,
  }),
  requireAuthenticatedRequest,
}));

import chatHandler from "../api/chat";

const vercelConfig = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
);

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

describe("Voice response API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthenticatedRequest.mockResolvedValue({
      userId: "user-1",
      ip: "127.0.0.1",
    });
    enforceRateLimits.mockResolvedValue(undefined);
    createVoiceReflectionResponse.mockResolvedValue({
      message: "I've got you. Take one slow breath and let this moment be enough.",
    });
  });

  it("returns the user-facing response without a shadow-note result", async () => {
    const response = createResponse();

    await chatHandler({
      method: "POST",
      headers: { "x-client-request-id": "turn-1234567890123456" },
      body: {
        mode: "voice",
        messages: [{ role: "user", content: "I feel anxious." }],
        shadowNotes: "User appreciates short prayers.",
      },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(createVoiceReflectionResponse).toHaveBeenCalledOnce();
    expect(response.body).toEqual({
      message: "I've got you. Take one slow breath and let this moment be enough.",
    });
    expect(response.body).not.toHaveProperty("shadowNotes");
  });

  it("keeps authentication and Voice-specific rate limits", async () => {
    const response = createResponse();

    await chatHandler({
      method: "POST",
      headers: {},
      body: {
        mode: "voice",
        messages: [{ role: "user", content: "Help me pray." }],
      },
    }, response);

    expect(requireAuthenticatedRequest).toHaveBeenCalledOnce();
    expect(enforceRateLimits).toHaveBeenCalledWith([
      { key: "voice-respond:user:user-1", limit: 30 },
      { key: "voice-respond:ip:127.0.0.1", limit: 60 },
    ]);
  });

  it("formalizes /api/voice/respond without adding another Vercel function", async () => {
    const response = createResponse();

    await chatHandler({
      method: "POST",
      url: "/api/chat?mode=voice",
      query: { mode: "voice" },
      headers: {},
      body: {
        messages: [{ role: "user", content: "Stay with me." }],
      },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(createVoiceReflectionResponse).toHaveBeenCalledOnce();
    expect(vercelConfig.rewrites[0]).toEqual({
      source: "/api/voice/respond",
      destination: "/api/chat?mode=voice",
    });
  });
});
