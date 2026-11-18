-- Haystack verify: the replay ledger and the retrieval registry hold no legacy rows. Read-only; a non-zero counter
-- fails the session (exit 3). The stored-document tolerance is verified separately by check-stored-documents.sh.
SET default_transaction_read_only = on;
SET statement_timeout = :'statement_timeout';
SET lock_timeout = :'lock_timeout';
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SELECT 'LR.database', current_database();
SELECT 'LR.schema_migrations', coalesce(string_agg(version, ',' ORDER BY version), '') FROM schema_migrations;
\ir_counts
SELECT 'LR.' || key, value FROM counts ORDER BY key;
\ir_counts
SELECT coalesce(sum(value), 0) = 0 AS lr_clean FROM counts WHERE must_be_zero \gset
SELECT to_regclass('pony_retrieval_profiles') IS NOT NULL AS lr_has_retrieval \gset
\if :lr_has_retrieval
-- Descriptors are parsed as the product parses them (JSON array, version tag first); text matching would miss a
-- (three-valued logic: a NULL test result, e.g. for [] or [null], counts as NOT proven v2: IS TRUE / IS NOT TRUE)
-- v1 descriptor written with other whitespace. Invalid JSON and unknown versions count as not current (fail closed).
SELECT 'LR.retrieval.profiles', count(*) FROM pony_retrieval_profiles;
SELECT 'LR.retrieval.v1_profiles', count(*) FROM pony_retrieval_profiles WHERE (CASE WHEN pg_input_is_valid(descriptor, 'jsonb') THEN jsonb_typeof(descriptor::jsonb) = 'array' AND descriptor::jsonb->>0 = 'embedding-space-v1' ELSE false END) IS TRUE;
SELECT 'LR.retrieval.invalid_descriptors', count(*) FROM pony_retrieval_profiles WHERE NOT pg_input_is_valid(descriptor, 'jsonb');
SELECT 'LR.retrieval.unrecognised_profiles', count(*) FROM pony_retrieval_profiles WHERE pg_input_is_valid(descriptor, 'jsonb') AND (CASE WHEN pg_input_is_valid(descriptor, 'jsonb') THEN jsonb_typeof(descriptor::jsonb) = 'array' AND descriptor::jsonb->>0 = 'embedding-space-v1' ELSE false END) IS NOT TRUE AND (CASE WHEN pg_input_is_valid(descriptor, 'jsonb') THEN jsonb_typeof(descriptor::jsonb) = 'array' AND descriptor::jsonb->>0 = 'embedding-space-v2' ELSE false END) IS NOT TRUE;
SELECT 'LR.retrieval.not_v2_profiles', count(*) FROM pony_retrieval_profiles WHERE (CASE WHEN pg_input_is_valid(descriptor, 'jsonb') THEN jsonb_typeof(descriptor::jsonb) = 'array' AND descriptor::jsonb->>0 = 'embedding-space-v2' ELSE false END) IS NOT TRUE;
SELECT count(*) = 0 AS lr_retrieval_clean FROM pony_retrieval_profiles WHERE (CASE WHEN pg_input_is_valid(descriptor, 'jsonb') THEN jsonb_typeof(descriptor::jsonb) = 'array' AND descriptor::jsonb->>0 = 'embedding-space-v2' ELSE false END) IS NOT TRUE \gset
\else
\echo LR.retrieval.profiles|0
\echo LR.retrieval.v1_profiles|0
\echo LR.retrieval.invalid_descriptors|0
\echo LR.retrieval.unrecognised_profiles|0
\echo LR.retrieval.not_v2_profiles|0
\set lr_retrieval_clean t
\endif
ROLLBACK;
SELECT (:'lr_clean'::boolean AND :'lr_retrieval_clean'::boolean) AS lr_all_clean \gset
\echo LR.note|stored-document tolerance is decided by check-stored-documents.sh (real codec), not by these counters
\if :lr_all_clean
\echo LR.result|verify-zero
\else
\echo LR.result|verify-nonzero
DO $$ BEGIN RAISE EXCEPTION 'legacy-retirement verify: legacy rows remain (see LR.* counters above)'; END $$;
\endif
