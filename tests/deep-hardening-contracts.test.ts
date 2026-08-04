import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("deep production hardening contracts", () => {
  it("keeps server Supabase configuration separate from Vite client configuration", () => {
    const source = read("server-security.ts");
    expect(source).not.toContain("process.env.VITE_SUPABASE_URL");
    expect(source).not.toContain("process.env.VITE_SUPABASE_ANON_KEY");
    expect(source).toContain("process.env.RATE_LIMIT_IP_SALT");
  });

  it("keeps provider readiness private and subscriptions split by operation", () => {
    expect(read("api/status.ts")).toContain("res.status(200).json({ ok: true })");
    expect(read("api/status/ready.ts")).toContain("requireAuthenticatedRequest");
    expect(read("api/subscription/native-sync.ts")).toContain('"POST, OPTIONS"');
    expect(read("api/subscription/status.ts")).toContain("getSubscriptionAccessStatus");
  });

  it("does not auto-schedule reminders from the app shell", () => {
    const layout = read("src/components/Layout.tsx");
    expect(layout).toContain("handleDailyReminderToggle");
    expect(layout).toContain("storageGetJson<boolean>");
    expect(layout).toContain("Notifications are blocked");
    expect(layout).not.toContain("ensureAutomaticDailyReminder");
  });

  it("keeps deletion and canonical Voice schema changes forward-only", () => {
    const accountMigration = read("supabase/migrations/20260804150000_account_cleanup_and_private_retention.sql");
    const voiceMigration = read("supabase/migrations/20260804150100_repair_canonical_voice_rpcs.sql");
    expect(accountMigration).toContain("public.delete_account_data");
    expect(accountMigration).toContain("drop table if exists private.user_shadow_notes_backup_20260803");
    expect(voiceMigration).toContain("p_handle_hash text");
    expect(voiceMigration).toContain("status = 'canceled'");
    expect(voiceMigration).toContain("not between 1 and 15");
  });

  it("runs a generated-bundle secret scan in production verification", () => {
    const packageJson = read("package.json");
    expect(packageJson).toContain('"verify:client-bundle"');
    expect(packageJson).toContain("npm run build && npm run verify:client-bundle");
    expect(read("scripts/verify-client-bundle.mjs")).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
