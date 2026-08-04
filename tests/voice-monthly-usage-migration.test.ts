import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(
  new URL(
    "../supabase/migrations/20260730080814_add_monthly_voice_usage_limit.sql",
    import.meta.url,
  ),
  "utf8",
);
const dailyCapRemovalSource = readFileSync(
  new URL(
    "../supabase/migrations/20260804180000_remove_daily_voice_cap.sql",
    import.meta.url,
  ),
  "utf8",
);
const billingCycleSource = readFileSync(
  new URL(
    "../supabase/migrations/20260804190000_increase_voice_allowance_and_anchor_billing_cycle.sql",
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

  it("removes the separate daily cap from the live six-argument RPCs", () => {
    expect(dailyCapRemovalSource).toContain("Monthly voice allowance reached");
    expect(dailyCapRemovalSource).not.toContain("v_daily_used_minutes >= p_daily_minutes");
    expect(dailyCapRemovalSource).not.toContain("'daily_limit'::text");
    expect(dailyCapRemovalSource).toContain("p_daily_minutes not between p_max_minutes and 1440");
  });

  it("uses a 300-minute billing-cycle allowance and permits 30-minute sessions", () => {
    expect(billingCycleSource).toContain("p_max_minutes not between 1 and 30");
    expect(billingCycleSource).toContain("billing_cycle_start_at timestamptz");
    expect(billingCycleSource).toContain("private.get_voice_billing_cycle_anchor(p_user_id)");
    expect(billingCycleSource).toContain("v_cycle_reset_at");
    expect(billingCycleSource).not.toContain("v_daily_used_minutes");
    expect(billingCycleSource).not.toContain("'daily_limit'::text");
  });
});
