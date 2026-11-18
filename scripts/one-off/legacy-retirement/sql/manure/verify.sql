-- Shared retrieval registry (Manure, and any database with pony_retrieval_* tables): read-only count of profiles
-- registered with a v1 embedding-space descriptor (guards PostgresRetrieval.migrateModelIdentities and the v1
-- branch of EmbeddingSpace.verified).
SET default_transaction_read_only = on;
SET statement_timeout = :'statement_timeout';
SET lock_timeout = :'lock_timeout';
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SELECT 'LR.database', current_database();
SELECT to_regclass('pony_retrieval_profiles') IS NOT NULL AS lr_has_retrieval \gset
\if :lr_has_retrieval
-- Descriptors are parsed as the product parses them (JSON array, version tag first); text matching would miss a
-- v1 descriptor written with other whitespace. Invalid JSON and unknown versions count as not current (fail closed).
SELECT 'LR.retrieval.profiles', count(*) FROM pony_retrieval_profiles;
SELECT 'LR.retrieval.v1_profiles', count(*) FROM pony_retrieval_profiles WHERE CASE WHEN pg_input_is_valid(descriptor, 'jsonb') THEN jsonb_typeof(descriptor::jsonb) = 'array' AND descriptor::jsonb->>0 = 'embedding-space-v1' ELSE false END;
SELECT 'LR.retrieval.invalid_descriptors', count(*) FROM pony_retrieval_profiles WHERE NOT pg_input_is_valid(descriptor, 'jsonb');
SELECT 'LR.retrieval.unrecognised_profiles', count(*) FROM pony_retrieval_profiles WHERE pg_input_is_valid(descriptor, 'jsonb') AND NOT (CASE WHEN pg_input_is_valid(descriptor, 'jsonb') THEN jsonb_typeof(descriptor::jsonb) = 'array' AND descriptor::jsonb->>0 = 'embedding-space-v1' ELSE false END) AND NOT (CASE WHEN pg_input_is_valid(descriptor, 'jsonb') THEN jsonb_typeof(descriptor::jsonb) = 'array' AND descriptor::jsonb->>0 = 'embedding-space-v2' ELSE false END);
SELECT 'LR.retrieval.not_v2_profiles', count(*) FROM pony_retrieval_profiles WHERE NOT (CASE WHEN pg_input_is_valid(descriptor, 'jsonb') THEN jsonb_typeof(descriptor::jsonb) = 'array' AND descriptor::jsonb->>0 = 'embedding-space-v2' ELSE false END);
SELECT count(*) = 0 AS lr_clean FROM pony_retrieval_profiles WHERE NOT (CASE WHEN pg_input_is_valid(descriptor, 'jsonb') THEN jsonb_typeof(descriptor::jsonb) = 'array' AND descriptor::jsonb->>0 = 'embedding-space-v2' ELSE false END) \gset
\else
\echo LR.retrieval.profiles|0
\echo LR.retrieval.v1_profiles|0
\echo LR.retrieval.invalid_descriptors|0
\echo LR.retrieval.unrecognised_profiles|0
\echo LR.retrieval.not_v2_profiles|0
\set lr_clean t
\endif
ROLLBACK;
\if :lr_clean
\echo LR.result|verify-zero
\else
\echo LR.result|verify-nonzero
DO $$ BEGIN RAISE EXCEPTION 'legacy-retirement verify: retrieval profiles with a non-v2 descriptor remain'; END $$;
\endif
