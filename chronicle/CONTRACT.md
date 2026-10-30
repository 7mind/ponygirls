# Chronicle v1.9 contract (2026-10-30)

Authoritative schema: `models/chronicle.baboon` (`chronicle.api`, `1.9.0`), the sole self-contained API model. Only this version's Scala and TypeScript codecs are generated; no historical schemas or cross-version converters are retained. Generated Scala: `generated/scala/chronicle/api/`; TypeScript: `generated/typescript/chronicle/api/`, with runtime at `generated/typescript/BaboonRuntime.ts` and `BaboonSharedRuntime.ts`. Use `Type_JsonCodec.instance.encode/decode(BaboonCodecContext.Default, value)`; do not use plain `JSON.stringify` on generated ADTs. ADTs encode as one-key objects (e.g. `{"Whoami":{}}`); enums encode their named string (`Lexical`, `Pi`, `Read`). UUID strings. Optional fields encode null. Timestamp metadata is ISO8601 string or null. Spans use UTF-8 byte offsets, half-open.

## HTTP/auth
- `POST /api/login`: generated `LoginRequest` -> `LoginResponse`; sets `chronicle_session` HttpOnly, SameSite=Strict, Secure (configurable only for local HTTP development).
- `POST /api/logout`: cookie + exact Origin, expires session.
- `POST /api/session/refresh`: cookie ONLY + exact Origin, no URL parameters; renews an existing unexpired session for an enabled user, returns generated `UserInfo`, and resets the same HttpOnly/SameSite=Strict/configured-Secure cookie. `X-Chronicle-Session-Ttl-Seconds` reports the configured positive lifetime; `Cache-Control: no-store`. Cookie Max-Age and server expiry use the same lifetime (default 30 days). Renewal cannot recreate an expired, logged-out or revoked session. Extending a still-live session for the same credential and principal preserves captured MCP authority; expiry reductions, credential/principal changes and revival of an already-expired row still advance the authorization epoch. Fresh authentication and natural-expiry checks are unchanged. After a successful renewal, the visible dashboard schedules the next renewal at half the configured lifetime, capped at one day; hidden dashboards do not keep renewing. Renewal errors are visible and require explicit retry or a fresh verified connection, not a password unless authentication was actually rejected.
- `GET /api/versions`: generated `VersionInfo`, public.
- `GET /api/ws`: cookie ONLY and exact configured Origin; text JSON `ClientEnvelope` -> `ServerEnvelope`. First operation Hello(versions containing `1.9.0`); only that version is accepted for the socket's lifetime. Removed and future-only offers return `version-mismatch` without a compatibility fallback. Repeated Hello is a protocol error. VersionInfo reports current `1.9.0`, minimum `1.9.0`, supported `[1.9.0]`. No browser HTTP version header is required. Per-request cookie/session/live-user authorization. Ping/Pong nonce heartbeat; server Ping uses a fresh envelope requestId, answer Pong with SAME requestId and nonce. 20s heartbeat / 10s pong deadline. Client Ping -> Result.Pong. Hello/Ping/Pong are consumed independently of serialized application work; its per-socket queue is bounded32 and saturation returns unavailable. Queued operations reauthenticate at execution. No mutation replay on reconnect.
- `POST /api/ingest`: bearer ONLY, Ingest scope; generated `IngestRequest` -> `IngestReceipt`; errors JSON Failure and non-2xx.
- `POST /mcp`: bearer ONLY, Read scope (Raw additionally for raw, which is deliberately not an MCP tool). Stateless Streamable HTTP; JSON responses. Supported MCP versions 2025-11-25, 2025-06-18, 2025-03-26. GET returns 405; notifications return 202. Origin if present must match configured origin. No URL credentials anywhere.

## WS operations
`Hello`, `Ping`, `Pong`, `Whoami`; reads `Search(SearchQuery)`, `GetSession`, `GetChunks(offset,limit)` (Result.Chunks: chunks,total,offset), `GetMessages(offset,limit)`, `GetRaw`, `Related(limit)`, `Facets(filter)`, `IngestStatus(offset,limit)`; browser-only mutations `RetryJob`, `MintToken`, `RevokeToken`, `CreateGroup`, `Invite`, `AcceptInvite(confirmSharing=true)`, `RemoveMember`, `LeaveGroup`, `DeleteGroup`, `Purge`, `Logout`; management `ListTokens`, `ListGroups`, `Receipt(mutationId)`. Result ADT branches are defined in model. Every request has UUID requestId; mutating receipts bind requestId to operation payload, changed replay conflicts. Mint returns secret exactly once; receipt lookup/replay returns token metadata with null secret (revoke/remint after uncertain outcome). Scopes `Ingest`, `Read`, `Raw`; Raw requires Read. Groups grant direct nontransitive read-only sharing. Owner must delete group rather than leave. Missing/unauthorized IDs indistinguishable. Search modes never silently degrade. Offset >=0, limits 1..100, transcript message page <=100; all results bounded. Receipt is Result.Mutation; errors Result.Error(Failure(code,message)).

