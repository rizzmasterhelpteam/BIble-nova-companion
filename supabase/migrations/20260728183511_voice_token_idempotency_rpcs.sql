-- The idempotency table intentionally remains in the private schema. These
-- service-role-only RPCs let Vercel use it without exposing that schema through
-- PostgREST to browser clients.

create or replace function public.get_voice_token_idempotency_response(
  p_user_id uuid,
  p_request_id text
)
returns table (
  response jsonb,
  expires_at timestamptz,
  acknowledged_at timestamptz
)
language sql
security definer
set search_path = public, private
as $$
  select request.response, request.expires_at, request.acknowledged_at
  from private.voice_token_idempotency as request
  where request.user_id = p_user_id
    and request.request_id = p_request_id
  limit 1;
$$;

create or replace function public.begin_voice_token_idempotency(
  p_user_id uuid,
  p_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  inserted_count integer;
begin
  perform public.cleanup_expired_voice_token_idempotency();

  insert into private.voice_token_idempotency (user_id, request_id)
  values (p_user_id, p_request_id)
  on conflict (user_id, request_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

create or replace function public.attach_voice_token_idempotency_lease(
  p_user_id uuid,
  p_request_id text,
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  updated_count integer;
begin
  update private.voice_token_idempotency
  set lease_id = p_lease_id
  where user_id = p_user_id
    and request_id = p_request_id;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.complete_voice_token_idempotency(
  p_user_id uuid,
  p_request_id text,
  p_response jsonb,
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  updated_count integer;
begin
  update private.voice_token_idempotency
  set response = p_response,
      lease_id = p_lease_id
  where user_id = p_user_id
    and request_id = p_request_id;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.acknowledge_voice_token_idempotency(
  p_user_id uuid,
  p_request_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  updated_count integer;
begin
  update private.voice_token_idempotency
  set acknowledged_at = now()
  where user_id = p_user_id
    and request_id = p_request_id
    and response is not null;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.delete_voice_token_idempotency(
  p_user_id uuid,
  p_request_id text
)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  delete from private.voice_token_idempotency
  where user_id = p_user_id
    and request_id = p_request_id
    and response is null;
end;
$$;

revoke all privileges on function public.get_voice_token_idempotency_response(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_voice_token_idempotency_response(uuid, text)
  to service_role;

revoke all privileges on function public.begin_voice_token_idempotency(uuid, text)
  from public, anon, authenticated;
grant execute on function public.begin_voice_token_idempotency(uuid, text)
  to service_role;

revoke all privileges on function public.attach_voice_token_idempotency_lease(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.attach_voice_token_idempotency_lease(uuid, text, uuid)
  to service_role;

revoke all privileges on function public.complete_voice_token_idempotency(uuid, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_voice_token_idempotency(uuid, text, jsonb, uuid)
  to service_role;

revoke all privileges on function public.acknowledge_voice_token_idempotency(uuid, text)
  from public, anon, authenticated;
grant execute on function public.acknowledge_voice_token_idempotency(uuid, text)
  to service_role;

revoke all privileges on function public.delete_voice_token_idempotency(uuid, text)
  from public, anon, authenticated;
grant execute on function public.delete_voice_token_idempotency(uuid, text)
  to service_role;
