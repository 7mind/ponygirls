-- Chronicle verify: every legacy counter must be zero. Read-only; a non-zero counter fails the session (exit 3).
SET default_transaction_read_only = on;
SET statement_timeout = :'statement_timeout';
SET lock_timeout = :'lock_timeout';
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SELECT 'LR.database', current_database();
SELECT 'LR.schema_migrations', coalesce(string_agg(version::text, ',' ORDER BY version), '') FROM ch_schema_migrations;
\ir_counts
SELECT 'LR.' || key, value FROM counts ORDER BY key;
\ir_counts
SELECT coalesce(sum(value), 0) AS lr_nonzero, coalesce(sum(value), 0) = 0 AS lr_clean FROM counts WHERE must_be_zero \gset
-- Product-level shape: published generations per stored format and per embedding-space version.
SELECT 'LR.published_by_format', coalesce(g.passage_format, '<null>'), e.descriptor->>0, count(*)
FROM ch_sources s JOIN ch_generations g ON g.id = s.published
LEFT JOIN ch_index_profiles p ON p.profile = g.profile LEFT JOIN ch_embedding_spaces e ON e.id = p.embedding_space
GROUP BY 2, 3 ORDER BY 2, 3;
ROLLBACK;
\if :lr_clean
\echo LR.result|verify-zero
\else
\echo LR.result|verify-nonzero
DO $$ BEGIN RAISE EXCEPTION 'legacy-retirement verify: legacy rows remain (see LR.* counters above)'; END $$;
\endif
