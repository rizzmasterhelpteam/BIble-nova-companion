create index if not exists voice_token_idempotency_lease_id_idx
  on private.voice_token_idempotency (lease_id)
  where lease_id is not null;
