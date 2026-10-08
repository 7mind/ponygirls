# Structured agent memory: implementation plan

Status: proposed; planning only. Working name: **agent-memory**, subject to approval.
Adversarial review findings/dispositions are retained in
[the review ledger](20261007-1911-agent-memory-adversarial-review.md).

## 1. Scope and proposed decisions

Build a standalone service flake, with a small integration into ponygirls. The
service has two user-facing components: an HTTP MCP server and a web UI. One
backend process should serve `/mcp`, the browser API, and the compiled UI under
one origin; two components do not require two independently deployed servers.
PostgreSQL is the durable store.

Required behavior:

- Logical document keys are `[project_id, item_id]`, represented externally as
  a canonical `project:item` qualified ID; title, description, arbitrary JSON
  fields, metadata, and directed typed links.
- Create/read/update, immutable revision history, full-text and structured
  search; archive instead of delete.
- Static users of type `human` or `agent`, with one or more static tokens each.
  Every authenticated user can read and update every project/item. User type is
  attribution, not an authorization role.
- A table-oriented UI for browsing, searching, editing, and following links.
- Enabling the NixOS service automatically integrates its HTTP MCP endpoint into
  Claude Code, Codex, and Pi for enrolled Home Manager agent accounts.
- Agents record their filed GitHub issues/PRs and proposed skills with
  `human-attention:required`.

### Decisions and remaining proposals

Confirmed by the user: metadata vocabularies are extensible, links can cross
projects, and references should combine project/item components as `project:item`.
The escaping contract below preserves that representation without introducing
ambiguous IDs or globally unique project-local item components.

| Decision | Default / decision | Consequence / alternative |
| --- | --- | --- |
| Service boundary | Separate repository/flake; ponygirls contributes only integration and policy changes | Keeping the entire service here is possible, but couples server releases to harness releases. |
| Implementation stack | TypeScript backend using the official MCP SDK; React UI; current compatible stable Node LTS, pinned dependencies | Run the JSON-fidelity and MCP-compatibility spike below before committing to this stack. Scala or another backend is an alternative, not an assumed requirement. No Baboon adoption is implied. |
| Meaning of “versioned” | Immutable per-item revisions, plus separately versioned API/schema migrations | This is not a multi-version branching or distributed merge store. |
| Link targets | Confirmed cross-project links; representation `[link_type, "project:item"]` with a canonical qualified-ID codec | Item components remain project-local; escape each component before combining them. No global uniqueness constraint on bare item components. |
| Metadata vocabularies | Confirmed extensible: `type`, `status`, `importance`; reserve `status:archived` for hiding | `todo`, `fact`, `github-issue`, `github-pr`, `skill-draft`, `actual`, `high`, and `low` are conventions, not exhaustive enums. `human-attention` remains the proposed two-value enum from the original requirement. |
| Browser authentication | Token in a persistent HttpOnly cookie, not localStorage | A script-readable token is unnecessary and increases the consequences of XSS. |
| Client launch availability | Proposed: bounded whoami preflight verifies the declared agent/token before launch | Fails closed on wrong identity, but makes memory-enabled harness launches depend on server availability. Approve this tradeoff before implementing it; never hide an unverified identity behind fallback credentials. |
| Search text behavior | CQ-like normalized word and phrase matching; no stemming/fuzzy/vector search | PostgreSQL native FTS is an alternative if different linguistic/phrase limits are acceptable. |
| Pagination | Stable key order, live keyset pages; no snapshot promise across concurrent writes | CQ-style invalidation/snapshot semantics would be an additional requirement. State the live-view behavior in the API/UI. |

No implementation proceeds past the contract gate without an approved qualified-ID
codec and JSON-fidelity contract. Other proposed defaults can be revised while reviewing this plan.

### Deliberate non-goals

No privilege separation, user/token administration UI, hard-delete API, workflow
engine, task claims, semantic/vector search, arbitrary SQL, rule-enforced graph,
automatic skill installation, GitHub synchronization daemon, or WebSocket
subscription system. No bulk import of existing GitHub activity in the first
release. The service stores memory; it does not execute it.

## 2. Existing integration evidence

Inspected ponygirls source establishes these seams, not deployed behavior:

- `nix/hm/dev-llm.nix` imports the three harness modules. Their shared wiring
  enables MCP integration and installs shared skills/context.
- `nix/hm/tools.nix` owns `programs.mcp` and the `assetBundles.context` /
  `memorySections` contribution paths.
- `nix/hm/pi.nix:240-275` renders URL-based entries as HTTP and preserves
  headers; it does not resolve credentials itself.
- `nix/hm/crawl4ai.nix` demonstrates runtime credential paths, but its SSE/stdio
  proxy is **not** the transport pattern for this service.
- `nix/nixos/podman.nix:10-18` discovers Home Manager accounts with the LLM
  environment enabled. `nix/hm/podman.nix` demonstrates optional `osConfig`
  integration without making standalone Home Manager depend on NixOS.
- `nix/hm/yolo.nix:369-391` exposes file-backed `secretSessionVariables`.
  Both Linux and Darwin launchers read secrets at runtime rather than embedding
  their contents in generated Nix files.
- The existing automatic GitHub issue policy is in
  `nix/hm/yolo.nix:508-516`. A source survey found that yolo prompt extensions
  do not provide the same injection route for Codex. Use shared harness context
  for the new all-three memory instruction; do not assume that adding another
  yolo prompt extension covers Codex.

Public Home Manager source at
`fae6e9e42c3b762ab47635cddcfaf6f52374a61b` shows:

- Remote registry entries accept `url`/`headers`; `env` is for local servers.
- Claude's renderer adds `type:http` and preserves headers.
- Codex's renderer renames `headers` to `http_headers` without converting an
  environment placeholder into `bearer_token_env_var`.
- `programs.codex.settings.mcp_servers.<name>` replaces that individual
  registry-derived entry, providing a narrow native-credential override.

Pi 1.0.0 documentation, Claude documentation, and Codex documentation describe
native Streamable HTTP and runtime environment credentials. These are source
and documentation observations, **not** successful connection tests. Pin and
exercise the actual downstream Home Manager/harness versions during Step 0.

## 3. Data and mutation contract

### Qualified IDs

Internally, `ItemKey` remains a pair of project/item components; PostgreSQL stores
and indexes the pair. Externally, APIs, MCP, documents, and links use a named
`QualifiedItemId` string: `encode(project_id) + ":" + encode(item_id)`.

- Encode each scalar-Unicode component as UTF-8, leaving only RFC3986 unreserved
  ASCII (`A-Z a-z 0-9 - . _ ~`) literal and percent-encoding other bytes using
  uppercase hex. In particular, encode component colons as `%3A` and percent
  signs as `%25`; the combined representation has exactly one literal colon.
- Decode exactly once at the qualified-ID layer, reject empty components, invalid
  UTF-8/escapes, NUL, noncanonical forms, or additional literal colons. IDs retain
  exact case and Unicode; do not normalize them using the text-search tokenizer.
