-- Fragment: the legacy counters of a Haystack database as one CTE chain ending in
-- counts(key, value, must_be_zero, in_plan). The caller appends the final SELECT. Read-only, counts only.
WITH RECURSIVE cutover AS (
  SELECT min(installed_at) AS at FROM haystack_contract_cutovers WHERE contract = 'haystack.api/1.0.0'
), containers(v, depth) AS (
  SELECT document, 1 FROM item_revisions WHERE jsonb_typeof(document) IN ('object', 'array')
  UNION ALL
  SELECT c.v, w.depth + 1 FROM containers w, LATERAL (
    SELECT value AS v FROM jsonb_each(CASE WHEN jsonb_typeof(w.v) = 'object' THEN w.v ELSE '{}'::jsonb END)
    UNION ALL
    SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.v) = 'array' THEN w.v ELSE '[]'::jsonb END)) c
  WHERE jsonb_typeof(c.v) IN ('object', 'array')
), link_targets AS (
  SELECT l->>1 AS target FROM item_revisions r, jsonb_array_elements(CASE WHEN jsonb_typeof(r.document->'links') = 'array' THEN r.document->'links' ELSE '[]'::jsonb END) l
), link_parts AS (
  SELECT target, split_part(target, ':', 1) AS a, split_part(target, ':', 2) AS b FROM link_targets
), counts(key, value, must_be_zero, in_plan) AS (
  -- H1: Node-era replay ledger rows
  SELECT 'replay.node_format', (SELECT count(*) FROM write_requests WHERE digest_format = 'haystack-op-v1'), true, true
  UNION ALL SELECT 'replay.unknown_format', (SELECT count(*) FROM write_requests WHERE digest_format NOT IN ('haystack-op-v1', 'haystack-op-scala-v1')), true, true
  UNION ALL SELECT 'replay.node_format_after_cutover', (SELECT count(*) FROM write_requests w, cutover c WHERE w.digest_format = 'haystack-op-v1' AND (c.at IS NULL OR w.created_at >= c.at)), true, true
  -- H2: documents outside the envelope a current write accepts (1 MiB UTF-8, container depth 66)
  UNION ALL SELECT 'stored.items_over_1mib', (SELECT count(*) FROM items WHERE octet_length(document_text) > 1048576), true, false
  UNION ALL SELECT 'stored.revisions_over_1mib', (SELECT count(*) FROM item_revisions WHERE octet_length(document_text) > 1048576), true, false
  UNION ALL SELECT 'stored.revisions_deeper_than_66', (SELECT count(*) FROM (SELECT 1 FROM containers WHERE depth > 66 LIMIT 1) one), true, false
  -- H3: link targets a current write would refuse
  UNION ALL SELECT 'stored.links_not_array', (SELECT count(*) FROM item_revisions WHERE jsonb_typeof(document->'links') IS DISTINCT FROM 'array'), true, false
  UNION ALL SELECT 'stored.link_targets_noncanonical', (SELECT count(*) FROM link_parts
      WHERE target IS NULL OR target !~ '^([A-Za-z0-9._~-]|%[0-9A-F]{2})+:([A-Za-z0-9._~-]|%[0-9A-F]{2})+$'
         OR target ~ '%(2D|2E|3[0-9]|4[1-9A-F]|5[0-9A]|5F|6[1-9A-F]|7[0-9A]|7E)'
         OR length(regexp_replace(a, '%[0-9A-F]{2}', 'x', 'g')) > 1024 OR length(regexp_replace(b, '%[0-9A-F]{2}', 'x', 'g')) > 1024
         OR length(regexp_replace(regexp_replace(regexp_replace(a, '%[89AB][0-9A-F]', '', 'g'), '%F[0-7]', 'yy', 'g'), '%[0-9A-F]{2}', 'x', 'g')) > 256
         OR length(regexp_replace(regexp_replace(regexp_replace(b, '%[89AB][0-9A-F]', '', 'g'), '%F[0-7]', 'yy', 'g'), '%[0-9A-F]{2}', 'x', 'g')) > 256), true, false
  UNION ALL SELECT 'info.replay.current_format', (SELECT count(*) FROM write_requests WHERE digest_format = 'haystack-op-scala-v1'), false, false
  UNION ALL SELECT 'info.revisions.before_cutover', (SELECT count(*) FROM item_revisions r, cutover c WHERE r.modified_at < c.at), false, false
)
