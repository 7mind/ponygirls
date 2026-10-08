# Haystack — data and mutation contract (frozen, Step 0)

Normative freeze of plan §3. Codec vectors:
`debug/20261007-2215-qid-codec.py` (all pass).

## 1. Qualified IDs

`ItemKey = (project_id, item_id)` internally and in PostgreSQL (two columns,
composite PK). Externally one string:

```
QualifiedItemId = encode(project_id) + ":" + encode(item_id)
```

- `encode`: UTF-8 bytes; RFC3986 unreserved (`A-Z a-z 0-9 - . _ ~`) literal;
  all other bytes `%XX` uppercase hex. Component `:` → `%3A`, `%` → `%25`.
  Exactly one literal colon in the combined form.
- `decode`: exactly once at the qualified-ID layer. Reject empty components,
  bad/truncated escapes, lowercase hex, escapes of unreserved chars, NUL,
  invalid UTF-8, noncanonical forms (re-encode must reproduce input), extra
  literal colons. Never decode twice; never build route/file paths from parts.
- Case and Unicode preserved exactly (no normalization).
- Namespace selectors take the raw project component, never a qualified ID.
- Limits: component ≤ 256 chars / ≤ 1024 UTF-8 bytes; encoded form bounded
  accordingly. Errors are typed `invalid-id` faults, never silent coercion.

Examples: `example-project:fact-mcp-auth`, `["a:b","i%d"]` → `a%3Ab:i%25d`.

## 2. Item shape (external)

```json
{
  "key": "example-project:skill-draft-mcp-auth",
  "revision": 1,
  "document": {
    "title": "…", "description": "…",
    "fields": { "arbitrary": ["lossless", "JSON", 9007199254740993, null] },
    "type": "skill-draft", "status": "actual",
    "importance": "high", "human-attention": "required",
    "links": [["motivated-by", "shared-knowledge:fact-mcp-auth"]]
  },
  "metadata": {
    "created-at": "2026-10-07T18:00:00Z", "created-by": "workstation-agent",
    "modified-at": "2026-10-07T18:00:00Z", "modified-by": "workstation-agent"
  }
}
```

- IDs nonempty, bounded, case-sensitive, immutable after creation. No project
  CRUD: first item introduces the namespace.
- `title`/`description`: nonempty-bounded strings (title ≤ 512 chars,
  description ≤ 64 KiB).
- `fields`: any JSON value (objects incl. nested, arrays, strings, numbers,
  booleans, null). **JSON domain (decision 4):** logical JSON with exact
  preservation of numbers (integers of any magnitude, decimals), strings
  (full Unicode incl. astral, no lone surrogates), and null. Not preserved:
  whitespace, object key order, duplicate keys (rejected at parse).
  Unsupported values (undefined, NaN/Infinity, lone surrogates, NUL in
  strings) are `invalid-document` faults. Single codec: `lossless-json`
  (`LosslessNumber` for all JSON numbers); raw-text transport across
  MCP/HTTP/PG, parsed exactly once at the application layer.
- Bounds: document ≤ 1 MiB serialized; depth ≤ 64; links ≤ 256 tuples;
  string leaves ≤ 256 KiB; number exponents within ±999999 (rejected at
  parse, never rounded). Disclosed bounds, never silent truncation.
  The [typed-field presentation convention](field-presentation.md) formats
  Markdown and code inside ordinary JSON; it does not narrow this domain.
- Links: `[link_type, QualifiedItemId]` tuples; `link_type` nonempty ≤ 128
  chars. Cross-project, self, cyclic, repeated, and dangling targets all
  permitted. No target FK, no existence checks, no inverses. Order and
  repetition preserved. History snapshots keep old tuples; resolution always
  targets current documents unless an exact revision is requested.
- Metadata vocabularies extensible: `type`, `status`, `importance` accept any
  nonempty ≤ 128-char string; conventional values (`todo`, `fact`,
  `github-issue`, `github-pr`, `skill-draft`, `actual`, `high`, `low`) are
  suggestions. `human-attention` ∈ {`required`, `cleared`} only.
  `status:archived` is reserved (hides from browse/search defaults).
- Authorship/timestamps come from the authenticated principal + server clock
  only. Author IDs survive user removal; never reassigned. Revisions record
  writer user ID + token ID, never secrets. Session labels in `fields` are
  unverified claims.

## 3. Writes (whole-document CAS + replay)

`put(key, document, expected_revision, request_id)`:

1. `expected_revision: 0` = create-only; duplicate key → `conflict`.
2. `expected_revision: n > 0` = replace iff current revision is exactly `n`;
   absent → `not-found`, mismatch → `conflict`. No upsert.
3. Validate → atomically: append revision `n+1`, update current row,
   projections, outgoing links, replay record — one transaction.
4. Creation metadata immutable; modification metadata = this write. History
   immutable; restore = new revision. No delete endpoint. Intentional no-op
   writes may create a revision; only same-`request_id` replay dedupes.
5. Replay: `request_id` (client-generated UUIDv7, required) scoped by
   principal. Check replay store before CAS; serialize same-identity
   concurrents; identical retry → original outcome; same ID + different
   operation → `replay-conflict` fault. Terminal outcomes (validation, CAS
   conflict, not-found) are persisted once the operation envelope is
   accepted. Auth/envelope failures and pre-commit crashes persist nothing.
   Outcomes retained durably in v1 (no TTL).
6. Digest: versioned canonical encoding `haystack-op-v1`: UTF-8 JSON array
   `["haystack-op-v1", tool/api-version, qualified-key, expected_revision,
   canonical-document]` with object keys sorted, array order kept, numbers
   via lossless decimal form (no binary FP conversion), strings exact.
   Digest = SHA-256 hex of those bytes. Duplicate object keys rejected
   before hashing. Store format version with each record; old records keep
   old comparison semantics across upgrades.
7. Client rule: never retry with a fresh ID after an uncertain outcome —
   read or replay the original ID. Conflicts resolve by explicit re-read +
   deliberate edit.

Archive/unarchive and attention changes are ordinary versioned writes.
