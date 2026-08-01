import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sessionSource = readFileSync(new URL("../api/voice/session.ts", import.meta.url), "utf8");
const rollbackMigrationSource = readFileSync(
  new URL("../supabase/migrations/20260801075351_remove_voice_web_payment_bypass.sql", import.meta.url),
  "utf8",
);

describe("Voice payment enforcement", () => {
  it("does not allow browser origin or environment bypasses", () => {
    expect(sessionSource).not.toContain("VOICE_WEB_PAYMENT_BYPASS");
    expect(sessionSource).not.toContain("VOICE_WEB_TEST_ORIGIN");
    expect(sessionSource).not.toContain("allowPaymentBypass");
  });

  it("removes the temporary bypass-only RPC overloads", () => {
    expect(rollbackMigrationSource).toContain("drop function if exists public.acquire_voice_session_lease");
    expect(rollbackMigrationSource).toContain("drop function if exists public.get_voice_session_availability");
    expect(rollbackMigrationSource).toContain("text, boolean");
  });
});