MCP tools: `search_sessions` (query,mode lexical|semantic|hybrid, project/gitBranch/after/before/tags, limit/offset), `get_session` (sessionId), `get_chunks` (sessionId,offset,limit), `get_messages` (sessionId,offset,limit), `read_message_context` (sessionId,view,anchor,beforeBytes,afterBytes), `related_sessions` (sessionId,limit), `list_facets` (same filters), `search_tags` (required query; same filters; limit/afterTag), `ingest_status` (offset,limit), `whoami` (no arguments). Outputs share application generated result codecs inside MCP text content. `search_tags` reuses `Result.Facets` with only `tags` populated; its empty `projects` and `branches` arrays are intentional, not evidence those values are absent. The tag catalog itself requires no additional browser operation or model version.

## Ingestion
Source key = authenticated owner + collectorNamespace + discoveryRootId + format + producerSessionId + nullable subagentId; namespace persistent across collector restarts, discoveryRootId stable across root rescans. Owner is NEVER supplied. expectedRevision=0 for new source; CAS increments by one. requestId persists through retries; same payload same receipt, changed payload conflict. digest is SHA256 over UTF-8 file contents concatenated in files order (each file separately has sha256); files are relative logical paths, exact permitted JSONL UTF-8 bytes. Max defaults: 8MiB HTTP body, 16 files, 4MiB/file, 10000 messages. Messages preserve parent IDs, role and recordIndex referring to original JSONL record; display text follows the NUL projection below. Completion is Quiescent or Closed (not assistant-turn completion). Metadata missing fields null. No real source content in development tests. Upload acknowledgement means raw revision+durable job committed, not searchable yet. A newer archive head terminalizes unfinished older jobs as Failed/error `superseded-revision` and fences their workers; older Complete jobs/generations remain available to pinned views. RetryJob for a superseded revision or obsolete model profile returns conflict, never a receipt for work that cannot run. Current-head AND current target-profile eligibility are checked under owner/target→source→job locks. A retained target that is not executable by this deployment rejects NEW ingestion and retry with `unavailable` before mutation; it is never silently queued under the new model's identity. A freshly authorized, payload-bound committed ingest receipt remains observable without an executable target. Collectors retain/retry pending uploads until a fresh confirmed owner rebuild establishes the current target. Startup preserves existing targets (including opaque targets inherited from pre-owner-target archives); only genuinely new configured owners seed current.

### NUL display projection (all API ingesters)

Valid JSONL may encode U+0000 as `\u0000`. Raw file content, its SHA256, the source digest, and record provenance remain unchanged. Before archive persistence or any fragment/index derivation, each U+0000 in message text and human-readable metadata (title, project, gitRemote, gitBranch, gitCommit, producer, model, tags) becomes the literal six-character text `\u0000`. Tabs, newlines, other previously accepted Unicode controls and scalar Unicode remain unchanged. Transcript reads and all derived spans address these archived normalized UTF-8 message bytes, not decoded text from raw JSONL. Literal backslash escapes already in input are not changed; raw records are the fidelity source when these display representations coincide.

Source identity and receipt payload hashes bind the ORIGINAL request, before display projection. Retrying the same requestId and unchanged pending payload returns the exact receipt; changing original NUL text to a literal escape with the same requestId conflicts even when the display projection matches. No collector/spool rewrite, API version change, migration or reindex of previously accepted data is required.

U+0000 is unsupported in source/message/parent IDs, file paths, metadata workdir, digests, roles and timestamps and returns `invalid`/HTTP400 (existing format validations still apply). Unpaired UTF-16 surrogates in request strings are unsupported non-scalar Unicode and return `invalid` rather than reaching PostgreSQL. This does not reject other previously accepted controls in opaque IDs or POSIX paths.

## Server JSON config
`listenHost`, `listenPort`, `allowedOrigin`, `secureCookies`, `jdbcUrl`, `databaseUser`, `databasePasswordFile`, `users` (array `{id,login,passwordHashFile,enabled}`), `maxBodyBytes`, `maxFiles`, `maxFileBytes`, `maxMessages`, `sessionTtlSeconds`, `annotation` (`endpoint,model,revision,credentialFile,timeoutSeconds,maxResponseBytes`), `embedding` (same plus `dimensions,queryPrefix,documentPrefix,sendDimensions`). Keys are required except public-config `sendDimensions`, whose omission explicitly means false for existing config files. `dimensions` is the expected response/index dimension (1..4000); `sendDimensions` independently opts into the OpenAI request's optional dimensional truncation parameter. Native fixed-dimension endpoints commonly reject that parameter: use false, not a fabricated model revision. No HTTP400 retry or automatic model fallback occurs. New generated configs should always provide the flag. Password files contain PBKDF2-SHA256 string from password helper, DB/model credentials single-line files. Index execution uses only the configured current context-aware policy; there is no retained annotation-model registry or Legacy/P1 executor. Existing targets require a fresh confirmed owner rebuild, not automatic startup retargeting or a global maintenance switch.

