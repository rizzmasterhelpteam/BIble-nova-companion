-- Remove the separate daily Voice allowance.
-- The monthly allowance remains authoritative; the legacy daily argument is
-- retained in the RPC signature for deployed-client compatibility only.
create or replace function public.acquire_voice_session_lease(
  p_user_id uuid, p_max_minutes integer, p_daily_minutes integer,
  p_monthly_minutes integer, p_reset_offset_minutes integer, p_handle_hash text
)
returns table(lease_id uuid, lease_expires_at timestamptz, leased_minutes integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_monthly_used_minutes integer;
  v_reserved_minutes integer; v_month_start timestamptz;
begin
  if p_user_id is null or p_max_minutes not between 1 and 15
    or p_daily_minutes not between p_max_minutes and 1440
    or p_monthly_minutes not between p_daily_minutes and 1440
    or p_reset_offset_minutes not between -720 and 840
    or coalesce(length(p_handle_hash), 0) <> 64 then
    raise exception 'Invalid voice session lease request';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  perform private.cleanup_expired_voice_session_leases(100);
  if not exists (
    select 1 from public.premium_test_accounts where user_id = p_user_id
  ) and not exists (
    select 1 from public.subscription_entitlements
    where user_id = p_user_id and (
      (status in ('active', 'grace_period') and expiry_time > now())
      or (status = 'canceled' and expiry_time > now())
    )
  ) then
    raise exception 'Active premium subscription required' using errcode = 'P0001';
  end if;
  if exists (select 1 from private.voice_session_leases where user_id = p_user_id and ended_at is null and expires_at > now()) then
    raise exception 'Voice session already active' using errcode = 'P0001';
  end if;
  v_month_start := date_trunc('month', now() + make_interval(mins => p_reset_offset_minutes)) - make_interval(mins => p_reset_offset_minutes);
  select coalesce(sum(reserved_minutes), 0)::integer into v_monthly_used_minutes
    from private.voice_session_leases where user_id = p_user_id and started_at >= v_month_start;
  if v_monthly_used_minutes >= p_monthly_minutes then
    raise exception 'Monthly voice allowance reached' using errcode = 'P0001';
  end if;
  v_reserved_minutes := least(p_max_minutes, p_monthly_minutes - v_monthly_used_minutes);
  return query insert into private.voice_session_leases (user_id, expires_at, reserved_minutes, handle_hash)
    values (p_user_id, now() + make_interval(mins => v_reserved_minutes), v_reserved_minutes, p_handle_hash)
    returning id, expires_at, reserved_minutes;
end;
$$;

create or replace function public.get_voice_session_availability(
  p_user_id uuid, p_max_minutes integer, p_daily_minutes integer,
  p_monthly_minutes integer, p_reset_offset_minutes integer, p_handle_hash text
)
returns table(eligible boolean, available boolean, reason text, retry_after_seconds integer,
  can_renew boolean, monthly_used_minutes integer, monthly_remaining_minutes integer,
  monthly_limit_minutes integer, monthly_reset_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_active private.voice_session_leases%rowtype; v_monthly_used_minutes integer;
  v_month_start timestamptz;
begin
  if p_user_id is null or p_max_minutes not between 1 and 15
    or p_daily_minutes not between p_max_minutes and 1440
    or p_monthly_minutes not between p_daily_minutes and 1440
    or p_reset_offset_minutes not between -720 and 840
    or (p_handle_hash is not null and length(p_handle_hash) <> 64) then
    raise exception 'Invalid voice session availability request';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  perform private.cleanup_expired_voice_session_leases(100);
  if not exists (
    select 1 from public.premium_test_accounts where user_id = p_user_id
  ) and not exists (
    select 1 from public.subscription_entitlements
    where user_id = p_user_id and (
      (status in ('active', 'grace_period') and expiry_time > now())
      or (status = 'canceled' and expiry_time > now())
    )
  ) then
    return query select false, false, 'subscription_required'::text, null::integer, false,
      null::integer, null::integer, null::integer, null::timestamptz;
    return;
  end if;
  v_month_start := date_trunc('month', now() + make_interval(mins => p_reset_offset_minutes)) - make_interval(mins => p_reset_offset_minutes);
  select coalesce(sum(reserved_minutes), 0)::integer into v_monthly_used_minutes
    from private.voice_session_leases where user_id = p_user_id and started_at >= v_month_start;
  select * into v_active from private.voice_session_leases
    where user_id = p_user_id and ended_at is null and expires_at > now()
    order by started_at desc limit 1;
  if v_active.id is not null then
    if p_handle_hash is not null and v_active.handle_hash = p_handle_hash and v_active.renewal_count < 2 and v_active.expires_at > now() + interval '30 seconds' then
      return query select true, true, 'reservation_resume'::text, floor(extract(epoch from (v_active.expires_at - now())))::integer, true, v_monthly_used_minutes, greatest(0, p_monthly_minutes - v_monthly_used_minutes), p_monthly_minutes, v_month_start + interval '1 month';
    else
      return query select true, false, 'session_active'::text, greatest(1, ceil(extract(epoch from (v_active.expires_at - now())))::integer), false, v_monthly_used_minutes, greatest(0, p_monthly_minutes - v_monthly_used_minutes), p_monthly_minutes, v_month_start + interval '1 month';
    end if;
    return;
  end if;
  if v_monthly_used_minutes >= p_monthly_minutes then
    return query select true, false, 'monthly_limit'::text, ceil(extract(epoch from (v_month_start + interval '1 month' - now())))::integer, false, v_monthly_used_minutes, 0, p_monthly_minutes, v_month_start + interval '1 month';
    return;
  end if;
  return query select true, true, 'available'::text, null::integer, false, v_monthly_used_minutes,
    greatest(0, p_monthly_minutes - v_monthly_used_minutes), p_monthly_minutes, v_month_start + interval '1 month';
end;
$$;

revoke all privileges on function public.acquire_voice_session_lease(uuid, integer, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.acquire_voice_session_lease(uuid, integer, integer, integer, integer, text) to service_role;
revoke all privileges on function public.get_voice_session_availability(uuid, integer, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.get_voice_session_availability(uuid, integer, integer, integer, integer, text) to service_role;
