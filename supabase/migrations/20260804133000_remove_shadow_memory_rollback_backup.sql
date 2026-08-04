-- The explicit-consent migration's rollback window has elapsed. Remove the
-- private snapshot so old shadow notes are not retained indefinitely.
drop table if exists private.user_shadow_notes_backup_20260803;

-- Keep all implementation tables inaccessible to client roles. The API uses
-- the service role and SECURITY DEFINER functions for the narrow operations it
-- needs, so no client grant is required here.
revoke all privileges on table private.rate_limit_buckets from public, anon, authenticated;
revoke all privileges on table private.voice_session_leases from public, anon, authenticated;
revoke all privileges on table public.user_shadow_notes from anon;
