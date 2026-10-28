ALTER TABLE ch_index_profiles DROP CONSTRAINT IF EXISTS ch_index_profiles_policy_check;
ALTER TABLE ch_index_profiles ADD CONSTRAINT ch_index_profiles_policy_check CHECK(policy IN ('LegacyV4','ContiguousPassagesV1','ContextAwareProblemsV1'));
ALTER TABLE ch_generations DROP CONSTRAINT IF EXISTS ch_generations_passage_format_check;
ALTER TABLE ch_generations ADD CONSTRAINT ch_generations_passage_format_check CHECK(passage_format IN ('LegacyAnnotations','ContiguousProblems','ContextAwareProblems'));
ALTER TABLE ch_generations ADD COLUMN IF NOT EXISTS retired boolean NOT NULL DEFAULT false;
ALTER TABLE ch_generations ADD COLUMN IF NOT EXISTS run_id uuid;
CREATE TABLE IF NOT EXISTS ch_context_spans(
  generation uuid NOT NULL REFERENCES ch_generations(id) ON DELETE CASCADE,
  ordinal bigint NOT NULL,
  message_id text NOT NULL,
  message_position integer NOT NULL,
  start_byte integer NOT NULL,
  end_byte integer NOT NULL CHECK(end_byte>start_byte),
  PRIMARY KEY(generation,ordinal)
);
