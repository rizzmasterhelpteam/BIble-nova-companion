-- Make the server-only entitlement table's intentional client denial explicit.

drop policy if exists "No direct client access to subscription entitlements"
  on public.subscription_entitlements;
create policy "No direct client access to subscription entitlements"
  on public.subscription_entitlements for all to authenticated
  using (false)
  with check (false);
