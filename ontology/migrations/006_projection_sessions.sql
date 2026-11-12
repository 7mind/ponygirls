ALTER TABLE ontology_outbox DROP COLUMN published;

CREATE TABLE ontology_projection_sessions (
  session_id uuid PRIMARY KEY,
  target_id text NOT NULL,
  incarnation uuid NOT NULL,
  fence_owner uuid NOT NULL,
  fence_epoch bigint NOT NULL CHECK (fence_epoch > 0),
  actor_id text NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind = 'Service'),
  session_payload text NOT NULL,
  progress_payload text NOT NULL,
  UNIQUE (target_id, incarnation, fence_epoch)
);
CREATE TABLE ontology_projection_acks (
  session_id uuid NOT NULL REFERENCES ontology_projection_sessions(session_id),
  request_id uuid NOT NULL,
  scope text NOT NULL,
  target_origin text NOT NULL CHECK (target_origin IN ('Head', 'Outbox')),
  request_digest text NOT NULL,
  request_payload text NOT NULL,
  receipt_payload text NOT NULL,
  PRIMARY KEY (session_id, request_id)
);
CREATE UNIQUE INDEX ontology_projection_head_ack ON ontology_projection_acks(session_id, scope) WHERE target_origin = 'Head';
CREATE TABLE ontology_projection_checkpoints (
  target_id text NOT NULL,
  incarnation uuid NOT NULL,
  scope text NOT NULL,
  generation bigint NOT NULL CHECK (generation >= 0),
  digest text NOT NULL,
  witness_session uuid NOT NULL,
  witness_request uuid NOT NULL,
  payload text NOT NULL,
  PRIMARY KEY (target_id, incarnation, scope),
  FOREIGN KEY (witness_session, witness_request) REFERENCES ontology_projection_acks(session_id, request_id)
);
