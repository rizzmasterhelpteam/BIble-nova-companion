create schema if not exists private;

create table if not exists private.rate_limit_buckets (
  key text primary key,
  window_started_at timestamptz not null,
  count integer not null check (count >= 0),
  expires_at timestamptz not null
);

create index if not exists rate_limit_buckets_expires_at_idx
  on private.rate_limit_buckets (expires_at);

revoke all on table private.rate_limit_buckets from public, anon, authenticated;

create or replace function public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = private, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket private.rate_limit_buckets%rowtype;
begin
  if coalesce(length(trim(p_key)), 0) = 0 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate-limit arguments';
  end if;

  insert into private.rate_limit_buckets (key, window_started_at, count, expires_at)
  values (p_key, v_now, 1, v_now + make_interval(secs => p_window_seconds))
  on conflict (key) do update
  set window_started_at = case
        when private.rate_limit_buckets.expires_at <= v_now then v_now
        else private.rate_limit_buckets.window_started_at
      end,
      count = case
        when private.rate_limit_buckets.expires_at <= v_now then 1
        else private.rate_limit_buckets.count + 1
      end,
      expires_at = case
        when private.rate_limit_buckets.expires_at <= v_now
          then v_now + make_interval(secs => p_window_seconds)
        else private.rate_limit_buckets.expires_at
      end
  returning * into v_bucket;

  return query
  select
    v_bucket.count <= p_limit,
    case
      when v_bucket.count <= p_limit then 0
      else greatest(1, ceil(extract(epoch from (v_bucket.expires_at - v_now)))::integer)
    end;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

create table if not exists public.subscription_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  product_id text not null,
  base_plan_id text,
  order_id text,
  purchase_token_hash text not null,
  status text not null check (status in ('active', 'grace_period', 'expired', 'revoked')),
  expiry_time timestamptz,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (purchase_token_hash)
);

alter table public.subscription_entitlements enable row level security;
revoke all on table public.subscription_entitlements from public, anon, authenticated;

create or replace function public.link_subscription_entitlement(
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
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_user uuid;
begin
  if p_user_id is null or p_platform not in ('android', 'ios') or coalesce(length(trim(p_purchase_token_hash)), 0) < 32 then
    raise exception 'Invalid subscription entitlement';
  end if;

  select user_id into v_existing_user
  from public.subscription_entitlements
  where purchase_token_hash = p_purchase_token_hash;

  if v_existing_user is not null and v_existing_user <> p_user_id then
    raise exception 'Purchase token is already linked to another account' using errcode = '23505';
  end if;

  insert into public.subscription_entitlements (
    user_id, platform, product_id, base_plan_id, order_id, purchase_token_hash,
    status, expiry_time, verified_at, updated_at
  ) values (
    p_user_id, p_platform, p_product_id, nullif(p_base_plan_id, ''), nullif(p_order_id, ''),
    p_purchase_token_hash, p_status, p_expiry_time, coalesce(p_verified_at, now()), now()
  )
  on conflict (purchase_token_hash) do update set
    platform = excluded.platform,
    product_id = excluded.product_id,
    base_plan_id = excluded.base_plan_id,
    order_id = excluded.order_id,
    status = excluded.status,
    expiry_time = excluded.expiry_time,
    verified_at = excluded.verified_at,
    updated_at = now();

  return true;
end;
$$;

revoke all on function public.link_subscription_entitlement(uuid, text, text, text, text, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.link_subscription_entitlement(uuid, text, text, text, text, text, text, timestamptz, timestamptz)
  to service_role;

create table if not exists public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  promo_code text not null,
  redeemed_at timestamptz not null default now(),
  unique (user_id, promo_code)
);

alter table public.promo_redemptions enable row level security;
revoke all on table public.promo_redemptions from public, anon, authenticated;
