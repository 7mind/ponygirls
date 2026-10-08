-- Haystack search projections (0002). Normative semantics: docs/query.md.
-- Text normalization lives in TypeScript (query/text.ts); this migration only
-- stores its output. Pre-0002 rows (none in production yet — service is
-- unreleased) get empty projections and need a re-put for text search;
-- metadata/link/id predicates never depend on projections.

CREATE TABLE item_search (
  project_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  words TEXT[] NOT NULL,
  segments TEXT[] NOT NULL,
  PRIMARY KEY (project_id, item_id)
);
CREATE INDEX item_search_words_idx ON item_search USING gin (words);

-- Metadata equality predicates (exact, case-sensitive).
CREATE INDEX items_doctype_idx ON items ((document ->> 'type'));
CREATE INDEX items_docstatus_idx ON items ((document ->> 'status'));
CREATE INDEX items_docimportance_idx ON items ((document ->> 'importance'));
CREATE INDEX itemsdochumanattention_idx ON items ((document ->> 'human-attention'));

-- Strict RFC6901 traversal rooted at fields. Mirrors query/pointer.ts exactly:
-- ~0/~1 decoded by the caller (segments arrive decoded); arrays accept only
-- canonical non-negative indexes strictly below the array length (PostgreSQL's
-- native negative-index/from-end behavior is masked here, per the contract);
-- unresolved traversal is missing (NULL), distinct from JSON null.
CREATE OR REPLACE FUNCTION haystack_exists(doc jsonb, path text[])
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  node jsonb := doc;
  seg text;
  idx bigint;
BEGIN
  FOREACH seg IN ARRAY path LOOP
    IF node IS NULL THEN RETURN FALSE; END IF;
    IF jsonb_typeof(node) = 'object' THEN
      IF NOT (node ? seg) THEN RETURN FALSE; END IF;
      node := node -> seg;
    ELSIF jsonb_typeof(node) = 'array' THEN
      IF seg !~ '^(0|[1-9][0-9]*)$' THEN RETURN FALSE; END IF;
      IF length(seg) > 9 THEN RETURN FALSE; END IF;
      idx := seg::bigint;
      IF idx >= jsonb_array_length(node) THEN RETURN FALSE; END IF;
      node := node -> idx::int;
    ELSE
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION haystack_resolve(doc jsonb, path text[])
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  node jsonb := doc;
  seg text;
  idx bigint;
BEGIN
  FOREACH seg IN ARRAY path LOOP
    IF node IS NULL THEN RETURN NULL; END IF;
    IF jsonb_typeof(node) = 'object' THEN
      IF NOT (node ? seg) THEN RETURN NULL; END IF;
      node := node -> seg;
    ELSIF jsonb_typeof(node) = 'array' THEN
      IF seg !~ '^(0|[1-9][0-9]*)$' THEN RETURN NULL; END IF;
      IF length(seg) > 9 THEN RETURN NULL; END IF;
      idx := seg::bigint;
      IF idx >= jsonb_array_length(node) THEN RETURN NULL; END IF;
      node := node -> idx::int;
    ELSE
      RETURN NULL;
    END IF;
  END LOOP;
  RETURN node;
END;
$$;
