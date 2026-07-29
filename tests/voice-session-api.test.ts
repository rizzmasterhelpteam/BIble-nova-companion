import { beforeEach, describe, expect, it, vi } from "vitest";

const acquireVoiceSessionLease = vi.hoisted(() => vi.fn());
const enforceRateLimits = vi.hoisted(() => vi.fn());
const getVoiceSessionAvailability = vi.hoisted(() => vi.fn());
const releaseVoiceSessionLease = vi.hoisted(() => vi.fn());
const requireAuthenticatedRequest = vi.hoisted(() => vi.fn());

vi.mock("../server-security", () => ({
  acquireVoiceSessionLease,
  createVoiceReservationHandle: () => ({ handle: "h".repeat(43), handleHash: "a".repeat(64) }),
  enforceRateLimits,
  getHttpErrorDetails: (error: Error & { statusCode?: number }) => ({
    statusCode: error.statusCode || 500,
    message: error.message,
  }),
  getVoiceSessionAvailability,
  getVoiceUsageLimits: () => ({ dailyMinutes: 60, resetOffsetMinutes: 330 }),
  hashVoiceReservationHandle: (handle?: string) => handle && handle.length >= 32 ? "a".repeat(64) : null,
  releaseVoiceSessionLease,
  requireAuthenticatedRequest,
}));
vi.mock("../voice-config", () => ({
  getVoiceSessionConfig: () => ({ maxMinutes: 10 }),
}));

import voiceSessionHandler from "../api/voice/session";

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

describe("turn-based Voice session API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthenticatedRequest.mockResolvedValue({ userId: "user-1", ip: "127.0.0.1" });
    enforceRateLimits.mockResolvedValue(undefined);
  });

  it("acquires a premium session lease", async () => {
    getVoiceSessionAvailability.mockResolvedValue({
      eligible: true,
      available: true,
      reason: "available",
      retryAfterSeconds: null,
      canRenew: false,
    });
    acquireVoiceSessionLease.mockResolvedValue({
      leaseId: "lease-1",
      expiresAt: "2026-07-29T12:10:00.000Z",
    });
    const response = createResponse();

    await voiceSessionHandler({
      method: "POST",
      body: { action: "start", reservationHandle: "r".repeat(43) },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(acquireVoiceSessionLease).toHaveBeenCalledWith(
      "user-1",
      10,
      60,
      330,
      "a".repeat(64),
    );
    expect(response.body).toMatchObject({ reservationHandle: "r".repeat(43), resumed: false });
  });

  it("allows the request id header used by Android voice requests", async () => {
    const response = createResponse();

    await voiceSessionHandler({ method: "OPTIONS" }, response);

    expect(response.statusCode).toBe(204);
    expect(response.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Client-Request-Id",
    );
    expect(response.status).toHaveBeenCalledWith(204);
    expect(response.end).toHaveBeenCalledOnce();
  });

  it("recovers a lost start response without acquiring another lease", async () => {
    getVoiceSessionAvailability.mockResolvedValue({
      eligible: true,
      available: true,
      reason: "reservation_resume",
      retryAfterSeconds: 420,
      canRenew: true,
    });
    const response = createResponse();

    await voiceSessionHandler({
      method: "POST",
      body: { action: "start", reservationHandle: "r".repeat(43) },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(acquireVoiceSessionLease).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      reservationHandle: "r".repeat(43),
      remainingSeconds: 420,
      resumed: true,
    });
  });

  it("returns a premium-required reason", async () => {
    getVoiceSessionAvailability.mockResolvedValue({
      eligible: false,
      available: false,
      reason: "subscription_required",
      retryAfterSeconds: null,
      canRenew: false,
    });
    const response = createResponse();

    await voiceSessionHandler({
      method: "POST",
      body: { action: "start", reservationHandle: "r".repeat(43) },
    }, response);

    expect(response.statusCode).toBe(403);
    expect(response.body).toMatchObject({ reason: "subscription_required" });
  });

  it("releases the exact reservation", async () => {
    releaseVoiceSessionLease.mockResolvedValue(undefined);
    const response = createResponse();

    await voiceSessionHandler({
      method: "POST",
      body: { action: "release", reservationHandle: "r".repeat(43) },
    }, response);

    expect(response.statusCode).toBe(204);
    expect(releaseVoiceSessionLease).toHaveBeenCalledWith("user-1", "a".repeat(64));
    expect(response.end).toHaveBeenCalledOnce();
  });
});
