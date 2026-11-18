-- Chronicle migrate, part 3: one transaction. Transport-only relocation of the remaining v1 model identities
-- (the transformation ModelIdentityMigration.apply performs for an executable profile, applied to retained ones),
-- then removal of the proof, namespace and registry rows that only the v1 identity needed.
-- No generation, job or rebuild receipt is deleted here or anywhere else in this migration.
\if :lr_apply
BEGIN;
\endif
SELECT pg_advisory_xact_lock(hashtextextended('model-identity-migration-v2', 0)) \gset lr_ignored_
LOCK TABLE ch_jobs, ch_owner_targets IN SHARE ROW EXCLUSIVE MODE;
-- I1: re-check, under the lock, what the guards checked before the batches: the service must be gone. A client that
-- connected or a worker that claimed in the meantime aborts this transaction (committed batches stay; run again).
DO $$
DECLARE n bigint;
BEGIN
  -- (--allow-active-connections reaches here only for a dry-run: run.sh refuses it for the Chronicle apply.)
  SELECT count(*) INTO n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend';
  IF n > 0 AND current_setting('lr.allow_connections') <> 't' THEN
    RAISE EXCEPTION 'legacy-retirement refused: % other client connection(s) to this database at the identity step; stop or fence the service', n;
  END IF;
  SELECT count(*) INTO n FROM ch_jobs WHERE state = 'Running' AND lease_until > clock_timestamp();
  IF n > 0 THEN RAISE EXCEPTION 'legacy-retirement refused: % indexing job(s) hold a live lease at the identity step', n; END IF;
