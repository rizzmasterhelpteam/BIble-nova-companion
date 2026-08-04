-- Process all request rate-limit buckets atomically.
-- The application uses this one-call API so user and IP buckets cannot
-- diverge. The old single-bucket RPC is removed at the end of this migration.
create or replace function private.cleanup_expired_rate_limit_buckets(p_max_rows integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from private.rate_limit_buckets
  where key in (
    select key
    from private.rate_limit_buckets
    where expires_at <= pg_catalog.clock_timestamp()
    order by expires_at
    limit greatest(1, least(coalesce(p_max_rows, 500), 5000))
    for update skip locked
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.check_rate_limits(
  p_rules jsonb
)
returns table(
  allowed boolean,
  retry_after_seconds integer,
  diagnostics jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule record;
  v_bucket private.rate_limit_buckets%rowtype;
  v_key text;
  v_limit integer;
  v_window_seconds integer;
  v_duplicate_key text;
  v_keys text[] := array[]::text[];
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_allowed boolean := true;
  v_retry_after_seconds integer := 0;
  v_rule_allowed boolean;
  v_rule_retry_after integer;
  v_diagnostics jsonb := '[]'::jsonb;
begin
  if pg_catalog.jsonb_typeof(p_rules) <> 'array'
    or pg_catalog.jsonb_array_length(p_rules) < 1
    or pg_catalog.jsonb_array_length(p_rules) > 8 then
    raise exception 'Invalid rate-limit rules';
  end if;

  -- Validate the entire request before touching a bucket.
  for v_rule in
    select value, ordinality
    from pg_catalog.jsonb_array_elements(p_rules) with ordinality
  loop
    if pg_catalog.jsonb_typeof(v_rule.value) <> 'object'
      or pg_catalog.jsonb_typeof(v_rule.value -> 'key') <> 'string'
      or pg_catalog.jsonb_typeof(v_rule.value -> 'limit') <> 'number'
      or pg_catalog.jsonb_typeof(v_rule.value -> 'window_seconds') <> 'number' then
      raise exception 'Invalid rate-limit rule';
    end if;

    v_key := pg_catalog.btrim(v_rule.value ->> 'key');
    if pg_catalog.length(v_key) < 1 or pg_catalog.length(v_key) > 512 then
      raise exception 'Invalid rate-limit key';
    end if;

    if (v_rule.value ->> 'limit') !~ '^[0-9]+$'
      or (v_rule.value ->> 'window_seconds') !~ '^[0-9]+$' then
      raise exception 'Invalid rate-limit rule values';
    end if;

    v_limit := (v_rule.value ->> 'limit')::integer;
    v_window_seconds := (v_rule.value ->> 'window_seconds')::integer;
    if v_limit < 1 or v_limit > 1000000
      or v_window_seconds < 1 or v_window_seconds > 86400 then
      raise exception 'Invalid rate-limit rule values';
    end if;

    v_keys := pg_catalog.array_append(v_keys, v_key);
  end loop;

  select duplicate_key
  into v_duplicate_key
  from (
    select key as duplicate_key
    from pg_catalog.unnest(v_keys) as keys(key)
    group by key
    having pg_catalog.count(*) > 1
    limit 1
  ) duplicates;

  if v_duplicate_key is not null then
    raise exception 'Duplicate rate-limit key';
  end if;

  -- Acquire all bucket locks in a deterministic order to avoid deadlocks.
  for v_key in
    select key
    from pg_catalog.unnest(v_keys) as keys(key)
    order by key
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_key, 0)
    );
  end loop;

  -- Opportunistically remove disposable buckets without adding a second
  -- network round trip to the request path.
  perform private.cleanup_expired_rate_limit_buckets(100);

  for v_rule in
    select value, ordinality
    from pg_catalog.jsonb_array_elements(p_rules) with ordinality
  loop
    v_key := pg_catalog.btrim(v_rule.value ->> 'key');
    v_limit := (v_rule.value ->> 'limit')::integer;
    v_window_seconds := (v_rule.value ->> 'window_seconds')::integer;

    insert into private.rate_limit_buckets (
      key,
      window_started_at,
      count,
      expires_at
    )
    values (
      v_key,
      v_now,
      1,
      v_now + pg_catalog.make_interval(secs => v_window_seconds)
    )
    on conflict (key) do update
    set window_started_at = case
          when private.rate_limit_buckets.expires_at <= v_now then v_now
          else private.rate_limit_buckets.window_started_at
        end,
        count = case
          when private.rate_limit_buckets.expires_at <= v_now then 1
          else private.rate_limit_buckets.count + 1
        end,
        expires_at = case
          when private.rate_limit_buckets.expires_at <= v_now
            then v_now + pg_catalog.make_interval(secs => v_window_seconds)
          else private.rate_limit_buckets.expires_at
        end
    returning * into v_bucket;

    v_rule_allowed := v_bucket.count <= v_limit;
    v_rule_retry_after := case
      when v_rule_allowed then 0
      else greatest(
        1,
        pg_catalog.ceil(
          pg_catalog.extract(epoch from (v_bucket.expires_at - v_now))
        )::integer
      )
    end;
    v_allowed := v_allowed and v_rule_allowed;
    v_retry_after_seconds := greatest(v_retry_after_seconds, v_rule_retry_after);
    v_diagnostics := v_diagnostics || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'rule_index', v_rule.ordinality,
        'allowed', v_rule_allowed,
        'retry_after_seconds', v_rule_retry_after
      )
    );
  end loop;

  return query select v_allowed, v_retry_after_seconds, v_diagnostics;
end;
$$;

drop function if exists public.check_rate_limit(text, integer, integer);

revoke all privileges on function public.check_rate_limits(jsonb)
  from public, anon, authenticated;
grant execute on function public.check_rate_limits(jsonb) to service_role;
