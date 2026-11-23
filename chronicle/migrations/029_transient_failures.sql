-- Transient database failures of indexing jobs (docs/drafts/20261123-0055-restart-robustness-spec.md §4): a statement
-- timeout, a lost or refused connection, a full admission or an earlier attempt's publication statement still running is
-- not charged to a job's attempts; the job waits Queued until `lease_until` (its next attempt, back-off 1, 2, 4, 8, then
-- 15 minutes) and fails `database-transient` at the tenth consecutive one. `transient_failures` counts them (an attempt
-- that commits progress starts again at 1; any other failure, a retry and a rebuild reset it); `transient_range` is the
-- first ordinal of the search-row range whose statement failed at the last one (NULL otherwise), which the next attempt
-- writes first. Both are metadata-only.
-- Runs at every start; idempotent; DDL only. Rollback: chronicle/scripts/down-029-transient-failures.sql.
ALTER TABLE ch_jobs ADD COLUMN IF NOT EXISTS transient_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transient_range integer;
INSERT INTO ch_schema_migrations VALUES(29) ON CONFLICT DO NOTHING;
