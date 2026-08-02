-- Privacy default: absence of an explicit preference is not consent.
alter table public.user_shadow_notes
  alter column memory_enabled set default false;

alter table public.user_shadow_notes
  add column if not exists memory_consent_version integer;

-- Rows without a consent timestamp were enabled by an older default and are
-- not evidence of an explicit opt-in. Clear their notes and fail closed.
update public.user_shadow_notes
set memory_enabled = false,
    notes = '',
    updated_at = timezone('utc', now())
where memory_consent_updated_at is null;

update public.user_shadow_notes
set memory_consent_version = 1
where memory_consent_updated_at is not null
  and memory_consent_version is null;

comment on column public.user_shadow_notes.memory_enabled is
  'Explicit durable-memory consent. Missing rows and new rows default to disabled.';
comment on column public.user_shadow_notes.memory_consent_version is
  'Privacy policy version accepted when the memory preference was explicitly changed.';
