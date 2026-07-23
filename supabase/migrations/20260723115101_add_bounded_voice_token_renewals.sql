alter table private.voice_session_leases
  add column if not exists handle_hash text,
  add column if not exists renewal_count integer not null default 0
    check (renewal_count between 0 and 2);

create unique index if not exists voice_session_leases_handle_hash_idx
  on private.voice_session_leases (handle_hash)
  where handle_hash is not null;

drop function if exists public.acquire_voice_session_lease(uuid, integer, integer, integer);

create or replace function public.acquire_voice_session_lease(
  p_user_id uuid,
  p_max_minutes integer,
  p_daily_minutes integer,
  p_reset_offset_minutes integer,
  p_handle_hash text
)
returns table(lease_id uuid, lease_expires_at timestamptz)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_used_minutes integer;
  v_day_start timestamptz;
begin
  if p_user_id is null
    or p_max_minutes not between 1 and 15
    or p_daily_minutes not between p_max_minutes and 240
    or p_reset_offset_minutes not between -720 and 840
    or coalesce(length(p_handle_hash), 0) <> 64 then
    raise exception 'Invalid voice session lease request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if not exists (
    select 1 from public.subscription_entitlements
    where user_id = p_user_id
      and status in ('active', 'grace_period')
      and (expiry_time is null or expiry_time > now())
  ) then
    raise exception 'Active premium subscription required' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from private.voice_session_leases
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

  return query
  insert into private.voice_session_leases (
    user_id, expires_at, reserved_minutes, handle_hash
  )
  values (
    p_user_id, now() + make_interval(mins => p_max_minutes), p_max_minutes, p_handle_hash
  )
  returning id, expires_at;
end;
$$;

create or replace function public.get_voice_session_availability(
  p_user_id uuid,
  p_max_minutes integer,
  p_daily_minutes integer,
  p_reset_offset_minutes integer,
  p_handle_hash text
)
returns table(
  eligible boolean,
  available boolean,
  reason text,
  retry_after_seconds integer,
  can_renew boolean
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_active private.voice_session_leases%rowtype;
  v_used_minutes integer;
  v_day_start timestamptz;
begin
  if not exists (
    select 1 from public.subscription_entitlements
    where user_id = p_user_id
      and status in ('active', 'grace_period')
      and (expiry_time is null or expiry_time > now())
  ) then
    return query select false, false, 'subscription_required'::text, null::integer, false;
    return;
  end if;

  select * into v_active
  from private.voice_session_leases
  where user_id = p_user_id
    and ended_at is null
    and expires_at > now()
  order by started_at desc
  limit 1;

  if v_active.id is not null then
    if p_handle_hash is not null
      and v_active.handle_hash = p_handle_hash
      and v_active.renewal_count < 2 then
      return query select true, true, 'reservation_resume'::text,
        ceil(extract(epoch from (v_active.expires_at - now())))::integer, true;
    else
      return query select true, false, 'session_active'::text,
        ceil(extract(epoch from (v_active.expires_at - now())))::integer, false;
    end if;
    return;
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
    return query select true, false, 'daily_limit'::text,
      ceil(extract(epoch from (
        v_day_start + interval '1 day' - now()
      )))::integer, false;
    return;
  end if;

  return query select true, true, 'available'::text, null::integer, false;
end;
$$;

create or replace function public.renew_voice_session_lease(
  p_user_id uuid,
  p_handle_hash text
)
returns table(lease_id uuid, lease_expires_at timestamptz)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  return query
  update private.voice_session_leases
  set renewal_count = renewal_count + 1
  where user_id = p_user_id
    and handle_hash = p_handle_hash
    and ended_at is null
    and expires_at > now()
    and renewal_count < 2
  returning id, expires_at;

  if not found then
    raise exception 'Reservation unavailable or renewal limit reached' using errcode = 'P0001';
  end if;
end;
$$;

revoke all privileges on function public.acquire_voice_session_lease(
  uuid, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.acquire_voice_session_lease(
  uuid, integer, integer, integer, text
) to service_role;

revoke all privileges on function public.get_voice_session_availability(
  uuid, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.get_voice_session_availability(
  uuid, integer, integer, integer, text
) to service_role;

revoke all privileges on function public.renew_voice_session_lease(uuid, text)
  from public, anon, authenticated;
grant execute on function public.renew_voice_session_lease(uuid, text)
  to service_role;
