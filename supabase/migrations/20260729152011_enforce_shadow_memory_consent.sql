alter table public.user_shadow_notes
  add constraint user_shadow_notes_memory_consent_check
  check (memory_enabled or notes = '')
  not valid;

comment on constraint user_shadow_notes_memory_consent_check on public.user_shadow_notes is
  'Enforces consent for all new or updated notes while preserving pre-consent legacy rows until users explicitly choose a memory preference.';
