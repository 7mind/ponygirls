ALTER TABLE ontology_captures ADD COLUMN input_kind text;
UPDATE ontology_captures SET input_kind = 'Capture';
ALTER TABLE ontology_captures ALTER COLUMN input_kind SET NOT NULL;
ALTER TABLE ontology_captures ADD CONSTRAINT ontology_captures_kind CHECK (input_kind IN ('Capture', 'Judgment'));
ALTER TABLE ontology_captures DROP CONSTRAINT ontology_captures_pkey;
ALTER TABLE ontology_captures ADD PRIMARY KEY (scope, source_namespace, input_kind, event_id);

CREATE TABLE ontology_presentations (
  scope text NOT NULL REFERENCES ontology_scopes(scope),
  presentation_id uuid NOT NULL,
  owner_id text NOT NULL,
  owner_kind text NOT NULL CHECK (owner_kind = 'Human'),
  generation bigint NOT NULL CHECK (generation >= 0),
  reserved_source_id uuid NOT NULL,
  payload_digest text NOT NULL,
  payload text NOT NULL,
  PRIMARY KEY (scope, presentation_id),
  UNIQUE (scope, reserved_source_id)
);

CREATE TABLE ontology_judgments (
  scope text NOT NULL REFERENCES ontology_scopes(scope),
  actor_id text NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind = 'Human'),
  request_id uuid NOT NULL,
  judgment_id uuid NOT NULL,
  presentation_id uuid NOT NULL,
  capture_id uuid NOT NULL,
  payload_digest text NOT NULL,
  PRIMARY KEY (scope, actor_id, actor_kind, request_id),
  UNIQUE (scope, judgment_id),
  UNIQUE (scope, capture_id),
  FOREIGN KEY (scope, presentation_id) REFERENCES ontology_presentations(scope, presentation_id),
  FOREIGN KEY (scope, capture_id) REFERENCES ontology_captures(scope, capture_id)
);