- Example: logical `["a:b", "i%d"]` becomes `a%3Ab:i%25d`. Ordinary keys stay
  readable, e.g. `example-project:fact-mcp-auth`.
- Keep ordinary transport escaping separate: use JSON strings or URL-building
  APIs, then pass their decoded value to this codec. Never repeatedly URL-decode
  a reference, concatenate untrusted route/file paths, or infer a missing project.
- Apply the same codec to current/history get, put, query literals, cursors,
  navigation, and link projections. Namespace selectors accept the raw project
  component, not a partially encoded qualified ID. Freeze component/encoded-byte
  limits and test round-trip, canonicalization, delimiter, Unicode, and URL-layer
  edge cases in Step 0.

### Item shape

Illustrative external representation:

```json
{
  "key": "example-project:skill-draft-mcp-auth",
  "revision": 1,
  "document": {
    "title": "Separate static credentials from MCP configuration",
    "description": "Draft a reusable skill for file-backed MCP credentials.",
    "fields": {
      "rationale": "The same deployment pattern has recurred in independent tasks.",
      "skill": {
        "name": "file-backed-mcp-auth",
        "description": "Use when wiring authenticated MCP clients declaratively.",
        "content": "Full proposed SKILL.md text goes here."
      },
      "evidence": [{"summary": "Generic reproducible example"}]
    },
    "type": "skill-draft",
    "status": "actual",
    "importance": "high",
    "human-attention": "required",
    "links": [["motivated-by", "shared-knowledge:fact-mcp-auth"]]
  },
  "metadata": {
    "created-at": "2026-10-07T18:00:00Z",
    "created-by": "workstation-agent",
    "modified-at": "2026-10-07T18:00:00Z",
    "modified-by": "workstation-agent"
  }
}
```

- IDs are nonempty, bounded, case-sensitive strings, immutable after creation.
  Projects are namespaces, not access-control boundaries. No project CRUD tool
  is necessary: creating the first item introduces a namespace.
- `fields` is an object whose values may be any supported JSON value, including
  nested objects, arrays, scalars, and null. Define the PostgreSQL JSONB-compatible
  domain explicitly: logical JSON, not preservation of whitespace, object key
  order, or duplicate object keys. Reject unsupported values explicitly.
- Verify large integers, decimals, Unicode, and JSON null through every path.
  Do not silently round numbers via JavaScript `JSON.parse` or an SDK. Either
  select a lossless representation/transport strategy or explicitly resolve the
  required numeric domain with the user before choosing the stack.
- Define transport/database restrictions such as invalid scalar Unicode and
  NUL, plus document/string/depth/link-count limits. These are disclosed bounds,
  not permission to silently truncate arbitrary JSON.
- Link structure: `[link_type, "target-project:target-item"]`, where the target
  is the same canonical `QualifiedItemId` type used by get/put. Cross-project links,
  arbitrary link types, self-links, cycles, repeated links, and dangling targets
  are permitted, including targets in namespaces with no existing items. Do not
  add target foreign keys, project-existence checks, or automatic inverse
  relationships. Preserve tuple order and repetitions; the UI can show incoming
  links derived from current sources. Historical snapshots retain their old
  outgoing tuples; following them resolves the target's current document unless
  an exact target revision is requested separately.
- Search/browse defaults exclude `status == "archived"`. Exact get, history, and
  link resolution can still retrieve archived items.
- All author IDs and timestamps come from the authenticated principal and server
  clock, never client-supplied authorship. Retain author identity after a user is
  removed from configuration; never reassign an old user ID to a different actor.
- Every revision records its writer and token identifier, never the token secret.
  Shared agent credentials attribute to that configured agent identity, not to a
  uniquely proven model/session. Optional session labels in `fields` are claims,
  not authenticated authorship.

### Writes, concurrency, and retries

Use whole-document `put`, not ambiguous recursive JSON merging:

1. `expected_revision:0` means create only. A duplicate key conflicts.
2. `expected_revision:n` replaces an existing item's mutable document only when
   the current revision is exactly `n`; absent/mismatched items return a typed
   conflict or not-found error. No unconditional upsert.
3. Validate first, then atomically append revision `n+1`, update the current
   projection, search data, and materialized outgoing links.
4. Creation metadata remains unchanged; modification metadata reflects this write.
   History cannot be edited. Restoring an old document makes a new revision.
5. Require a client-generated `request_id` for writes. Persist replay results
   keyed by principal/request ID in the same transaction. Serialize simultaneous
   requests with that identity, then recheck replay after acquiring ownership or
   waiting for the competing transaction. An identical retry returns the original
   outcome; reuse with a different operation/payload fails. Check replay before
   CAS so a lost response does not turn a successful retry into a conflict.
   Retain outcomes durably in the first release. Once a well-formed operation
   envelope is accepted, persist terminal application outcomes, including domain
   validation, CAS-conflict, and not-found failures, not just successful writes.
   Authentication/envelope parsing failures are not accepted operations, and
   transient failures before transaction commit have no durable outcome.
6. Define a versioned, lossless canonical operation encoding for the replay
   digest: include operation/API version, full key, expected revision, and entire
   mutable document; exclude credentials, server metadata, and request ID
   (already part of the replay key). Preserve strings and array order, sort object
   keys deterministically, and normalize numbers without double-precision
   conversion. Reject duplicate object keys rather than hashing an ambiguous
   operation. Store the digest-format version and retain its comparison semantics
   across upgrades; do not reinterpret old request IDs with a new algorithm.
7. Do not retry a write with a new ID after an uncertain outcome. Read/replay the
   original request. Conflict resolution is explicit re-read and deliberate edit,
   not automatic last-writer-wins.

Archiving/unarchiving and changing attention are ordinary versioned writes.
There is no delete endpoint. A no-op intentional write may create a revision;
only replay of the same request is deduplicated.

## 4. Search contract: CQ-like, not CQ's ledger model

Reference: cq4 commit `63db1c2fec0b66b81e9799e3e06cc17548f6d817`, especially
`docs/design/query-language.md`, `core/.../QueryParser.scala`, and
`server/.../QuerySql.scala`.

Keep its useful semantics:

```text
expression  := conjunction (OR conjunction)*
conjunction := unary ((AND)? unary)*
unary       := (NOT | -) unary | '(' expression ')' | atom
atom        := word | quoted-string | predicate
```

- Case-insensitive Boolean operators; precedence `NOT` > `AND` > `OR`;
  whitespace implies `AND`; quoted strings use JSON escaping.
- Unknown attributes, malformed values, and incomplete expressions return
  diagnostics with half-open UTF-16 spans. Never fall back to text silently.
- Unlike CQ, arbitrary bare IDs are not recognizable ledger IDs: use
  `id:"project:item"` for an exact qualified key. Quotes protect the embedded
  colon from the query lexer. Do not import CQ's ledgers, status enums, claims,
  relation rules, or authority
  scoping. This store has no privilege separation.
- Built-ins: `project`, `id`, `type`, `status`, `importance`, `human-attention`,
  `created-by`, `modified-by`, `created-at`, `modified-at`, and `archived`.
  Built-in names are case-insensitive; ordinary ID/string values are exact and
  case-sensitive. Timestamp comparisons accept validated UTC/RFC3339 instants.
