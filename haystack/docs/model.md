# Haystack — data and mutation contract (current Scala service)

Current wire model is [sole current API](api.md); stored logical invariants below remain authoritative. Codec vectors:
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

## 2. Logical item shape (current wire uses named DocumentPayload; see api.md)

```json
{
  "key": "example-project:skill-draft-mcp-auth",
  "revision": 1,
  "document": {
    "title": "…", "description": "…",
    "fields": { "arbitrary": ["lossless", "JSON", 9007199254740993, null] },
    "type": "skill-draft", "status": "actual",
    "importance": "high", "human-attention": "required",
    "links": [["motivated-by", "shared-knowledge:fact-mcp-auth"]],
    "tags": ["mcp", "auth"]
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
  strings) are `invalid-document` faults. The shared domain codec uses
  lossless-json validation/serialization and native source-context revival
  (`LosslessNumber` for all JSON numbers); raw-text transport across
  MCP/HTTP/PG. Prototype-named keys are ordinary own properties.
- Bounds: document ≤ 1 MiB serialized; fields depth starts at zero and is ≤ 64; links ≤ 256 tuples;
  tags ≤ 64 entries; string leaves ≤ 256 KiB; number exponents within ±999999
  (rejected at parse, never rounded). Disclosed bounds, never silent truncation.
  The [typed-field presentation convention](field-presentation.md) formats
  Markdown and code inside ordinary JSON; it does not narrow this domain.
- Links: `[link_type, QualifiedItemId]` tuples; `link_type` nonempty ≤ 128
  chars. Cross-project, self, cyclic, repeated, and dangling targets all
  permitted. No target FK, no existence checks, no inverses. Order and
  repetition preserved. History snapshots keep old tuples; resolution always
  targets current documents unless an exact revision is requested.
- Tags: optional string array (absent ≡ `[]`), each entry nonempty ≤ 128
  chars, no NUL, no leading/trailing whitespace. Order and repetition
  preserved (set semantics at query time). Tags are exact case-sensitive
  labels for `tag:` search and are also indexed as text (each tag is its own
  segment). History snapshots keep old tag sets; restore = new revision.
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
6. Current digest: `haystack-op-scala-v1` binds shared encoding version,
   current operation API identifier, canonical qualified key, expected revision
   and validated lossless document in a deterministic UTF8 JSON array. Object
   keys sort by UTF16, arrays and numeric tokens retain their spelling; SHA256
   of those bytes is stored with the explicit format. This deliberately does
   not reproduce historical JavaScript serialization. Migration0004 records
   the cutover policy without deleting/re-hashing historical replays or history.
   Cross-format request identities are refused, never reinterpreted. Reconcile
   an uncertain pre-cutover write through its retained recorded outcome/history;
   a fresh ID is not automatic recovery.
7. Client rule: never retry with a fresh ID after an uncertain outcome —
   read or replay the original ID. Conflicts resolve by explicit re-read +
   deliberate edit.

Archive/unarchive and attention changes are ordinary versioned writes.

## Stored admission versus new writes

New writes are bounded1MiB source/canonical JSON; shared parser container cap66
implements the original fields-depth rule0..64 (64arrays around a scalar and
65empty arrays are valid). Number tokens may use that document budget, subject
to explicit PG JSONB numeric bounds131072 integral/16383 fractional positions;
NUL/scalar violations and duplicate keys are rejected, never rounded/stringified.
Object keys have no invented independent256KiB bound; the document byte cap
bounds them. Numeric tokens such as100000-digit coefficients are accepted when
PG can project them. Query-number exponents need not fit PG numeric;0005 compares
sign/magnitude/digits exactly without casting those query literals.

`decodeStored` uses16MiB/128containers/1MiB-number absolute safety ceilings and
original shape/fields rules, not today's write envelope or projection re-admission.
Actual old MCP admitted UTF16-bounded Unicode envelopes larger than1MiB UTF8.
Synthetic fixtures from the actual frozen validator/service and real PG prove
those current/history texts, numeric lexemes, keys, metadata and acknowledgements
remain byte-for-byte readable. Reads never rewrite text/history. Inputs beyond
absolute read ceilings fail closed for explicit offline audit, never get dropped.
