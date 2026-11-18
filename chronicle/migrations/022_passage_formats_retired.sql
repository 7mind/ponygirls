-- The old publication formats are retired (docs/drafts/20261118-1100-legacy-data-retirement.md §6.6): a generation that
-- is not retired is in the current format; a retired one keeps its historical label. Runs at every start, after
-- Database.initialize has refused rows this check would reject. The check is added only while it is absent, so its scan
-- of ch_generations under ACCESS EXCLUSIVE happens once; a previous release started on this database keeps it.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='ch_generations'::regclass AND conname='ch_generations_current_format_check') THEN
    ALTER TABLE ch_generations ADD CONSTRAINT ch_generations_current_format_check
      CHECK(retired OR (passage_format IS NOT NULL AND passage_format='ContextAwareProblems'));
  END IF;
END $$;
INSERT INTO ch_schema_migrations VALUES(22) ON CONFLICT DO NOTHING;
