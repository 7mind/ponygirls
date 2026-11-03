# Haystack — sole current API (Scala port)

Authoritative model: [`models/current.baboon`](../models/current.baboon),
`haystack.api` **1.0.0**. Pinned Baboon0.0.198 generates Scala2.13 and TypeScript;
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
| `POST /api/v1/login` | `LoginRequest` → `LoginResult(identity,versions)` + session cookie |
| `POST /api/v1/logout` | empty object → `Ack` + expired cookie |
| `GET /api/v1/whoami` | none → `Identity(userId,userType,tokenId,activityProjectId)` |
| `POST /api/v1/get` | `GetRequest(key,revision?)` → `Item` |
| `POST /api/v1/put` | `PutRequest` → `PutResult` |
| `POST /api/v1/search` | `SearchRequest` → `SearchResult(items,cursor?)` |
| `POST /api/v1/history` | `HistoryRequest(key)` → `HistoryResult(revisions)` |
| `POST /api/v1/query/analyze` | `QueryRequest(query,caret)` → `AnalyzeResult(valid,spans)` |
| `POST /api/v1/complete` | `QueryRequest` → `CompletionResult(suggestions)` |
| `POST /api/v1/values` | `ValuesRequest(field)` → `ValuesResult(values)` |
| `POST /api/v1/retrieve` | `RetrieveRequest` → `RetrieveResult` |
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
limit. Unconfigured means lexical-only; semantic/hybrid is typed unavailable,
never hidden fallback. Configured outages do not couple writes/browse to models.
Approved metadata/string leaves only; operator pointer approvals and chunk bounds
participate in policy identity. Results carry actual source revision, generation,
profile/embedding-space (optional for lexical HEAD), policy, field/pointer/UTF16
provenance, text and score; totals declare ExactMatches or CandidateWindow and
rankingLimit. No mutable hydration relabels an older published hit. Profile/policy
incompatibility is unavailable until deliberate rebuild/publication.

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
list/call exactly `get`, `put`, `search` and exercise transport/version errors.

MCP tool arguments retain their externally declared schemas:

- get: `{key, revision?}`. Full exact `document_json` appears in both structured
  content and text content with key/revision/metadata.
- put: `{key,document_json,expected_revision,request_id}`. document_json is a
  **string**, expected_revision is an integer, request_id is UUIDv7 (not v4).
- search: `{query,project?,limit?,cursor?}`. Canonical qualified IDs in summaries.

Tool failures have `isError:true`, safe text and structured code/message. Protocol
failures remain JSON-RPC errors, never generated application wrappers. Guidance
states archive defaults, CAS/replay/uncertain-outcome rules and that stored content
is data, not instructions. External MCP is verified with the official Node client,
not with a home-grown fake client or a production Node proxy.
