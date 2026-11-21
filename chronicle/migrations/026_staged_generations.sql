-- Streamed publication (docs/drafts/20261121-0055-ingest-limits-spec.md §5.2.4, §5.2.5): a job's run writes its
-- generation from its persisted window results in bounded batches while the generation is staged here, then switches
-- ch_sources.published to it in one short transaction that deletes this row. No reader reaches a staged generation: the
-- published pointer does not name it and an explicit content view of it is not-found. `phase` and `resume` say where the
-- same job and run continue after a crash. A row whose run is not its job's live run is marked abandoned (run_id =
-- generation) and its generation deleted in bounded statements by the maintenance pass.
-- ch_search_retirements: generations a switch replaced whose search rows are still being deleted in bounded statements.
-- Runs at every start; idempotent; DDL only. Rollback: chronicle/scripts/down-026-staged-generations.sql.
CREATE TABLE IF NOT EXISTS ch_staged_generations(
  generation uuid PRIMARY KEY REFERENCES ch_generations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES ch_jobs(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  phase text NOT NULL CHECK(phase IN('Passages','Pieces')),
  resume jsonb NOT NULL,
  UNIQUE(job_id,run_id));
CREATE TABLE IF NOT EXISTS ch_search_retirements(
  generation uuid PRIMARY KEY REFERENCES ch_generations(id) ON DELETE CASCADE);
-- Deleted search rows cost the ANN scan budget until vacuumed: 100,000 dead rows make the table eligible for autovacuum
-- whatever its size (spec §5.2.5). Set once: the start does not take the table's lock again.
DO $$
BEGIN
  IF NOT coalesce((SELECT reloptions FROM pg_class WHERE oid='ch_search_chunks'::regclass),'{}') @> ARRAY['autovacuum_vacuum_scale_factor=0','autovacuum_vacuum_threshold=100000'] THEN
    ALTER TABLE ch_search_chunks SET (autovacuum_vacuum_scale_factor=0,autovacuum_vacuum_threshold=100000);
  END IF;
END;
$$;
INSERT INTO ch_schema_migrations VALUES(26) ON CONFLICT DO NOTHING;
