-- Bible Nova production hardening for the existing public schema.
-- This migration does not delete application rows or change the rizzmaster.online project.

create schema if not exists private;

create table if not exists private.rate_limit_buckets (
  key text primary key,
  window_started_at timestamptz not null,
  count integer not null check (count >= 0),
  expires_at timestamptz not null
);

create index if not exists rate_limit_buckets_expires_at_idx
  on private.rate_limit_buckets (expires_at);

revoke all privileges on table private.rate_limit_buckets from public, anon, authenticated;

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

revoke all privileges on function public.check_rate_limit(text, integer, integer)
  from public, anon, authenticated;
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

create index if not exists subscription_entitlements_user_id_idx
  on public.subscription_entitlements (user_id);

alter table public.subscription_entitlements enable row level security;
revoke all privileges on table public.subscription_entitlements from public, anon, authenticated;

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
  v_linked_user uuid;
begin
  if p_user_id is null
    or p_platform is null
    or p_platform not in ('android', 'ios')
    or coalesce(length(trim(p_product_id)), 0) = 0
    or coalesce(length(trim(p_purchase_token_hash)), 0) < 32
    or p_status is null
    or p_status not in ('active', 'grace_period', 'expired', 'revoked') then
    raise exception 'Invalid subscription entitlement';
  end if;

  insert into public.subscription_entitlements as entitlement (
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
    updated_at = now()
  where entitlement.user_id = excluded.user_id
  returning entitlement.user_id into v_linked_user;

  if v_linked_user is null then
    raise exception 'Purchase token is already linked to another account' using errcode = '23505';
  end if;

  return true;
end;
$$;

revoke all privileges on function public.link_subscription_entitlement(
  uuid, text, text, text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.link_subscription_entitlement(
  uuid, text, text, text, text, text, text, timestamptz, timestamptz
) to service_role;

alter function public.set_updated_at() set search_path = public;

create index if not exists chat_messages_user_id_idx
  on public.chat_messages (user_id);

-- Remove the existing broad/public policies before recreating explicit owner policies.
drop policy if exists "Users read own api logs" on public.api_usage_logs;
drop policy if exists "Users insert own app events" on public.app_events;
drop policy if exists "Users manage own chat messages" on public.chat_messages;
drop policy if exists "Users manage own chat sessions" on public.chat_sessions;
drop policy if exists "Users manage own intentions" on public.intentions;
drop policy if exists "Users manage own onboarding" on public.onboarding_answers;
drop policy if exists "Users manage own profile" on public.profiles;
drop policy if exists "Users read own security events" on public.security_events;
drop policy if exists "Users read own subscription" on public.subscriptions;

alter table public.profiles enable row level security;
alter table public.onboarding_answers enable row level security;
alter table public.intentions enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.app_events enable row level security;
alter table public.api_usage_logs enable row level security;
alter table public.security_events enable row level security;
alter table public.subscriptions enable row level security;

revoke all privileges on table public.profiles, public.onboarding_answers, public.intentions,
  public.chat_sessions, public.chat_messages, public.app_events, public.api_usage_logs,
  public.security_events, public.subscriptions
  from public, anon, authenticated;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.onboarding_answers to authenticated;
grant select, insert, update, delete on table public.intentions to authenticated;
grant select, insert, update, delete on table public.chat_sessions to authenticated;
grant select, insert, update, delete on table public.chat_messages to authenticated;
grant insert on table public.app_events to authenticated;
grant select on table public.api_usage_logs to authenticated;
grant select on table public.security_events to authenticated;
grant select on table public.subscriptions to authenticated;

create policy "Permanent users manage own profile"
  on public.profiles for all to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  )
  with check (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );

create policy "Permanent users manage own onboarding"
  on public.onboarding_answers for all to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  )
  with check (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );

create policy "Permanent users manage own intentions"
  on public.intentions for all to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  )
  with check (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );

create policy "Permanent users manage own chat sessions"
  on public.chat_sessions for all to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  )
  with check (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );

create policy "Permanent users manage own chat messages"
  on public.chat_messages for all to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
    and exists (
      select 1
      from public.chat_sessions as sessions
      where sessions.id = chat_messages.session_id
        and sessions.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
    and exists (
      select 1
      from public.chat_sessions as sessions
      where sessions.id = chat_messages.session_id
        and sessions.user_id = (select auth.uid())
    )
  );

create policy "Permanent users insert own app events"
  on public.app_events for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );

create policy "Permanent users read own api logs"
  on public.api_usage_logs for select to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );

create policy "Permanent users read own security events"
  on public.security_events for select to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );

create policy "Permanent users read own subscription"
  on public.subscriptions for select to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );
