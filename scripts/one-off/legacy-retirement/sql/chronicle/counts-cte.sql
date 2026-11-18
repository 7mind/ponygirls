-- Fragment: the legacy counters of a Chronicle database as one CTE chain ending in
-- counts(key, value, must_be_zero, in_plan). The caller appends the final SELECT.
-- Read-only. Counts only: no identifiers or content leave the database.
WITH legacy_spaces AS (
  SELECT id FROM ch_embedding_spaces WHERE descriptor->>0 IS DISTINCT FROM 'embedding-space-v2'
), space_profiles AS (
  SELECT profile FROM ch_index_profiles WHERE embedding_space IN (SELECT id FROM legacy_spaces)
), policy_profiles AS (
  SELECT profile FROM ch_index_profiles WHERE policy <> 'ContextAwareProblemsV1'
), legacy_profiles AS (
  SELECT profile FROM space_profiles UNION SELECT profile FROM policy_profiles
), legacy_generations AS (
  -- stored output of a retired policy: by format label or by the policy of the producing profile
  SELECT g.id, EXISTS (SELECT 1 FROM ch_sources s WHERE s.published = g.id) AS published
  FROM ch_generations g
  WHERE g.passage_format IS DISTINCT FROM 'ContextAwareProblems' OR g.profile IN (SELECT profile FROM policy_profiles)
), counts(key, value, must_be_zero, in_plan) AS (
  SELECT 'spaces.v1', (SELECT count(*) FROM legacy_spaces), true, true
  UNION ALL SELECT 'profiles.v1_space', (SELECT count(*) FROM space_profiles), true, true
  UNION ALL SELECT 'profiles.legacy_policy', (SELECT count(*) FROM policy_profiles), true, true
  UNION ALL SELECT 'profiles.v1_descriptor', (SELECT count(*) FROM ch_index_profiles WHERE descriptor->>0 = 'index-profile-descriptor-v1'), true, false
  UNION ALL SELECT 'generations.legacy_format_or_policy', (SELECT count(*) FROM legacy_generations), true, true
  UNION ALL SELECT 'generations.legacy_format_or_policy.published', (SELECT count(*) FROM legacy_generations WHERE published), true, true
  UNION ALL SELECT 'generations.v1_space', (SELECT count(*) FROM ch_generations WHERE profile IN (SELECT profile FROM space_profiles)), true, true
  UNION ALL SELECT 'generations.v1_space.published', (SELECT count(*) FROM ch_generations g WHERE g.profile IN (SELECT profile FROM space_profiles) AND EXISTS (SELECT 1 FROM ch_sources s WHERE s.published = g.id)), true, false
  UNION ALL SELECT 'generations.unregistered_profile', (SELECT count(*) FROM ch_generations g WHERE NOT EXISTS (SELECT 1 FROM ch_index_profiles p WHERE p.profile = g.profile)), true, false
  UNION ALL SELECT 'jobs.legacy_policy', (SELECT count(*) FROM ch_jobs WHERE profile IN (SELECT profile FROM policy_profiles)), true, true
  UNION ALL SELECT 'jobs.v1_space', (SELECT count(*) FROM ch_jobs WHERE profile IN (SELECT profile FROM space_profiles)), true, true
  UNION ALL SELECT 'owner_targets.legacy_or_unregistered', (SELECT count(*) FROM ch_owner_targets t WHERE t.profile IN (SELECT profile FROM legacy_profiles) OR NOT EXISTS (SELECT 1 FROM ch_index_profiles p WHERE p.profile = t.profile)), true, false
  UNION ALL SELECT 'singleton.legacy_or_unregistered', (SELECT count(*) FROM ch_profile x WHERE x.active IN (SELECT profile FROM legacy_profiles) OR x.target IN (SELECT profile FROM legacy_profiles)
      OR NOT EXISTS (SELECT 1 FROM ch_index_profiles p WHERE p.profile = x.active) OR NOT EXISTS (SELECT 1 FROM ch_index_profiles p WHERE p.profile = x.target)), true, false
  UNION ALL SELECT 'search_chunks.legacy_profile.exists', (SELECT count(*) FROM (SELECT 1 FROM ch_search_chunks WHERE profile IN (SELECT profile FROM legacy_profiles) LIMIT 1) one), true, false
  UNION ALL SELECT 'reindex_requests.legacy_target', (SELECT count(*) FROM ch_reindex_requests WHERE target_profile IN (SELECT profile FROM legacy_profiles)), true, true
  UNION ALL SELECT 'reindex_requests.relocated_receipt', (SELECT count(*) FROM ch_reindex_requests WHERE result->>'targetProfile' IS DISTINCT FROM target_profile), true, true
  UNION ALL SELECT 'model_identity_migrations', (SELECT count(*) FROM ch_model_identity_migrations), true, true
  UNION ALL SELECT 'checkpoint_namespaces', (SELECT count(*) FROM ch_checkpoint_namespaces), true, true
  UNION ALL SELECT 'checkpoint_namespaces.unfinished_run', (SELECT count(*) FROM ch_checkpoint_namespaces n JOIN ch_jobs j ON j.id = n.job_id AND j.run_id = n.run_id WHERE j.state <> 'Complete'), true, true
  UNION ALL SELECT 'retained_profile_reads', (SELECT count(*) FROM ch_retained_profile_reads), true, true
  UNION ALL SELECT 'sessions.deadline', (SELECT count(*) FROM ch_sessions WHERE expires IS NOT NULL), true, true
  -- informational: not legacy by themselves
  UNION ALL SELECT 'info.generations.current_format', (SELECT count(*) FROM ch_generations WHERE passage_format = 'ContextAwareProblems'), false, false
  UNION ALL SELECT 'info.sources.published', (SELECT count(*) FROM ch_sources WHERE published IS NOT NULL), false, false
  UNION ALL SELECT 'info.jobs.running_live_lease', (SELECT count(*) FROM ch_jobs WHERE state = 'Running' AND lease_until > clock_timestamp()), false, false
)
