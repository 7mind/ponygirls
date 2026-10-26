CREATE TABLE IF NOT EXISTS ch_collector_progress (
  owner text NOT NULL REFERENCES ch_users(id),
  collector_id text NOT NULL,
  sequence bigint NOT NULL CHECK(sequence>0),
  report jsonb NOT NULL,
  received_at timestamptz NOT NULL,
  PRIMARY KEY(owner,collector_id)
);