END $$;
CREATE TEMP TABLE lr_log(ord serial, step text NOT NULL, n bigint NOT NULL) ON COMMIT DROP;
-- circe `noSpaces` of arrays of scalars and arrays; objects are not reproducible (jsonb reorders keys) and yield NULL.
CREATE FUNCTION pg_temp.lr_nospaces(v jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE parts text[] := '{}'; e jsonb; piece text;
BEGIN
  IF jsonb_typeof(v) = 'array' THEN
    FOR e IN SELECT x.e FROM jsonb_array_elements(v) WITH ORDINALITY x(e, o) ORDER BY x.o LOOP
      piece := pg_temp.lr_nospaces(e);
      IF piece IS NULL THEN RETURN NULL; END IF;
      parts := parts || piece;
    END LOOP;
    RETURN '[' || array_to_string(parts, ',') || ']';
  ELSIF jsonb_typeof(v) = 'object' THEN
    RETURN NULL;
  END IF;
  RETURN v::text;
END $f$;
CREATE FUNCTION pg_temp.lr_sha256(v text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT encode(sha256(convert_to(v, 'UTF8')), 'hex') $f$;
DO $$
DECLARE
  n bigint; total bigint; rehomed bigint := 0;
  s1 record; p record; pair record;
  canonical_space text; canonical_descriptor jsonb;
  new_descriptor jsonb; new_profile text; existing record;
  repoint_to text;
  refs CONSTANT text[][] := ARRAY[['ch_profile','active'],['ch_profile','target'],['ch_owner_targets','profile'],['ch_jobs','profile'],
                                  ['ch_generations','profile'],['ch_search_chunks','profile'],['ch_reindex_requests','target_profile']];
BEGIN
  -- The batched part must be complete before identities are rewritten.
  SELECT count(*) INTO n FROM ch_jobs j
  WHERE j.state IS DISTINCT FROM 'Complete' AND (
    EXISTS (SELECT 1 FROM ch_checkpoint_namespaces ns WHERE ns.job_id = j.id AND ns.run_id = j.run_id)
    OR (j.profile IN (SELECT q.profile FROM ch_index_profiles q JOIN ch_embedding_spaces e ON e.id = q.embedding_space WHERE (jsonb_typeof(e.descriptor) = 'array' AND e.descriptor->>0 = 'embedding-space-v2') IS NOT TRUE)
        AND (EXISTS (SELECT 1 FROM ch_index_checkpoints c WHERE c.job_id = j.id AND c.run_id = j.run_id)
          OR EXISTS (SELECT 1 FROM ch_annotation_attempts a WHERE a.job_id = j.id AND a.run_id = j.run_id AND a.retry_epoch = j.annotation_retry_epoch))));
  IF n > 0 THEN RAISE EXCEPTION 'legacy-retirement incomplete: % unfinished run(s) still hold v1-identity accepted work; run again (raise --max-batches or --batch-size)', n; END IF;

  -- Pre-persistent sessions: the conversion of migration 020, for a database that acquired deadline rows afterwards.
  DELETE FROM ch_sessions WHERE expires <= clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO lr_log(step, n) VALUES ('sessions_expired_deleted', n);
  UPDATE ch_sessions SET expires = NULL WHERE expires IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO lr_log(step, n) VALUES ('sessions_made_persistent', n);

  -- The pre-owner-target singleton (read only by the startup seed for pre-007 archives): keep it resolvable until
  -- its table is dropped with the legacy code. A v1 profile it names is relocated with every other reference below.
  IF EXISTS (SELECT 1 FROM ch_profile x WHERE NOT EXISTS (SELECT 1 FROM ch_index_profiles q WHERE q.profile = x.active AND q.policy = 'ContextAwareProblemsV1')
               OR NOT EXISTS (SELECT 1 FROM ch_index_profiles q WHERE q.profile = x.target AND q.policy = 'ContextAwareProblemsV1')) THEN
    SELECT count(DISTINCT t.profile), min(t.profile) INTO n, repoint_to FROM ch_owner_targets t;
    IF n <> 1 THEN RAISE EXCEPTION 'legacy-retirement refused: the ch_profile singleton is legacy and % distinct owner targets exist; cannot choose its replacement', n; END IF;
    UPDATE ch_profile x SET active = repoint_to, target = repoint_to WHERE x.active <> repoint_to OR x.target <> repoint_to;
    GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO lr_log(step, n) VALUES ('singleton_repointed', n);
  END IF;

  -- Relocation of every profile still registered on a v1 embedding space.
  total := 0;
  FOR s1 IN SELECT id, descriptor FROM ch_embedding_spaces WHERE (jsonb_typeof(descriptor) = 'array' AND descriptor->>0 = 'embedding-space-v2') IS NOT TRUE ORDER BY id LOOP
    -- IS NOT FALSE: a NULL test (missing element) refuses instead of passing (three-valued logic)
    IF (jsonb_typeof(s1.descriptor) <> 'array' OR s1.descriptor->>0 <> 'embedding-space-v1' OR jsonb_array_length(s1.descriptor) <> 9
       OR (s1.descriptor->>1) !~ '^[0-9a-f]{64}$' OR pg_temp.lr_sha256(pg_temp.lr_nospaces(s1.descriptor)) IS DISTINCT FROM s1.id) IS NOT FALSE THEN
      RAISE EXCEPTION 'legacy-retirement refused: an embedding space is neither v2 nor a verifiable v1 descriptor';
    END IF;
    -- V1 prepends a transport hash to the model tuple; the canonical space is the one with the identical tuple
    -- (the equality IndexProfiles.readSpaceSql requires before it lets a retained profile be read).
    SELECT count(*), min(c.id) INTO n, canonical_space FROM ch_embedding_spaces c
    WHERE jsonb_typeof(c.descriptor) = 'array' AND c.descriptor->>0 = 'embedding-space-v2' AND s1.descriptor - 0 - 0 = c.descriptor - 0;
    IF n <> 1 THEN RAISE EXCEPTION 'legacy-retirement refused: a v1 embedding space has % canonical v2 counterpart(s), expected exactly 1 (start the current binary once so it registers the configured space)', n; END IF;
    SELECT descriptor INTO canonical_descriptor FROM ch_embedding_spaces WHERE id = canonical_space;
    IF pg_temp.lr_sha256(pg_temp.lr_nospaces(canonical_descriptor)) IS DISTINCT FROM canonical_space THEN
      RAISE EXCEPTION 'legacy-retirement refused: the canonical embedding space descriptor does not hash to its id';
    END IF;
    FOR p IN SELECT profile, policy, descriptor FROM ch_index_profiles WHERE embedding_space = s1.id ORDER BY profile LOOP
      SELECT (SELECT count(*) FROM ch_profile WHERE active = p.profile OR target = p.profile) + (SELECT count(*) FROM ch_owner_targets WHERE profile = p.profile)
           + (SELECT count(*) FROM ch_jobs WHERE profile = p.profile) + (SELECT count(*) FROM ch_generations WHERE profile = p.profile)
           + (SELECT count(*) FROM ch_reindex_requests WHERE target_profile = p.profile) INTO n;
      -- ch_search_chunks has no index on profile: probe it only when nothing else decides.
      IF n = 0 THEN SELECT count(*) INTO n FROM (SELECT 1 FROM ch_search_chunks WHERE profile = p.profile LIMIT 1) one; END IF;
      IF n = 0 THEN CONTINUE; END IF;  -- already relocated by the product CLI, or never used: only the registry row remains
      IF EXISTS (SELECT 1 FROM ch_model_identity_migrations WHERE legacy_profile = p.profile) THEN
        RAISE EXCEPTION 'legacy-retirement refused: a profile the product already relocated is referenced again';
      END IF;
      IF p.policy IS DISTINCT FROM 'ContextAwareProblemsV1' THEN
        -- A retired policy has no derivable canonical id (its writer is gone) and its id is opaque to the current
        -- code: the registry row is re-homed onto the canonical space, id and descriptor unchanged.
        UPDATE ch_index_profiles SET embedding_space = canonical_space WHERE profile = p.profile;
        rehomed := rehomed + 1;
        CONTINUE;
      END IF;
      IF (jsonb_typeof(p.descriptor) <> 'array' OR jsonb_array_length(p.descriptor) <> 3 OR p.descriptor->>0 <> 'index-profile-descriptor-v1'
         OR jsonb_typeof(p.descriptor->2) <> 'string' OR p.descriptor->>2 = '' OR jsonb_typeof(p.descriptor->1) <> 'array' OR jsonb_array_length(p.descriptor->1) <> 5
         OR (p.descriptor->1->>0) !~ '^[0-9a-f]{64}$'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(p.descriptor->1) e WHERE jsonb_typeof(e) <> 'string' OR e #>> '{}' = '')
         OR pg_temp.lr_sha256(pg_temp.lr_nospaces(jsonb_build_array('context-aware-problems-profile-v1', s1.id, p.descriptor))) IS DISTINCT FROM p.profile) IS NOT FALSE THEN
        RAISE EXCEPTION 'legacy-retirement refused: a referenced v1 profile does not verify against its descriptor; re-index its sources with the product instead';
      END IF;
      new_descriptor := jsonb_build_array('index-profile-descriptor-v2', (p.descriptor->1) - 0, p.descriptor->2);
      new_profile := pg_temp.lr_sha256(pg_temp.lr_nospaces(jsonb_build_array('context-aware-problems-profile-v2', canonical_space, new_descriptor)));
      INSERT INTO ch_index_profiles(profile, embedding_space, policy, descriptor) VALUES (new_profile, canonical_space, p.policy, new_descriptor) ON CONFLICT DO NOTHING;
      SELECT embedding_space, policy, descriptor INTO existing FROM ch_index_profiles WHERE profile = new_profile;
      IF (existing.embedding_space <> canonical_space OR existing.policy <> p.policy OR existing.descriptor <> new_descriptor) IS NOT FALSE THEN
        RAISE EXCEPTION 'legacy-retirement refused: canonical profile id collides with a different registered profile';
      END IF;
      SELECT count(*) INTO n FROM ch_jobs a JOIN ch_jobs b ON b.session_id = a.session_id AND b.revision = a.revision WHERE a.profile = p.profile AND b.profile = new_profile;
      IF n > 0 THEN RAISE EXCEPTION 'legacy-retirement refused: % job(s) exist under both the v1 and the canonical identity of one profile', n; END IF;
      FOR pair IN SELECT refs[i][1] AS tbl, refs[i][2] AS col FROM generate_subscripts(refs, 1) i LOOP
        EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', pair.tbl, pair.col, pair.col) USING new_profile, p.profile;
        GET DIAGNOSTICS n = ROW_COUNT;
        INSERT INTO lr_log(step, n) VALUES ('relocated.' || pair.tbl || '.' || pair.col, n);
      END LOOP;
      total := total + 1;
    END LOOP;
  END LOOP;
  INSERT INTO lr_log(step, n) VALUES ('profiles_relocated', total);
  INSERT INTO lr_log(step, n) VALUES ('retired_policy_profiles_rehomed', rehomed);

  -- A relocated rebuild receipt keeps a v1 id in its stored result; bring it to the control column's identity.
  UPDATE ch_reindex_requests SET result = jsonb_set(result, '{targetProfile}', to_jsonb(target_profile))
  WHERE result->>'targetProfile' IS DISTINCT FROM target_profile;
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO lr_log(step, n) VALUES ('rebuild_receipts_canonicalized', n);

  -- Proof and namespace rows, then the registry rows nothing references any more.
  DELETE FROM ch_checkpoint_namespaces;
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO lr_log(step, n) VALUES ('checkpoint_namespaces_deleted', n);
  DELETE FROM ch_retained_profile_reads;
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO lr_log(step, n) VALUES ('retained_profile_reads_deleted', n);
  DELETE FROM ch_model_identity_migrations;
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO lr_log(step, n) VALUES ('model_identity_migrations_deleted', n);
  SELECT count(*) INTO n FROM ch_index_profiles q
  WHERE q.embedding_space IN (SELECT id FROM ch_embedding_spaces WHERE (jsonb_typeof(descriptor) = 'array' AND descriptor->>0 = 'embedding-space-v2') IS NOT TRUE)
    AND (EXISTS (SELECT 1 FROM ch_profile WHERE active = q.profile OR target = q.profile) OR EXISTS (SELECT 1 FROM ch_owner_targets WHERE profile = q.profile)
      OR EXISTS (SELECT 1 FROM ch_jobs WHERE profile = q.profile) OR EXISTS (SELECT 1 FROM ch_generations WHERE profile = q.profile)
      OR EXISTS (SELECT 1 FROM ch_reindex_requests WHERE target_profile = q.profile));
  IF n > 0 THEN RAISE EXCEPTION 'legacy-retirement refused: % v1 registry profile(s) are still referenced', n; END IF;
  -- One scan instead of one per profile: no search row may still name a registry row that is about to go.
  SELECT count(*) INTO n FROM (SELECT 1 FROM ch_search_chunks WHERE profile IN (SELECT q.profile FROM ch_index_profiles q
    WHERE q.embedding_space IN (SELECT id FROM ch_embedding_spaces WHERE (jsonb_typeof(descriptor) = 'array' AND descriptor->>0 = 'embedding-space-v2') IS NOT TRUE)) LIMIT 1) one;
  IF n > 0 THEN RAISE EXCEPTION 'legacy-retirement refused: search rows still name a v1 registry profile that no generation uses'; END IF;
  DELETE FROM ch_index_profiles q
  WHERE q.embedding_space IN (SELECT id FROM ch_embedding_spaces WHERE (jsonb_typeof(descriptor) = 'array' AND descriptor->>0 = 'embedding-space-v2') IS NOT TRUE);
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO lr_log(step, n) VALUES ('v1_registry_profiles_deleted', n);
  DELETE FROM ch_embedding_spaces WHERE (jsonb_typeof(descriptor) = 'array' AND descriptor->>0 = 'embedding-space-v2') IS NOT TRUE;
  GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO lr_log(step, n) VALUES ('v1_embedding_spaces_deleted', n);
END $$;
SELECT 'LR.step.' || step, n FROM lr_log ORDER BY ord;
\ir_counts
SELECT 'LR.after.' || key, value FROM counts ORDER BY key;
\ir_counts
SELECT coalesce(sum(value) FILTER (WHERE item = 'identity'), 0) = 0 AND (coalesce(sum(value) FILTER (WHERE item = 'formats'), 0) = 0 OR :'skip_formats'::boolean) AS lr_clean FROM counts WHERE must_be_zero \gset
\if :lr_clean
\else
DO $$ BEGIN RAISE EXCEPTION 'legacy-retirement refused: legacy counters of the selected items are not zero after the migration (see LR.after.*); nothing of this transaction is kept'; END $$;
\endif
\if :lr_apply
COMMIT;
\if :lr_skip_formats
\echo LR.result|applied-formats-skipped
\else
\echo LR.result|applied
\endif
\else
ROLLBACK;
\echo LR.result|dry-run-rolled-back
\endif
