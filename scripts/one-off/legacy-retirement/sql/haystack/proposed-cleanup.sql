-- PROPOSAL, not applied by run.sh: migration 0007 of the legacy-free Haystack binary (plan section 6.6).
-- Precondition: `run.sh haystack verify` is zero.
BEGIN;
ALTER TABLE write_requests ALTER COLUMN digest_format DROP DEFAULT;
ALTER TABLE write_requests ADD CONSTRAINT write_requests_current_digest_format_check CHECK (digest_format = 'haystack-op-scala-v1');
INSERT INTO haystack_contract_cutovers(contract, policy)
VALUES ('haystack.replay/node-retired', 'Node-era replay rows deleted by the one-off retirement; one digest format; no authoritative history rewrite');
INSERT INTO schema_migrations(version) VALUES ('0007-node-replay-retired');
COMMIT;
