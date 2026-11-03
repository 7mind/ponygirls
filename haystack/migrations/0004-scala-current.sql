-- Coordinated current-contract cutover. Keep every historical replay row and
-- acknowledged revision. Old digest formats are retired, never reinterpreted:
-- retrying an old identity returns replay-conflict and requires reconciliation
-- against its recorded outcome/history (not a fresh-ID automatic retry).
CREATE TABLE haystack_contract_cutovers (
  contract TEXT PRIMARY KEY,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  policy TEXT NOT NULL
);
INSERT INTO haystack_contract_cutovers(contract, policy)
VALUES ('haystack.api/1.0.0', 'retain historical replay rows; refuse cross-format identities; no authoritative history rewrite');

-- Durable generation work originates in the same transaction as authoritative
-- writes. No network/model call is part of an item transaction.
CREATE TABLE item_index_jobs (
  project_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  projection_policy TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','complete','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(project_id, item_id, revision, projection_policy)
);
