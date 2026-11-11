CREATE TABLE ontology_curation_coordinator (
  singleton boolean PRIMARY KEY CHECK (singleton),
  epoch bigint NOT NULL CHECK (epoch >= 0),
  payload text,
  CHECK (payload IS NULL OR epoch > 0)
);
INSERT INTO ontology_curation_coordinator(singleton, epoch, payload) VALUES (true, 0, NULL);

CREATE TABLE ontology_curation_attempts (
  attempt_id uuid PRIMARY KEY,
  scope text NOT NULL REFERENCES ontology_scopes(scope),
  frontier bigint NOT NULL CHECK (frontier > 0),
  owner_id uuid NOT NULL,
  fence_epoch bigint NOT NULL CHECK (fence_epoch > 0),
  state text NOT NULL CHECK (state IN ('Claimed', 'InputSealed', 'Running', 'Published', 'Failed', 'Stale', 'Interrupted')),
  payload text NOT NULL,
  publication_generation bigint CHECK (publication_generation > 0),
  CHECK ((state = 'Published') = (publication_generation IS NOT NULL)),
  UNIQUE (scope, frontier)
);
CREATE UNIQUE INDEX ontology_curation_one_active_scope ON ontology_curation_attempts(scope)
  WHERE state IN ('Claimed', 'InputSealed', 'Running');

CREATE INDEX ontology_curation_publication_cut ON ontology_curation_attempts(scope, publication_generation) WHERE state = 'Published';

CREATE TABLE ontology_curation_audit (
  attempt_id uuid NOT NULL REFERENCES ontology_curation_attempts(attempt_id),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  stage text NOT NULL CHECK (stage IN ('RequestPrepared', 'DispatchPossible', 'ResponseObserved')),
  payload text NOT NULL,
  PRIMARY KEY (attempt_id, ordinal, stage)
);
