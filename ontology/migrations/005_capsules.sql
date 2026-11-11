CREATE TABLE ontology_capsules (
  scope text NOT NULL,
  capsule_id uuid NOT NULL,
  owner_kind text NOT NULL,
  owner_id text NOT NULL,
  request_id uuid NOT NULL,
  request_digest text NOT NULL,
  request_payload text NOT NULL,
  previous_capsule_id uuid,
  payload_digest text NOT NULL,
  payload text NOT NULL,
  PRIMARY KEY (scope, capsule_id),
  UNIQUE (scope, owner_kind, owner_id, request_id),
  FOREIGN KEY (scope, previous_capsule_id) REFERENCES ontology_capsules(scope, capsule_id),
  CHECK (previous_capsule_id IS NULL OR previous_capsule_id <> capsule_id)
);

CREATE TABLE ontology_deliveries (
  scope text NOT NULL,
  delivery_id uuid NOT NULL,
  owner_kind text NOT NULL,
  owner_id text NOT NULL,
  request_id uuid NOT NULL,
  capsule_id uuid NOT NULL,
  request_digest text NOT NULL,
  request_payload text NOT NULL,
  payload text NOT NULL,
  PRIMARY KEY (scope, delivery_id),
  UNIQUE (scope, owner_kind, owner_id, request_id),
  FOREIGN KEY (scope, capsule_id) REFERENCES ontology_capsules(scope, capsule_id)
);
