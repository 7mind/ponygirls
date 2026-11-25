-- Claim order (indexing-claim-order spec §5.2, §5.5): when a job began waiting and whether it is bulk work.
-- Nullable without a default: adding them is a catalog change, ch_jobs is not rewritten. The ALTER takes ACCESS EXCLUSIVE
-- on ch_jobs until the start transaction commits, so applying 033 for the first time is an offline step (docs/operations.md).
-- Every start fills NULLs of unfinished jobs afterwards (ClaimOrderSeed.startFill); the server writes both on every insert
-- and re-queue that starts a wait (Jobs.successorOrder, Jobs.retry, RetryFailedJobs, ReindexCohort). No authority check
-- reads them.
ALTER TABLE ch_jobs ADD COLUMN IF NOT EXISTS waiting_since timestamptz, ADD COLUMN IF NOT EXISTS bulk boolean;
-- The class lanes' order (bulk, then oldest first), lane 0's unsized order, lane 0's sized order, and the older-Running checks.
CREATE INDEX IF NOT EXISTS ch_jobs_class ON ch_jobs(bulk,waiting_since,session_id) WHERE state IN('Queued','Running');
CREATE INDEX IF NOT EXISTS ch_jobs_age ON ch_jobs(waiting_since,session_id) WHERE state IN('Queued','Running');
CREATE INDEX IF NOT EXISTS ch_jobs_sized ON ch_jobs(waiting_since,session_id) WHERE state='Queued' AND total_windows IS NOT NULL;
CREATE INDEX IF NOT EXISTS ch_jobs_running ON ch_jobs(session_id,profile) WHERE state='Running';

INSERT INTO ch_schema_migrations VALUES(33) ON CONFLICT DO NOTHING;
