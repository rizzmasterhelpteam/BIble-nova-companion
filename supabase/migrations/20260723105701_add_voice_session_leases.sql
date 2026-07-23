create table if not exists private.voice_session_leases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  reserved_minutes integer not null check (reserved_minutes between 1 and 15)
);

create index if not exists voice_session_leases_user_active_idx
  on private.voice_session_leases (user_id, expires_at)
  where ended_at is null;

create index if not exists voice_session_leases_daily_idx
  on private.voice_session_leases (user_id, started_at);

revoke all privileges on table private.voice_session_leases
  from public, anon, authenticated;
grant select, insert, update on table private.voice_session_leases to service_role;

create or replace function public.acquire_voice_session_lease(
  p_user_id uuid,
  p_max_minutes integer,
  p_daily_minutes integer
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lease_id uuid;
  v_used_minutes integer;
begin
  if p_user_id is null
    or p_max_minutes not between 1 and 15
    or p_daily_minutes not between p_max_minutes and 240 then
    raise exception 'Invalid voice session lease request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if not exists (
    select 1
    from public.subscription_entitlements
    where user_id = p_user_id
      and status in ('active', 'grace_period')
      and (expiry_time is null or expiry_time > now())
  ) then
    raise exception 'Active premium subscription required' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from private.voice_session_leases
    where user_id = p_user_id
      and ended_at is null
      and expires_at > now()
  ) then
    raise exception 'Voice session already active' using errcode = 'P0001';
  end if;

  select coalesce(sum(reserved_minutes), 0)::integer
  into v_used_minutes
  from private.voice_session_leases
  where user_id = p_user_id
    and started_at >= date_trunc('day', now());

  if v_used_minutes + p_max_minutes > p_daily_minutes then
    raise exception 'Daily voice allowance reached' using errcode = 'P0001';
  end if;

  insert into private.voice_session_leases (user_id, expires_at, reserved_minutes)
  values (p_user_id, now() + make_interval(mins => p_max_minutes), p_max_minutes)
  returning id into v_lease_id;

  return v_lease_id;
end;
$$;

create or replace function public.release_voice_session_lease(
  p_user_id uuid,
  p_lease_id uuid
)
returns boolean
language sql
security definer
set search_path = public, private
as $$
  update private.voice_session_leases
  set ended_at = coalesce(ended_at, now())
  where id = p_lease_id
    and user_id = p_user_id
    and ended_at is null
  returning true;
$$;

revoke all privileges on function public.acquire_voice_session_lease(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.acquire_voice_session_lease(uuid, integer, integer)
  to service_role;

revoke all privileges on function public.release_voice_session_lease(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_voice_session_lease(uuid, uuid)
  to service_role;
