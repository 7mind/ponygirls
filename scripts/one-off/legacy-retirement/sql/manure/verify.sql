-- Manure verify: the shared retrieval registry holds only proven embedding-space-v2 descriptors. Read-only; the
-- predicate is the single definition in haystack/scripts/check-legacy-free.sql (block shared:retrieval).
SET default_transaction_read_only = on;
SET statement_timeout = :'statement_timeout';
SET lock_timeout = :'lock_timeout';
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SELECT 'LR.database', current_database();
\ir_shared haystack retrieval
ROLLBACK;
SELECT :lp_retrieval_not_v2 = 0 AS lr_clean \gset
\if :lr_clean
\echo LR.result|verify-zero
\else
\echo LR.result|verify-nonzero
DO $$ BEGIN RAISE EXCEPTION 'legacy-retirement verify: retrieval profiles without a proven v2 descriptor remain'; END $$;
\endif
