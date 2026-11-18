-- Fragment: the legacy counters of a Chronicle database as one CTE chain ending in
-- counts(key, value, item, must_be_zero, in_plan). The caller appends the final SELECT.
-- item: 'identity' (model identity v1, sessions, singleton, opaque targets), 'formats' (retired output formats),
-- 'info' (not legacy by itself). Read-only. Counts only: no identifiers or content leave the database.
WITH legacy_spaces AS (
  SELECT id FROM ch_embedding_spaces WHERE descriptor->>0 IS DISTINCT FROM 'embedding-space-v2'
), space_profiles AS (
  SELECT profile FROM ch_index_profiles WHERE embedding_space IN (SELECT id FROM legacy_spaces)
), policy_profiles AS (
  SELECT profile FROM ch_index_profiles WHERE policy <> 'ContextAwareProblemsV1'
), old_format AS (
  -- stored output of a retired policy, by format label or by the policy of the producing profile
  SELECT g.id, g.retired, EXISTS (SELECT 1 FROM ch_sources s WHERE s.published = g.id) AS published
  FROM ch_generations g
  WHERE g.passage_format IS DISTINCT FROM 'ContextAwareProblems' OR g.profile IN (SELECT profile FROM policy_profiles)
), unfinished AS (
  -- unfinished runs whose checkpoint identity changes: a v1 namespace row is removed, or the profile leaves a v1 space
  SELECT j.id, j.run_id FROM ch_jobs j
  WHERE j.state <> 'Complete' AND (
    EXISTS (SELECT 1 FROM ch_checkpoint_namespaces n WHERE n.job_id = j.id AND n.run_id = j.run_id)
    OR (j.profile IN (SELECT profile FROM space_profiles) AND (
         EXISTS (SELECT 1 FROM ch_index_checkpoints c WHERE c.job_id = j.id AND c.run_id = j.run_id)
      OR EXISTS (SELECT 1 FROM ch_annotation_attempts a WHERE a.job_id = j.id AND a.run_id = j.run_id AND a.retry_epoch = j.annotation_retry_epoch))))
), counts(key, value, item, must_be_zero, in_plan) AS (
  SELECT 'spaces.v1', (SELECT count(*) FROM legacy_spaces), 'identity', true, true
  UNION ALL SELECT 'profiles.v1_space', (SELECT count(*) FROM space_profiles), 'identity', true, true
  UNION ALL SELECT 'profiles.v1_descriptor.current_policy', (SELECT count(*) FROM ch_index_profiles WHERE policy = 'ContextAwareProblemsV1' AND descriptor->>0 = 'index-profile-descriptor-v1'), 'identity', true, false
  UNION ALL SELECT 'generations.v1_space', (SELECT count(*) FROM ch_generations WHERE profile IN (SELECT profile FROM space_profiles)), 'identity', true, true
  UNION ALL SELECT 'generations.v1_space.published', (SELECT count(*) FROM ch_generations g WHERE g.profile IN (SELECT profile FROM space_profiles) AND EXISTS (SELECT 1 FROM ch_sources s WHERE s.published = g.id)), 'identity', true, false
  UNION ALL SELECT 'generations.unregistered_profile', (SELECT count(*) FROM ch_generations g WHERE NOT EXISTS (SELECT 1 FROM ch_index_profiles p WHERE p.profile = g.profile)), 'identity', true, false
  UNION ALL SELECT 'jobs.v1_space', (SELECT count(*) FROM ch_jobs WHERE profile IN (SELECT profile FROM space_profiles)), 'identity', true, true
  UNION ALL SELECT 'unfinished_runs.identity_changes', (SELECT count(*) FROM unfinished), 'identity', true, true
  UNION ALL SELECT 'owner_targets.not_executable_policy_or_unregistered', (SELECT count(*) FROM ch_owner_targets t WHERE NOT EXISTS (SELECT 1 FROM ch_index_profiles p WHERE p.profile = t.profile AND p.policy = 'ContextAwareProblemsV1')), 'identity', true, false
  UNION ALL SELECT 'owner_targets.v1_space', (SELECT count(*) FROM ch_owner_targets WHERE profile IN (SELECT profile FROM space_profiles)), 'identity', true, false
  UNION ALL SELECT 'singleton.legacy_or_unregistered', (SELECT count(*) FROM ch_profile x WHERE x.active IN (SELECT profile FROM space_profiles) OR x.target IN (SELECT profile FROM space_profiles)
      OR NOT EXISTS (SELECT 1 FROM ch_index_profiles p WHERE p.profile = x.active AND p.policy = 'ContextAwareProblemsV1')
      OR NOT EXISTS (SELECT 1 FROM ch_index_profiles p WHERE p.profile = x.target AND p.policy = 'ContextAwareProblemsV1')), 'identity', true, false
  UNION ALL SELECT 'search_chunks.v1_space.exists', (SELECT count(*) FROM (SELECT 1 FROM ch_search_chunks WHERE profile IN (SELECT profile FROM space_profiles) LIMIT 1) one), 'identity', true, false
  UNION ALL SELECT 'reindex_requests.v1_target', (SELECT count(*) FROM ch_reindex_requests WHERE target_profile IN (SELECT profile FROM space_profiles)), 'identity', true, true
  UNION ALL SELECT 'reindex_requests.relocated_receipt', (SELECT count(*) FROM ch_reindex_requests WHERE result->>'targetProfile' IS DISTINCT FROM target_profile), 'identity', true, true
  UNION ALL SELECT 'model_identity_migrations', (SELECT count(*) FROM ch_model_identity_migrations), 'identity', true, true
  UNION ALL SELECT 'checkpoint_namespaces', (SELECT count(*) FROM ch_checkpoint_namespaces), 'identity', true, true
  UNION ALL SELECT 'retained_profile_reads', (SELECT count(*) FROM ch_retained_profile_reads), 'identity', true, true
  UNION ALL SELECT 'sessions.deadline', (SELECT count(*) FROM ch_sessions WHERE expires IS NOT NULL), 'identity', true, true
  -- formats: only generations that are not retired carry readable content in a retired format
  UNION ALL SELECT 'generations.old_format.published', (SELECT count(*) FROM old_format WHERE NOT retired AND published), 'formats', true, true
  UNION ALL SELECT 'generations.old_format.history', (SELECT count(*) FROM old_format WHERE NOT retired AND NOT published), 'formats', true, true
  -- informational
  UNION ALL SELECT 'info.generations.old_format.retired_tombstones', (SELECT count(*) FROM old_format WHERE retired), 'info', false, false
  UNION ALL SELECT 'info.profiles.retired_policy', (SELECT count(*) FROM policy_profiles), 'info', false, false
  UNION ALL SELECT 'info.jobs.retired_policy', (SELECT count(*) FROM ch_jobs WHERE profile IN (SELECT profile FROM policy_profiles)), 'info', false, false
  UNION ALL SELECT 'info.unfinished_runs.accepted_checkpoints_to_discard', (SELECT count(*) FROM ch_index_checkpoints c JOIN unfinished u ON u.id = c.job_id AND u.run_id = c.run_id), 'info', false, false
  UNION ALL SELECT 'info.generations.current_format', (SELECT count(*) FROM ch_generations WHERE passage_format = 'ContextAwareProblems'), 'info', false, false
  UNION ALL SELECT 'info.sources.published', (SELECT count(*) FROM ch_sources WHERE published IS NOT NULL), 'info', false, false
  UNION ALL SELECT 'info.jobs.running_live_lease', (SELECT count(*) FROM ch_jobs WHERE state = 'Running' AND lease_until > clock_timestamp()), 'info', false, false
)
