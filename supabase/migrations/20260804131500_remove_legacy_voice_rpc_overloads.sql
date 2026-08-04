-- The six-argument Voice RPCs are now the only supported application contract.
-- This migration is intentionally staged after the server stops using legacy
-- signatures, so old overloads cannot hide production schema drift.
drop function if exists public.acquire_voice_session_lease(uuid, integer, integer, integer);
drop function if exists public.acquire_voice_session_lease(uuid, integer, integer, integer, text);
drop function if exists public.get_voice_session_availability(uuid, integer, integer, integer, text);

revoke all privileges on function public.acquire_voice_session_lease(
  uuid, integer, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.acquire_voice_session_lease(
  uuid, integer, integer, integer, integer, text
) to service_role;

revoke all privileges on function public.get_voice_session_availability(
  uuid, integer, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.get_voice_session_availability(
  uuid, integer, integer, integer, integer, text
) to service_role;

notify pgrst, 'reload schema';
