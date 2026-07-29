-- A fresh Voice reflection may intentionally supersede a recoverable lease.
-- Charge only the elapsed minutes when that lease is released, while retaining
-- user ownership checks and service-role-only access.
create or replace function public.release_voice_session_lease(
  p_user_id uuid,
  p_handle_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_released boolean;
begin
  if p_user_id is null or coalesce(length(p_handle_hash), 0) <> 64 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  update private.voice_session_leases
  set
    ended_at = coalesce(ended_at, now()),
    reserved_minutes = least(
      reserved_minutes,
      greatest(
        1,
        ceil(extract(epoch from (now() - started_at)) / 60)::integer
      )
    )
  where user_id = p_user_id
    and handle_hash = p_handle_hash
    and ended_at is null
    and expires_at > now()
  returning true into v_released;

  return coalesce(v_released, false);
end;
$$;

revoke all privileges on function public.release_voice_session_lease(uuid, text)
  from public, anon, authenticated;
grant execute on function public.release_voice_session_lease(uuid, text)
  to service_role;
