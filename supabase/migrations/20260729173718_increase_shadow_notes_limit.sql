alter table public.user_shadow_notes
  drop constraint if exists user_shadow_notes_notes_length;

alter table public.user_shadow_notes
  add constraint user_shadow_notes_notes_length
  check (char_length(notes) <= 4000);

comment on constraint user_shadow_notes_notes_length on public.user_shadow_notes is
  'Keeps structured durable user memory compact while allowing up to 4,000 characters.';
