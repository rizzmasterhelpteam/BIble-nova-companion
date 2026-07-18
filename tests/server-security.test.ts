import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc: rpcMock })),
}));

import {
  assertStringLength,
  enforceRateLimits,
  getRateLimitStorageKey,
  HttpError,
  requireAuthenticatedRequest,
} from "../server-security";

describe("server security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    process.env.RATE_LIMIT_IP_SALT = "test-salt";
  });

  it("requires a bearer token before any backend work", async () => {
    await expect(requireAuthenticatedRequest({ headers: {} })).rejects.toMatchObject({
      statusCode: 401,
      message: "Authentication is required.",
    });
  });

  it("hashes IP keys so raw client addresses are never persisted", () => {
    const key = getRateLimitStorageKey("chat:ip:203.0.113.44");
    expect(key).toMatch(/^chat:ip:[a-f0-9]{64}$/);
    expect(key).not.toContain("203.0.113.44");
  });

  it("uses the server-only service key as a safe fallback salt", () => {
    delete process.env.RATE_LIMIT_IP_SALT;
    const key = getRateLimitStorageKey("subscription-sync:ip:203.0.113.44");
    expect(key).toMatch(/^subscription-sync:ip:[a-f0-9]{64}$/);
    expect(key).not.toContain("203.0.113.44");
  });

  it("uses the persistent RPC and rejects denied windows", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });
    await enforceRateLimits([{ key: "chat:user:user-1", limit: 30 }]);
    expect(rpcMock).toHaveBeenCalledWith("check_rate_limit", expect.objectContaining({
      p_key: "chat:user:user-1",
      p_limit: 30,
      p_window_seconds: 600,
    }));

    rpcMock.mockResolvedValueOnce({ data: [{ allowed: false, retry_after_seconds: 17 }], error: null });
    await expect(enforceRateLimits([{ key: "chat:user:user-1", limit: 30 }])).rejects.toMatchObject({
      statusCode: 429,
      retryAfterSeconds: 17,
    });
  });

  it("fails closed if the persistent limiter is unavailable", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "missing function" } });
    await expect(enforceRateLimits([{ key: "chat:user:user-1", limit: 1 }])).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("rejects oversized input with a client-safe HTTP error", () => {
    expect(() => assertStringLength("12345", 4, "Prompt")).toThrowError(HttpError);
    expect(() => assertStringLength("12345", 4, "Prompt")).toThrow("Prompt is invalid or too long.");
  });
});
