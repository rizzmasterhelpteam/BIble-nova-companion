import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.update = vi.fn(() => query);
  query.upsert = vi.fn(() => query);
  query.maybeSingle = vi.fn();
  query.single = vi.fn();

  return {
    from: vi.fn(() => query),
    query,
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: database.from,
  })),
}));

import {
  createReflectionResponse,
  loadShadowMemoryProfile,
  saveShadowNotes,
  setShadowMemoryPreference,
} from "../server-api";
import { normalizeShadowNotes } from "../src/lib/shadowMemory";

describe("shadow memory database boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.query.maybeSingle.mockReset();
    database.query.single.mockReset();
    process.env.VITE_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    process.env.GROQ_API_KEY = "test-groq-key";
    vi.stubGlobal("fetch", vi.fn());
    database.query.maybeSingle.mockResolvedValue({ data: null, error: null });
    database.query.single.mockResolvedValue({
      data: { memory_enabled: false, notes: "" },
      error: null,
    });
  });

  afterEach(() => {
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.GROQ_API_KEY;
    vi.unstubAllGlobals();
  });

  it("clears legacy notes even when an off preference is repeated", async () => {
    database.query.maybeSingle.mockResolvedValueOnce({
      data: { memory_enabled: false, notes: "Legacy context" },
      error: null,
    });

    await expect(setShadowMemoryPreference("user-1", false)).resolves.toEqual({
      memoryEnabled: false,
      shadowNotes: null,
    });

    expect(database.query.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        memory_enabled: false,
        notes: "",
        memory_consent_updated_at: expect.any(String),
      }),
      { onConflict: "user_id" },
    );
  });

  it("preserves existing notes for an idempotent enabled preference", async () => {
    database.query.maybeSingle.mockResolvedValueOnce({
      data: { memory_enabled: true, notes: "Existing context" },
      error: null,
    });

    await expect(setShadowMemoryPreference("user-1", true)).resolves.toEqual({
      memoryEnabled: true,
      shadowNotes: normalizeShadowNotes("Existing context"),
    });
    expect(database.query.upsert).not.toHaveBeenCalled();
  });

  it("persists initial onboarding notes with the explicit opt-in", async () => {
    database.query.single.mockResolvedValueOnce({
      data: { memory_enabled: true, notes: "User memory:\n- Preferred tone: gentle" },
      error: null,
    });
    await expect(setShadowMemoryPreference("user-1", true, "User memory:\n- Preferred tone: gentle"))
      .resolves.toEqual({
        memoryEnabled: true,
        shadowNotes: normalizeShadowNotes("User memory:\n- Preferred tone: gentle"),
      });
    expect(database.query.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ notes: normalizeShadowNotes("User memory:\n- Preferred tone: gentle") }),
      { onConflict: "user_id" },
    );
  });

  it("writes only through a memory-enabled row filter", async () => {
    database.query.maybeSingle.mockResolvedValueOnce({
      data: { notes: "Updated context" },
      error: null,
    });

    await expect(saveShadowNotes("user-1", "Updated context")).resolves.toBe(
      normalizeShadowNotes("Updated context"),
    );
    expect(database.query.update).toHaveBeenCalledWith(
      expect.objectContaining({ notes: normalizeShadowNotes("Updated context") }),
    );
    expect(database.query.eq).toHaveBeenCalledWith("memory_enabled", true);
  });

  it("defaults missing memory preference to disabled", async () => {
    database.query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(loadShadowMemoryProfile("user-1")).resolves.toEqual({
      memoryEnabled: false,
      shadowNotes: null,
    });
  });

  it("does not create memory for a new user before opt-in", async () => {
    database.query.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    await expect(saveShadowNotes("user-1", "User memory:\n- Preferred tone: warm")).resolves.toBeNull();
    expect(database.query.upsert).not.toHaveBeenCalled();
  });

  it("does not recreate notes after an explicit memory opt-out", async () => {
    database.query.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { memory_enabled: false }, error: null });

    await expect(saveShadowNotes("user-1", "Do not save this.")).resolves.toBeNull();
    expect(database.query.upsert).not.toHaveBeenCalled();
  });

  it("trims oversized memory before the database write", async () => {
    database.query.maybeSingle.mockResolvedValueOnce({
      data: { notes: "Stored context" },
      error: null,
    });
    const oversized = `- Important personal context: ${"useful ".repeat(900)}`;

    await saveShadowNotes("user-1", oversized);

    const writtenNotes = database.query.update.mock.calls[0][0].notes as string;
    expect(writtenNotes.length).toBeLessThanOrEqual(4_000);
    expect(writtenNotes).toContain("User memory:");
  });

  it("saves updated shadow notes for a text reflection after generating the reply", async () => {
    database.query.maybeSingle
      .mockResolvedValueOnce({
        data: { memory_enabled: true, notes: null },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { notes: "User memory:\n- Preferred tone: concise and warm" },
        error: null,
      });
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "A direct reply." } }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{
              message: {
                content: "User memory:\n- Preferred tone: concise and warm",
              },
            }],
          }),
          { status: 200 },
        ),
      );

    const result = await createReflectionResponse(
      "user-1",
      [{ role: "user", content: "Please keep replies concise." }],
    );

    expect(result.message).toBe("A direct reply.");
    expect(result.shadowNotes).toContain("- Preferred tone: concise and warm");
    expect(database.query.update).toHaveBeenCalled();
  });
});
