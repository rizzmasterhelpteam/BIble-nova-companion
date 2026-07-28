alter table private.voice_token_idempotency
  add column if not exists acknowledged_at timestamptz;

create or replace function public.cleanup_expired_voice_token_idempotency()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  update private.voice_session_leases as leases
  set ended_at = coalesce(leases.ended_at, now())
  from private.voice_token_idempotency as requests
  where requests.expires_at <= now()
    and requests.lease_id = leases.id
    and requests.acknowledged_at is null
    and leases.ended_at is null;

  delete from private.voice_token_idempotency
  where expires_at <= now();
end;
$$;

revoke all privileges on function public.cleanup_expired_voice_token_idempotency()
  from public, anon, authenticated;
grant execute on function public.cleanup_expired_voice_token_idempotency()
  to service_role;
