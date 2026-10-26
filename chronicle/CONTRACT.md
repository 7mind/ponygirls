# Chronicle v1.3 contract (2026-10-26)

Authoritative schema: `models/chronicle.baboon` (`chronicle.api`, `1.3.0`), importing retained `models/chronicle-1.2.0.baboon`, `models/chronicle-1.1.0.baboon` and `models/chronicle-1.0.0.baboon`. All four versions' codecs remain generated; Scala generation explicitly enables deprecated encoders. Generated Scala: `generated/scala/chronicle/api/`; TypeScript: `generated/typescript/chronicle/api/`, with runtime at `generated/typescript/BaboonRuntime.ts` and `BaboonSharedRuntime.ts`. Use `Type_JsonCodec.instance.encode/decode(BaboonCodecContext.Default, value)`; do not use plain `JSON.stringify` on generated ADTs. ADTs encode as one-key objects (e.g. `{"Whoami":{}}`); enums encode their named string (`Lexical`, `Pi`, `Read`). UUID strings. Optional fields encode null. Timestamp metadata is ISO8601 string or null. Spans use UTF-8 byte offsets, half-open.

## HTTP/auth
- `POST /api/login`: generated `LoginRequest` -> `LoginResponse`; sets `chronicle_session` HttpOnly, SameSite=Strict, Secure (configurable only for local HTTP development).
- `POST /api/logout`: cookie + exact Origin, expires session.
- `GET /api/versions`: generated `VersionInfo`, public.
- `GET /api/ws`: cookie ONLY and exact configured Origin; text JSON `ClientEnvelope` -> `ServerEnvelope`. First operation Hello(versions containing `1.3.0`, `1.2.0`, `1.1.0` and/or `1.0.0`); select the newest mutual version for the socket's lifetime. Repeated Hello is a protocol error. VersionInfo reports current `1.3.0`, minimum `1.0.0`, supported `[1.3.0,1.2.0,1.1.0,1.0.0]`. No browser HTTP version header is required. Per-request cookie/session/live-user authorization. Ping/Pong nonce heartbeat; server Ping uses a fresh envelope requestId, answer Pong with SAME requestId and nonce. 20s heartbeat / 10s pong deadline. Client Ping -> Result.Pong. Hello/Ping/Pong are consumed independently of serialized application work; its per-socket queue is bounded32 and saturation returns unavailable. Queued operations reauthenticate at execution. No mutation replay on reconnect.
- `POST /api/ingest`: bearer ONLY, Ingest scope; generated `IngestRequest` -> `IngestReceipt`; errors JSON Failure and non-2xx.
- `POST /mcp`: bearer ONLY, Read scope (Raw additionally for raw, which is deliberately not an MCP tool). Stateless Streamable HTTP; JSON responses. Supported MCP versions 2025-11-25, 2025-06-18, 2025-03-26. GET returns 405; notifications return 202. Origin if present must match configured origin. No URL credentials anywhere.

## WS operations
`Hello`, `Ping`, `Pong`, `Whoami`; reads `Search(SearchQuery)`, `GetSession`, `GetChunks(offset,limit)` (Result.Chunks: chunks,total,offset), `GetMessages(offset,limit)`, `GetRaw`, `Related(limit)`, `Facets(filter)`, `IngestStatus(offset,limit)`; browser-only mutations `RetryJob`, `MintToken`, `RevokeToken`, `CreateGroup`, `Invite`, `AcceptInvite(confirmSharing=true)`, `RemoveMember`, `LeaveGroup`, `DeleteGroup`, `Purge`, `Logout`; management `ListTokens`, `ListGroups`, `Receipt(mutationId)`. Result ADT branches are defined in model. Every request has UUID requestId; mutating receipts bind requestId to operation payload, changed replay conflicts. Mint returns secret exactly once; receipt lookup/replay returns token metadata with null secret (revoke/remint after uncertain outcome). Scopes `Ingest`, `Read`, `Raw`; Raw requires Read. Groups grant direct nontransitive read-only sharing. Owner must delete group rather than leave. Missing/unauthorized IDs indistinguishable. Search modes never silently degrade. Offset >=0, limits 1..100, transcript message page <=100; all results bounded. Receipt is Result.Mutation; errors Result.Error(Failure(code,message)).

