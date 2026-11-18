\if :lr_more_replay
\if :lr_apply
BEGIN;
\endif
-- Node-era replay identities. The current service never decodes their outcome; it only answers replay-conflict
-- for the same (principal, token, request id). Authoritative items, revisions and links are not touched.
WITH doomed AS (
  SELECT principal_user, token_id, request_id FROM write_requests WHERE digest_format = 'haystack-op-v1'
  ORDER BY principal_user, token_id, request_id LIMIT :batch_size FOR UPDATE
), gone AS (
  DELETE FROM write_requests w USING doomed d
  WHERE w.principal_user = d.principal_user AND w.token_id = d.token_id AND w.request_id = d.request_id RETURNING 1
)
SELECT count(*) AS lr_n, count(*) >= :batch_size AS lr_more_replay FROM gone \gset
\echo LR.step.node_replay_rows_deleted|:lr_n
\if :lr_apply
COMMIT;
\endif
\endif
