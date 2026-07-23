import { beforeEach, describe, expect, it, vi } from "vitest";

const security = vi.hoisted(() => ({
  acquire: vi.fn(),
  cancel: vi.fn(),
  limits: vi.fn(),
  notes: vi.fn(),
  auth: vi.fn(),
}));
const createToken = vi.hoisted(() => vi.fn());

vi.mock("../server-security", () => ({
  acquireVoiceSessionLease: security.acquire,
  cancelUnstartedVoiceSessionLease: security.cancel,
  enforceRateLimits: security.limits,
  getHttpErrorDetails: (error: unknown) => ({
    statusCode: 500,
    message: error instanceof Error ? error.message : String(error),
  }),
  getServerShadowNotes: security.notes,
  requireAuthenticatedRequest: security.auth,
}));

vi.mock("../live-api", () => ({
  createGeminiLiveEphemeralToken: createToken,
  getVoiceSessionConfig: () => ({ maxMinutes: 10 }),
}));

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
    vi.clearAllMocks();
    security.auth.mockResolvedValue({ userId: "user-1", ip: "127.0.0.1" });
    security.limits.mockResolvedValue(undefined);
    security.acquire.mockResolvedValue("11111111-1111-4111-8111-111111111111");
    security.notes.mockResolvedValue("Prefers short prayers.");
    security.cancel.mockResolvedValue(undefined);
    createToken.mockResolvedValue({ token: "ephemeral", model: "live", maxMinutes: 10 });
  });

  it("does not expose the database lease identifier to the client", async () => {
    const response = createResponse();
    await tokenHandler({ method: "POST", headers: {} }, response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ token: "ephemeral", model: "live", maxMinutes: 10 });
    expect(response.body).not.toHaveProperty("leaseId");
  });

  it("cancels only the unstarted lease when token creation fails", async () => {
    createToken.mockRejectedValueOnce(new Error("Gemini token failure"));
    const response = createResponse();
    await tokenHandler({ method: "POST", headers: {} }, response);
    expect(security.cancel).toHaveBeenCalledWith(
      "user-1",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(response.statusCode).toBe(500);
  });
});
