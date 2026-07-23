import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  limits: vi.fn(),
  availability: vi.fn(),
  hash: vi.fn(),
}));

vi.mock("../server-security", () => ({
  enforceRateLimits: mocks.limits,
  getHttpErrorDetails: (error: unknown) => ({
    statusCode: 500,
    message: error instanceof Error ? error.message : String(error),
  }),
  getVoiceSessionAvailability: mocks.availability,
  getVoiceUsageLimits: () => ({ dailyMinutes: 60, resetOffsetMinutes: 330 }),
  hashVoiceReservationHandle: mocks.hash,
  requireAuthenticatedRequest: mocks.auth,
}));

vi.mock("../live-api", () => ({
  getVoiceSessionConfig: () => ({ maxMinutes: 10 }),
}));

import eligibilityHandler from "../api/live/eligibility";

const createResponse = () => {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: vi.fn(),
    status: vi.fn((code: number) => {
      response.statusCode = code;
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

describe("Voice eligibility endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "user-1", ip: "127.0.0.1" });
    mocks.limits.mockResolvedValue(undefined);
    mocks.hash.mockReturnValue("a".repeat(64));
  });

  it("returns a stable subscription-required reason", async () => {
    mocks.availability.mockResolvedValue({
      eligible: false,
      available: false,
      reason: "subscription_required",
      retryAfterSeconds: null,
      canRenew: false,
    });
    const response = createResponse();
    await eligibilityHandler({ method: "GET", headers: {} }, response);
    expect(response.body).toMatchObject({
      available: false,
      reason: "subscription_required",
    });
  });

  it("checks an opaque handle before allowing same-reservation renewal", async () => {
    mocks.availability.mockResolvedValue({
      eligible: true,
      available: true,
      reason: "reservation_resume",
      retryAfterSeconds: 420,
      canRenew: true,
    });
    const response = createResponse();
    await eligibilityHandler({
      method: "GET",
      headers: { "x-voice-reservation": "opaque-handle" },
    }, response);
    expect(mocks.hash).toHaveBeenCalledWith("opaque-handle");
    expect(response.body).toMatchObject({
      available: true,
      reason: "reservation_resume",
      canRenew: true,
    });
  });
});
