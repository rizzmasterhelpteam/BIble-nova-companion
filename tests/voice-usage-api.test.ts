import { beforeEach, describe, expect, it, vi } from "vitest";

const enforceRateLimits = vi.hoisted(() => vi.fn());
const getVoiceSessionAvailability = vi.hoisted(() => vi.fn());
const requireAuthenticatedRequest = vi.hoisted(() => vi.fn());

vi.mock("../server-security", () => ({
  enforceRateLimits,
  getHttpErrorDetails: (error: Error & { statusCode?: number }) => ({
    statusCode: error.statusCode || 500,
    message: error.message,
  }),
  getVoiceSessionAvailability,
  getVoiceUsageLimits: () => ({ dailyMinutes: 20, monthlyMinutes: 180, resetOffsetMinutes: 330 }),
  requireAuthenticatedRequest,
}));

vi.mock("../voice-config", () => ({
  getVoiceSessionConfig: () => ({ maxMinutes: 15, idleTimeoutSeconds: 45 }),
}));

import voiceUsageHandler from "../api/voice/usage";

const createResponse = () => {
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: vi.fn((name: string, value: string) => headers.set(name, value)),
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

describe("Voice usage API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthenticatedRequest.mockResolvedValue({ userId: "user-1", ip: "127.0.0.1" });
    enforceRateLimits.mockResolvedValue(undefined);
    getVoiceSessionAvailability.mockResolvedValue({
      eligible: true,
      available: true,
      reason: "available",
      retryAfterSeconds: null,
      canRenew: false,
      usage: {
        monthlyLimitMinutes: 180,
        monthlyUsedMinutes: 15,
        monthlyRemainingMinutes: 165,
        monthlyResetAt: "2026-09-01T00:00:00.000Z",
      },
    });
  });

  it("returns authoritative Voice usage and configured limits without reserving a session", async () => {
    const response = createResponse();
    await voiceUsageHandler({ method: "GET", headers: {} }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      eligible: true,
      usage: {
        monthlyUsedMinutes: 15,
        monthlyRemainingMinutes: 165,
      },
      limits: {
        maxSessionMinutes: 15,
        dailyMinutes: 20,
        monthlyMinutes: 180,
      },
    });
    expect(getVoiceSessionAvailability).toHaveBeenCalledWith(
      "user-1",
      15,
      20,
      180,
      330,
      null,
    );
  });
});
