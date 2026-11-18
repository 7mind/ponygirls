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
\ir_shared haystack haystack-replay
\ir_shared haystack retrieval
ROLLBACK;
SELECT (:'lr_clean'::boolean AND :lp_replay = 0 AND :lp_retrieval_not_v2 = 0) AS lr_all_clean \gset
\echo LR.note|stored-document tolerance is decided by check-stored-documents.sh (real codec), not by these counters
\if :lr_all_clean
\echo LR.result|verify-zero
\else
\echo LR.result|verify-nonzero
DO $$ BEGIN RAISE EXCEPTION 'legacy-retirement verify: legacy rows remain (see LR.* counters above)'; END $$;
\endif
