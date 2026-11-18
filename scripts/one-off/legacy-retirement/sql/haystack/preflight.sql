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
\ir_shared haystack haystack-replay
\ir_shared haystack retrieval
SELECT 'LR.size.database_bytes', pg_database_size(current_database());
SELECT 'LR.other_client_backends', count(*) FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend';
ROLLBACK;
\echo LR.note|stored-document tolerance is decided by check-stored-documents.sh (real codec), not by these counters
\echo LR.result|preflight-complete
