-- Voice now includes a 300-minute monthly allowance with no daily bucket.
-- The legacy p_daily_minutes and p_reset_offset_minutes arguments remain in
-- the RPC signatures so older deployed clients continue to resolve them.

alter table public.subscription_entitlements
  add column if not exists billing_cycle_start_at timestamptz;

update public.subscription_entitlements
set billing_cycle_start_at = coalesce(billing_cycle_start_at, verified_at, created_at, now())
where billing_cycle_start_at is null;

alter table private.voice_session_leases
  drop constraint if exists voice_session_leases_reserved_minutes_check;

alter table private.voice_session_leases
  add constraint voice_session_leases_reserved_minutes_check
  check (reserved_minutes between 1 and 30);

create or replace function private.get_voice_billing_cycle_anchor(p_user_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select test_account.created_at
      from public.premium_test_accounts as test_account
      where test_account.user_id = p_user_id
    ),
    (
      select coalesce(entitlement.billing_cycle_start_at, entitlement.verified_at, entitlement.created_at)
      from public.subscription_entitlements as entitlement
      where entitlement.user_id = p_user_id
        and (
          (entitlement.status in ('active', 'grace_period')
            and (entitlement.expiry_time is null or entitlement.expiry_time > now()))
          or (entitlement.status = 'canceled' and entitlement.expiry_time > now())
        )
      order by entitlement.verified_at desc nulls last, entitlement.created_at desc
      limit 1
    ),
    now()
  );
$$;

revoke all privileges on function private.get_voice_billing_cycle_anchor(uuid)
  from public, anon, authenticated;
grant execute on function private.get_voice_billing_cycle_anchor(uuid)
  to service_role;

-- New server path: retain verification time separately from the Google Play
-- subscription start time used as the monthly Voice-cycle anchor.
create or replace function public.link_subscription_entitlement_authoritative(
  p_user_id uuid,
  p_platform text,
  p_product_id text,
  p_base_plan_id text,
  p_order_id text,
  p_purchase_token_hash text,
  p_status text,
  p_expiry_time timestamptz,
  p_verified_at timestamptz,
  p_billing_cycle_start_at timestamptz
)
returns table (
  status text,
  product_id text,
  base_plan_id text,
  order_id text,
  expiry_time timestamptz,
  verified_at timestamptz,
  billing_cycle_start_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_user uuid;
  v_order_id text := nullif(trim(p_order_id), '');
  v_verified_at timestamptz := coalesce(p_verified_at, now());
  v_billing_cycle_start_at timestamptz := coalesce(p_billing_cycle_start_at, v_verified_at);
begin
  if p_user_id is null
    or p_platform not in ('android', 'ios')
    or coalesce(length(trim(p_product_id)), 0) = 0
    or coalesce(length(trim(p_purchase_token_hash)), 0) < 32
    or p_status not in ('active', 'grace_period', 'on_hold', 'paused', 'canceled', 'expired', 'revoked')
    or v_billing_cycle_start_at > now() + interval '5 minutes' then
    raise exception 'Invalid subscription entitlement';
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(p_purchase_token_hash, 0));
  if v_order_id is not null then
    perform pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order_id, 1));
  end if;

  select entitlement.user_id into v_existing_user
  from public.subscription_entitlements as entitlement
  where entitlement.purchase_token_hash = p_purchase_token_hash
     or (v_order_id is not null and entitlement.order_id = v_order_id)
  limit 1;

  if v_existing_user is not null and v_existing_user <> p_user_id then
    raise exception 'Purchase is already linked to another account' using errcode = '23505';
  end if;

  insert into public.subscription_entitlements as entitlement (
    user_id, platform, product_id, base_plan_id, order_id, purchase_token_hash,
    status, expiry_time, verified_at, billing_cycle_start_at, updated_at
  ) values (
    p_user_id, p_platform, trim(p_product_id), nullif(trim(p_base_plan_id), ''),
    v_order_id, p_purchase_token_hash, p_status, p_expiry_time, v_verified_at,
    v_billing_cycle_start_at, now()
  )
  on conflict (purchase_token_hash) do update set
    platform = excluded.platform,
    product_id = excluded.product_id,
    base_plan_id = excluded.base_plan_id,
    order_id = excluded.order_id,
    status = excluded.status,
    expiry_time = excluded.expiry_time,
    verified_at = excluded.verified_at,
    billing_cycle_start_at = excluded.billing_cycle_start_at,
    updated_at = now()
  where entitlement.user_id = excluded.user_id
    and entitlement.verified_at <= excluded.verified_at;

  return query
  select entitlement.status, entitlement.product_id, entitlement.base_plan_id,
    entitlement.order_id, entitlement.expiry_time, entitlement.verified_at,
    entitlement.billing_cycle_start_at
  from public.subscription_entitlements as entitlement
  where entitlement.purchase_token_hash = p_purchase_token_hash;
end;
$$;

