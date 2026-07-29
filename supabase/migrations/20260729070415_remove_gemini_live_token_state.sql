-- Gemini Live token minting and recovery are no longer part of Voice Mode.
-- Keep the voice_session_leases table and its start/release RPCs because the
-- turn-based Groq + Google TTS pipeline still uses them for premium accounting.

drop function if exists public.get_voice_token_idempotency_response(uuid, text);
drop function if exists public.begin_voice_token_idempotency(uuid, text);
drop function if exists public.attach_voice_token_idempotency_lease(uuid, text, uuid);
drop function if exists public.complete_voice_token_idempotency(uuid, text, jsonb, uuid);
drop function if exists public.acknowledge_voice_token_idempotency(uuid, text);
drop function if exists public.delete_voice_token_idempotency(uuid, text);
drop function if exists public.cleanup_expired_voice_token_idempotency();

drop table if exists private.voice_token_idempotency;

drop function if exists public.claim_voice_session_renewal(uuid, text, text);
drop function if exists public.finalize_voice_session_renewal(uuid, text);
drop function if exists public.rollback_voice_session_renewal(uuid, text);
drop function if exists public.cancel_unstarted_voice_session_lease(uuid, uuid);