MCP tools: `search_sessions` (query,mode lexical|semantic|hybrid, project/gitBranch/after/before/tags, limit/offset), `get_session` (sessionId), `get_chunks` (sessionId,offset,limit), `get_messages` (sessionId,offset,limit), `related_sessions` (sessionId,limit), `list_facets` (same filters), `ingest_status` (offset,limit), `whoami` (no arguments). Outputs share application generated result codecs inside MCP text content.

## Ingestion
Source key = authenticated owner + collectorNamespace + discoveryRootId + format + producerSessionId + nullable subagentId; namespace persistent across collector restarts, discoveryRootId stable across root rescans. Owner is NEVER supplied. expectedRevision=0 for new source; CAS increments by one. requestId persists through retries; same payload same receipt, changed payload conflict. digest is SHA256 over UTF-8 file contents concatenated in files order (each file separately has sha256); files are relative logical paths, exact permitted JSONL UTF-8 bytes. Max defaults: 8MiB HTTP body, 16 files, 4MiB/file, 10000 messages. Messages preserve parent IDs, role and recordIndex referring to original JSONL record; display text follows the NUL projection below. Completion is Quiescent or Closed (not assistant-turn completion). Metadata missing fields null. No real source content in development tests. Upload acknowledgement means raw revision+durable job committed, not searchable yet. A newer archive head terminalizes unfinished older jobs as Failed/error `superseded-revision` and fences their workers; older Complete jobs/generations remain available to pinned views. RetryJob for a superseded revision or obsolete model profile returns conflict, never a receipt for work that cannot run. Current-head AND current target-profile eligibility are checked under profile→source→job locks.

### NUL display projection (all API ingesters)

Valid JSONL may encode U+0000 as `\u0000`. Raw file content, its SHA256, the source digest, and record provenance remain unchanged. Before archive persistence or any fragment/index derivation, each U+0000 in message text and human-readable metadata (title, project, gitRemote, gitBranch, gitCommit, producer, model, tags) becomes the literal six-character text `\u0000`. Tabs, newlines, other previously accepted Unicode controls and scalar Unicode remain unchanged. Transcript reads and all derived spans address these archived normalized UTF-8 message bytes, not decoded text from raw JSONL. Literal backslash escapes already in input are not changed; raw records are the fidelity source when these display representations coincide.

Source identity and receipt payload hashes bind the ORIGINAL request, before display projection. Retrying the same requestId and unchanged pending payload returns the exact receipt; changing original NUL text to a literal escape with the same requestId conflicts even when the display projection matches. No collector/spool rewrite, API version change, migration or reindex of previously accepted data is required.

U+0000 is unsupported in source/message/parent IDs, file paths, metadata workdir, digests, roles and timestamps and returns `invalid`/HTTP400 (existing format validations still apply). Unpaired UTF-16 surrogates in request strings are unsupported non-scalar Unicode and return `invalid` rather than reaching PostgreSQL. This does not reject other previously accepted controls in opaque IDs or POSIX paths.

## Server JSON config
`listenHost`, `listenPort`, `allowedOrigin`, `secureCookies`, `jdbcUrl`, `databaseUser`, `databasePasswordFile`, `users` (array `{id,login,passwordHashFile,enabled}`), `maxBodyBytes`, `maxFiles`, `maxFileBytes`, `maxMessages`, `sessionTtlSeconds`, `annotation` (`endpoint,model,revision,credentialFile,timeoutSeconds,maxResponseBytes`), `embedding` (same plus `dimensions,queryPrefix,documentPrefix,sendDimensions`). Keys are required except public-config `sendDimensions`, whose omission explicitly means false for existing config files. `dimensions` is the expected response/index dimension (1..4000); `sendDimensions` independently opts into the OpenAI request's optional dimensional truncation parameter. Native fixed-dimension endpoints commonly reject that parameter: use false, not a fabricated model revision. No HTTP400 retry or automatic model fallback occurs. New generated configs should always provide the flag. Password files contain PBKDF2-SHA256 string from password helper, DB/model credentials single-line files. Profile changes require explicit maintenance reindex. Build/run/maintenance details in README.

