drop policy if exists "Permanent users manage own shadow notes" on public.user_shadow_notes;

create policy "Permanent users manage own shadow notes"
  on public.user_shadow_notes
  for all
  to authenticated
  using (
    (select auth.uid()) = user_id
    and (((select auth.jwt())->>'is_anonymous')::boolean) is false
  )
  with check (
    (select auth.uid()) = user_id
    and (((select auth.jwt())->>'is_anonymous')::boolean) is false
  );
