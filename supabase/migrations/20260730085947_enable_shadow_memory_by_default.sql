-- Memory is on by default. Existing users who explicitly turned it off retain
-- that choice because their consent timestamp is present.
alter table public.user_shadow_notes
  alter column memory_enabled set default true;

update public.user_shadow_notes
set memory_enabled = true,
    updated_at = timezone('utc', now())
where memory_enabled = false
  and memory_consent_updated_at is null;

comment on column public.user_shadow_notes.memory_enabled is
  'Whether durable personalization notes may be stored or used. Enabled by default; an explicit user opt-out is retained.';
