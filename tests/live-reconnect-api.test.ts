import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  limits: vi.fn(),
  hash: vi.fn(),
  renew: vi.fn(),
  notes: vi.fn(),
  token: vi.fn(),
}));

vi.mock("../server-security", () => ({
  enforceRateLimits: mocks.limits,
  getHttpErrorDetails: (error: unknown) => {
    const candidate = error as { statusCode?: number; message?: string };
    return { statusCode: candidate.statusCode || 500, message: candidate.message || "error" };
  },
  getServerShadowNotes: mocks.notes,
  hashVoiceReservationHandle: mocks.hash,
  renewVoiceSessionLease: mocks.renew,
  requireAuthenticatedRequest: mocks.auth,
}));

vi.mock("../live-api", () => ({
  createGeminiLiveEphemeralToken: mocks.token,
}));

import reconnectHandler from "../api/live/reconnect-token";

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

describe("Voice reconnect token endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "user-1", ip: "127.0.0.1" });
    mocks.limits.mockResolvedValue(undefined);
    mocks.hash.mockReturnValue("b".repeat(64));
    mocks.renew.mockResolvedValue({
      leaseId: "lease-1",
      expiresAt: "2026-07-23T12:00:00.000Z",
    });
    mocks.notes.mockResolvedValue("");
    mocks.token.mockResolvedValue({ token: "replacement", model: "live", maxMinutes: 10 });
  });

  it("mints a replacement token without creating another reservation", async () => {
    const response = createResponse();
    await reconnectHandler({
      method: "POST",
      headers: {},
      body: { reservationHandle: "opaque-handle" },
    }, response);
    expect(mocks.renew).toHaveBeenCalledWith("user-1", "b".repeat(64));
    expect(response.body).toEqual({
      token: "replacement",
      model: "live",
      maxMinutes: 10,
      reservationHandle: "opaque-handle",
      reservationExpiresAt: "2026-07-23T12:00:00.000Z",
    });
  });

  it("returns a stable renewal-unavailable code after bounded renewals", async () => {
    mocks.renew.mockRejectedValueOnce({
      statusCode: 409,
      message: "This Voice reservation cannot be renewed.",
    });
    const response = createResponse();
    await reconnectHandler({
      method: "POST",
      headers: {},
      body: { reservationHandle: "opaque-handle" },
    }, response);
    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ reason: "renewal_unavailable" });
  });
});
