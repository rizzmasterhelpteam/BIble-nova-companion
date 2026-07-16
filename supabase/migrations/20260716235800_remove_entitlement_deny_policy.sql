-- The server-only entitlement table intentionally has no client policies.
-- With no client grants and RLS enabled, anon/authenticated access is denied.

drop policy if exists "No direct client access to subscription entitlements"
  on public.subscription_entitlements;