## Error/close vocabulary
`unauthorized`: revoked/expired browser session or disabled user (terminal WS4401); `version-mismatch`: unsupported Hello versions (terminal4406); `protocol-error`: malformed text/frame/handshake or unexpected Pong (terminal4400); `forbidden`: request-level missing scope/browser-only denial (NOT connection-terminal); `invalid`: fields/pages; `conflict`: payload-bound receipt or revision CAS; `not-found`: missing OR unauthorized entity; `unavailable`: model/profile failure, never lexical fallback; `gone`: purged source; `indexed-view-retired`: an authorized exact generation pin whose derived payload was retired by an accepted explicit rebuild (nonterminal; never redirected). Exact Origin is checked BEFORE upgrading; same-origin absent/expired cookie upgrades then receives typed unauthorized plus4401 so browsers can distinguish authentication failure from network failure. Hello deadline10s, server Ping every20s with10s matching-pong deadline. Missing either liveness deadline closes with1013 (Try Again Later), which permits bounded automatic replacement after a pause or transient network failure; it is not a terminal protocol or authentication verdict. Malformed frames/unexpected Pong remain4400, revoked/expired credentials4401, and unsupported versions4406. Cookie expiry/revocation checked each operation and heartbeat. Authentication-store failures are availability failures (retryable WS1013), not evidence of expired credentials; only an actual unauthorized verdict closes with4401. Temporary reconnects clear protected views while checking the existing cookie rather than presenting them as a rejected login. A request-level Whoami failure offers an explicit session retry without requiring credentials.

Endpoint keys are FULL operation URLs, e.g. `/v1/chat/completions` and `/v1/embeddings`. Explicit empty credential files omit Authorization for unauthenticated local endpoints. An absent/unreadable file fails; there is no ambient-secret fallback. `secureCookies=false` is permitted ONLY with loopback listenHost and loopback HTTP allowedOrigin.

## Current indexing and durable accepted work (1.7)

Only `ContextAwareProblemsV1` is executable. Historical profile/format metadata remains readable without historical annotation executors. The maximum-reasoning request policy retains `max_tokens=65536`, maximum reasoning and a 900-second operation deadline; exact truncation alone permits five local annotation attempts.

The annotator explicitly partitions every nonempty normalized source scalar into `Problem` or `Context` using canonical half-open fragment/Unicode-scalar coordinates. Windows contain at most64 fragments of at most2048 UTF8 bytes. Substantive domain facts, decisions, parameters, ownership, outcomes and rejected factual alternatives are Problem material even without an explicit question or imperative; Context is non-task runtime/bootstrap/heartbeat/tool-inventory material. Context has exactly kind/start/end: no invented summary, tags, problem ID or vector. Only real Problem slices become exact-source retrieval pieces; pieces never join distinct messages or bridge omitted Context. Context advances the original cursor without closing an open problem, and continuation may refer to a problem opened earlier in the same window. System/developer/subagent role or bootstrap-looking prefixes are not blanket exclusion rules. Empty/context-only sessions can publish a complete, zero-problem generation without embedding calls.

Carry contains only bounded existing-problem information: original/updated summaries, tags and at most4096 source bytes/16 fragments. **No Context text is buffered across windows.** Thus antecedents solely in an earlier Context window are not supplied as semantic carry; this is an explicit bounded-quality limit, not deletion of archived source. Every normalized message byte and original position remains available to revision-only reads and selected-history Find. Publication validates the exact once-only Problem-piece/Context coverage union.

A job run UUID persists across automatic reclaim and Failed retry; deliberate Complete recompute or confirmed owner rebuild rotates it. Validated annotation decisions and each accepted exact-source embedding batch are durably committed before later work. Keys bind run, profile, logical immutable revision identity, algorithm, exact input and bounded carry. Opaque JSON TEXT preserves scientific numeric lexemes and negative zero. No accepted output is silently replaced or treated as a cache miss on corruption/input mismatch. Every get/put and final publication rechecks owner, target/profile/epoch, source, job/run/fence and lease; stale authority is denial. The logical revision binding survives logical backup/restore, unlike physical xmin; normal snapshot/identity UPDATE is prohibited. Claim-local immutable snapshot bindings avoid full-source serialization on each checkpoint. No global mutable source cache is used.

There is no exactly-once provider-call claim across response/commit crashes: only committed accepted work is reusable. `JobInfo.failureStage` is required-present nullable Annotation/Embedding/Publication; unknown historical stages remain null. Failed retry retains the prior error/stage; supersession or lease exhaustion replaces it with an unknown stage, and completion clears it.

## Explicit fixed-current owner rebuild (1.7)

`PreviewOwnerReindex` and confirmed `ApplyOwnerReindex` bind an exact owner selection hash, current destination and request receipt. They force replacement of ALL selected live HEADs, including already-current and Running work: `alreadyCurrent=0`, replacements/queued equal selected heads. Each accepted intent rotates target epoch and runs; stale previews conflict. There is no unsafe global maintenance CLI, implicit boot retarget or old-model fallback.

`GetReindexStatus(requestId)` returns targetProfile and a finite captured cohort: total, complete, superseded, failed, pending are i64 values, exclusive and summing to total. Future HEADs never enlarge it; purge/job deletion cannot shrink it. Recorded exact-member completion survives later revisions and run rotation.

