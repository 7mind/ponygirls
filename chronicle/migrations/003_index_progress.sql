ALTER TABLE ch_jobs ADD COLUMN IF NOT EXISTS completed_windows integer NOT NULL DEFAULT 0;
ALTER TABLE ch_jobs ADD COLUMN IF NOT EXISTS total_windows integer;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM ch_schema_migrations WHERE version=3) THEN
    ALTER TABLE ch_jobs ADD CONSTRAINT ch_jobs_progress_bounds CHECK (
      completed_windows >= 0 AND (total_windows IS NULL AND completed_windows=0 OR total_windows >= completed_windows)
    );
    INSERT INTO ch_schema_migrations VALUES(3);
  END IF;
END $$;
