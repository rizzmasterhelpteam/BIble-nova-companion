import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(
  new URL(
    "../supabase/migrations/20260730080814_add_monthly_voice_usage_limit.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("monthly Voice usage migration", () => {
  it("enforces monthly reservations in both acquisition and availability RPCs", () => {
    expect(migrationSource).toContain("p_monthly_minutes integer");
    expect(migrationSource).toContain(
      "drop function if exists public.acquire_voice_session_lease(uuid, integer, integer, integer);",
    );
    expect(migrationSource).toContain("Monthly voice allowance reached");
    expect(migrationSource).toContain("'monthly_limit'::text");
    expect(migrationSource).toContain("monthly_remaining_minutes integer");
    expect(migrationSource).toContain("v_reserved_minutes := least(");
    expect(migrationSource).toContain("leased_minutes integer");
  });

  it("keeps the private lease RPCs service-role only", () => {
    expect(migrationSource).toContain("from public, anon, authenticated;");
    expect(migrationSource).toContain(") to service_role;");
    expect(migrationSource).not.toContain(") to authenticated;");
  });
});
