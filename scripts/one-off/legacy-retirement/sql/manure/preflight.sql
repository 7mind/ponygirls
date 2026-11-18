-- Manure preflight: read-only counters of the shared retrieval registry (block shared:retrieval of
-- haystack/scripts/check-legacy-free.sql, the single definition).
SET default_transaction_read_only = on;
SET statement_timeout = :'statement_timeout';
SET lock_timeout = :'lock_timeout';
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SELECT 'LR.database', current_database();
\ir_shared haystack retrieval
ROLLBACK;
\echo LR.result|preflight-complete