Old publication/search stays intact until validated atomic replacement and final live-lease acceptance. Then all obsolete derived generations for that selected source are retired; raw data, normalized revisions, receipts and job IDs are not deleted by rebuild. Retirement consent is ONE-SHOT per captured source/target epoch/profile, separate from exact revision/job/run completion: a validated superseding revision may fulfill retirement while its captured member remains Superseded. Later ordinary publications preserve the new current-policy history unless another explicit rebuild is accepted. Publication rollback also rolls back completion/retirement markers and all derived changes.

Retired full-generation pins first reauthorize, then return exactly `indexed-view-retired`, never redirect to HEAD. Revision-only views, Find and raw revisions remain available. Historical index-profile formats and persisted content remain readable under the current API; removing old wire codecs does not remove historical data.

`GetChunks` / MCP `get_chunks` pages every published annotation in deterministic original source order, never UUID order. Read scope and live same-session ACL apply before limits. Count+rows use one REPEATABLE READ transaction and captured generation pointer; concurrent publication cannot mix generations within one page. GetSession retains its first100chunk compatibility response.

## Immutable content views (final v1 freeze)
`ContentView{revision:i32,generationId:UUID|null}` identifies immutable source content and optionally its immutable annotation generation. `SessionInfo.view` identifies the content supplying its metadata; `SessionInfo.revision` remains the current archive HEAD, and `indexedRevision` remains the current published source revision, so indexing lag stays explicit.

GetSession/GetChunks/GetMessages have an appended `view:ContentView|null` selector. Null is discovery: resolve current published view, or archive head without annotations if never published. Clients MUST retain the returned `SessionInfo.view`, `ChunksResult.view`, or `MessagesResult.view` and send that same view on all subsequent source/chunk pages. A non-null view with null generationId explicitly selects raw/normalized archive-only content for that revision, with no annotations. A generationId must belong to exactly that session and revision; mismatches and unauthorized historical views return not-found. Revisions remain immutable and retained until owner purge. Generation identities remain retained, but an accepted explicit rebuild may retire obsolete derived payloads; full retired pins return `indexed-view-retired` after fresh authorization. Ordinary later publications do not retire historical generation payloads. Reannotation of the same source creates a different generation pin.

GetRaw has `revision:i32|null`: null explicitly means latest archived HEAD (including failed/pending indexing), a positive revision pins historical bytes. RawResult files and revision are obtained in ONE repeatable-read transaction. To render a selected annotation's original bytes, use `GetRaw(revision=selectedView.revision)`, never resolve HEAD again.

MCP get_session/get_chunks/get_messages accept optional `revision` and `generationId` (generationId requires revision). Omit both to discover the published view; retain and resend both returned fields for immutable annotated reads. A revision without generationId explicitly reads archive-only content. Other MCP tool arguments are unchanged.

## Indexed search and count scope (1.1)

`SearchResult{hits,total,countScope:SearchCountScope,rankingLimit:i32|null}` adds `SearchCountScope` (`ExactMatches` or `CandidateWindow`). Lexical search uses an indexable `document @@ websearch_to_tsquery` GIN predicate, exact authorized matching-session `total`, `ExactMatches`, and null rankingLimit; an empty query browses eligible published sessions.

Semantic search obtains at most1000 authorized, filtered chunk candidates through HNSW. Hybrid unions that ANN leg with at most1000 independently authorized lexical candidates, then applies RRF(k=60). Both modes exactly rerank retained candidates using their original full-precision PostgreSQL vector cosine distances; candidate discovery remains approximate. `total` is the exact number of distinct sessions in that candidate window, NOT the global eligible-session/match count. `countScope=CandidateWindow` and `rankingLimit=1000` (semantic) or2000 (hybrid) expose this boundary. rankingLimit bounds chunk candidates before session deduplication, not the number of hits or an assurance that the window fills. Offset must be smaller than rankingLimit; otherwise `invalid`. Pages still return at most100 sessions and offsets beyond the actual candidate-session total return empty. Search pages are not a frozen search snapshot across requests; live ACL/publication changes may change membership/order. Facets remain exact distinct-session counts over their authorized filtered published corpus, not the ANN window.

Current Hybrid recomputes lexical and full-vector ranks over the candidate union, then selects each session's best fused chunk. A candidate receives lexical RRF credit only when its document satisfies the full `@@ websearch_to_tsquery('english', query)` predicate; a positive cover-density score alone is insufficient. Nonmatching ANN candidates remain eligible for the vector term, but receive zero lexical score before lexical rank assignment. In particular, lexical exclusions are not hard semantic filters.

Live ACLs, owner/reader enabled state, profile identity, published-generation equality and all structured filters apply before EACH candidate LIMIT. pgvector strict iterative scanning continues beyond rejected tuples (ef_search200, max_scan_tuples200000, scan_mem_multiplier4); the resource budget and approximate graph may still underfill selective queries. There is no unbounded application postfilter of a global topK, no unauthorized count contribution and no silent exact fallback. Full vectors remain `vector`; HNSW uses normalized `halfvec(dimensions)` expression indexing, including2048-dimensional models. Literal dimension and partial-index predicates match even under generic prepared plans.