## Error/close vocabulary
`unauthorized`: revoked/expired browser session or disabled user (terminal WS4401); `version-mismatch`: unsupported Hello versions (terminal4406); `protocol-error`: malformed text/frame/handshake or unexpected Pong (terminal4400); `forbidden`: request-level missing scope/browser-only denial (NOT connection-terminal); `invalid`: fields/pages; `conflict`: payload-bound receipt or revision CAS; `not-found`: missing OR unauthorized entity; `unavailable`: model/profile failure, never lexical fallback; `gone`: purged source. Exact Origin is checked BEFORE upgrading; same-origin absent/expired cookie upgrades then receives typed unauthorized plus4401 so browsers can distinguish authentication failure from network failure. Hello deadline10s, server Ping every20s with10s matching-pong deadline. Missing either liveness deadline closes with1013 (Try Again Later), which permits bounded automatic replacement after a pause or transient network failure; it is not a terminal protocol or authentication verdict. Malformed frames/unexpected Pong remain4400, revoked/expired credentials4401, and unsupported versions4406. Cookie expiry/revocation checked each operation and heartbeat.

Endpoint keys are FULL operation URLs, e.g. `/v1/chat/completions` and `/v1/embeddings`. Explicit empty credential files omit Authorization for unauthenticated local endpoints. An absent/unreadable file fails; there is no ambient-secret fallback. `secureCookies=false` is permitted ONLY with loopback listenHost and loopback HTTP allowedOrigin.

Annotation external contract: user message content is a JSON string `{fragments:[{index,role,text,messageId}]}`. Byte offsets remain server-only: competing source bounds are omitted from the model envelope under profile token `prompt:v3:fragment-indices-only`; output indices never denote byte offsets. Indices reset per bounded window (4 fragments, each2048UTF8bytes; totaltext8192bytes). Response `choices[0].message.content` is JSON string `{chunks:[{first,last,summary,tags}]}`; first/last inclusive fragmentindices. Chunks must partition0..N-1 in order, exhaustively and without overlap/gaps; keys strict, no refs/foreign text. Reconstruct source text/spans server-side: insert LF between distinct message IDs in chunk projections, but concatenate contiguous fragments of the same message without insertion. Spans always address archived normalized per-message UTF8 bytes (including the NUL display projection), never offsets in the projected chunk text. This projection policy is included in the semantic profile identity and requires explicit maintenance reindex when changed. Summary<=1000chars, tags<=16strings each<=64chars; max_tokens2048. Empty messages are retained but have no eligible text span. Embedding inputs include configured prefixes, each<=16384UTF8bytes, batches<=16. Annotation semanticprofileidentity includes endpoint/model/revision,prompt/schema/window/limits; embedding identity includes endpoint/model/revision/dimensions/sendDimensions/prefixes/cosine. Credential locations/values and transport timeouts do NOT change model identity.

`GetChunks` / MCP `get_chunks` pages every published annotation in deterministic original source order, never UUID order. Read scope and live same-session ACL apply before limits. Count+rows use one REPEATABLE READ transaction and captured generation pointer; concurrent publication cannot mix generations within one page. GetSession retains its first100chunk compatibility response.

## Immutable content views (final v1 freeze)
`ContentView{revision:i32,generationId:UUID|null}` identifies immutable source content and optionally its immutable annotation generation. `SessionInfo.view` identifies the content supplying its metadata; `SessionInfo.revision` remains the current archive HEAD, and `indexedRevision` remains the current published source revision, so indexing lag stays explicit.

GetSession/GetChunks/GetMessages have an appended `view:ContentView|null` selector. Null is discovery: resolve current published view, or archive head without annotations if never published. Clients MUST retain the returned `SessionInfo.view`, `ChunksResult.view`, or `MessagesResult.view` and send that same view on all subsequent source/chunk pages. A non-null view with null generationId explicitly selects raw/normalized archive-only content for that revision, with no annotations. A generationId must belong to exactly that session and revision; mismatches and unauthorized historical views return not-found. Generations and revisions remain immutable and retained until owner purge. Reannotation of the same source creates a different generation pin.

GetRaw has `revision:i32|null`: null explicitly means latest archived HEAD (including failed/pending indexing), a positive revision pins historical bytes. RawResult files and revision are obtained in ONE repeatable-read transaction. To render a selected annotation's original bytes, use `GetRaw(revision=selectedView.revision)`, never resolve HEAD again.

MCP get_session/get_chunks/get_messages accept optional `revision` and `generationId` (generationId requires revision). Omit both to discover the published view; retain and resend both returned fields for immutable annotated reads. A revision without generationId explicitly reads archive-only content. Other MCP tool arguments are unchanged.