revoke all privileges on function public.link_subscription_entitlement_authoritative(
  uuid, text, text, text, text, text, text, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.link_subscription_entitlement_authoritative(
  uuid, text, text, text, text, text, text, timestamptz, timestamptz, timestamptz
) to service_role;

create or replace function public.acquire_voice_session_lease(
  p_user_id uuid, p_max_minutes integer, p_daily_minutes integer,
  p_monthly_minutes integer, p_reset_offset_minutes integer, p_handle_hash text
)
returns table(lease_id uuid, lease_expires_at timestamptz, leased_minutes integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_monthly_used_minutes integer;
  v_reserved_minutes integer;
  v_cycle_anchor timestamptz;
  v_cycle_start timestamptz;
  v_cycle_reset_at timestamptz;
  v_cycle_months integer;
begin
  if p_user_id is null
    or p_max_minutes not between 1 and 30
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

  if exists (
    select 1 from private.voice_session_leases
    where user_id = p_user_id and ended_at is null and expires_at > now()
  ) then
    raise exception 'Voice session already active' using errcode = 'P0001';
  end if;

  v_cycle_anchor := least(private.get_voice_billing_cycle_anchor(p_user_id), now());
  v_cycle_months := greatest(
    0,
    extract(year from age(now(), v_cycle_anchor))::integer * 12
      + extract(month from age(now(), v_cycle_anchor))::integer
  );
  v_cycle_start := v_cycle_anchor + make_interval(months => v_cycle_months);
  if v_cycle_start > now() then
    v_cycle_months := greatest(0, v_cycle_months - 1);
    v_cycle_start := v_cycle_anchor + make_interval(months => v_cycle_months);
  end if;
  v_cycle_reset_at := v_cycle_anchor + make_interval(months => v_cycle_months + 1);

  select coalesce(sum(reserved_minutes), 0)::integer
  into v_monthly_used_minutes
  from private.voice_session_leases
  where user_id = p_user_id and started_at >= v_cycle_start;

  if v_monthly_used_minutes >= p_monthly_minutes then
    raise exception 'Monthly voice allowance reached' using errcode = 'P0001';
  end if;

  v_reserved_minutes := least(p_max_minutes, p_monthly_minutes - v_monthly_used_minutes);
  return query
  insert into private.voice_session_leases (user_id, expires_at, reserved_minutes, handle_hash)
  values (p_user_id, now() + make_interval(mins => v_reserved_minutes), v_reserved_minutes, p_handle_hash)
  returning id, expires_at, reserved_minutes;
end;
$$;

create or replace function public.get_voice_session_availability(
  p_user_id uuid, p_max_minutes integer, p_daily_minutes integer,
  p_monthly_minutes integer, p_reset_offset_minutes integer, p_handle_hash text
)
returns table(
  eligible boolean,
  available boolean,
  reason text,
  retry_after_seconds integer,
  can_renew boolean,
  monthly_used_minutes integer,
  monthly_remaining_minutes integer,
  monthly_limit_minutes integer,
  monthly_reset_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_active private.voice_session_leases%rowtype;
  v_monthly_used_minutes integer;
  v_cycle_anchor timestamptz;
  v_cycle_start timestamptz;
  v_cycle_reset_at timestamptz;
  v_cycle_months integer;
begin
  if p_user_id is null
    or p_max_minutes not between 1 and 30
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

  v_cycle_anchor := least(private.get_voice_billing_cycle_anchor(p_user_id), now());
  v_cycle_months := greatest(
    0,
    extract(year from age(now(), v_cycle_anchor))::integer * 12
      + extract(month from age(now(), v_cycle_anchor))::integer
  );
  v_cycle_start := v_cycle_anchor + make_interval(months => v_cycle_months);
  if v_cycle_start > now() then
    v_cycle_months := greatest(0, v_cycle_months - 1);
    v_cycle_start := v_cycle_anchor + make_interval(months => v_cycle_months);
  end if;
  v_cycle_reset_at := v_cycle_anchor + make_interval(months => v_cycle_months + 1);

  select coalesce(sum(reserved_minutes), 0)::integer
  into v_monthly_used_minutes
  from private.voice_session_leases
  where user_id = p_user_id and started_at >= v_cycle_start;

  select * into v_active
  from private.voice_session_leases
  where user_id = p_user_id and ended_at is null and expires_at > now()
  order by started_at desc
  limit 1;

  if v_active.id is not null then
    if p_handle_hash is not null
      and v_active.handle_hash = p_handle_hash
      and v_active.renewal_count < 2
      and v_active.expires_at > now() + interval '30 seconds' then
      return query select true, true, 'reservation_resume'::text,
        floor(extract(epoch from (v_active.expires_at - now())))::integer, true,
        v_monthly_used_minutes, greatest(0, p_monthly_minutes - v_monthly_used_minutes),
        p_monthly_minutes, v_cycle_reset_at;
    else
      return query select true, false, 'session_active'::text,
        greatest(1, ceil(extract(epoch from (v_active.expires_at - now())))::integer), false,
        v_monthly_used_minutes, greatest(0, p_monthly_minutes - v_monthly_used_minutes),
        p_monthly_minutes, v_cycle_reset_at;
    end if;
    return;
  end if;

  if v_monthly_used_minutes >= p_monthly_minutes then
    return query select true, false, 'monthly_limit'::text,
      ceil(extract(epoch from (v_cycle_reset_at - now())))::integer, false,
      v_monthly_used_minutes, 0, p_monthly_minutes, v_cycle_reset_at;
    return;
  end if;

  return query select true, true, 'available'::text, null::integer, false,
    v_monthly_used_minutes, greatest(0, p_monthly_minutes - v_monthly_used_minutes),
    p_monthly_minutes, v_cycle_reset_at;
end;
$$;

revoke all privileges on function public.acquire_voice_session_lease(uuid, integer, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.acquire_voice_session_lease(uuid, integer, integer, integer, integer, text)
  to service_role;
revoke all privileges on function public.get_voice_session_availability(uuid, integer, integer, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.get_voice_session_availability(uuid, integer, integer, integer, integer, text)
  to service_role;
