import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/native/platform", () => ({ isNativePlatform: () => false }));
vi.mock("../src/lib/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: {},
}));

import { apiFetch, invalidateApiSession } from "../src/lib/apiClient";

describe("API account generation", () => {
  it("rejects a response that arrives after account invalidation", async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    const request = apiFetch("/api/status");
    invalidateApiSession();
    resolveFetch(new Response("{}", { status: 200 }));
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
