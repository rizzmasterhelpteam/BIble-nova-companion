import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  result: {
    data: [] as unknown[],
    error: null as unknown,
  },
  limit: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => {
    const builder: Record<string, (...args: unknown[]) => unknown> = {};
    for (const method of ["select", "eq", "not", "update"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.limit = vi.fn((count: number) => {
      database.limit(count);
      return Promise.resolve(database.result);
    });
    const table = { from: vi.fn(() => builder) };
    return {
      schema: vi.fn(() => table),
      from: vi.fn(() => builder),
    };
  }),
}));

import {
  acknowledgeVoiceTokenIdempotency,
  getServerShadowNotes,
  getVoiceTokenIdempotencyResponse,
} from "../server-security";

describe("Voice token recovery queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    database.result = { data: [], error: null };
  });

  it("treats a stale Android request ID as a safe recovery miss", async () => {
    await expect(
      getVoiceTokenIdempotencyResponse("user-1", "stale-request-id-0001"),
    ).resolves.toBeNull();
    expect(database.limit).toHaveBeenCalledWith(1);
  });

  it("returns a completed unacknowledged token response", async () => {
    database.result = {
      data: [{
        response: { token: "ephemeral", model: "live" },
        expires_at: "2099-01-01T00:00:00.000Z",
        acknowledged_at: null,
      }],
      error: null,
    };

    await expect(
      getVoiceTokenIdempotencyResponse("user-1", "completed-request-001"),
    ).resolves.toEqual({ token: "ephemeral", model: "live" });
  });

  it("returns a stable not-found error when acknowledgement has no row", async () => {
    await expect(
      acknowledgeVoiceTokenIdempotency("user-1", "missing-request-id-001"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("allows Voice startup when a user has no shadow notes", async () => {
    await expect(getServerShadowNotes("user-1")).resolves.toBe("");
    expect(database.limit).toHaveBeenCalledWith(1);
  });
});
