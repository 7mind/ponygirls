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
SELECT 'LR.retrieval.profiles', count(*) FROM pony_retrieval_profiles;
SELECT 'LR.retrieval.v1_profiles', count(*) FROM pony_retrieval_profiles WHERE descriptor LIKE '["embedding-space-v1"%';
SELECT 'LR.retrieval.unrecognised_profiles', count(*) FROM pony_retrieval_profiles WHERE descriptor NOT LIKE '["embedding-space-v1"%' AND descriptor NOT LIKE '["embedding-space-v2"%';
SELECT count(*) = 0 AS lr_clean FROM pony_retrieval_profiles WHERE descriptor NOT LIKE '["embedding-space-v2"%' \gset
\else
\echo LR.retrieval.profiles|0
\echo LR.retrieval.v1_profiles|0
\echo LR.retrieval.unrecognised_profiles|0
\set lr_clean t
\endif
ROLLBACK;
\echo LR.result|preflight-complete
