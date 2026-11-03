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

-- Shared pony_retrieval_* projection/outbox tables are initialized by the
-- shared retrieval library; put(c,projection) joins the authoritative write.