## Indexed search and count scope (1.1)

`SearchResult{hits,total,countScope:SearchCountScope,rankingLimit:i32|null}` adds `SearchCountScope` (`ExactMatches` or `CandidateWindow`). Lexical search uses an indexable `document @@ websearch_to_tsquery` GIN predicate, exact authorized matching-session `total`, `ExactMatches`, and null rankingLimit; an empty query browses eligible published sessions.

Semantic search obtains at most1000 authorized, filtered chunk candidates through HNSW. Hybrid unions that ANN leg with at most1000 independently authorized lexical candidates, then applies RRF(k=60). Both modes exactly rerank retained candidates using their original full-precision PostgreSQL vector cosine distances; candidate discovery remains approximate. `total` is the exact number of distinct sessions in that candidate window, NOT the global eligible-session/match count. `countScope=CandidateWindow` and `rankingLimit=1000` (semantic) or2000 (hybrid) expose this boundary. rankingLimit bounds chunk candidates before session deduplication, not the number of hits or an assurance that the window fills. Offset must be smaller than rankingLimit; otherwise `invalid`. Pages still return at most100 sessions and offsets beyond the actual candidate-session total return empty. Search pages are not a frozen search snapshot across requests; live ACL/publication changes may change membership/order. Facets remain exact distinct-session counts over their authorized filtered published corpus, not the ANN window.

Live ACLs, owner/reader enabled state, profile identity, published-generation equality and all structured filters apply before EACH candidate LIMIT. pgvector strict iterative scanning continues beyond rejected tuples (ef_search200, max_scan_tuples200000, scan_mem_multiplier4); the resource budget and approximate graph may still underfill selective queries. There is no unbounded application postfilter of a global topK, no unauthorized count contribution and no silent exact fallback. Full vectors remain `vector`; HNSW uses normalized `halfvec(dimensions)` expression indexing, including2048-dimensional models. Literal dimension and partial-index predicates match even under generic prepared plans.

The explicit negotiated1.0 compatibility path retains the old exact full-corpus ranking/count/pagination semantics and encodes only the old SearchResult fields with the1.0 codec. It is not the1.1 ANN path and does not claim ANN performance. MCP always returns the current1.1 result shape, including scope metadata. Ingest/raw/content-view schemas are unchanged.

Structured tag filters apply AND across requested tags, with each tag allowed in the union of published-source metadata tags and ANY chunk's generated work tags for that same session/generation. Facets use the same published revision and live ACL; tag counts are DISTINCT sessions, not chunk occurrences. Pending mutable-head metadata never labels an older published search generation.

## Ingestion/provenance evolution (1.2, preparatory contract)

- Persisted `TokenInfo` and `TokenResult` are unchanged. Only 1.2 token lists use `ListedToken{info:TokenInfo,source:TokenSource}` (`Issued` / `StaticConfig`). Older list responses project `.info`. Existing issued tokens are wrapped as `Issued`; static credential configuration/enforcement is a later backend implementation.
- `JobInfo` appends required `completedWindows:i32` and `totalWindows:opt[i32]`. Old-to-new conversions use 0/null for unknown progress. Old responses omit these fields. Database reads currently return unknown progress; worker persistence is a later backend implementation.
- `CollectorProgressUpdate` and `CollectorProgressAck` are root wire types. `CollectorCounters` includes all twelve discovery/upload counters plus `scannedBytes:i64`; phase is Discovering/Scanning/Uploading/Idle/Failed. Sequence and byte counts are i64 **decimal strings on JSON**, bigint in TypeScript / Long in Scala. `uploadedBytes` denotes ACKNOWLEDGED payload bytes only.
- `Operation.CollectionStatus{}` / `Result.CollectionStatus{result:CollectorStatusResult}` carry owner-filtered `CollectorStatus{report,receivedAt,stale}` snapshots. These types are published now; the browser/Read handler, Ingest-only POST endpoint, 64KiB bound, owner limit100, durable monotonic sequence, and >120s staleness computation are deliberately deferred to the backend feature implementation. No placeholder healthy/empty response is supplied.

### Regeneration and negotiation

Run `BABOON=<pinned 0.0.198 executable> scripts/generate.sh`. The executable hash is checked. All model signatures are frozen in `models/lock.json`; enforcement protects legacy versions. `scripts/protocol-conversions.py` runs after generation:

1. It registers every generated Scala forward converter in the 1.0→1.1→1.2 chain; the three custom conversions live in `server/src/main/scala/chronicle/ApiConversions.scala`.
2. Pinned Baboon has no reverse-generation flag. The helper mirrors its structural **response-only** Scala converters, with explicit lossy projections for search count metadata, job progress, and token wrappers. Output is `server/src/main/scala/chronicle/protocol/DerivedConversions.scala`. No JSON field rewrite/codec cast substitutes for typed evolution.
3. The TypeScript emitter inlines throws for unsupported nested conversions. The helper wires exactly the three known stubs and three call sites to `protocol/typescript/conversions.ts`; semantic implementations remain outside the wiped generated directories. Unknown output fails generation/compilation rather than silently falling back.

Web/current acceptance clients offer 1.2.0. Retained 1.0/1.1 clients use their generated codecs for the whole socket lifetime. The full PostgreSQL suite exercises both retained Hello/Ping/token mint/list/receipt/revoke/status/search flows, including nonempty job status and exact legacy pagination. `ProtocolEvolutionTest` and web `evolution.test.ts` cover typed upgrades/downgrades and exact i64 wire values. `scripts/test-codecs.sh` checks four Scala/TypeScript shared fixtures including collector progress.


## Archive and Activity (1.3)

The complete additive wire fields, expression grammar, candidate-domain policy,
paging and pinning contract are in
[`docs/drafts/20261026-1106-archive-contract.md`](docs/drafts/20261026-1106-archive-contract.md).
New operations are Archive(ArchiveQuery), Activity(ActivityQuery),
ActivityJobs(ActivityJobsQuery), LocateMessage(sessionId,view,messageId); locator
responds with Result.LocatedMessage(MessageLocation). Every previous operation,
retained socket version and existing MCP tool remains available unchanged.

Archive is all authorized live raw HEADs, not the published-only Search corpus.
Empty/metadata-only browsing never requires annotation, embeddings or an available
semantic profile. Default mode is Hybrid; default UI sort is LastTimestamp Desc.
Text membership is exact normalized HEAD literal matching in Lexical, bounded
published ANN membership in Semantic, and the UNBOUNDED exact lexical union with
bounded ANN in Hybrid. annChunkLimitPerOperand=1000 bounds chunks before session
deduplication, not Archive rows. NOT excludes the retrieved set, not a proof of
semantic unrelatedness. Mode directives must be outer conjuncts; operators,
field names and mode values are case-insensitive. Literal text and metadata
strings use deterministic Unicode lowercase matching, except opaque owner IDs.

ArchiveRow.head.view is archive-only HEAD; publishedView and matchedView are
separate immutable pins. A representative matchedView does not prove that every
Boolean term matches the same revision. Both dialog panes must retain the same
selected pin, with an explicit latest-HEAD switch. LocateMessage resolves a
message's position within that required pin without scanning previous pages.

Activity is owner-only. Current HEAD/target-profile jobs and all historical jobs
are counted separately. Running state is not an active lease: active, expired and
unleased Running counts remain distinct. retryable is Current AND Failed, while
the legacy RetryJob fencing behavior is unchanged. Absent collector reports are
unknown; freshness refers to actual report receipt, not a socket connection.
All summary totals are i64 decimal strings on JSON / bigint in TypeScript.

Migration006 adds normalized per-revision info, message and bounded literal
projections plus generation tags. Backfill uses committed batches of4 revisions,
streamed message reads and transactional projection writes, without loading raw
files into JVM listing paths or calling models. Source normalization, annotation
policy and semantic profile identities are unchanged. pg_trgm1.6 is bundled in
the pinned PostgreSQL18.6 and can be installed by a non-superuser database owner.
Whole fields/messages are lowercased in PostgreSQL before fragmentation; original
normalized content and spans are unchanged. A lexical-version marker rebuilds
obsolete fragments transactionally. Content paging has no100000 offset ceiling;
GetMessages seeks by indexed position. The trigram index is on
lower(value COLLATE pg_unicode_fast), not raw ILIKE: the
observed raw-index Unicode false-negative constraint and differential tests are
documented in
[`docs/drafts/20261026-1140-lexical-index-collation.md`](docs/drafts/20261026-1140-lexical-index-collation.md).
