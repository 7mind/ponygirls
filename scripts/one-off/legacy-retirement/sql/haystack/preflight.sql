-- Haystack preflight: read-only legacy counters and the plan token for apply.
SET default_transaction_read_only = on;
SET statement_timeout = :'statement_timeout';
SET lock_timeout = :'lock_timeout';
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SELECT 'LR.database', current_database();
SELECT 'LR.schema_migrations', coalesce(string_agg(version, ',' ORDER BY version), '') FROM schema_migrations;
\ir_counts
SELECT 'LR.' || key, value FROM counts ORDER BY key;
\ir_counts
SELECT 'LR.plan', string_agg(value::text, '.' ORDER BY key) FROM counts WHERE in_plan;
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
\else
\echo LR.retrieval.profiles|0
\echo LR.retrieval.v1_profiles|0
\echo LR.retrieval.invalid_descriptors|0
\echo LR.retrieval.unrecognised_profiles|0
\echo LR.retrieval.not_v2_profiles|0
\endif
SELECT 'LR.size.database_bytes', pg_database_size(current_database());
SELECT 'LR.other_client_backends', count(*) FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend';
ROLLBACK;
\echo LR.note|stored-document tolerance is decided by check-stored-documents.sh (real codec), not by these counters
\echo LR.result|preflight-complete
