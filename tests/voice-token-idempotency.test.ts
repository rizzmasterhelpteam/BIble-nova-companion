import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  result: {
    data: [] as unknown[],
    error: null as unknown,
  },
  limit: vi.fn(),
  rpc: vi.fn(),
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
      rpc: database.rpc,
      schema: vi.fn(() => table),
      from: vi.fn(() => builder),
    };
  }),
}));

import {
  acknowledgeVoiceTokenIdempotency,
  attachVoiceTokenIdempotencyLease,
  beginVoiceTokenIdempotency,
  completeVoiceTokenIdempotency,
  deleteVoiceTokenIdempotency,
  getServerShadowNotes,
  getVoiceTokenIdempotencyResponse,
} from "../server-security";

describe("Voice token recovery queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    database.result = { data: [], error: null };
    database.rpc.mockImplementation(() => Promise.resolve(database.result));
  });

  it("treats a stale Android request ID as a safe recovery miss", async () => {
    await expect(
      getVoiceTokenIdempotencyResponse("user-1", "stale-request-id-0001"),
    ).resolves.toBeNull();
    expect(database.rpc).toHaveBeenCalledWith("get_voice_token_idempotency_response", {
      p_user_id: "user-1",
      p_request_id: "stale-request-id-0001",
    });
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

  it("does not misclassify a private-schema 406 as a safe no-row miss", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    database.result = {
      data: null,
      error: { code: "PGRST106", status: 406, message: "Schema is not exposed." },
    };

    await expect(
      getVoiceTokenIdempotencyResponse("user-1", "schema-error-request01"),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(errorSpy).toHaveBeenCalledWith(
      "Voice token idempotency operation failed:",
      expect.objectContaining({ operation: "read", code: "PGRST106", status: 406 }),
    );
    errorSpy.mockRestore();
  });

  it("uses service-only RPCs for every idempotency lifecycle write", async () => {
    database.result = { data: true, error: null };

    await expect(beginVoiceTokenIdempotency("user-1", "begin-request-id0001")).resolves.toBe(true);
    await expect(
      attachVoiceTokenIdempotencyLease(
        "user-1",
        "begin-request-id0001",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).resolves.toBeUndefined();
    await expect(
      completeVoiceTokenIdempotency(
        "user-1",
        "begin-request-id0001",
        { token: "ephemeral" },
        "11111111-1111-4111-8111-111111111111",
      ),
    ).resolves.toBeUndefined();
    await expect(deleteVoiceTokenIdempotency("user-1", "begin-request-id0001")).resolves.toBeUndefined();

    expect(database.rpc).toHaveBeenCalledWith("begin_voice_token_idempotency", {
      p_user_id: "user-1",
      p_request_id: "begin-request-id0001",
    });
    expect(database.rpc).toHaveBeenCalledWith("attach_voice_token_idempotency_lease", {
      p_user_id: "user-1",
      p_request_id: "begin-request-id0001",
      p_lease_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(database.rpc).toHaveBeenCalledWith("complete_voice_token_idempotency", {
      p_user_id: "user-1",
      p_request_id: "begin-request-id0001",
      p_response: { token: "ephemeral" },
      p_lease_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(database.rpc).toHaveBeenCalledWith("delete_voice_token_idempotency", {
      p_user_id: "user-1",
      p_request_id: "begin-request-id0001",
    });
  });

  it("returns a stable not-found error when acknowledgement has no row", async () => {
    database.result = { data: false, error: null };
    await expect(
      acknowledgeVoiceTokenIdempotency("user-1", "missing-request-id-001"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("allows Voice startup when a user has no shadow notes", async () => {
    await expect(getServerShadowNotes("user-1")).resolves.toBe("");
    expect(database.limit).toHaveBeenCalledWith(1);
  });
});
