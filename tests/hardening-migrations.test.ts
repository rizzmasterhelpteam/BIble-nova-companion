import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const readMigration = (name: string) =>
  readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

describe("production hardening migrations", () => {
  it("uses one transactional rate-limit RPC and removes the split-call RPC", () => {
    const migration = readMigration("20260804130000_add_atomic_rate_limits.sql");
    expect(migration).toContain("create or replace function public.check_rate_limits");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("drop function if exists public.check_rate_limit");
    expect(migration).toContain("grant execute on function public.check_rate_limits(jsonb) to service_role");
  });

  it("removes every deployed legacy Voice overload", () => {
    const migration = readMigration("20260804131500_remove_legacy_voice_rpc_overloads.sql");
    expect(migration).toContain("acquire_voice_session_lease(uuid, integer, integer, integer)");
    expect(migration).toContain("acquire_voice_session_lease(uuid, integer, integer, integer, text)");
    expect(migration).toContain("get_voice_session_availability(uuid, integer, integer, integer, text)");
    expect(migration).toContain("acquire_voice_session_lease(\n  uuid, integer, integer, integer, integer, text");
  });

  it("deletes the temporary shadow-memory backup and keeps private tables closed", () => {
    const migration = readMigration("20260804133000_remove_shadow_memory_rollback_backup.sql");
    expect(migration).toContain("drop table if exists private.user_shadow_notes_backup_20260803");
    expect(migration).toContain("revoke all privileges on table private.rate_limit_buckets");
    expect(migration).toContain("revoke all privileges on table private.voice_session_leases");
  });
});
