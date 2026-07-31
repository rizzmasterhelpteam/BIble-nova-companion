import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sessionSource = readFileSync(new URL("../api/voice/session.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(
  new URL("../supabase/migrations/20260731183441_add_voice_web_test_bypass.sql", import.meta.url),
  "utf8",
);

describe("temporary web Voice payment bypass", () => {
  it("requires both the server switch and an exact allowed browser Origin", () => {
    for (const source of [sessionSource]) {
      expect(source).toContain('process.env.VOICE_WEB_PAYMENT_BYPASS === "true"');
      expect(source).toContain("process.env.VOICE_WEB_TEST_ORIGIN");
      expect(source).toContain('req.headers?.origin || ""');
    }
  });

  it("passes the bypass only to service-role-only RPC overloads", () => {
    expect(sessionSource).toContain("allowPaymentBypass,");
    expect(migrationSource).toContain("p_allow_payment_bypass boolean");
    expect(migrationSource).toContain("grant execute on function public.acquire_voice_session_lease");
    expect(migrationSource).toContain("to service_role;");
  });
});
