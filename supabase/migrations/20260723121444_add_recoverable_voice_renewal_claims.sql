create table if not exists private.voice_renewal_claims (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references private.voice_session_leases(id) on delete cascade,
  claim_hash text not null unique,
  finalized_at timestamptz,
  created_at timestamptz not null default now()
);

revoke all privileges on table private.voice_renewal_claims
  from public, anon, authenticated;
grant select, insert, update, delete on table private.voice_renewal_claims
  to service_role;

drop function if exists public.renew_voice_session_lease(uuid, text);

create or replace function public.claim_voice_session_renewal(
  p_user_id uuid,
  p_handle_hash text,
  p_claim_hash text
)
returns table(lease_id uuid, lease_expires_at timestamptz)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lease private.voice_session_leases%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_lease
  from private.voice_session_leases
  where user_id = p_user_id
    and handle_hash = p_handle_hash
    and ended_at is null
    and expires_at > now()
    and renewal_count < 2
  for update;

  if v_lease.id is null or coalesce(length(p_claim_hash), 0) <> 64 then
    raise exception 'Reservation unavailable or renewal limit reached' using errcode = 'P0001';
  end if;

  update private.voice_session_leases
  set renewal_count = renewal_count + 1
  where id = v_lease.id;

  insert into private.voice_renewal_claims (lease_id, claim_hash)
  values (v_lease.id, p_claim_hash);

  return query select v_lease.id, v_lease.expires_at;
end;
$$;

create or replace function public.finalize_voice_session_renewal(
  p_user_id uuid,
  p_claim_hash text
)
returns boolean
language sql
security definer
set search_path = public, private
as $$
  update private.voice_renewal_claims as claim
  set finalized_at = coalesce(finalized_at, now())
  from private.voice_session_leases as lease
  where claim.lease_id = lease.id
    and lease.user_id = p_user_id
    and claim.claim_hash = p_claim_hash
  returning true;
$$;

create or replace function public.rollback_voice_session_renewal(
  p_user_id uuid,
  p_claim_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lease_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  delete from private.voice_renewal_claims as claim
  using private.voice_session_leases as lease
  where claim.lease_id = lease.id
    and lease.user_id = p_user_id
    and claim.claim_hash = p_claim_hash
    and claim.finalized_at is null
  returning claim.lease_id into v_lease_id;

  if v_lease_id is null then
    return false;
  end if;

  update private.voice_session_leases
  set renewal_count = greatest(0, renewal_count - 1)
  where id = v_lease_id;

  return true;
end;
$$;

revoke all privileges on function public.claim_voice_session_renewal(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_voice_session_renewal(uuid, text, text)
  to service_role;

revoke all privileges on function public.finalize_voice_session_renewal(uuid, text)
  from public, anon, authenticated;
grant execute on function public.finalize_voice_session_renewal(uuid, text)
  to service_role;

revoke all privileges on function public.rollback_voice_session_renewal(uuid, text)
  from public, anon, authenticated;
grant execute on function public.rollback_voice_session_renewal(uuid, text)
  to service_role;

-- Keep the previous production function compatible during the Git/Vercel
-- deployment transition. It remains service-role-only and is not used by
-- the new server code.
create or replace function public.acquire_voice_session_lease(
  p_user_id uuid,
  p_max_minutes integer,
  p_daily_minutes integer,
  p_reset_offset_minutes integer
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lease_id uuid;
begin
  select lease_id into v_lease_id
  from public.acquire_voice_session_lease(
    p_user_id,
    p_max_minutes,
    p_daily_minutes,
    p_reset_offset_minutes,
    md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text)
  );
  return v_lease_id;
end;
$$;

revoke all privileges on function public.acquire_voice_session_lease(
  uuid, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.acquire_voice_session_lease(
  uuid, integer, integer, integer
) to service_role;
