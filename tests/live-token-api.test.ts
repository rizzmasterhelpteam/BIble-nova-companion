import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => ({
  acquire: vi.fn(),
  attachLease: vi.fn(),
  acknowledge: vi.fn(),
  cancel: vi.fn(),
  limits: vi.fn(),
  notes: vi.fn(),
  auth: vi.fn(),
  createHandle: vi.fn(),
  hashHandle: vi.fn(),
  claimRenewal: vi.fn(),
  finalizeRenewal: vi.fn(),
  rollbackRenewal: vi.fn(),
  getIdempotency: vi.fn(),
  beginIdempotency: vi.fn(),
  completeIdempotency: vi.fn(),
  deleteIdempotency: vi.fn(),
  release: vi.fn(),
}));
const createToken = vi.hoisted(() => vi.fn());

vi.mock("../server-security", () => ({
  acquireVoiceSessionLease: security.acquire,
  attachVoiceTokenIdempotencyLease: security.attachLease,
  acknowledgeVoiceTokenIdempotency: security.acknowledge,
  cancelUnstartedVoiceSessionLease: security.cancel,
  enforceRateLimits: security.limits,
  claimVoiceSessionRenewal: security.claimRenewal,
  finalizeVoiceSessionRenewal: security.finalizeRenewal,
  getVoiceTokenIdempotencyResponse: security.getIdempotency,
  beginVoiceTokenIdempotency: security.beginIdempotency,
  completeVoiceTokenIdempotency: security.completeIdempotency,
  deleteVoiceTokenIdempotency: security.deleteIdempotency,
  releaseVoiceSessionLease: security.release,
  getHttpErrorDetails: (error: unknown) => ({
    statusCode: 500,
    message: error instanceof Error ? error.message : String(error),
  }),
  getServerShadowNotes: security.notes,
  getVoiceUsageLimits: () => ({ dailyMinutes: 60, resetOffsetMinutes: 330 }),
  createVoiceReservationHandle: security.createHandle,
  hashVoiceReservationHandle: security.hashHandle,
  rollbackVoiceSessionRenewal: security.rollbackRenewal,
  requireAuthenticatedRequest: security.auth,
}));

vi.mock("../live-api", () => ({
  createGeminiLiveEphemeralToken: createToken,
  getVoiceSessionConfig: () => ({ maxMinutes: 10 }),
  VoiceTokenTimingError: class VoiceTokenTimingError extends Error {
    statusCode: number;
    reason: "renewal_unavailable" | "connection_failed";

    constructor(
      message: string,
      statusCode: number,
      reason: "renewal_unavailable" | "connection_failed",
    ) {
      super(message);
      this.statusCode = statusCode;
      this.reason = reason;
    }
  },
}));

import { VoiceTokenTimingError } from "../live-api";
import tokenHandler from "../api/live/token";

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