There is no API-version-based exact search path or compatibility fallback. MCP and the dashboard use the same current result shape, including scope metadata. The exact search oracle retained for diagnostics is not a negotiated API.

Structured tag filters apply AND across requested tags, with each tag allowed in the union of published-source metadata tags and ANY chunk's generated work tags for that same session/generation. Facets use the same published revision and live ACL; tag counts are DISTINCT sessions, not chunk occurrences. Pending mutable-head metadata never labels an older published search generation.

`search_tags` searches tag names, not conversation contents. Required `query` is a literal substring; `""` browses all matching tags. Matching uses PostgreSQL `lower(... COLLATE pg_unicode_fast)` on both operands: case-insensitive Unicode-lower matching, not fuzzy search, wildcard/Boolean syntax, normalization, accent removal or full Unicode case folding (`ß` is not `ss`). Whitespace, `%`, `_`, quotes and backslashes remain literal. Exact case-distinct tag values remain separate entries and counts.

Pages contain 1..100 maximum requested entries (`limit`, default20), ordered by the exact tag value under `COLLATE "C"`, not by popularity. Continue with `afterTag` equal to the last returned `value`, exclusively; stop when `tags` is an empty array. An empty tag value is legal, so preserve `afterTag:""` rather than treating it as an absent position. Positions need not still exist and confer no authorization. Query length is at most2048 UTF-16 units; the copied position has no smaller tool-specific length cap than existing request budgets, so historical long tags are not stranded by an arbitrary query-length limit. Query and position require valid Unicode scalars without NUL.

Every page reevaluates current published revisions, structured filters and live authorization; unpublished heads, superseded generations and unauthorized sessions do not contribute. Shared source/generated tags count once per session, not per annotation. Returned counts retain the generated `Facet.count` signed-i32 contract; out-of-range counts fail explicitly rather than wrap. Read scope suffices; Raw/browser privileges and model/embedding readiness are not required. The in-dashboard model adapter uses the same parser and query with source-byte admission before selected payload decoding, bounded to the requested page; ordinary public MCP retains its existing request/response policy. Existing argument/read budgets can reject oversized requests or pages explicitly—no truncation or silent omission. The row bound does not bound aggregate SQL work. Pages are live, not snapshot-pinned: complete enumeration assumes a stable authorized dataset; concurrent inserts before a position may be missed and counts or visibility may change.

Example: `tools/call` with `{"name":"search_tags","arguments":{"query":"postgres","limit":20,"project":"ponygirls"}}` returns generated `Facets.result.tags` entries such as `{"value":"PostgreSQL","count":3}`. Nonempty returned values of at most128 UTF-16 units can be used unchanged in `search_sessions.tags`; that existing filter still rejects empty or longer historical values even though the catalog exposes them. Pass the last value, without truncation, as `afterTag` with the same query/filters to continue. `list_facets` remains the separate top100/popularity tool.

## Ingestion and provenance

- Persisted `TokenInfo` and `TokenResult` are unchanged. Token lists use `ListedToken{info:TokenInfo,source:TokenSource}` (`Issued` / `StaticConfig`). Existing issued tokens are wrapped as `Issued`; static credential configuration/enforcement is a later backend implementation.
- `JobInfo` appends required `completedWindows:i32` and `totalWindows:opt[i32]`. Unknown progress is represented as 0/null. Database reads currently return unknown progress; worker persistence is a later backend implementation.
- `CollectorProgressUpdate` and `CollectorProgressAck` are root wire types. `CollectorCounters` includes all twelve discovery/upload counters plus `scannedBytes:i64`; phase is Discovering/Scanning/Uploading/Idle/Failed. Sequence and byte counts are i64 **decimal strings on JSON**, bigint in TypeScript / Long in Scala. `uploadedBytes` denotes ACKNOWLEDGED payload bytes only.
- `Operation.CollectionStatus{}` / `Result.CollectionStatus{result:CollectorStatusResult}` carry owner-filtered `CollectorStatus{report,receivedAt,stale}` snapshots. These types are published now; the browser/Read handler, Ingest-only POST endpoint, 64KiB bound, owner limit100, durable monotonic sequence, and >120s staleness computation are deliberately deferred to the backend feature implementation. No placeholder healthy/empty response is supplied.

### Regeneration and negotiation

Run `BABOON=<pinned 0.0.198 executable> scripts/generate.sh`. The executable hash is checked. `models/chronicle.baboon` contains every current type directly, with no version imports; `models/lock.json` locks only1.9.0. Both output trees are emitted entirely by the pinned compiler, without handwritten codec edits or post-generation conversion/whitespace rewriting. Edit this single schema in place for this owned deployment rather than adding historical API versions.

VersionInfo and browser/native workflow Hello offers use the generated current version. The dashboard and server accept only1.9.0; old/future versions are rejected explicitly. Domain↔API mappings remain separate from codecs. PostgreSQL workflow coverage exercises current Hello/Ping/token mint/list/receipt/revoke/status/search, Archive/Activity, passages/spans and MCP controls. `ProtocolEvolutionTest` and `ApiVersionCompatibilityTest` check sole-version negotiation and removed/future-version rejection. `scripts/test-codecs.sh` exercises current Scala/TypeScript golden payloads, exact i64 values, required flags and bounded context. Recorded historical wire fixtures remain immutable even when their old shapes are no longer accepted.