- `archived:true|false|all` maps to the reserved archived status. If the AST has
  no explicit archive selector or `status:archived` predicate, add
  `NOT status:archived` around the **whole** expression. An explicit selector
  anywhere disables the implicit filter, including beneath `NOT`/`OR`, matching
  CQ's predictable Boolean treatment. Thus `status:archived` actually finds
  archived entries. Exact retrieval does not apply this default.
- JSON predicates use RFC6901 JSON Pointer selectors rooted at `fields`, e.g.
  `field["/github/state"] = "open"`. The empty pointer selects the entire fields
  object; decode `~0`/`~1` once. Array access follows RFC6901 (zero-based decimal
  indexes without leading zeros); negative indexes and `-` do not select array
  elements, although the same tokens can name object members. PostgreSQL `#>`
  alone is not a conforming evaluator: prevent its negative-index/loose-index
  behavior from changing the contract. Treat an unresolved traversal as missing.
  Support logical JSON equality/inequality, numeric comparisons, and
  `exists["/path"]`. Bind decoded path segments rather than accepting raw
  SQL/JSONPath. Missing differs from JSON null; a comparison
  against a missing path is false, including `!=`; use `NOT exists[...]` to
  find missing fields. Wrong-type numeric comparisons are false, not casts or
  query failures. Negation operates on explicit two-valued predicates.
- `link:["relates-to","other-project:item-123"]` matches one exact outgoing
  tuple; `linked-to:"other-project:item-123"` matches any outgoing type;
  `linked-from:"source-project:item-456"` matches an incoming source.
  Targets/sources use explicit full keys, never the current namespace as an
  implicit fallback. Query/project scope restricts result candidates, not the
  permitted project of their link targets. Do not silently correlate separate
  type and target predicates across different links.

Examples:

```text
project:example-project type:todo importance:high human-attention:required
(type:github-issue OR type:github-pr) field["/github/state"] = "open"
type:skill-draft "repeated pattern" NOT importance:low
project:example-project link:["motivated-by","shared-knowledge:fact-mcp-auth"]
archived:all field["/observations/count"] >= 3
NOT exists["/review"] modified-at >= "2026-10-01T00:00:00Z"
```

### Text/index strategy

- Normalize with NFKC and locale-independent lowercasing; extract Unicode
  letter/number words and combining marks. Unquoted atoms require their words;
  quoted atoms require a contiguous word sequence. A text atom yielding no words
  (including empty or punctuation-only quoted text) is a diagnostic, not an
  implicit match-all. Only an entirely empty/whitespace query browses all eligible
  items.
- Search title, description, and all string leaves of `fields`. Retain segment
  boundaries so a phrase cannot accidentally cross separate fields or array
  elements. Numbers/booleans remain queryable via typed JSON predicates.
- Materialize a GIN-indexed normalized word array for candidates and normalized
  per-segment streams for exact phrase checks. CQ uses this approach because
  native `tsvector` has finite positional/repetition limits. Choosing native FTS
  instead requires a declared semantic change and limits, not just an index swap.
- Add bounded syntax/AST/token/depth limits; CQ's 4,096 UTF-16 characters, 512
  tokens, 128 explicit nodes, and depth 16 are reasonable initial bounds.
  Set and test per-word/per-atom/document bounds separately.
- Compile a typed AST to fixed SQL operators/columns and bound values. Arbitrary
  JSON paths and link types are data, never SQL identifiers.
- Start with `(project_id, item_id)` keyset ordering, bounded summary pages, and
  opaque cursors bound to query/scope/order. Full documents are fetched with get;
  no implicit total-count or relevance-ranking work.
- Pages are live views: concurrent edits can change membership between pages;
  cursors do not claim a repeatable snapshot. The UI restarts browsing after
  writes and exposes refresh. Reject malformed or query-mismatched cursors.
- Provide bounded HTTP query analysis/completion for the browser using the same
  parser and catalog. This does not require a fourth MCP tool. Initially suggest
  built-ins, configured/conventional vocabulary, observed values, and item IDs;
  never scan full histories for completion.

## 5. HTTP, authentication, and minimal MCP

### Authentication

- Generate independent tokens from 32 cryptographically random bytes, encoded as
  canonical unpadded base64url (43 ASCII characters). A token identifies exactly
  one configured user and token ID. Multiple token IDs allow overlapping rotation
  without creating another user. Runtime token files contain exactly this token
  with at most one final LF; reject other whitespace, multiline values, and
  noncanonical encodings. HTTP/cookie values omit the file terminator. Hash these
  exact ASCII token bytes, never an ambiguously trimmed or differently encoded
  value; document a secret-generation/hash procedure that does not expose tokens
  through tracing or process arguments.
- The NixOS module declares users/types and runtime `tokenHashFile` paths. Files
  contain SHA-256 digests of high-entropy tokens; the backend receives them via
  systemd credentials and compares validated digests securely. Slow password
  hashing is not required for uniformly random bearer secrets.
- Clients receive raw tokens through runtime `tokenFile` paths. Paths are Nix
  strings, not file literals that copy secret material into the store. Never use
  `builtins.readFile` on secrets or serialize literal bearer headers.
- Validate configuration on startup: unique user IDs and per-user token IDs,
  valid types/digests, no token digest assigned twice, readable/nonempty required
  credentials. Fail rather than starting anonymous or selecting another identity.
- Tokens are revalidated on every authenticated request. Removing a token/user
  and restarting/reloading configuration revokes access, including browser
  cookies. Already committed/in-flight operations have an explicit boundary;
  do not claim retroactive revocation.
- Use bearer authentication for `/mcp`. Do not accept browser cookies there.
  The browser API supports either its same-origin cookie or an explicit bearer
  token for non-browser clients; reject ambiguous simultaneous credentials.
  Login uses its explicitly submitted token rather than an existing cookie.
  Bearer-authenticated whoami is mandatory for client identity preflight and
  returns user ID/type, token ID, and the authoritative `activityProjectId`.
  Return explicit 401/403/rate-limit errors.
- TLS is mandatory outside loopback development. Validate `Origin` when present,
  validate allowed hosts, disable cross-origin API access by default, and trust
  proxy headers only from the configured local reverse proxy.

### Response/cache and logging privacy

- All API/MCP/authentication responses, including errors and whoami, carry
  `Cache-Control: no-store`. The deployment proxy must disable/bypass caching on
  these routes; never rely only on cookies, `Vary`, or backend revocation checks
  to prevent a cache serving previously authenticated content.
- Only public, content-hashed static assets may be cached immutably. The public
  UI shell contains no item/user/token data. No service worker or application
  cache persists authenticated responses. Clear in-memory data on logout or
  identity change, and test history/back-forward navigation after logout.
