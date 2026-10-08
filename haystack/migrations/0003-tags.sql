-- Haystack tags (0003). Documents carry an optional `tags` string array
-- (validated in TypeScript, ≤64 entries of ≤128 chars). Existing rows have
-- no `tags` key: COALESCE to [] keeps tag predicates FALSE (and NOT TRUE)
-- instead of three-valued NULL. GIN on the COALESCE expression accelerates
-- the `?` membership check used by tag: predicates.
CREATE INDEX IF NOT EXISTS items_tags_idx
  ON items USING gin ((COALESCE(document -> 'tags', '[]'::jsonb)));