MCP tester responses are bounded against the sole current envelope/DTO shape. Its call/round ceilings derive from the256-event trace capacity (at least call+result events and a final response):127calls/128rounds, not a token/cost budget. Whole-run900seconds, context/source/result/trace byte limits, fresh authorization and cancellation still apply; multipart items may reach the trace limit sooner.


## Archive and Activity (1.3)

New operations are Archive(ArchiveQuery), Activity(ActivityQuery),
ActivityJobs(ActivityJobsQuery), LocateMessage(sessionId,view,messageId); locator
responds with Result.LocatedMessage(MessageLocation). All current operations and existing MCP tools remain available.

Archive is all authorized live raw HEADs, not the published-only Search corpus.
Empty/metadata-only browsing never requires annotation, embeddings or an available
semantic profile. Default mode is Hybrid; initial browsing sort is LastTimestamp Desc.
The explicit relevance preference is described below.
Text membership is exact normalized HEAD literal matching in Lexical, bounded
published ANN membership in Semantic, and the UNBOUNDED exact lexical union with
bounded ANN in Hybrid. annChunkLimitPerOperand=1000 bounds chunks before session
deduplication, not Archive rows. NOT excludes the retrieved set, not a proof of
semantic unrelatedness. Mode directives must be outer conjuncts; operators,
field names and mode values are case-insensitive. Literal text and metadata
strings use deterministic Unicode lowercase matching, except opaque owner IDs.

### Relevance preference and live ordering (1.8)

`ArchiveQuery` appends required `preferRelevance:bit`; `ArchiveResult` appends
required `relevanceOrdered:bit`. The server applies relevance only when the
preference is true and the parsed expression has at least one distinct positive
text operand under even NOT parity. Otherwise it applies the requested existing
`sort`/`direction`; this is an explicit preference contract, not a model fallback.
The result reports which ordering was applied. Empty, metadata-only, mode-only
and negative-only queries retain column ordering. Negative-only Semantic/Hybrid
membership still requires the same embeddings as before.

The dashboard initially requests this preference, retaining LastTimestamp Desc
as its browsing tuple. A deliberate column sort disables the preference and
remains sticky across text/mode edits, refresh and same-owner reconnect. The
explicit relevance action reenables it without losing the remembered column
order; clearing text or submitting metadata restores that tuple. Ordering intent
is account-scoped tab memory, not persistent browser storage. Consumers must
validate the returned Boolean: the pinned generated TypeScript primitive casts
alone do not reject an absent or incorrectly typed field.

Boolean membership, HEAD substring fragments, published ANN candidate sets,
authorization and `matchedView` provenance are unchanged. For every distinct
positive text operand, Lexical/Hybrid literal membership contributes `1/61`.
Semantic/Hybrid contributes `1/(60+rank)`, where SQL `rank()` orders sessions by
their nearest original full-vector cosine distance among that operand's same
bounded ANN candidates. Chunks are deduplicated into sessions before ranking;
equal distances share a rank. Sum contributions as PostgreSQL numeric, then order
by score descending, last message time descending with nulls last, and UUID
ascending. Negative operands contribute nothing; rows admitted only through
metadata/negative branches remain with score zero. Literal HEAD membership stays
unbounded, including stale or unindexed heads beyond the ANN chunk limit.

Literal evidence is binary, not a graded full-text score. Lexical AND matches
can all tie and therefore retain recency order; OR can reward matching more
operands. Semantic noise is ordered, not removed. RRF scores are not confidence
and have no acceptance threshold. Dashboard HEAD substring/per-operand retrieval
remains distinct from MCP's published-passage websearch/RRF algorithm.

Column ordering retains version2 opaque cursors. Relevance uses version3 with
exact numeric score text and nullable timestamp, binding the exact expression,
reader, requested column tuple and UUID. Mixed ordering versions and malformed
numeric positions fail before embedding calls. Counts retain their existing
retrieved-set scope. These are live keysets, not search snapshots: publication,
ACL, ANN or query-vector changes can shift ranks and cause duplicates or omissions
between pages; client deduplication does not guarantee complete enumeration.

Both relevance flags are required in the current wire format; missing flags do not receive compatibility defaults. All column enums, limits, model failures and query language remain unchanged. No migration, embedding/profile change or reindex is required.

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
lower(value COLLATE pg_unicode_fast), not raw ILIKE, due to an observed
raw-index Unicode false-negative constraint.

## Published generation format (1.5)

`ArchiveRow` appends `publishedFormat:opt[PassageFormat]`, read from the same
stored generation as its authorized `publishedView` in the Archive snapshot.
`LegacyAnnotations`, `ContiguousProblems` and (since1.7) `ContextAwareProblems` describe actual stored output,
not the current target policy. Null remains unknown, including a known legacy
profile with missing provenance; no publication also has no published format.
HEAD metadata/source format, stale revisions, profile hashes and Complete/Failed
job states cannot substitute for this value. An explicitly legacy publication
remains legacy while a replacement is Queued, Running or Failed.