- Send `Referrer-Policy: no-referrer` on the UI and dynamic responses. UI query/
  selection state, if saved in a URL, uses the fragment, not query/path parameters.
  Send search text and qualified item keys to API endpoints in JSON bodies.
  Fragment URLs still enter browser history and intentionally shared URLs reveal
  their contents to recipients; explain this rather than claiming they are secret.
- Use explicit per-layer logging schemas: proxy access events permit a fixed
  route label, generated request ID, timing, and status; application events add
  authenticated principal/token **labels** (never credentials/digests), revision
  counters, and a fixed result/error category; infrastructure events add
  allowlisted database/pool/latency/timeout health counters. Dynamic item keys,
  titles, author display names, URLs, and query text are not attribution labels.
  Do not log raw request URIs, query strings, Referer, authorization, cookies,
  request/response bodies, DSNs, or unfiltered exception messages. Apply this to
  proxy error logs too. Ensure PostgreSQL service-role statement/error parameter
  logging cannot expose memory; configure its supported scoped controls rather
  than disabling unrelated cluster diagnostics. Schema tests accept required
  operational fields and reject every unapproved field; sanitized infrastructure
  failures remain observable.
- Verify through the real proxy with distinct memory/token/query canaries,
  including failed requests, reload/navigation, and logout/revocation. Assert
  cache headers/configuration and absence of canaries in application, proxy,
  database logs, and outgoing referrers. Cached public assets must not create an
  authenticated-data bypass.

### Persistent browser login

`POST /api/v1/login` verifies a supplied token and sets a cookie such as
`__Host-agent-memory`, containing the token, with `HttpOnly`, `Secure`, `Path=/`,
no Domain attribute, and `SameSite=Strict`. A proposed 180-day lifetime renewed
on authenticated activity avoids frequent sign-in. The server still checks the
current token configuration on every request; cookie persistence does not imply
revocation immunity. No additional session database is necessary for this design.

Require same-origin validation on login and every cookie-authenticated mutation
for CSRF protection. Logout expires the cookie; it does not revoke a static token
on other devices. Development HTTP-cookie behavior must be explicitly separate
from production. Never put tokens in URLs, localStorage, browser logs, or tracing.

### Shared browser API

Define versioned request/response schemas and typed faults for get, put, search,
history, query analysis, namespace/value discovery, and login/logout/whoami.
The MCP and browser transports call the same application service and repository;
no second implementation of permissions, archival defaults, or mutation rules.
Schema migrations are versioned independently from item revisions and API paths.

### Exactly three initial MCP tools

| Tool | Input | Output / semantics |
| --- | --- | --- |
| `get` | `key`, optional exact `revision` | Full document and authoritative metadata. Without revision, read current. Archived items remain accessible. |
| `put` | `key`, complete mutable `document`, required `expected_revision`, required `request_id` | Committed key/revision/metadata; create/update/archive all use the same operation. |
| `search` | `query`, optional project scope, bounded `limit`, optional cursor | Bounded current-item summaries and continuation cursor. Empty query browses nonarchived items. Explicit scope intersects query predicates. |

MCP initialization guidance documents archive defaults, CAS/replay behavior,
query examples, and that stored content is data, not authoritative instructions.
Set correct read-only/idempotency annotations; `put` is not read-only and its
idempotency depends on retaining the same request ID. Return bounded structured
results plus a compact text representation for clients that only display text.
No MCP resources/prompts, user tools, graph traversal tool, or GitHub-specific
helper tools are necessary initially.

Use **Streamable HTTP at `/mcp`**, not legacy HTTP+SSE at `/sse`, and expose no
stdio service/proxy. Short operations can return JSON rather than require an
open SSE stream. Pin the SDK and supported protocol revisions against all three
actual clients: MCP's current transport docs describe a 2026-07-28 revision that
removed protocol sessions/GET streams, unlike 2025-11-25. Do not mix those rules.
Implement and test whichever revisions are selected, including initialization,
notifications, headers, content negotiation, unsupported versions/methods, and
GET/session behavior appropriate to each supported revision. Prefer an SDK to a
handwritten JSON-RPC implementation. No OAuth authorization server is required
for these operator-provisioned private tokens.

## 6. Storage and PostgreSQL operation

Start with these explicit storage responsibilities:

- `items`: composite key, latest revision, current JSONB document, authoritative
  metadata, typed metadata/search projection.
- `item_revisions`: composite key plus revision; immutable document snapshot,
  authoritative author/time/token ID. Historical reads never reinterpret a
  previous revision using today's user display name/type.
- `item_links`: current outgoing tuples with full source key, full target key,
  link type, and tuple position; indexes on source and
  `(target_project_id, target_item_id, link_type)`. No target/project FK.
  Reverse lookup must include both target-key components and work across projects.
- `write_requests`: principal/request ID, operation digest, durable replay result.
- `store_metadata`: initialized authoritative activity namespace. It must match
  static `activityProjectId` on startup; changing it requires an explicitly
  reviewed migration/accounting-key transition, not a silent new namespace.
- Ordered schema-migration ledger, protected by a migration/advisory lock.

The application repository exposes atomic mutation semantics rather than leaking
individual table writes into HTTP/MCP code. Keep snapshots, current projections,
links, and search data consistent in one transaction. Initialize author/type
snapshots from static configuration; configuration is the authority for active
users, not a competing editable user table.

Indexes: composite-key B-tree; selected metadata/project indexes; word-array GIN;
reverse-link index; history `(project_id,item_id,revision DESC)`. Add JSONB GIN
only where the compiler's actual predicates can use its operator class; a generic
GIN index does not accelerate every `#>` path comparison. Arbitrary paths cannot
all be efficiently indexed. Use expression indexes only when measured workloads
justify them. Test selective queries and broad negations independently;
do not promise index-only work for every Boolean expression.

### Modern-machine tuning, without damaging shared PostgreSQL

The NixOS module should manage a local database/role on NixOS PostgreSQL in the
first release. Connect over a local Unix socket with peer authentication where
possible; PostgreSQL must not become public when the web service is enabled.
Database roles must not be cluster superusers or have cluster-wide create-role/
create-database privileges; scope migration/runtime permissions to this database.
Expose a small documented tuning/resource section, respecting the pinned PG
version and existing cluster configuration.

Initial SSD/NVMe planner profile:

- `seq_page_cost = 1.0`, `random_page_cost = 1.1` as tunable starting estimates.
- `effective_cache_size` reflects the cache budget actually available to this
  database, not blindly the machine's entire RAM.
- Bounded connection pool, modest per-operation `work_mem`, `statement_timeout`,
  `lock_timeout`, and idle-in-transaction timeout. Remember that `work_mem` is
  per plan operation and can multiply across queries/connections.
- Consider `jit = off` for short interactive queries; validate with measurements.
  Choose `effective_io_concurrency` for the pinned version and storage stack,
  rather than transplanting an unexplained constant.

Apply role/database-scoped settings where supported. Do not silently retune a
host's unrelated databases. Cluster-level `shared_buffers`, maintenance memory,
WAL/checkpoint sizing, and IO settings require an explicit resource budget and
operator-approved cluster profile. As an **example**, a dedicated 16 GiB host
might start at 4 GiB shared buffers, approximately 12 GiB effective cache,
16 MiB work memory, and an 8-connection service pool; these are not universal
module defaults, nor guaranteed optimal values.

