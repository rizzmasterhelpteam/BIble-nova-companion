create or replace function private.cleanup_stale_voice_renewal_claims(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lease_id uuid;
  v_claim_count integer;
begin
  for v_lease_id, v_claim_count in
    select lease.id, count(*)::integer
    from private.voice_renewal_claims as claim
    join private.voice_session_leases as lease on lease.id = claim.lease_id
    where lease.user_id = p_user_id
      and claim.finalized_at is null
      and claim.created_at < now() - interval '2 minutes'
    group by lease.id
  loop
    delete from private.voice_renewal_claims as claim
    where claim.lease_id = v_lease_id
      and claim.finalized_at is null
      and claim.created_at < now() - interval '2 minutes';

    update private.voice_session_leases
    set renewal_count = greatest(0, renewal_count - v_claim_count)
    where id = v_lease_id;
  end loop;
end;
$$;

revoke all privileges on function private.cleanup_stale_voice_renewal_claims(uuid)
  from public, anon, authenticated;
grant execute on function private.cleanup_stale_voice_renewal_claims(uuid)
  to service_role;

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
  perform private.cleanup_stale_voice_renewal_claims(p_user_id);

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
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  perform private.cleanup_stale_voice_renewal_claims(p_user_id);

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
      and v_active.renewal_count < 2
      and v_active.expires_at > now() + interval '30 seconds' then
      return query select true, true, 'reservation_resume'::text,
        floor(extract(epoch from (v_active.expires_at - now())))::integer, true;
    else
      return query select true, false, 'session_active'::text,
        greatest(1, ceil(extract(epoch from (v_active.expires_at - now())))::integer), false;
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
  perform private.cleanup_stale_voice_renewal_claims(p_user_id);

  select * into v_lease
  from private.voice_session_leases
  where user_id = p_user_id
    and handle_hash = p_handle_hash
    and ended_at is null
    and expires_at > now() + interval '30 seconds'
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
