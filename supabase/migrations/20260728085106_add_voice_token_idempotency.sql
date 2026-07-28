create table if not exists private.voice_token_idempotency (
  user_id uuid not null,
  request_id text not null check (char_length(request_id) between 16 and 128),
  response jsonb,
  lease_id uuid references private.voice_session_leases(id) on delete set null,
  expires_at timestamptz not null default now() + interval '2 minutes',
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

create index if not exists voice_token_idempotency_expires_at_idx
  on private.voice_token_idempotency (expires_at);

revoke all privileges on table private.voice_token_idempotency from public, anon, authenticated;
grant select, insert, update, delete on table private.voice_token_idempotency to service_role;

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
    and requests.response is null
    and leases.ended_at is null;

  delete from private.voice_token_idempotency
  where expires_at <= now();
end;
$$;

revoke all privileges on function public.cleanup_expired_voice_token_idempotency()
  from public, anon, authenticated;
grant execute on function public.cleanup_expired_voice_token_idempotency()
  to service_role;

create or replace function public.release_voice_session_lease(
  p_user_id uuid,
  p_handle_hash text
)
returns boolean
language sql
security definer
set search_path = public, private
as $$
  update private.voice_session_leases
  set ended_at = coalesce(ended_at, now())
  where user_id = p_user_id
    and handle_hash = p_handle_hash
    and ended_at is null
    and expires_at > now()
  returning true;
$$;

revoke all privileges on function public.release_voice_session_lease(uuid, text)
  from public, anon, authenticated;
grant execute on function public.release_voice_session_lease(uuid, text)
  to service_role;