Keep `fsync`, `full_page_writes`, and durable commit behavior enabled. Keep
regular autovacuum/ANALYZE, particularly for frequently updated projections and
GIN indexes. Capture `EXPLAIN (ANALYZE, BUFFERS)` and warm/cold measurements over
representative data before asserting that tuning improves performance. PostgreSQL
planner cost guidance explicitly cautions against fitting a few isolated queries.

Operational requirements:

- systemd dedicated service account, restart policy, DB readiness/migration
  ordering, least filesystem access, and credentials through `LoadCredential`.
- Migration failure or incompatible schema fails startup; never recreate data
  automatically. Do not automatically upgrade the PostgreSQL major version.
- Operational events follow the explicit per-layer allowlists in section 5:
  authenticated principal/token labels and revision/result category belong to
  application events; request ID/latency/status correlate layers; aggregate DB
  health belongs to infrastructure events. Excluded data remains excluded even
  on errors.
- Liveness without data; readiness only after configuration, database, and
  migrations are usable. Define graceful drain/shutdown.
- Automated database backups with explicit retention and restore procedure.
  Retain every item revision initially; introduce pruning only with a separate
  approved policy. Back up secret configuration through the operator's secret
  manager, not alongside plaintext item exports.

## 7. Flake and module contracts

### Standalone service repository layout

```text
flake.nix / flake.lock
src/domain/                 types, validation, query AST/tokenization
src/application/            service contracts and implementations
src/storage/                repository contract, PostgreSQL implementation
src/http/                   browser API and authentication
src/mcp/                    thin SDK adapter
web/                        React table/detail/edit UI
migrations/                 ordered SQL migrations
tests/                      shared contracts, dummy, real DB, transport/browser
nix/package.nix
nix/nixos.nix
nix/tests/                  module evaluation and deployment tests
docs/                       model/query/API/operation contracts
```

Export `packages.<system>.default` / `agent-memory`, a development shell,
`checks`, `nixosModules.default`, and `homeManagerModules.default`. The server
package bundles built UI assets and must not need npm/network access at runtime.
Build the server on Linux; the client Home Manager module must evaluate on both
Linux and macOS. Lock dependencies and prove offline/sandboxed Nix builds.
Keep the HM client implementation in ponygirls at `nix/hm/agent-memory.nix`,
export it as a standalone module there, and re-export that same module as the
service flake's `homeManagerModules.default`. The service flake pins ponygirls
for this export/tests; ponygirls takes no service-flake input, avoiding a cyclic
flake dependency. The client consumes public URL/auth options, not server code.
The NixOS server module must not force installation of all harnesses. Importing
or building the server must not pull harness packages into its runtime closure.

### NixOS options (proposed namespace)

`smind.services.agent-memory`:

- `enable`, `package`, loopback listen address/port, `publicUrl`, allowed origins.
- Optional local reverse-proxy/TLS configuration, with explicit certificate
  provisioning; no public firewall opening unless selected.
- `users.<userId>.type`, display name, and
  `tokens.<tokenId>.tokenHashFile` runtime paths.
- `clients.<unixAccount>`: configured agent `userId`, `tokenId`, raw `tokenFile`.
  This is an account-to-agent-credential mapping, not a second user registry.
- `activityProjectId`: the authoritative shared namespace for all GitHub
  accounting and reusable skill drafts. Persist/check it in store metadata and
  propagate it into every client policy so agents agree on complete keys, not
  just item IDs. Client preflight rejects a configured namespace that differs
  from the server's whoami response.
- Local PostgreSQL database/role, pool/timeout and explicit resource/tuning
  options; backup schedule/retention.

Illustrative configuration contract, not currently implemented:

```nix
smind.services.agent-memory = {
  enable = true;
  publicUrl = "https://memory.example.net";
  activityProjectId = "agent-activity";
  users = {
    operator = {
      type = "human";
      tokens.browser.tokenHashFile = "/run/secrets/memory-human-sha256";
    };
    workstation-agent = {
      type = "agent";
      tokens.default.tokenHashFile = "/run/secrets/memory-agent-sha256";
    };
  };
  clients.alice = {
    userId = "workstation-agent";
    tokenId = "default";
    tokenFile = "/run/secrets/memory-agent-token";
  };
};
```

The human token is provisioned for browser login independently of the agent token.
The module does not generate untracked random credentials during evaluation or
activation. Document secret-manager ownership/modes for both server digests and
per-account raw token files.

### Automatic integration and standalone Home Manager

1. Canonical import route: add ponygirls' `nix/hm/agent-memory.nix` to its
   `dev-llm.nix` aggregation, using existing public options and optional `osConfig`
   detection. The service flake re-exports that module for standalone compositions
   that lack the updated aggregation; use the same ponygirls revision/module
   identity and document import deduplication. Do not add a second automatic sharedModules import or require
   another per-harness enable switch. Keep the service/backend dependency out of
   ponygirls' runtime closure except for client integration assets.
2. When the NixOS service is enabled, discover accounts already enrolled with
   `smind.hm.dev.llm.enable`. Each needs an explicit valid client mapping; missing
   credentials or a non-agent mapped identity are actionable assertions, not
   anonymous connections or reuse of a human credential.
3. For these accounts, derive the URL/identity/token path and enable all three
   clients. Do not install harnesses into unrelated accounts, invent a root
   mapping, or create identities from Unix names implicitly. Server-only hosts
   with no enrolled harness accounts remain valid.
4. With service disabled, contribute no automatic endpoint/policy. Standalone HM
   can explicitly connect to a remote instance with the same URL/token-path,
   expected user/token identity, and required `activityProjectId` options;
   absence of `osConfig` must not break evaluation.
5. The HM adapter registers one logical URL-based `programs.mcp` entry. Claude
   and Pi use a literal runtime placeholder in the Authorization header:
   `Bearer ${AGENT_MEMORY_TOKEN}`. Codex gets a targeted native entry with `url`
   and `bearer_token_env_var = "AGENT_MEMORY_TOKEN"`, replacing only this
   registry-derived entry. Nix interpolation must be escaped when writing the
   placeholder; the generated files contain no bearer secret.
6. Supply `AGENT_MEMORY_TOKEN` through yolo's runtime secret transport, with a
   token-specific host loading seam in its Linux/Darwin packages and HM wiring.
   One shared reader validates the exact selected file bytes **before** command
   substitution or line-based environment-file composition; the current generic
   `$(cat file)` transport strips trailing LFs and cannot enforce this new
   token-file contract. Read once and inject the same validated token, rather
   than validating then rereading the file. Explicitly propagate reader failures
   instead of masking them with an `export` command's exit status; rejected files
   must never compose an environment assignment. Preserve unrelated existing
   secrets' transport semantics and named-profile path selection.
   Inside yolo, credential wrappers validate/consume only the injected value;
   they do not reread an unavailable host path. Outside yolo, narrowly scoped
   wrappers use that same file reader without tracing, export the variable, and
   exec the native harness; do not select a stray ambient token instead. Test
   zero/one final LF acceptance and rejection of multiple LFs, embedded LF/CRLF,
   NUL, invalid encodings, and attempted extra-variable injection on direct and
   sandbox paths, including profile overrides. These are credential-loading
   wrappers, **not** MCP stdio proxies. Preserve existing package wrappers,
   argv, exit status, and profile behavior.
