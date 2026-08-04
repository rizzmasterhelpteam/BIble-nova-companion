import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const securitySource = readFileSync(new URL("../server-security.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(
  new URL("../supabase/migrations/20260804170000_add_private_premium_test_account.sql", import.meta.url),
  "utf8",
);
const statusSource = readFileSync(new URL("../api/status.ts", import.meta.url), "utf8");

describe("production premium test access", () => {
  it("uses a service-role-only account table instead of a fake Play purchase", () => {
    expect(securitySource).toContain('from("premium_test_accounts")');
    expect(securitySource).toContain("isPremiumTestAccount");
    expect(migrationSource).toContain("enable row level security");
    expect(migrationSource).toContain("revoke all privileges on table public.premium_test_accounts");
    expect(migrationSource).not.toContain("test1212@gmail.com");
  });

  it("keeps normal Voice session and allowance limits for test accounts", () => {
    expect(migrationSource).toContain("p_max_minutes not between 1 and 15");
    expect(migrationSource).toContain("p_daily_minutes not between p_max_minutes and 240");
    expect(migrationSource).toContain("p_monthly_minutes not between p_daily_minutes and 1440");
  });

  it("does not replace permanent test access with an expiring Play entitlement", () => {
    const serverSource = readFileSync(new URL("../server-api.ts", import.meta.url), "utf8");
    expect(serverSource).toContain('source: "server_test_allowlist"');
    expect(serverSource).toContain('productId: "developer_test"');
  });

  it("keeps legacy native-sync GET clients on the authenticated entitlement path", () => {
    expect(statusSource).toContain("if (req.method === \"GET\")");
    expect(statusSource).toContain("subscription:");
    expect(statusSource).toContain("accessActive: status.active");
  });
});
