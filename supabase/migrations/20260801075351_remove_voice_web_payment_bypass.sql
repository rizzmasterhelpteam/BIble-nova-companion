-- Remove the temporary service-role-only bypass overloads. The remaining
-- lease and availability functions always require a premium entitlement.
drop function if exists public.acquire_voice_session_lease(
  uuid, integer, integer, integer, integer, text, boolean
);

drop function if exists public.get_voice_session_availability(
  uuid, integer, integer, integer, integer, text, boolean
);
