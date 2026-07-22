create table if not exists public.user_shadow_notes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notes text not null default '',
  updated_at timestamptz not null default timezone('utc', now()),
  constraint user_shadow_notes_notes_length check (char_length(notes) <= 2000)
);

alter table public.user_shadow_notes enable row level security;

drop policy if exists "Permanent users manage own shadow notes" on public.user_shadow_notes;

create policy "Permanent users manage own shadow notes"
  on public.user_shadow_notes
  for all
  to authenticated
  using (
    (select auth.uid()) = user_id
  )
  with check (
    (select auth.uid()) = user_id
  );