7. Missing/unreadable/empty credentials fail the affected launch explicitly; do
   not rely on yolo's general warn-and-skip behavior as successful memory setup.
   Before a memory-enabled launch, a bounded bearer-authenticated whoami preflight
   must verify the configured user ID, token ID, agent type, and activity
   namespace. Wrong identity/namespace fails closed; no automatic substitution.
   An unreachable service is an explicit preflight failure, not verified setup
   or an anonymous fallback;
   this deliberately makes memory-enabled launches depend on service availability.
   Account for named profiles and rotation: env-backed credentials are loaded
   for a process lifetime, so affected clients restart when switching tokens.
8. Verify endpoint reachability and secret hygiene inside Linux/Darwin sandboxes
   and outside them. Bind no broad secret directories, and never pass a bearer
   secret in process arguments or generated store files.

Use shared `assetBundles.context`/`memorySections` for the policy on all three
harnesses. Avoid embedding credentials, assuming slash-command distribution is
identical across harnesses, or overwriting unrelated MCP entries.

## 8. Web UI requirements

- Token login, remembered cookie, current principal/type, and logout. A 401
  prompts sign-in; a network error is not mislabeled as authentication failure.
- Namespace selector plus all-project browse, query editor with diagnostics and
  bounded completion, explicit include-archived control that composes with the
  query AST rather than appending a contradictory filter.
- Paginated table: project/item ID, title, type, status, importance,
  human-attention, last author/time, and revision. Default nonarchived view;
  optional saved query in the URL fragment under the privacy rules in section 5,
  never credentials. Search requests use JSON bodies, not URL query parameters.
- Detail/editor: title/description, suggested-but-extensible metadata values,
  validated raw JSON editor for fields, tuple link editor, current metadata.
- Incoming/outgoing links, with project-qualified navigation, explicit target
  project selection/editing, and visible dangling/archived targets. Cross-project
  navigation must not silently reinterpret an ID in the current namespace.
  No graph visualization is required to support graph-organized memory.
- Revision list and exact historical snapshots; comparison and restore-as-new-
  revision. A stale save preserves the draft and displays a conflict with the
  latest revision; it never silently overwrites someone else's update.
- Human-attention inbox is a preset query, not a new permissions/workflow system.
  Clearing attention makes an attributed revision; it is not cryptographic proof
  that a human reviewed the content because all users may write all items.
- Render documents as untrusted data. No raw HTML, automatic script execution,
  automatic instruction/skill activation, unsafe URL schemes, or unsolicited
  remote content loads. Use CSP and escaped/sanitized Markdown if Markdown is
  displayed. A skill draft is text awaiting review, not an active skill.
- Loading/failure/empty states, accessible table/forms, and explicit save/retry
  outcomes. No autosave or live subscription requirements in the initial scope.

## 9. Agent policies and record conventions

These are shared instructions plus ordinary documents, not special server tools.
Only enable them when the memory integration is configured. Maintain existing
reproduction, deduplication, security-reporting, and privacy constraints.

### Filed GitHub issues and pull requests

Proposed instruction:

> After successfully filing a GitHub issue or pull request, record its canonical
> URL and sanitized summary in agent memory with human-attention:required. Use a
> deterministic key so retries do not create duplicates. Record what was actually
> filed, not what was intended. If filing succeeded but recording failed, report
> both outcomes separately and preserve a sanitized retry payload; do not file
> the GitHub artifact again to repair memory accounting. Existing privacy rules
> also apply to memory, since every configured user can read it.

Record conventions:

- Always account artifacts in the server-authoritative `activityProjectId`,
  regardless of an agent's local project knowledge. Use links to relevant
  project-local records rather than creating another accounting copy there.
- Resolve the successfully filed artifact through GitHub GraphQL on the trusted
  `api.github.com` endpoint. Require `X-Github-Next-Global-ID: 1` and use the
  returned opaque `id` plus `__typename` (`Issue` -> `issue`, `PullRequest` ->
  `pr`), not the input/REST node ID or an ID prefix. GitHub documents multiple
  global-ID formats for the same object; raw legacy and next IDs must not mint
  separate memory records. Use a version-pinned lookup procedure and fixtures
  for conversion to the canonical next-format response. Do not derive identity
  from an owner/repository slug, issue number alone, or a URL spelling. Never forward credentials to an arbitrary host/redirect supplied by
  a stored URL. The initial GitHub integration targets `github.com`; other hosts
  need an explicit trusted-host/identity contract before automatic accounting.
- Define the complete key as `encode(activityProjectId) + ":" + item_component`,
  using the qualified-ID codec. The item component is `github-issue-<digest>` or
  `github-pr-<digest>`, where digest is the full 64-character lowercase hex
  SHA-256 of the UTF-8 canonical JSON string array
  `["github-artifact-v1", "github.com", kind, node_id]`. Canonicalize using the
  versioned canonical JSON rules from section 3 (no numeric conversion is involved
  in this all-string array); preserve the opaque node ID exactly. No truncation.
  Freeze fixtures for API responses, aliases/URL spellings, repository renames,
  kind detection, canonical bytes, and digest output in Step 0.
- Store verified kind/canonical node ID/identity-format version plus canonical
  HTTPS `url` from the trusted GraphQL response in `fields.github`. URLs are
  display/provenance, not key identity;
  strip tracking/fragment state and validate host/path rather than guessing an
  artifact from a URL. Record repository/number/version only when appropriate for
  this shared store. Different spellings that resolve to the same GitHub node
  must produce the same complete key across clients.
- On an existing key, verify stored kind/node identity before CAS. A different
  or missing identity is an observable collision/corrupted-accounting fault,
  never permission to overwrite unrelated data. If trusted identity resolution
  fails after GitHub creation, retain a sanitized URL/pending-resolution payload
  and report incomplete accounting; do not mint an alternate URL-derived key or
  file the GitHub artifact again. Future global-ID/API format changes require
  an explicitly reviewed existing-key/alias transition before automatic
  accounting resumes; never silently select a new digest input for old artifacts.
- `type:github-issue|github-pr`, `status:actual`, `human-attention:required`,
  importance chosen from evidence rather than making every artifact high.
- `fields.github`: canonical URL, artifact kind, sanitized public title/summary,
  affected version/commit, observed external state/time when available.
  Distinguish external GitHub state from memory's archived/actual status.
- Link to relevant facts/skill drafts when useful. An existing equivalent issue
  can be recorded explicitly as a discovered/referenced artifact; do not describe
  it as agent-filed. The request to account for PRs does not itself authorize
  creating PRs that other instructions would not allow.
