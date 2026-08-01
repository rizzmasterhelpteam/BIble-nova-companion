import { beforeEach, describe, expect, it, vi } from "vitest";

const acquireVoiceSessionLease = vi.hoisted(() => vi.fn());
const enforceRateLimits = vi.hoisted(() => vi.fn());
const getVoiceSessionAvailability = vi.hoisted(() => vi.fn());
const releaseVoiceSessionLease = vi.hoisted(() => vi.fn());
const requireAuthenticatedRequest = vi.hoisted(() => vi.fn());

vi.mock("../server-security", () => ({
  acquireVoiceSessionLease,
  createVoiceReservationHandle: () => ({
    handle: "h".repeat(43),
    handleHash: "h".repeat(64),
  }),
  enforceRateLimits,
  getHttpErrorDetails: (error: Error & { statusCode?: number }) => ({
    statusCode: error.statusCode || 500,
    message: error.message,
  }),
  getVoiceSessionAvailability,
  getVoiceUsageLimits: () => ({ dailyMinutes: 60, monthlyMinutes: 180, resetOffsetMinutes: 330 }),
  hashVoiceReservationHandle: (handle?: string) =>
    handle && handle.length >= 32 ? handle[0].repeat(64) : null,
  releaseVoiceSessionLease,
  requireAuthenticatedRequest,
}));
vi.mock("../voice-config", () => ({
  getVoiceSessionConfig: () => ({ maxMinutes: 10, idleTimeoutSeconds: 45 }),
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
    requireAuthenticatedRequest.mockResolvedValue({
      userId: "user-1",
      ip: "127.0.0.1",
    });
    enforceRateLimits.mockResolvedValue(undefined);
    releaseVoiceSessionLease.mockResolvedValue(true);
  });

  it("fresh start releases an old reservation and acquires a new handle", async () => {
    getVoiceSessionAvailability.mockResolvedValue({
      eligible: true,
      available: true,
      reason: "available",
      retryAfterSeconds: null,
      canRenew: false,
      usage: {
        monthlyLimitMinutes: 180,
        monthlyUsedMinutes: 20,
        monthlyRemainingMinutes: 160,
        monthlyResetAt: "2026-08-01T00:00:00.000Z",
      },
    });
    acquireVoiceSessionLease.mockResolvedValue({
      leaseId: "lease-1",
      expiresAt: "2026-07-29T12:10:00.000Z",
      reservedMinutes: 10,
    });
    const response = createResponse();

    await voiceSessionHandler({
      method: "POST",
      body: {
        action: "start",
        mode: "fresh_start",
        reservationHandle: "r".repeat(43),
        previousReservationHandle: "p".repeat(43),
      },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(releaseVoiceSessionLease).toHaveBeenCalledWith("user-1", "p".repeat(64));
    expect(getVoiceSessionAvailability).toHaveBeenCalledWith(
      "user-1",
      10,
      60,
      180,
      330,
      null,
    );
    expect(acquireVoiceSessionLease).toHaveBeenCalledWith(
      "user-1",
      10,
      60,
      180,
      330,
      "r".repeat(64),
    );
    expect(response.body).toMatchObject({
      reservationHandle: "r".repeat(43),
      resumed: false,
      idleTimeoutSeconds: 45,
      usage: expect.objectContaining({ monthlyRemainingMinutes: 150 }),
    });
  });

  it("fresh start generates a new handle when none is valid", async () => {
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
      reservedMinutes: 10,
    });
    const response = createResponse();

    await voiceSessionHandler({
      method: "POST",
      body: { action: "start", mode: "fresh_start" },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(acquireVoiceSessionLease).toHaveBeenCalledWith(
      "user-1",
      10,
      60,
      180,
      330,
      "h".repeat(64),
    );
    expect(response.body).toMatchObject({ reservationHandle: "h".repeat(43) });
  });

  it("recovery resume reuses a valid active reservation", async () => {
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
      body: {
        action: "start",
        mode: "recovery_resume",
        reservationHandle: "r".repeat(43),
      },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(acquireVoiceSessionLease).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      reservationHandle: "r".repeat(43),
      remainingSeconds: 420,
      resumed: true,
    });
  });

  it("rejects recovery with less than two minutes remaining", async () => {
    getVoiceSessionAvailability.mockResolvedValue({
      eligible: true,
      available: true,
      reason: "reservation_resume",
      retryAfterSeconds: 119,
      canRenew: true,
    });
    const response = createResponse();

    await voiceSessionHandler({
      method: "POST",
      body: {
        action: "start",
        mode: "recovery_resume",
        reservationHandle: "r".repeat(43),
      },
    }, response);

    expect(response.statusCode).toBe(410);
    expect(response.body).toMatchObject({ reason: "recovery_unavailable" });
    expect(acquireVoiceSessionLease).not.toHaveBeenCalled();
  });

  it("returns a premium-required reason without weakening eligibility", async () => {
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
      body: {
        action: "start",
        mode: "fresh_start",
        reservationHandle: "r".repeat(43),
      },
    }, response);

    expect(response.statusCode).toBe(403);
    expect(response.body).toMatchObject({ reason: "subscription_required" });
  });

  it("returns a retryable monthly limit with server-calculated remaining minutes", async () => {
    getVoiceSessionAvailability.mockResolvedValue({
      eligible: true,
      available: false,
      reason: "monthly_limit",
      retryAfterSeconds: 86_400,
      canRenew: false,
      usage: {
        monthlyLimitMinutes: 180,
        monthlyUsedMinutes: 180,
        monthlyRemainingMinutes: 0,
        monthlyResetAt: "2026-08-01T00:00:00.000Z",
      },
    });
    const response = createResponse();

    await voiceSessionHandler({
      method: "POST",
      body: { action: "start", mode: "fresh_start", reservationHandle: "r".repeat(43) },
    }, response);

    expect(response.statusCode).toBe(429);
    expect(response.body).toMatchObject({
      reason: "monthly_limit",
      usage: { monthlyRemainingMinutes: 0 },
    });
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "86400");
    expect(acquireVoiceSessionLease).not.toHaveBeenCalled();
  });

  it("allows the request id header used by Android voice requests", async () => {
    const response = createResponse();

    await voiceSessionHandler({ method: "OPTIONS" }, response);

    expect(response.statusCode).toBe(204);
    expect(response.setHeader).toHaveBeenCalledWith(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Client-Request-Id",
    );
    expect(response.end).toHaveBeenCalledOnce();
  });

  it("releases the exact reservation once with an explicit reason", async () => {
    const response = createResponse();

    await voiceSessionHandler({
      method: "POST",
      body: {
        action: "release",
        reservationHandle: "r".repeat(43),
        releaseReason: "user_exit",
      },
    }, response);

    expect(response.statusCode).toBe(204);
    expect(releaseVoiceSessionLease).toHaveBeenCalledWith(
      "user-1",
      "r".repeat(64),
    );
    expect(response.end).toHaveBeenCalledOnce();
  });
});
