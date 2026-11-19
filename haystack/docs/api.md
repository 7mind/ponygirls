# Haystack — sole current API (Scala port)

Authoritative model: [`models/current.baboon`](../models/current.baboon),
`haystack.api` **1.0.0**. Pinned Baboon0.0.200 generates Scala2.13 and TypeScript;
handwritten code never patches generated codecs. Only this version is registered.
No independent deployments require old DTOs/routes/codecs/cursors. Stored data,
credentials, history and acknowledged outcomes are separately preserved.

## First-party HTTP

`GET /api/versions` returns generated `VersionInfo(current,minimum,supported)`;
all three describe only1.0.0. `X-Haystack-Version: 1.0.0` explicitly selects current;
an absent header also selects current, but any removed/future value fails
`version-mismatch`. Every dynamic response, including faults, is no-store and
no-referrer. Private queries/keys are JSON bodies, never URL query parameters.

Use generated classes **and codecs**, not interface casts or custom legacy JSON:

| Route | Generated request → response |
|---|---|
| `GET /api/v1/health` | none → `Ack` (no data/auth) |
| `POST /api/v1/login` | legacy `LoginRequest` decoded, then `unauthorized`; never sets a bearer cookie |
| `POST /api/v1/logout` | empty object → `Ack`; deletes the current browser session and expires its cookie |
| `GET /api/v1/whoami` | none → `Identity(userId,userType,tokenId,activityProjectId)` |
| `POST /api/v1/get` | `GetRequest(key,revision?)` → `Item` |
| `POST /api/v1/put` | `PutRequest` → `PutResult` |
| `POST /api/v1/search` | `SearchRequest` → `SearchResult(items,cursor?)` |
| `POST /api/v1/history` | `HistoryRequest(key)` → `HistoryResult(revisions)` |
| `POST /api/v1/query/analyze` | `QueryRequest(query,caret)` → `AnalyzeResult(valid,spans)` |
| `POST /api/v1/complete` | `QueryRequest` → `CompletionResult(suggestions)` |
| `POST /api/v1/values` | `ValuesRequest(field)` → `ValuesResult(values)` |
| `POST /api/v1/retrieve` | `RetrieveRequest` → `RetrieveResult` |
| `GET /api/v1/capabilities` | none → `RetrievalCapabilities(modes)` |
| `GET /api/v1/live` | authenticated WS; generated `LiveFrame` in both directions |

`Item.document` and `PutRequest.document` are named `DocumentPayload { json:str }`.
The contained text is validated by shared `LosslessJson`, not Circe doubles. For
example, the generated PutRequest codec emits:

```json
{"key":"p:i","document":{"json":"{\"title\":\"t\",\"description\":\"d\",\"fields\":{\"n\":9007199254740993},\"type\":\"fact\",\"status\":\"actual\",\"importance\":\"low\",\"human-attention\":\"cleared\",\"links\":[]}"},"expectedRevision":0,"requestId":"0193e8d5-6f5c-7a1b-8c2d-000000000001"}
```

Envelope counters use generated i32 codecs. Optional fields are encoded according
to generated codecs (JSON null), not handwritten omission conventions. The browser
parses only the inner document with its lossless codec and keeps fields as exact
text. It never `JSON.parse`s arbitrary document numbers into JS numbers.

`Failure` is the generated **direct response**, not an old `{error:...}` wrapper:
`code,message,spans,currentRevision?`. Stable categories include invalid-id,
invalid-document/query/cursor, bad-envelope, not-found, conflict/replay-conflict,
unauthorized, forbidden, ambiguous-credentials, too-large, rate-limited,
version-mismatch and unavailable. Messages never contain submitted values, SQL,
paths or credentials. Query spans are half-open UTF16 offsets.

## Independent account API

