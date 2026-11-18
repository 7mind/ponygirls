-- Chronicle verify: every legacy counter of the selected items must be zero. Read-only; a non-zero counter fails
-- the session (exit 3). With --skip-formats the retired-format counters are reported but do not decide the result.
SET default_transaction_read_only = on;
SET statement_timeout = :'statement_timeout';
SET lock_timeout = :'lock_timeout';
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SELECT 'LR.database', current_database();
SELECT 'LR.schema_migrations', coalesce(string_agg(version::text, ',' ORDER BY version), '') FROM ch_schema_migrations;
\ir_counts
SELECT 'LR.' || key, value FROM counts ORDER BY key;
\ir_counts
SELECT coalesce(sum(value) FILTER (WHERE item = 'identity'), 0) = 0 AS lr_identity_clean,
       coalesce(sum(value) FILTER (WHERE item = 'formats'), 0) = 0 AS lr_formats_clean FROM counts WHERE must_be_zero \gset
-- The predicates shared with the retained post-deployment check (single definition: block shared:chronicle).
\ir_shared chronicle chronicle
-- Product-level shape: published generations per stored format and per embedding-space version.
SELECT 'LR.published_by_format', coalesce(g.passage_format, '<null>'), e.descriptor->>0, count(*)
FROM ch_sources s JOIN ch_generations g ON g.id = s.published
LEFT JOIN ch_index_profiles p ON p.profile = g.profile LEFT JOIN ch_embedding_spaces e ON e.id = p.embedding_space
GROUP BY 2, 3 ORDER BY 2, 3;
ROLLBACK;
\echo LR.item.identity.clean|:lr_identity_clean
\echo LR.item.formats.clean|:lr_formats_clean
SELECT (:'lr_identity_clean'::boolean AND :'lp_identity_clean'::boolean
        AND ((:'lr_formats_clean'::boolean AND :'lp_formats_clean'::boolean) OR :'skip_formats'::boolean)) AS lr_clean \gset
\if :lr_skip_formats
\echo LR.formats|skipped
\endif
\if :lr_clean
\echo LR.result|verify-zero
\else
\echo LR.result|verify-nonzero
DO $$ BEGIN RAISE EXCEPTION 'legacy-retirement verify: legacy rows remain (see LR.* counters above)'; END $$;
\endif
