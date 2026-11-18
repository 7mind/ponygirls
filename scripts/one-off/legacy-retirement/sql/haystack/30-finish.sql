-- Haystack migrate, part 3: the remaining counters decide whether the run is complete.
\ir_counts
SELECT 'LR.after.' || key, value FROM counts ORDER BY key;
\ir_counts
SELECT coalesce(sum(value), 0) = 0 AS lr_replay_clean FROM counts WHERE key LIKE 'replay.%' \gset
\if :lr_replay_clean
\else
DO $$ BEGIN RAISE EXCEPTION 'legacy-retirement incomplete: Node-era replay rows remain; run again (raise --max-batches or --batch-size)'; END $$;
\endif
\if :lr_apply
\echo LR.result|applied
\else
ROLLBACK;
\echo LR.result|dry-run-rolled-back
\endif