Password sign-in and browser-only token settings use `/api/account/v1`, with
strict JSON rather than generated domain DTOs. See [auth.md](auth.md#account-settings-boundary)
for the complete login/account/list/issue/revoke/logout contract, owner-bound
`X-Account-Actor` header, immutable declarative tokens and sanitized error wrapper.
The domain's generated version, audit IDs, bearer access and item policy are unchanged.
Browser cookies authenticate only durable sessions, never configured/issued API tokens.

## Search, metadata and content retrieval

Exact Boolean search retains [`query.md`](query.md), including archive-default
scope, strict pointers, mathematical numeric comparison, global C/UTF8 ordering
and saved-position live cursors. PostgreSQL performs grammar/filter/sort/boundary
and `LIMIT limit+1` before returning at most101 **summaries**, not full documents.
Migration0005 compares query decimal lexemes by signs/magnitudes/digits, including
`1e±999999`, without numeric-cast overflow or exponent-sized allocation. No
unsupported-query fallback downloads the corpus into the server/browser.

Completion enforces the full4096-UTF16-unit query bound even for a short requested prefix; carets must be in range and cannot split a surrogate pair.

Values return at most100 distinct current values; completion returns at most20
suggestions using grammar plus bounded current metadata/IDs, never histories or
models. Quoted insertions preserve colons, spaces, controls and non-BMP identity.
These are bounded suggestions, not exhaustive facets or counts.

Content retrieval is distinct from exact browse. `RetrieveRequest` explicitly
selects Lexical/Semantic/Hybrid, raw project filter, includeArchived, offset and
limit; the route serves exactly that mode and never substitutes another.
Configured outages do not couple writes/browse to models. Approved metadata/string
leaves only (production: title, description and tags; fields are not embedded);
operator pointer approvals and chunk bounds participate in policy identity.
Results carry actual source revision, generation, profile/embedding-space
(optional for lexical HEAD), policy, field/pointer/UTF16 provenance, text and
score; totals declare ExactMatches or CandidateWindow and rankingLimit. No mutable
hydration relabels an older published hit.

Partial readiness is declared, not refused. Semantic/hybrid rank only
publications of the active profile; `RetrieveResult.pending` (i64, a JSON decimal
string like `total`) counts the sources inside the query's
authorization/project/archived/expiry scope whose current revision has no
publication under the active profile: never published, published for an older
revision, or published under another profile/policy/embedding space. A pending
source with an older revision published under the active profile is still
ranked through that publication (its hits carry the older revision) until the
current revision's publication replaces it; a source never published, or
published only under another profile, is not ranked until the worker publishes
it. Lexical reads current revisions and always reports `"0"`.

`GET /api/v1/capabilities` is an authenticated read like `whoami` (401
`unauthorized` without credentials) returning `RetrievalCapabilities(modes)`:
`{"modes":["Lexical"]}` without an embedding, `{"modes":["Lexical","Semantic","Hybrid"]}`
with one.

A semantic/hybrid request that cannot be served answers HTTP 503 with the
generated `Failure`, `code` `unavailable` and exactly one of these fixed
messages (the closed reason set; never provider or exception text):

| Reason | `message` |
|---|---|
| not configured on this server (lexical-only capability) | `semantic retrieval is not configured; lexical-only capability` |
| the query embedding failed (provider error, timeout, invalid output) | `query embedding failed` |

```json
{"code":"unavailable","message":"query embedding failed","spans":[],"currentRevision":null}
```

Every other failure keeps its code-derived message (for example a database
outage is `{"code":"unavailable","message":"unavailable",…}`), so clients
recognize the reasons by these exact messages.

Example `RetrieveResult` (hybrid; one published hit, one in-scope item pending):

```json
{"sources":[{"key":"p:a","revision":1,"pointer":"/title","text":"harbour notes","score":0.03252247488101533,"generation":"87383bfc-7739-4721-aa6b-cf3e8a313fef","profile":"a5a4a44a6e6f05e9817a2c71008847b39d40b8cd06b074d570e3a11666f28e5e","embeddingSpace":"bae20c9a7a6434218b707da37d3effdc4af9aaee8918847c401b0469f87fcb17","policy":"3e7505b5bede1a2b1e4296ba0bf0eb1118e62bfbf00c8c1e13e406403caf8b65","field":"title","start":0,"end":13}],"mode":"Hybrid","countScope":"CandidateWindow","total":"1","rankingLimit":2000,"pending":"1"}
```

Client default rule (MCP `retrieve`, CLI `retrieve`, dashboard): free text and
no explicit mode → **hybrid** if the capabilities list it; otherwise lexical with
the visible notice `Hybrid search is not available on this server: <reason>;
showing lexical results` (`<reason>` is the not-configured message above). A
defaulted hybrid answered with one of the 503 reasons is re-run once as lexical
with the same notice naming the server's message. An explicit mode is never
substituted; its unavailability is reported with the server's message. `pending
> 0` is shown as `N items are not yet indexed for semantic search; results may
be incomplete` (`1 item is not yet indexed …` for one). The model stays `1.0.0`, changed in place (one negotiated
version): a client built before `pending`/`RetrievalCapabilities` rejects the
retrieve response with its strict decoder, and the current CLI rejects an older
server's response; upgrade clients with the server.

## Live/current browser state

Generated `LiveFrame.kind` is `ping | pong | changed` with optional fields. Ping
requires bounded nonce and finite clientTs; pong echoes them with serverTs.
Changed carries canonical key/revision. Session slots are scoped to the actual upgraded stream; invalid/non-upgrade handshakes never reserve capacity and carry no-store. Initial credential validation admits only bounded body reading: all authenticated body routes revalidate the exact captured identity/transport after the read and before dispatch.

Only fresh committed writes publish;
replay/terminal failure does not. Application frame cap1024bytes, transport safety
ceiling1MiB, bounded64KiB/64frame outgoing queue, per-token8 sockets, real30second
protocol heartbeat with nonce validation (Pong frames are deliberately delivered to the service, not filtered by the builder). Revocation is checked on incoming and
outgoing activity and heartbeat. Session rejection4401 alone asks for sign-in;
network outages preserve cookies, reconnect/refetch and unsaved editor CAS.

An uncertain browser write freezes its exact payload/CAS/original UUIDv7 in a
session-local lane. Retry replays that operation, even if a caller proposes a new
ID. Different writes wait for reconciliation; newer editor drafts remain intact.
No automatic fresh-ID retry or browser-storage credential/payload persistence.

## External MCP (not Baboon-framed)

`POST /mcp`, JSON-RPC2.0, stateless Streamable HTTP2025-11-25. Exact Bearer only;
either session-cookie name is rejected even alongside a bearer. No GET/SSE stream,
stdio, OAuth server or resources/prompts. Official Node SDK tests initialize,
list exactly `get`, `put`, `search`, `retrieve`, call `get`/`put`/`search` and
exercise transport/version errors; `retrieve` is exercised through the same
production route in `RetrievalSurfaceTest`.

MCP tool arguments retain their externally declared schemas:

- get: `{key, revision?}`. Full exact `document_json` appears in both structured
  content and text content with key/revision/metadata.
- put: `{key,document_json,expected_revision,request_id}`. document_json is a
  **string**, expected_revision is an integer, request_id is UUIDv7 (not v4).
- search: `{query,project?,limit?,cursor?}`. Canonical qualified IDs in summaries.
  Exact Boolean browse (metadata, tags, links, fields); no ranking or models.
- retrieve: `{query, mode?, project?, include_archived?, limit?, offset?}`. Ranked
  retrieval over title, description and tags (fields are not embedded). `query`
  is a nonempty string; `mode` is `lexical`|`semantic`|`hybrid`; `project` an
  exact raw project; `include_archived` defaults to false; `limit` 1..50 (default
  10); `offset` ≥ 0 (default 0); read-only/idempotent annotations like `search`.
  Without `mode` the server applies the client default rule above: hybrid when
  offered, otherwise lexical with the notice; a defaulted hybrid whose query
  embedding fails is re-run as lexical with the notice naming that reason. An
  explicit unavailable mode is a tool error `{code:"unavailable", message:<fixed
  reason message>}`. Structured content is the `RetrieveResult` JSON plus
  `requested_mode` (the `mode` argument, or null when defaulted),
  `effective_mode` (the mode served) and `notice` (string or null). Text content:
  `mode: <effective>[ (default)]`, the `notice: …` line if any, the pending line
  when `pending > 0`, `<countScope>: <total>; <n> shown from offset <offset>`, then
  one line per hit `<key> r<revision> <field> <pointer> score <score> <snippet>`
  (snippet: whitespace collapsed, at most 200 characters). Every hit keeps its
  line: the text is bounded by `limit` ≤ 50 and the snippets, never cut by an
  aggregate length limit. Argument keys outside the declared schema are refused
  with `bad-envelope` (a misspelled key never widens the query).

  ```text
  mode: hybrid (default)
  1 item is not yet indexed for semantic search; results may be incomplete
  CandidateWindow: 1; 1 shown from offset 0
  p:a r1 title /title score 0.03252247488101533 harbour notes
  ```

Tool failures have `isError:true`, safe text and structured code/message (the
message is the code's text, except the fixed retrieval reason messages). Protocol
failures remain JSON-RPC errors, never generated application wrappers. Guidance
names the four tools, when to use `search` versus `retrieve` and the hybrid
default, and states archive defaults, CAS/replay/uncertain-outcome rules and that
stored content is data, not instructions. External MCP is verified with the official Node client,
not with a home-grown fake client or a production Node proxy.