- On an existing deterministic key, get and use CAS; preserve human edits and
  do not repeatedly reset attention after a human has cleared it. A genuinely
  new material development can require renewed attention with a stated reason.

The GitHub write and memory write cannot be one transaction. Instructions plus
replay-safe storage reduce duplicates but do **not** guarantee accounting after
an agent crashes between services. Document this residual boundary. Guaranteed
capture would need a separate wrapper/outbox/reconciliation design; do not claim
it or build a GitHub synchronizer without an additional requirement.

### Skill candidates

Proposed instruction:

> When a recurring or concretely reusable pattern is worth a skill, first check
> installed skills and existing drafts for overlap. Draft the complete skill and
> store it as a skill-draft with human-attention:required. Include the rationale,
> triggering situations, evidence, intended benefit, boundaries, and why existing
> guidance is insufficient. State whether recurrence is observed or only a
> hypothesis. Do not install or activate the draft automatically.

Store `fields.skill` with name, trigger description, and complete proposed
`SKILL.md`; `fields.rationale` with motivation/evidence, alternatives,
limitations, expected benefit, and overlap analysis. Use links to motivating
facts or issue/PR records. Store reusable skill drafts in the configured
`activityProjectId` namespace under a deterministic `skill-draft-<name>` item ID;
use cross-project links for originating context. Every agent searches that shared
namespace before drafting. Stable complete keys plus CAS prevent duplicate writes
only for the same chosen name/key, not semantic duplicates under different names.
Overlap detection is best effort, including after concurrent creation. When
semantic overlap is discovered, reuse or link/reconcile drafts explicitly,
preserving human edits and cleared attention. When unrelated drafts collide on a
name, choose a distinct key and link the naming collision; never overwrite an
unrelated draft because its name matches. Do not independently place copies under
each originating project's namespace. Skill-worthiness is a
judgment with recorded reasons, not an arbitrary occurrence-count threshold.

Human review can edit, clear attention, or archive the draft; installation is a
separate explicit action. Do not trust a free-form `approved` label as authority
for installation. Never store credentials, private excerpts without permission,
or personal data just to make a proposed skill persuasive.

## 10. Step-by-step implementation and verification gates

Every step ends with observable evidence. These are planned checks, not claims
that the service or tests already exist.

### Step 0 — Freeze contracts and prove risky assumptions

Approve the remaining proposals in section 1 and freeze/test the canonical
`project:item` codec; write model/query/auth/API contracts and examples.
Preserve the confirmed
extensible-vocabulary and cross-project-link requirements. Pin actual Home Manager, all three harness versions, MCP SDK/protocol,
and current stable compatible runtime dependencies. Exercise a disposable native
HTTP endpoint with env-backed tokens across the three clients. Spike lossless
JSON round-trips through MCP, HTTP, PostgreSQL, the editor, query numeric literals,
and operation-digest generation/comparison, including upgrade-stable replay.
Freeze the shared GitHub node-identity/key algorithm and authoritative namespace
contract, with deterministic fixtures independent of local project knowledge,
including legacy/next GraphQL IDs resolving to one canonical identity.
Decide final stack only after these checks. Review CQ behavior without copying its ledger model;
verify licensing/permission before reusing code (GitHub metadata does not identify
an upstream license).

**Gate:** recorded client/protocol compatibility matrix; numeric/Unicode fidelity
results; codec round-trip/collision-rejection evidence and query/archive examples. A stdio workaround or
lossy JSON is not an unreported pass.

### Step 1 — Scaffold the standalone flake and reproducible packages

Create the source layout, dev shell, dependency lockfiles, backend/UI build,
package with bundled UI, checks, and module export stubs. Keep imports lazy so
Linux server evaluation does not force macOS-only harness packages and vice versa.

**Gate:** clean sandboxed package builds, deterministic UI assets, offline runtime
launch, and Linux/macOS client-module evaluation. No service implementation in
ponygirls beyond agreed integration seams.

### Step 2 — Model/domain service and hand-written repository dummy

Define named key/revision/principal/link/document/fault types, validators, and a
narrow repository contract with atomic CAS/replay semantics. Write contract and
service scenarios before the adapter: create/get/update, conflict, history,
archival defaults, attribution, malformed inputs, retry identity, extensible
metadata values, canonical qualified IDs, and links across projects with colliding
bare item components.
Implement a small hand-written in-memory repository and injected clock/auth
configuration for fast feedback.

**Gate:** behavioral Blackbox-Atomic/Group tests pass; forbidden authorship and
unsupported JSON are rejected at the boundary. No autogenerated DB mocks or
business logic coupled to SQL tables.

### Step 3 — PostgreSQL adapter, migrations, and durability

Implement initial migrations, current/history storage, CAS transactions,
replay records, projections, links, and indexes. Run the **same** repository and
service scenarios against dummy and temporary real PostgreSQL. Add focused
real-DB checks for concurrent create/update, rollback, lost-response replay,
simultaneous identical request IDs, conflicting payload reuse, replay of terminal
failures, restart/upgrade-stable digests, migration locking/failure, and prior-author
retention.

**Gate:** both legs pass; racing writes produce one correct winner with no lost
history or partial projection. A missing production test leg fails full
verification rather than silently substituting the dummy.

### Step 4 — Query language, text search, and measured access paths

Implement the bounded parser/diagnostics, typed AST, JSON Pointer predicates,
archive transformation, word/phrase normalization, safe SQL compiler, live keyset
paging, and bounded completion. Extend shared dummy/PG scenarios with precedence,
Unicode, missing/null, arbitrary link types, phrase boundaries, malformed input,
cross-project candidate/target scope, RFC6901 object/array traversal differences,
empty text atoms, and cursor errors. Measure selective and broad-query plans at
growing data sizes.

**Gate:** expected result sets agree across dummy/PG; parameterized injection
inputs cannot alter SQL structure; default/explicit archive behavior is identical
in every entry point. Publish measured query plans and disclosed scan cases.

### Step 5 — Authenticated HTTP application and persistent cookie

Build static-config loading, bearer lookup, login/logout/whoami, versioned browser
API, origin/host/CSRF validation, no-store/cache controls, no-referrer/fragment
query state, bounds/timeouts, error mapping, and allowlisted sanitized logging. Make authentication independent of transports and item visibility rules.
Test revocation after configuration reload/restart and persistent browser login.

**Gate:** unauthenticated/malformed/revoked credentials cannot read or write;
all configured valid users see all items; authors derive from tokens. Browser
restarts retain login, logout clears it, and cookie/CSRF/TLS properties are proven.
Proxy-backed cache/revocation tests and query/token/memory-canary log/referrer
checks must pass; required bearer whoami verifies identity and activity namespace.

### Step 6 — Minimal HTTP MCP adapter

Expose only get/put/search over the selected supported Streamable HTTP revisions,
using the shared application service. Add schema/annotation/result bounds and
concise initialization guidance. Do not create a custom stdio transport.

**Gate:** real MCP client initialize/list/call flows, errors, pagination and CAS
work; the three native harnesses use the authenticated HTTP route. Cookie-only
MCP access is rejected. Unsupported protocol behavior is explicit.