describe("Gemini Live token endpoint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T11:50:00.000Z"));
    vi.clearAllMocks();
    security.auth.mockResolvedValue({ userId: "user-1", ip: "127.0.0.1" });
    security.limits.mockResolvedValue(undefined);
    security.acquire.mockResolvedValue({
      leaseId: "11111111-1111-4111-8111-111111111111",
      expiresAt: "2026-07-23T12:00:00.000Z",
    });
    security.attachLease.mockResolvedValue(undefined);
    security.acknowledge.mockResolvedValue(undefined);
    security.createHandle.mockReturnValue({
      handle: "opaque-reservation-handle",
      handleHash: "a".repeat(64),
    });
    security.notes.mockResolvedValue("Prefers short prayers.");
    security.cancel.mockResolvedValue(undefined);
    security.hashHandle.mockReturnValue("b".repeat(64));
    security.claimRenewal.mockResolvedValue({
      leaseId: "11111111-1111-4111-8111-111111111111",
      expiresAt: "2026-07-23T12:00:00.000Z",
      claimHash: "c".repeat(64),
    });
    security.finalizeRenewal.mockResolvedValue(undefined);
    security.rollbackRenewal.mockResolvedValue(undefined);
    security.getIdempotency.mockResolvedValue(null);
    security.beginIdempotency.mockResolvedValue(true);
    security.completeIdempotency.mockResolvedValue(undefined);
    security.deleteIdempotency.mockResolvedValue(undefined);
    security.release.mockResolvedValue(undefined);
    createToken.mockResolvedValue({
      token: "ephemeral",
      model: "live",
      maxMinutes: 10,
      expiresAt: "2026-07-23T12:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews through the existing token route without creating another lease", async () => {
    const response = createResponse();
    await tokenHandler({
      method: "POST",
      headers: { "x-client-request-id": "request-id-0000001" },
      body: { reservationHandle: "existing-opaque-handle" },
    }, response);
    expect(security.claimRenewal).toHaveBeenCalledWith("user-1", "b".repeat(64));
    expect(createToken).toHaveBeenCalledWith({
      shadowNotes: "Prefers short prayers.",
      reservationExpiresAt: "2026-07-23T12:00:00.000Z",
    });
    expect(security.acquire).not.toHaveBeenCalled();
    expect(security.finalizeRenewal).toHaveBeenCalledWith("user-1", "c".repeat(64));
    expect(response.body).toMatchObject({
      token: "ephemeral",
      reservationHandle: "existing-opaque-handle",
    });
  });

  it("releases an existing lease before token idempotency and rate limits", async () => {
    const response = createResponse();
    await tokenHandler({
      method: "POST",
      headers: { "x-client-request-id": "release-id-00000001" },
      body: { action: "release", reservationHandle: "existing-opaque-handle" },
    }, response);

    expect(security.release).toHaveBeenCalledWith("user-1", "b".repeat(64));
    expect(security.getIdempotency).not.toHaveBeenCalled();
    expect(security.limits).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(204);
    expect(response.end).toHaveBeenCalled();
  });

  it("recovers a completed token response before rate limiting", async () => {
    security.getIdempotency.mockResolvedValueOnce({
      token: "recovered-token",
      model: "live",
      reservationHandle: "recovered-handle",
    });
    const response = createResponse();
    await tokenHandler({
      method: "POST",
      headers: { "x-client-request-id": "recover-id-00000001" },
      body: { action: "recover" },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ token: "recovered-token" });
    expect(security.limits).not.toHaveBeenCalled();
    expect(security.beginIdempotency).not.toHaveBeenCalled();
  });

  it("acknowledges an accepted token response before rate limiting", async () => {
    const response = createResponse();
    await tokenHandler({
      method: "POST",
      headers: { "x-client-request-id": "acknowledge-id-0001" },
      body: { action: "acknowledge" },
    }, response);

    expect(security.acknowledge).toHaveBeenCalledWith("user-1", "acknowledge-id-0001");
    expect(response.statusCode).toBe(204);
    expect(security.limits).not.toHaveBeenCalled();
  });

  it("rolls back a renewal claim when Gemini token minting fails", async () => {
    createToken.mockRejectedValueOnce(new Error("Gemini token failure"));
    const response = createResponse();
    await tokenHandler({
      method: "POST",
      headers: { "x-client-request-id": "request-id-0000002" },
      body: { reservationHandle: "existing-opaque-handle" },
    }, response);
    expect(security.rollbackRenewal).toHaveBeenCalledWith("user-1", "c".repeat(64));
    expect(response.statusCode).toBe(500);
  });

  it("returns only an opaque reservation handle, never the database lease identifier", async () => {
    const response = createResponse();
    await tokenHandler({ method: "POST", headers: { "x-client-request-id": "request-id-0000003" } }, response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      token: "ephemeral",
      model: "live",
      maxMinutes: 10,
      expiresAt: "2026-07-23T12:00:00.000Z",
      reservationHandle: "opaque-reservation-handle",
      reservationExpiresAt: "2026-07-23T12:00:00.000Z",
      remainingSeconds: 600,
    });
    expect(response.body).not.toHaveProperty("leaseId");
    expect(Date.parse((response.body as { expiresAt: string }).expiresAt)).toBeLessThanOrEqual(
      Date.parse((response.body as { reservationExpiresAt: string }).reservationExpiresAt),
    );
    expect(createToken).toHaveBeenCalledWith({
      shadowNotes: "Prefers short prayers.",
      reservationExpiresAt: "2026-07-23T12:00:00.000Z",
    });
  });

  it("cancels only the unstarted lease when token creation fails", async () => {
    createToken.mockRejectedValueOnce(new Error("Gemini token failure"));
    const response = createResponse();
    await tokenHandler({ method: "POST", headers: { "x-client-request-id": "request-id-0000004" } }, response);
    expect(security.cancel).toHaveBeenCalledWith(
      "user-1",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(security.deleteIdempotency).toHaveBeenCalledWith("user-1", "request-id-0000004");
    expect(response.statusCode).toBe(500);
  });

  it("validates renewal handles before rate limiting or idempotency insertion", async () => {
    security.hashHandle.mockReturnValueOnce(null);
    const response = createResponse();

    await tokenHandler({
      method: "POST",
      headers: { "x-client-request-id": "request-id-invalid01" },
      body: { reservationHandle: "invalid-handle" },
    }, response);

    expect(response.statusCode).toBe(400);
    expect(security.limits).not.toHaveBeenCalled();
    expect(security.beginIdempotency).not.toHaveBeenCalled();
  });

  it("returns a stable 409 and rolls back when a renewal is nearly expired", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const timingError = new VoiceTokenTimingError(
      "This Voice reservation is nearly complete.",
      409,
      "renewal_unavailable",
    );
    createToken.mockRejectedValueOnce(timingError);
    const response = createResponse();

    await tokenHandler({
      method: "POST",
      headers: { "x-client-request-id": "request-id-0000005" },
      body: { reservationHandle: "existing-opaque-handle" },
    }, response);

    expect(security.rollbackRenewal).toHaveBeenCalledWith("user-1", "c".repeat(64));
    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: "This Voice reservation is nearly complete.",
      reason: "renewal_unavailable",
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