Historical wire fixtures remain frozen. No migration, re-ingestion, owner retargeting or generation rewrite is implicit in the single-API consolidation.
The warning uses joined row metadata, not per-row content or passage requests.

## Agent expression predicate
Archive expressions and Activity job expressions accept `agent:main` and `agent:subagent` (field and values case-insensitive). They are ordinary metadata atoms supporting AND, OR, NOT and the existing candidate-filter policy; `producer`, `model` and `format` keep their existing meanings. Main means `SourceIdentity.subagentId` is absent or null; subagent means it is present. No title, producer/model label, filename, producer session ID or raw `parentSession` link affects classification. Archive evaluates the current HEAD identity; Activity evaluates the job's own revision identity, including historical jobs. Activity collector expressions do not accept `agent`. Expression hints expose the fixed `main`/`subagent` vocabulary for Archive and Activity jobs, independent of corpus contents. This is recorded-source classification, not cryptographic identity or proof of legacy lineage: a legacy source with no recorded subagent ID is main operationally, even if its true lineage is unknown. Missing provenance is never inferred or backfilled.

## Recorded yolo profile attribute

Archive and Activity job expressions accept `yolo-profile:<name>` as an ordinary metadata atom. The field name is case-insensitive; values match case-sensitively and exactly (`Foo` differs from `foo`). The attribute is derived only from the displayed revision's `SourceIdentity.discoveryRootId`: an exact `yolo:` prefix followed by a nonempty `[A-Za-z0-9._-]+` name other than `.` or `..`. Native/default, missing and unrecognized root claims have no value, so their positive atoms are false and negation uses ordinary Boolean semantics. Titles, tags, paths and transcript prose are never profile signals. Archive uses authorized live HEADs; Activity uses each owner's job revision, including historical jobs. Activity collectors do not accept this field. Hints use the same authorized revision universes; suggestion prefix matching retains the existing case-insensitive behavior without changing exact predicate matching. Activity `profile:` remains the annotation/index policy hash.

This is a **recorded source-root claim**, not proof of auto-discovery, original launch profile or host identity. Explicit collector roots and authenticated ingestion clients can supply such IDs; copied sessions retain their bytes under a different storage root. The dashboard labels it “Recorded yolo profile”. Existing archives expose it without rewriting tags, payloads, raw digests, source keys, revisions or receipts. No wire schema/API change, re-ingestion or backfill is involved. This display/filter helper is not a collector upload-admission policy.

MCP `search_sessions` retains its existing structured filters and PostgreSQL websearch query contract, not the Archive expression DSL: `yolo-profile:` is not an MCP filter or an added structured argument. `get_session` exposes the recorded `source.discoveryRootId` for inspection. Selected-history message Find still searches only normalized message text, not this attribute.

## Selected-history message find (1.6)

`SearchSessionMessages(sessionId:UUID, view:ContentView, literal:str, cursor:str|null, limit:i32)` requires Read scope and an explicit immutable view. `Result.SessionMessageSearch` wraps `SessionMessageSearchResult{view:ContentView,hits:MessageSearchHit[],nextCursor:str|null}`; each hit is `{messageId:str,position:i32}`. No snippet, message body, exact total, regex or model request is returned or performed. Use existing `LocateMessage` and `GetMessages` with the same pin for navigation. No new MCP tool is registered.

The server matches all archived normalized `message.text` values in exactly the selected session/revision, including unindexed revisions. It does not search raw records, annotations, metadata, Archive fragments, loaded pages or current HEAD. The complete selected view (including optional generation) is validated and echoed, although text is revision-scoped. `ContentView(revision,None)` never follows HEAD. Owner/reader enabled state, current direct sharing and non-tombstoned source authorization are checked together with view validation in each page's repeatable-read transaction; cursors grant no access.

Matching uses PostgreSQL `strpos(lower(message.text COLLATE pg_unicode_fast),lower(literal COLLATE pg_unicode_fast))>0`: case-insensitive literal matching with database-collation semantics, not universal Unicode casefold. Percent, underscore and backslash are literal characters. Unicode, emoji, tabs and other accepted controls are preserved; a literal U+0000 query uses the same `\\u0000` display projection as archived text. One locator per matching message is returned in stable normalized source-position order, using position keyset pagination with limit+1 lookahead after matching.

Named bounds in `SessionMessageSearchPolicy`: nonempty scalar query <=2048 UTF-8 bytes, cursor <=4096 UTF-8 bytes, limit 1..100, selected locator JSON <=64KiB including lookahead. The database measures the limited locator selection and charges it before fetching/decoding IDs, even for unrestricted browser reads; an admitted caller's source budget is also charged. Budget excess fails explicitly with `read-budget`, never silent truncation. Each database statement has a five-second deadline (or a stricter existing deadline), including authorization, lock waits and preflight; cancellation fails with `deadline`, never no-matches or partial success.

