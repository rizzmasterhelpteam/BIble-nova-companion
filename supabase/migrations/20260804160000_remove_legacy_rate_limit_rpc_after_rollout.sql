-- POST-DEPLOYMENT MIGRATION.
-- Apply this only after the server using check_rate_limits(jsonb) is deployed
-- and production requests have been verified successfully.
do $$
begin
  if pg_catalog.to_regprocedure('public.check_rate_limits(jsonb)') is null then
    raise exception 'The atomic check_rate_limits(jsonb) RPC is not installed';
  end if;
end;
$$;

drop function if exists public.check_rate_limit(text, integer, integer);

revoke all privileges on function public.check_rate_limit(text, integer, integer)
  from public, anon, authenticated;
notify pgrst, 'reload schema';
