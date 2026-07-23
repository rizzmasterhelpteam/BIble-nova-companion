create or replace function public.release_voice_session_lease(
  p_user_id uuid,
  p_lease_id uuid
)
returns boolean
language sql
security definer
set search_path = public, private
as $$
  update private.voice_session_leases
  set
    ended_at = coalesce(ended_at, now()),
    reserved_minutes = least(
      reserved_minutes,
      greatest(1, ceil(extract(epoch from (now() - started_at)) / 60)::integer)
    )
  where id = p_lease_id
    and user_id = p_user_id
    and ended_at is null
  returning true;
$$;

revoke all privileges on function public.release_voice_session_lease(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_voice_session_lease(uuid, uuid)
  to service_role;
