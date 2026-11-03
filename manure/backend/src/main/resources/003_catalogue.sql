-- Runtime projection v3; NEVER change original offline/canonical metadata DDL.
-- App Exact.matching computes ROOT lowercase; name_match remains bytea for NUL.
ALTER TABLE manure.artifacts ADD COLUMN IF NOT EXISTS name_match bytea;
CREATE INDEX IF NOT EXISTS catalogue_name ON manure.artifacts(name,id);
CREATE INDEX IF NOT EXISTS catalogue_created ON manure.artifacts(created_at_s_value,id);
CREATE INDEX IF NOT EXISTS catalogue_expiry_asc ON manure.artifacts(expires_at_s_value ASC NULLS LAST,id ASC);
CREATE INDEX IF NOT EXISTS catalogue_expiry_desc ON manure.artifacts(expires_at_s_value DESC NULLS LAST,id DESC);
CREATE INDEX IF NOT EXISTS catalogue_total ON manure.artifacts((COALESCE(total_bytes,0)),id);
CREATE INDEX IF NOT EXISTS catalogue_count ON manure.artifacts((COALESCE(file_count,0)),id);
CREATE INDEX IF NOT EXISTS catalogue_visibility ON manure.artifacts(visibility,id);
CREATE INDEX IF NOT EXISTS catalogue_state ON manure.artifacts(state,id);
CREATE INDEX IF NOT EXISTS catalogue_kind ON manure.artifacts(kind,id);
-- Owner IDs have no admitted byte-length bound. A full bytea btree would
-- reject otherwise valid owners at PostgreSQL's index-tuple size ceiling.
-- Owner pages use the same SQL keyset/top-N policy without that new constraint.