### Step 7 — Table/detail/edit web UI

Implement remembered login, browse/search/query diagnostics, archive control,
JSON editing, metadata/link navigation, attention preset, history, comparison,
and restore-as-new-revision. Make network/auth failures and stale-edit conflicts
visible without losing unsaved text. Add escaped rendering and CSP.

**Gate:** controlled browser tests cover persisted login, search/edit/archive,
arbitrary JSON/link fidelity, archived references, two-editor conflicts,
history/restore, attention clearing, XSS payloads, and inaccessible server.

### Step 8 — Production NixOS and Home Manager modules

Implement the module options/assertions, static identities/hash credentials,
local PostgreSQL/peer auth, migrations/service hardening, tuning/resource options,
TLS proxy integration, backups, and standalone HM client configuration. Implement
all three native client renderings, credential wrappers, the approved identity
preflight policy, and activity namespace propagation in the canonical ponygirls
client module here, before their module gate; update the service flake's module
re-export pin as part of this step. Wire the NixOS
enabled state into already-enrolled agent accounts with explicit mapping.

**Gate:** module evaluation covers enabled/disabled, server-only, missing HM,
invalid/missing mappings, multiple accounts/tokens, standalone remote HM, and
Darwin HM. A NixOS deployment test proves start/restart, database persistence,
credential permissions, TLS routing, and revocation. Service enable produces all
three harness entries without three additional toggles.

### Step 9 — Integrate with ponygirls and validate secret boundaries

Add the canonical HM import/contribution path and deploy/test the client adapters
implemented in Step 8 through the actual ponygirls aggregation. Preserve other
MCP servers and existing profile/package behavior; add feature-gated shared
context. This step verifies composition rather than deferring implementation of
client entries that Step 8 already requires.

**Gate:** generated configs contain URLs/placeholders but no test-token canary;
no raw canary in Nix outputs, argv, traced scripts, logs, or broad filesystem
binds. Test wrong-but-valid identity, missing credentials, unavailable preflight,
and yolo execution with inaccessible host token paths. Verify native get/put/search
on Claude/Codex/Pi inside/outside Linux yolo,
and on Darwin clients against a Linux server. Configuration inspection alone
is not proof that a harness actually authenticates and calls the endpoint.

### Step 10 — Deliver the two shared agent instructions

Add GitHub accounting and skill-draft guidance through shared context, with
exact record examples, deduplication, the authoritative activity namespace,
project-context links, and failure reporting,
privacy, stable GitHub node-derived full keys, and no automatic skill activation.
Keep the existing verified-issue
filing policy intact; do not accidentally broaden PR authorization. Update any
operating-manual text to distinguish persistent service memory from model
conversation memory when this integration is enabled.

**Gate:** inspect rendered context for every harness/profile; scenario checks
cover successful filing, GitHub success/memory or identity-resolution failure,
independent clients with differing project knowledge/URL spellings deriving the
same GitHub key, concurrent accounting, identity mismatch/collision, cleared
attention preservation, existing equivalent issues, reviewed skill drafts,
same-key retries, different-name semantic overlap, and same-name unrelated drafts.
Use controlled fixtures rather than creating real GitHub artifacts as tests.
A small operator-reviewed agent trial confirms instruction usability; it is not
proof of crash-proof cross-service accounting.

### Step 11 — Release/operations acceptance

Run full verification, deploy from the built package rather than the source
checkout, document token provisioning/rotation, backup/restore, upgrades,
resource tuning, known bounds, and incident recovery. Restore a backup into a
fresh instance and compare current items, history, links, authorship, and replay
behavior. Re-run clients against that restored instance.

**Gate:** repeatable deployment/restart/restore evidence, passing required tests,
and a documented upgrade compatibility policy. Report measured search latency
and write contention for a recorded dataset/hardware; agree performance targets
before treating them as delivery gates. Do not silently add unmeasured latency
promises to the correctness contract.

Dependency order: **0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11**.
After contracts/storage stabilize, transport and UI work can proceed in separate
worktrees; merge only after their shared contracts and tests pass.

## 11. Test strategy and definition of done

Most correctness tests should be Behavioral-Active Blackbox-Atomic/Group, with
specified origin recorded separately. Repository/service scenarios run against
both a hand-written dummy and real PostgreSQL. Exact transaction/isolation,
planner, systemd, and browser behavior use a smaller controlled
Good-Communication tier. Performance measurements are a separate suite.
No live GitHub dependency in pre-merge CI; paid/model-backed harness trials are
explicit operator acceptance, not an unnoticed fast-test dependency.

The first release is complete only when:

- Approved item/query/auth contracts are implemented without lossy writes.
- CAS, history, idempotent replay, author provenance, archive defaults, and
  arbitrary JSON/link semantics pass the required tests.
- All three harnesses authenticate natively over HTTP from module-generated
  configuration; secrets remain outside store/argv/logs.
- Browser login persists, edits cannot silently overwrite concurrent updates,
  and stored content remains inert.
- NixOS/HM enabled and disabled states, standalone clients, PostgreSQL resource
  settings, and secret permissions are verified.
- Both agent use cases produce attributed attention-required records, with the
  acknowledged GitHub/memory failure boundary and no automatic skill installation.
- Restart and fresh-instance backup/restore preserve durable memory and history.

## References

- [CQ query contract at inspected commit](https://github.com/pshirshov/cq4/blob/63db1c2fec0b66b81e9799e3e06cc17548f6d817/docs/design/query-language.md)
- [CQ parser](https://github.com/pshirshov/cq4/blob/63db1c2fec0b66b81e9799e3e06cc17548f6d817/core/src/main/scala/cq/core/QueryParser.scala)
- [CQ SQL compiler](https://github.com/pshirshov/cq4/blob/63db1c2fec0b66b81e9799e3e06cc17548f6d817/server/src/main/scala/cq/server/QuerySql.scala)
- [Home Manager MCP registry](https://github.com/nix-community/home-manager/blob/fae6e9e42c3b762ab47635cddcfaf6f52374a61b/modules/programs/mcp.nix)
- [Home Manager Codex renderer](https://github.com/nix-community/home-manager/blob/fae6e9e42c3b762ab47635cddcfaf6f52374a61b/modules/programs/codex/default.nix)
- [Home Manager Claude renderer](https://github.com/nix-community/home-manager/blob/fae6e9e42c3b762ab47635cddcfaf6f52374a61b/modules/programs/claude-code/default.nix)
- [Claude MCP configuration](https://code.claude.com/docs/en/mcp)
- [Codex MCP configuration](https://developers.openai.com/codex/mcp/)
- [Current Streamable HTTP transport](https://modelcontextprotocol.io/specification/latest/basic/transports/streamable-http)
- [2025-11-25 transport rules](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [PostgreSQL planner tuning](https://www.postgresql.org/docs/current/runtime-config-query.html)
- [GitHub global-ID formats and canonical next-ID lookup](https://docs.github.com/en/graphql/guides/migrating-graphql-global-node-ids)
