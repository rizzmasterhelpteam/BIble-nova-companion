-- Repair private Voice support tables that may be missing on older projects
-- even though deployed RPCs already reference them.
create table if not exists private.voice_token_idempotency (
  user_id uuid not null,
  request_id text not null check (char_length(request_id) between 16 and 128),
  response jsonb,
  lease_id uuid references private.voice_session_leases(id) on delete set null,
  expires_at timestamptz not null default now() + interval '2 minutes',
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

create index if not exists voice_token_idempotency_expires_at_idx
  on private.voice_token_idempotency (expires_at);

create table if not exists private.voice_renewal_claims (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references private.voice_session_leases(id) on delete cascade,
  claim_hash text not null unique,
  finalized_at timestamptz,
  created_at timestamptz not null default now()
);

revoke all privileges on table private.voice_token_idempotency, private.voice_renewal_claims
  from public, anon, authenticated;
grant select, insert, update, delete on table private.voice_token_idempotency, private.voice_renewal_claims
  to service_role;

create or replace function public.cleanup_expired_voice_token_idempotency()
returns void
language plpgsql security definer set search_path = public, private as $$
begin
  update private.voice_session_leases as leases
  set ended_at = coalesce(leases.ended_at, now())
  from private.voice_token_idempotency as requests
  where requests.expires_at <= now()
    and requests.lease_id = leases.id
    and requests.response is null
    and leases.ended_at is null;
  delete from private.voice_token_idempotency where expires_at <= now();
end;
$$;

create or replace function public.release_voice_session_lease(
  p_user_id uuid, p_handle_hash text
)
returns boolean
language sql security definer set search_path = public, private as $$
  update private.voice_session_leases
  set ended_at = coalesce(ended_at, now())
  where user_id = p_user_id
    and handle_hash = p_handle_hash
    and ended_at is null
    and expires_at > now()
  returning true;
$$;

-- Keep account deletion and private-table retention in the database boundary.
-- The service role calls the deletion function before removing auth.users so
-- non-cascaded data cannot survive an account deletion.
create or replace function public.delete_account_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'A user id is required';
  end if;

  delete from public.chat_messages where user_id = p_user_id;
  delete from public.chat_sessions where user_id = p_user_id;
  delete from public.intentions where user_id = p_user_id;
  delete from public.onboarding_answers where user_id = p_user_id;
  delete from public.profiles where user_id = p_user_id;
  delete from public.user_shadow_notes where user_id = p_user_id;
  delete from public.app_events where user_id = p_user_id;
  delete from public.api_usage_logs where user_id = p_user_id;
  delete from public.security_events where user_id = p_user_id;
  delete from public.subscriptions where user_id = p_user_id;
  delete from public.subscription_entitlements where user_id = p_user_id;
  delete from public.promo_redemptions where user_id = p_user_id;

  delete from private.voice_token_idempotency where user_id = p_user_id;
  delete from private.voice_renewal_claims where user_id = p_user_id;
  delete from private.voice_session_leases where user_id = p_user_id;
  delete from private.rate_limit_buckets
    where key like '%:user:' || p_user_id::text
       or key like '%:account:' || p_user_id::text
       or key like '%:subscription:' || p_user_id::text
       or key like '%:voice:' || p_user_id::text
       or key like '%:memory:' || p_user_id::text;
end;
$$;

revoke all privileges on function public.delete_account_data(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_account_data(uuid) to service_role;

-- Private tables are used only by SECURITY DEFINER functions/service_role.
-- RLS makes accidental client exposure fail closed even if a grant changes.
alter table private.rate_limit_buckets enable row level security;
alter table private.voice_session_leases enable row level security;
alter table private.voice_token_idempotency enable row level security;
alter table private.voice_renewal_claims enable row level security;

drop table if exists private.user_shadow_notes_backup_20260803;

-- Rate-limit buckets are disposable state. Voice usage rows are retained for
-- two full calendar months so current-month calculations remain authoritative.
delete from private.rate_limit_buckets where expires_at <= now();
delete from private.voice_session_leases
where ended_at is not null
  and expires_at < now() - interval '62 days';

create index if not exists voice_session_leases_retention_idx
  on private.voice_session_leases (expires_at, ended_at);

create or replace function private.cleanup_expired_rate_limit_buckets(p_max_rows integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from private.rate_limit_buckets
  where key in (
    select key
    from private.rate_limit_buckets
    where expires_at <= pg_catalog.clock_timestamp()
    order by expires_at
    limit greatest(1, least(coalesce(p_max_rows, 500), 5000))
    for update skip locked
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function private.cleanup_expired_voice_session_leases(p_max_rows integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from private.voice_session_leases
  where id in (
    select id
    from private.voice_session_leases
    where ended_at is not null
      and expires_at < pg_catalog.clock_timestamp() - interval '62 days'
    order by expires_at
    limit greatest(1, least(coalesce(p_max_rows, 500), 5000))
    for update skip locked
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all privileges on function private.cleanup_expired_rate_limit_buckets(integer)
  from public, anon, authenticated;
revoke all privileges on function private.cleanup_expired_voice_session_leases(integer)
  from public, anon, authenticated;
