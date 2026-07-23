drop function if exists public.release_voice_session_lease(uuid, uuid);
drop function if exists public.acquire_voice_session_lease(uuid, integer, integer);

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
  v_used_minutes integer;
  v_day_start timestamptz;
begin
  if p_user_id is null
    or p_max_minutes not between 1 and 15
    or p_daily_minutes not between p_max_minutes and 240
    or p_reset_offset_minutes not between -720 and 840 then
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

  v_day_start := date_trunc(
    'day',
    now() + make_interval(mins => p_reset_offset_minutes)
  ) - make_interval(mins => p_reset_offset_minutes);

  select coalesce(sum(reserved_minutes), 0)::integer
  into v_used_minutes
  from private.voice_session_leases
  where user_id = p_user_id
    and started_at >= v_day_start;

  if v_used_minutes + p_max_minutes > p_daily_minutes then
    raise exception 'Daily voice allowance reached' using errcode = 'P0001';
  end if;

  insert into private.voice_session_leases (user_id, expires_at, reserved_minutes)
  values (p_user_id, now() + make_interval(mins => p_max_minutes), p_max_minutes)
  returning id into v_lease_id;

  return v_lease_id;
end;
$$;

create or replace function public.cancel_unstarted_voice_session_lease(
  p_user_id uuid,
  p_lease_id uuid
)
returns boolean
language sql
security definer
set search_path = public, private
as $$
  delete from private.voice_session_leases
  where id = p_lease_id
    and user_id = p_user_id
    and started_at > now() - interval '2 minutes'
  returning true;
$$;

revoke all privileges on function public.acquire_voice_session_lease(uuid, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.acquire_voice_session_lease(uuid, integer, integer, integer)
  to service_role;

revoke all privileges on function public.cancel_unstarted_voice_session_lease(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_unstarted_voice_session_lease(uuid, uuid)
  to service_role;
