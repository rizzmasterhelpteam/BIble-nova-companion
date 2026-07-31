alter table public.user_shadow_notes
  add column if not exists memory_enabled boolean not null default false,
  add column if not exists memory_consent_updated_at timestamptz;

comment on column public.user_shadow_notes.memory_enabled is
  'Explicit user preference controlling whether durable personalization notes may be stored or used.';

comment on column public.user_shadow_notes.memory_consent_updated_at is
  'UTC timestamp of the most recent explicit memory preference change.';
