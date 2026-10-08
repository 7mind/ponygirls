# Haystack — search contract (frozen, Step 0)

Normative freeze of plan §4. CQ-like grammar, haystack semantics.
Reference (read, not vendored): cq4 `63db1c2` query-language.md.

## 1. Grammar

```text
expression  := conjunction (OR conjunction)*
conjunction := unary ((AND)? unary)*
unary       := (NOT | -) unary | '(' expression ')' | atom
atom        := word | quoted-string | predicate
```

- `AND`/`OR`/`NOT` case-insensitive; precedence `NOT` > `AND` > `OR`;
  juxtaposition = `AND`. Quoted strings use JSON escaping (`"a \"b\""`).
- Unknown attributes, malformed values, incomplete input → typed
  `invalid-query` diagnostics with half-open UTF-16 spans. Never fall back
  to text search.
- Limits: query ≤ 4096 UTF-16 code units, ≤ 512 lexer tokens, ≤ 128 AST
  nodes, depth ≤ 16, per-atom words ≤ 64. Exceeding → `invalid-query`.
- An atom yielding zero words (empty/punctuation-only quoted text) is a
  diagnostic, not match-all. Only an entirely empty/whitespace query browses
  (all eligible items, keyset order).

## 2. Built-in predicates

Names case-insensitive; ID/string values exact, case-sensitive.

| Predicate | Matches |
|---|---|
| `project:P` | item in project `P` (raw component) |
| `id:"p:i"` | exact qualified key (quotes required — protects the colon) |
| `type/status/importance/human-attention:V` | metadata equality; `human-attention` ∈ required/cleared |
| `created-by/modified-by:U` | author user ID equality |
| `created-at/modified-at OP "ts"` | `OP` ∈ `= != < <= > >=`; `ts` validated UTC/RFC3339 instant |
| `archived:true\|false\|all` | archive selector (see §3) |
| `field["PTR"] OP V` | JSON predicate (see §4) |
| `exists["PTR"]` / `NOT exists["PTR"]` | path presence |
| `link:["TYPE","p:i"]` | one exact outgoing tuple |
| `linked-to:"p:i"` | any outgoing edge to target |
| `linked-from:"p:i"` | any item with an outgoing edge from source (reverse index) |

No bare-ID recognition (unlike CQ ledger IDs). No privilege/authority
predicates — every authenticated user reads everything.

## 3. Archive default (Boolean-level, CQ treatment)

- If the AST contains **no** explicit archive selector (`archived:...`) and
  **no** `status:archived` predicate, wrap the whole expression:
  `(<expr>) AND NOT status:archived`.
- An explicit selector **anywhere** (even under `NOT`/`OR`) disables the
  implicit filter. Hence `status:archived` finds archived items, and
  `archived:all` browses everything.
- Exact get/history/link resolution never apply the default.

## 4. JSON Pointer predicates (rooted at `fields`)

- Selector `field["PTR"]` where `PTR` is an RFC6901 pointer; `""` selects
  the whole `fields` object; `~0`/`~1` decoded once. Array access: RFC6901
  (`0`-based, no leading zeros); negative indexes and `-` never select
  array elements (they may still name object members). Unresolved traversal
  (incl. PostgreSQL `#>` negative/loose-index quirks — must be masked in
  SQL) = missing.
- `OP` ∈ `= != < <= > >=`, right-hand `V` is a JSON literal (string/number/
  boolean/null). Numeric comparison only when both sides are JSON numbers
  (lossless compare, no FP conversion); wrong-type → false (not an error).
  Missing vs null are distinct: any comparison against missing is false,
  including `!=`; use `NOT exists[...]` for missing.
- `exists["PTR"]` is true iff traversal resolves (even to null).
- Paths bind as data (segment arrays), never as SQL/JSONPath text.

## 5. Text matching

- Normalize: NFKC + locale-independent lowercase. Words = Unicode
  letter/number runs + combining marks. Unquoted atom: all its words
  required. Quoted atom: contiguous word sequence required.
- Corpus: title + description + all string leaves of `fields`, with segment
  boundaries (phrase cannot span fields/array elements).
- Index: GIN word array (candidates) + per-segment normalized streams
  (exact phrase check). No stemming/fuzzy/vector (decision: CQ-like).
- Numbers/booleans are not text-searchable; use JSON predicates.

## 6. Results and paging

- Order: `(project_id, item_id)` ascending. Summaries (key/title/type/
  status/importance/human-attention/author/time/revision), never full
  documents; no total counts; no ranking.
- Opaque cursor bound to (query text, scope, order); `limit` 1–100,
  default 20. Pages are live views across concurrent writes (no snapshot);
  UI restarts browsing after writes. Malformed/foreign cursors rejected.
- Explicit project scope parameter intersects query predicates; it restricts
  candidates, never the permitted project of link targets.
- SQL compiler: fixed operators/columns + bound values only; link types and
  paths are data. Completion endpoint reuses the parser (built-ins,
  configured vocabulary, observed values, IDs) — never scans histories.

Examples:

```text
project:example-project type:todo importance:high human-attention:required
(type:github-issue OR type:github-pr) field["/github/state"] = "open"
type:skill-draft "repeated pattern" NOT importance:low
project:example-project link:["motivated-by","shared-knowledge:fact-mcp-auth"]
archived:all field["/observations/count"] >= 3
NOT exists["/review"] modified-at >= "2026-10-01T00:00:00Z"
```
