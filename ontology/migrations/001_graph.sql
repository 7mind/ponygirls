CREATE TABLE ontology_scopes (
  scope text PRIMARY KEY,
  generation bigint NOT NULL CHECK (generation >= 0),
  frontier bigint NOT NULL DEFAULT 0 CHECK (frontier >= 0),
  snapshot text NOT NULL
);
CREATE TABLE ontology_revisions (
  scope text NOT NULL REFERENCES ontology_scopes(scope),
  generation bigint NOT NULL CHECK (generation >= 0),
  snapshot text NOT NULL,
  PRIMARY KEY (scope, generation)
);
CREATE TABLE ontology_mutations (
  scope text NOT NULL REFERENCES ontology_scopes(scope),
  actor_id text NOT NULL,
  actor_kind text NOT NULL,
  request_id uuid NOT NULL,
  payload_digest text NOT NULL,
  result text NOT NULL,
  PRIMARY KEY (scope, actor_id, actor_kind, request_id)
);
CREATE TABLE ontology_inputs (
  scope text NOT NULL REFERENCES ontology_scopes(scope),
  input_id uuid NOT NULL,
  generation bigint NOT NULL,
  payload text NOT NULL,
  PRIMARY KEY (scope, input_id)
);
CREATE TABLE ontology_captures (
  scope text NOT NULL REFERENCES ontology_scopes(scope),
  source_namespace text NOT NULL,
  event_id uuid NOT NULL,
  capture_id uuid NOT NULL,
  frontier bigint NOT NULL CHECK (frontier > 0),
  fingerprint text NOT NULL,
  payload text NOT NULL,
  result text NOT NULL,
  PRIMARY KEY (scope, source_namespace, event_id),
  UNIQUE (scope, capture_id),
  UNIQUE (scope, frontier)
);
CREATE TABLE ontology_ingest_requests (
  scope text NOT NULL REFERENCES ontology_scopes(scope),
  source_namespace text NOT NULL,
  request_id uuid NOT NULL,
  payload_digest text NOT NULL,
  result text NOT NULL,
  PRIMARY KEY (scope, source_namespace, request_id)
);
CREATE TABLE ontology_outbox (
  scope text NOT NULL,
  generation bigint NOT NULL,
  published boolean NOT NULL DEFAULT false,
  PRIMARY KEY (scope, generation),
  FOREIGN KEY (scope, generation) REFERENCES ontology_revisions(scope, generation)
);
