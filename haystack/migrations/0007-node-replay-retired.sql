-- Node-era replay rows were deleted by the one-off legacy data retirement; one
-- digest format remains. No column default may stamp the retired Node format on
-- an insert that omits it. Adding the constraint validates every existing row:
-- a remaining other format fails this migration, and with it startup.
-- Authoritative documents, revisions and current replay records are not rewritten.
ALTER TABLE write_requests ALTER COLUMN digest_format DROP DEFAULT;
ALTER TABLE write_requests ADD CONSTRAINT write_requests_current_digest_format_check
  CHECK (digest_format = 'haystack-op-scala-v1');
INSERT INTO haystack_contract_cutovers(contract, policy)
VALUES ('haystack.replay/node-retired', 'Node-era replay rows deleted by the one-off retirement; one digest format; no authoritative history rewrite');
