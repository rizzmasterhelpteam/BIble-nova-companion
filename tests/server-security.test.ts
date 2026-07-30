import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const getClaimsMock = vi.hoisted(() => vi.fn());
const getUserMock = vi.hoisted(() => vi.fn());

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    rpc: rpcMock,
    auth: {
      getClaims: getClaimsMock,
      getUser: getUserMock,
    },
  })),
}));

import {
  acquireVoiceSessionLease,
  assertStringLength,
  enforceRateLimits,
  getRateLimitStorageKey,
  getVoiceUsageLimits,
  HttpError,
  requireAuthenticatedRequest,
} from "../server-security";
import { getApiStatus, getNativeSubscriptionClientErrorMessage } from "../server-api";

describe("server security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockReset();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    process.env.RATE_LIMIT_IP_SALT = "test-salt";
    getClaimsMock.mockReset();
    getUserMock.mockReset();
    getClaimsMock.mockResolvedValue({ data: null, error: new Error("legacy key") });
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("requires a bearer token before any backend work", async () => {
    await expect(requireAuthenticatedRequest({ headers: {} })).rejects.toMatchObject({
      statusCode: 401,
      message: "Authentication is required.",
    });
  });

  it("uses verified JWT claims without a getUser round trip when supported", async () => {
    getClaimsMock.mockResolvedValueOnce({
      data: {
        claims: {
          sub: "verified-user",
          iss: "https://example.supabase.co/auth/v1",
          aud: "authenticated",
          exp: Math.floor(Date.now() / 1_000) + 300,
          role: "authenticated",
        },
      },
      error: null,
    });

    await expect(requireAuthenticatedRequest({
      headers: { authorization: "Bearer signed-token" },
    })).resolves.toMatchObject({ userId: "verified-user" });
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("falls back to getUser if verified claims are unavailable", async () => {
    await expect(requireAuthenticatedRequest({
      headers: { authorization: "Bearer legacy-token" },
    })).resolves.toMatchObject({ userId: "user-1" });
    expect(getClaimsMock).toHaveBeenCalledWith("legacy-token");
    expect(getUserMock).toHaveBeenCalledWith("legacy-token");
  });

  it("rejects expired verified claims instead of trusting a fallback user", async () => {
    getClaimsMock.mockResolvedValueOnce({
      data: {
        claims: {
          sub: "expired-user",
          iss: "https://example.supabase.co/auth/v1",
          aud: "authenticated",
          exp: Math.floor(Date.now() / 1_000) - 1,
          role: "authenticated",
        },
      },
      error: null,
    });

    await expect(requireAuthenticatedRequest({
      headers: { authorization: "Bearer expired-token" },
    })).rejects.toMatchObject({ statusCode: 401 });
    expect(getUserMock).not.toHaveBeenCalled();
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

  it("starts user and IP persistent checks concurrently while remaining fail-closed", async () => {
    let resolveFirst: ((value: { data: unknown; error: null }) => void) | null = null;
    const firstCheck = new Promise<{ data: unknown; error: null }>((resolve) => {
      resolveFirst = resolve;
    });
    rpcMock
      .mockImplementationOnce(() => firstCheck)
      .mockResolvedValueOnce({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });

    const pending = enforceRateLimits([
      { key: "voice:user:user-1", limit: 60 },
      { key: "voice:ip:203.0.113.44", limit: 60 },
    ]);
    await Promise.resolve();
    expect(rpcMock).toHaveBeenCalledTimes(2);
    resolveFirst?.({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });
    await expect(pending).resolves.toBeUndefined();
  });

  it.each([
    ["Active premium subscription required", 403],
    ["Voice session already active", 409],
    ["Daily voice allowance reached", 429],
    ["Monthly voice allowance reached", 429],
  ])("maps protected Voice lease rejection '%s' to HTTP %i", async (message, statusCode) => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message } });
    await expect(acquireVoiceSessionLease("user-1", 10, 60, 180, 330)).rejects.toMatchObject({
      statusCode,
    });
  });

  it("passes the configured reset offset into the atomic lease RPC", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{
        lease_id: "11111111-1111-4111-8111-111111111111",
        lease_expires_at: "2026-07-23T12:00:00.000Z",
        leased_minutes: 10,
      }],
      error: null,
    });
    await acquireVoiceSessionLease("user-1", 10, 60, 180, 330, "a".repeat(64));
    expect(rpcMock).toHaveBeenCalledWith("acquire_voice_session_lease", {
      p_user_id: "user-1",
      p_max_minutes: 10,
      p_daily_minutes: 60,
      p_monthly_minutes: 180,
      p_reset_offset_minutes: 330,
      p_handle_hash: "a".repeat(64),
    });
  });

  it("keeps monthly Voice limits server-configurable and never below daily minutes", () => {
    const previousDaily = process.env.VOICE_DAILY_MAX_MINUTES;
    const previousMonthly = process.env.VOICE_MONTHLY_MAX_MINUTES;
    try {
      process.env.VOICE_DAILY_MAX_MINUTES = "20";
      process.env.VOICE_MONTHLY_MAX_MINUTES = "180";
      expect(getVoiceUsageLimits(10)).toMatchObject({
        dailyMinutes: 20,
        monthlyMinutes: 180,
      });

      process.env.VOICE_MONTHLY_MAX_MINUTES = "5";
      expect(getVoiceUsageLimits(10)).toMatchObject({
        dailyMinutes: 20,
        monthlyMinutes: 20,
      });
    } finally {
      if (previousDaily === undefined) delete process.env.VOICE_DAILY_MAX_MINUTES;
      else process.env.VOICE_DAILY_MAX_MINUTES = previousDaily;
      if (previousMonthly === undefined) delete process.env.VOICE_MONTHLY_MAX_MINUTES;
      else process.env.VOICE_MONTHLY_MAX_MINUTES = previousMonthly;
    }
  });

  it("rejects oversized input with a client-safe HTTP error", () => {
    expect(() => assertStringLength("12345", 4, "Prompt")).toThrowError(HttpError);
    expect(() => assertStringLength("12345", 4, "Prompt")).toThrow("Prompt is invalid or too long.");
  });

  it("reports whether secure Google Play subscription linking is configured", () => {
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "play@example.iam.gserviceaccount.com",
      private_key: "test-private-key",
    });
    expect(getApiStatus().nativeSubscriptionSyncReady).toBe(true);

    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
    expect(getApiStatus().nativeSubscriptionSyncReady).toBe(false);
  });

  it("reports turn-based Voice readiness only when Groq and Google TTS are configured", () => {
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "tts@example.iam.gserviceaccount.com",
      private_key: "test-private-key",
    });
    expect(getApiStatus()).toMatchObject({
      chatReady: true,
      speechReady: true,
      ttsReady: true,
      voiceReady: true,
    });

    delete process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON;
    expect(getApiStatus()).toMatchObject({ ttsReady: false, voiceReady: false });
    delete process.env.GROQ_API_KEY;
  });

  it("never formats subscription failures as reflection-service errors", () => {
    expect(
      getNativeSubscriptionClientErrorMessage(
        new Error("Google Play API access was denied for the subscription verifier."),
      ),
    ).toContain("Play Console");
    expect(getNativeSubscriptionClientErrorMessage(new Error("unknown subscription error"))).not.toContain("reflection");
    expect(getNativeSubscriptionClientErrorMessage(new Error("This Google Play subscription could not be acknowledged."))).toContain("Restore Purchases");
  });
});
