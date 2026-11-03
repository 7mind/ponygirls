-- Prefix eligibility must precede bounded tag completion. Folding is computed
-- by the application with String.toLowerCase(Locale.ROOT), never SQL lower or
-- a locale/normalization-dependent replacement. Migrations.initialize backfills
-- existing current tags on this same transaction/connection after this DDL.
-- Authoritative documents, revisions and replay records are never rewritten.
CREATE TABLE item_tag_values (
  project_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  tag TEXT COLLATE "C" NOT NULL,
  tag_folded TEXT COLLATE "C" NOT NULL,
  PRIMARY KEY (project_id, item_id, position)
);
CREATE INDEX item_tag_values_folded_idx
  ON item_tag_values (tag_folded text_pattern_ops, tag);
