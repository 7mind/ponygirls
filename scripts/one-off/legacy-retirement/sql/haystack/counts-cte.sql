-- Fragment: the legacy counters of a Haystack database as one CTE chain ending in
-- counts(key, value, must_be_zero, in_plan). The caller appends the final SELECT. Read-only, counts only.
-- Only the replay ledger is decided here. Whether a stored document still needs the wide stored-read tolerance is
-- NOT decided by SQL: that is the codec check (check-stored-documents.sh), which runs the real decoder.
WITH cutover AS (
  SELECT min(installed_at) AS at FROM haystack_contract_cutovers WHERE contract = 'haystack.api/1.0.0'
), counts(key, value, must_be_zero, in_plan) AS (
  SELECT 'replay.node_format', (SELECT count(*) FROM write_requests WHERE digest_format = 'haystack-op-v1'), true, true
  UNION ALL SELECT 'replay.unknown_format', (SELECT count(*) FROM write_requests WHERE digest_format NOT IN ('haystack-op-v1', 'haystack-op-scala-v1')), true, true
  UNION ALL SELECT 'replay.node_format_after_cutover', (SELECT count(*) FROM write_requests w, cutover c WHERE w.digest_format = 'haystack-op-v1' AND (c.at IS NULL OR w.created_at >= c.at)), true, true
  UNION ALL SELECT 'info.replay.current_format', (SELECT count(*) FROM write_requests WHERE digest_format = 'haystack-op-scala-v1'), false, false
  UNION ALL SELECT 'info.items', (SELECT count(*) FROM items), false, false
  UNION ALL SELECT 'info.item_revisions', (SELECT count(*) FROM item_revisions), false, false
  UNION ALL SELECT 'info.revisions.before_cutover', (SELECT count(*) FROM item_revisions r, cutover c WHERE r.modified_at < c.at), false, false
)