Opaque base64url JSON cursors bind reader, session, full view, matching policy, exact query digest and last position, and are HMAC authenticated by the stable archive reader instance. Mismatch/tampering is invalid. Restart/replacement of that instance invalidates outstanding cursors; restart the find from its first page. No cursor authenticates a reader or overrides fresh authorization. APIs1.0–1.5 remain frozen, available and unchanged.


## Byte-bounded message context (1.9)

`Operation.ReadMessageContext{sessionId,view,anchor,beforeBytes,afterBytes}` returns
`Result.MessageContext{result:MessageContextResult}`. `MessageContextResult` carries
`sessionId`, the exact `view`, a resolved `anchor:PassageSourceSpan`,
`excerpts:ContextExcerpt[]`, and nullable `previous`/`next:Span`.
Each excerpt is `{source:PassageSourceSpan,role:str,text:str}`; source carries
`messageId`, `messagePosition`, `start`, `end`. There is no whole-message or raw
payload, parent ID, timestamp, snapshot, or synthesized text separator.

MCP `read_message_context` requires exactly these five arguments:

```json
{"sessionId":"00000000-0000-4000-8000-000000000001","view":{"revision":1,"generationId":null},"anchor":{"messageId":"m0","start":0,"end":12},"beforeBytes":2048,"afterBytes":2048}
```

Copy `session.id`, the complete `session.view`, and one `chunk.spans` entry from
a search hit. The existing search/session/chunk/span shapes are unchanged; a
multi-span chunk permits independent navigation from each span. Unlike older
MCP content tools, this tool requires a nested `view` with both fields present
(`generationId` may be null). Unknown/missing fields are invalid. Read scope is
sufficient; browser/Raw scope, indexing work and model requests are not needed.

Offsets address archived normalized UTF-8 bytes, half-open, on Unicode-scalar
boundaries: `0 <= start <= end <= message UTF-8 length`. A zero-width anchor is
valid, including at a message boundary. The anchor is included in full and may
not exceed2048bytes (`read-budget`); it is never silently clipped. Each required
side budget is zero (direction disabled) or4..2048bytes. Positive budgets admit
any Unicode scalar, not necessarily a grapheme cluster. Expand first within the
anchor message, then into at most four adjacent messages per side. Stop at the
first scalar that does not fit remaining bytes; do not skip it. Encountered
empty messages count toward the adjacency cap. Omit a nonempty neighbor when
no scalar fits; keep continuation at the preceding returned boundary. The
anchor itself is always retained, including when zero-width. Return at most nine excerpts in
source order, with the anchor message merged once and original roles/boundaries
preserved. Every excerpt's UTF-8 bytes equal exactly its source slice; no text
separators are injected.

`previous`/`next` are zero-width spans at the outer returned boundaries, nonnull
iff bytes or messages remain in that direction. Continue with that anchor and
the exact same session/view, setting the other direction to zero. At a message
start/end, navigation proceeds into the neighbor. Empty sequences advance by
position. Boundary metadata can repeat, but continuation never repeats text.

`PostgresArchive` delegates to its private `PostgresContextReader`, with one
REPEATABLE READ source transaction, fresh same-session ACL/pin validation and a
five-second per-statement deadline (preserving stricter configured deadlines).
Direct numeric message location, byte lengths and scalar-boundary projections
are bounded; only bounded exact-source excerpt text is selected. Complete
selected JSON framing/metadata is measured and admitted before text transfer to
the JVM. The endpoint always applies a cumulative64KiB source cap, including
numeric source projections and excerpt framing, even with an unrestricted
caller; admitted callers additionally consume their own cumulative budget.
Generated serialized `Result.MessageContext` and the complete MCP tool-content
wrapper (including its additional JSON string escaping) are each capped at128KiB. These are
conservative initial resource limits, not measured semantic sufficiency.
PostgreSQL may inspect/decompress full stored text internally: this bounds
application transfer, not database CPU independently of source size.

Public HTTP supplies explicit fresh bearer authentication before and after this
new read and compares the captured global security epoch. Browser API1.9 uses
fresh `currentBrowser` and the same epoch policy. Live MCP tester calls retain
fresh captured-run authority through `ReadAccess.blocking`. The old two-argument
MCP handler cannot invoke context without explicit fresh authority; the nine
older tools retain their former behavior. Source ACL/pin validity is checked
in the source transaction's snapshot; credential/epoch checks are delivery
checks, not a second source snapshot. Global epoch changes can conservatively
deny an unrelated context read. No final check can prevent revocation occurring
after that check or retract a previously delivered result.

Malformed ranges, scalar cuts and side budgets return `invalid`; absent,
unauthorized or purged source/message/view returns `not-found`; an authorized
retired generation returns `indexed-view-retired`; source/caller/result limits
return `read-budget`; SQL cancellation returns `deadline`. The one-shot MCP
runner retains named `deadline` and `indexed-view-retired` failure codes with
a generic sanitized message and no automatic retry. Ordinary append or
republication preserves old full pins; foreign session/revision generations
never fall back to HEAD. APIs1.0–1.8 signatures/codecs remain frozen, and reject
the new operation/result branch explicitly rather than fabricating compatibility.
