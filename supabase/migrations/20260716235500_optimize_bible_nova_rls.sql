-- Keep auth helpers in RLS initialization plans so they are evaluated once per statement.

drop policy if exists "Permanent users manage own profile" on public.profiles;
drop policy if exists "Permanent users manage own onboarding" on public.onboarding_answers;
drop policy if exists "Permanent users manage own intentions" on public.intentions;
drop policy if exists "Permanent users manage own chat sessions" on public.chat_sessions;
drop policy if exists "Permanent users manage own chat messages" on public.chat_messages;
drop policy if exists "Permanent users insert own app events" on public.app_events;
drop policy if exists "Permanent users read own api logs" on public.api_usage_logs;
drop policy if exists "Permanent users read own security events" on public.security_events;
drop policy if exists "Permanent users read own subscription" on public.subscriptions;

create policy "Permanent users manage own profile"
  on public.profiles for all to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  )
  with check (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );

create policy "Permanent users manage own onboarding"
  on public.onboarding_answers for all to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  )
  with check (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );

create policy "Permanent users manage own intentions"
  on public.intentions for all to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  )
  with check (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );

create policy "Permanent users manage own chat sessions"
  on public.chat_sessions for all to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  )
  with check (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );

create policy "Permanent users manage own chat messages"
  on public.chat_messages for all to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
    and exists (
      select 1
      from public.chat_sessions as sessions
      where sessions.id = chat_messages.session_id
        and sessions.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
    and exists (
      select 1
      from public.chat_sessions as sessions
      where sessions.id = chat_messages.session_id
        and sessions.user_id = (select auth.uid())
    )
  );

create policy "Permanent users insert own app events"
  on public.app_events for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );

create policy "Permanent users read own api logs"
  on public.api_usage_logs for select to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );

create policy "Permanent users read own security events"
  on public.security_events for select to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );

create policy "Permanent users read own subscription"
  on public.subscriptions for select to authenticated
  using (
    (select auth.uid()) = user_id
    and coalesce((((select auth.jwt()) ->> 'is_anonymous')::boolean), false) = false
  );
