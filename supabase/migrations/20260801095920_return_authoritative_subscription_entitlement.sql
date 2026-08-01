create or replace function public.link_subscription_entitlement_authoritative(
  p_user_id uuid,
  p_platform text,
  p_product_id text,
  p_base_plan_id text,
  p_order_id text,
  p_purchase_token_hash text,
  p_status text,
  p_expiry_time timestamptz,
  p_verified_at timestamptz
)
returns table (
  status text,
  product_id text,
  base_plan_id text,
  order_id text,
  expiry_time timestamptz,
  verified_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_user uuid;
  v_order_id text := nullif(trim(p_order_id), '');
  v_verified_at timestamptz := coalesce(p_verified_at, now());
begin
  if p_user_id is null
    or p_platform not in ('android', 'ios')
    or coalesce(length(trim(p_product_id)), 0) = 0
    or coalesce(length(trim(p_purchase_token_hash)), 0) < 32
    or p_status not in ('active', 'grace_period', 'on_hold', 'paused', 'canceled', 'expired', 'revoked') then
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
    status, expiry_time, verified_at, updated_at
  ) values (
    p_user_id, p_platform, trim(p_product_id), nullif(trim(p_base_plan_id), ''),
    v_order_id, p_purchase_token_hash, p_status, p_expiry_time, v_verified_at, now()
  )
  on conflict (purchase_token_hash) do update set
    platform = excluded.platform,
    product_id = excluded.product_id,
    base_plan_id = excluded.base_plan_id,
    order_id = excluded.order_id,
    status = excluded.status,
    expiry_time = excluded.expiry_time,
    verified_at = excluded.verified_at,
    updated_at = now()
  where entitlement.user_id = excluded.user_id
    and entitlement.verified_at <= excluded.verified_at;

  return query
  select entitlement.status, entitlement.product_id, entitlement.base_plan_id,
    entitlement.order_id, entitlement.expiry_time, entitlement.verified_at
  from public.subscription_entitlements as entitlement
  where entitlement.purchase_token_hash = p_purchase_token_hash;
end;
$$;

revoke all privileges on function public.link_subscription_entitlement_authoritative(
  uuid, text, text, text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.link_subscription_entitlement_authoritative(
  uuid, text, text, text, text, text, text, timestamptz, timestamptz
) to service_role;
