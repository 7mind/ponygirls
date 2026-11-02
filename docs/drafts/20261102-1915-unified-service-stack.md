# Unified service stack and reusable hybrid search — migration plan

Status: proposed implementation plan; no service code or deployment changed.

Source baseline: Ponygirls `eb106af47948a1041412f959cee11f81231c055a`, inspected 2026-11-02. Repository configuration describes intended wiring, not verified running services. Codegraph exploration was unavailable (daemon PID-namespace ownership refusal); this plan uses direct source inspection and three read-only research reviews.

## 1. Scope and decisions

Requested direction: port the **Haystack and Manure backends** to Chronicle's Scala, distage, http4s, PostgreSQL JDBC and Baboon stack; extract reusable components; wire independent services through Nix and one PostgreSQL cluster per selected host. All three services can accept an embedding endpoint and expose lexical, semantic and hybrid retrieval.

Working assumptions for implementation planning:

- Keep three independent server processes, databases, credentials, public URLs and authorization models. Share code and infrastructure, not one application or a cross-service search corpus.
- Keep existing web clients, the Manure Python CLI/client/stdio MCP bridge, and deployed HTTP/MCP contracts working. Backend port does not imply rewriting all clients.
- Reuse Chronicle's source-pinned dependency set initially; do not combine this migration with Scala/library upgrades. Its current implementation uses cats-effect `IO`, not a new BIO/ZIO runtime.
- Preserve behavior first; add hybrid retrieval separately. No implicit model calls in legacy searches, writes, catalogue browsing or artifact serving.
- No rollout, private-data export to models, credential rotation or deletion of old state is authorized by this planning document. Exact host sizing, deployment inventory and maintenance windows are preflight work.

### Current source facts

| Service | Backend and storage | Constraints relevant to the port |
|---|---|---|
| Chronicle | Scala 3.9.0, distage 1.2.25, http4s 0.23.38, JDBC 42.7.14, Baboon 0.0.198; PostgreSQL 18 + pgvector | Generated Scala compiles as a separate Scala 2.13.18 module. There are **two different hybrid retrieval contracts**, not one interchangeable engine. |
| Haystack | TypeScript/Node, Express, official MCP SDK, `pg`; PostgreSQL | Existing schema/history/replay records can remain. Lossless document text and historical operation digests must survive byte-for-byte where their contracts require it. |
| Manure | Python >=3.12, stdlib HTTP/MCP; SQLite + filesystem | SQLite metadata moves to PostgreSQL, but payload files remain files. Upload/publish/recovery, grants, expiry, URLs and resume semantics must survive. |

The generic Home Manager `agentic-services-server.nix` owns a Haystack-only plain PostgreSQL cluster using Unix peer authentication. `chronicle-server.nix` owns a separate PostgreSQL+pgvector cluster on loopback TCP/SCRAM (default port 15433). NixOS service modules already compose with `services.postgresql`, but that does not consolidate the separate HM clusters. Paddock also contains source-local hosting modules; changing Ponygirls alone does not update those consumers.

## 2. Target architecture and build

```text
Haystack HTTP/MCP/WS  -> Haystack application + repositories --+
Manure HTTP/bytes    -> Manure application + repositories ----+-> shared JVM libraries
Chronicle HTTP/MCP/WS-> Chronicle application + repositories -+   (below)
                                                                 |
                 +-----------------------------------------------+
                 | service-runtime | retrieval-core | retrieval-postgres |
                 | model-http      | generated Baboon runtime/contracts  |
                 +------------------------------------------------------+
                         |               |                     |
                    JDBC per DB      http4s client        service-owned policies
                         |               |
             one PostgreSQL cluster     selected embedding endpoint(s)
             [haystack][manure][chronicle]
```

Proposed layout: a repository-root sbt multi-project build with `shared/` libraries and existing service directories as project bases. Library names below are provisional, not new products or remote services. Preserve current command entrypoints through small build-script wrappers; no duplicate dependency universes.

| Module | Owns | Must not absorb |
|---|---|---|
| `service-runtime` | Typed database configuration, scoped JDBC transactions/migration coordination, finite admission/deadlines, lifecycle-managed resources, safe diagnostics | Service tables, users/scopes, cookie policy, arbitrary CRUD framework |
| `model-http` | Bounded http4s embedding adapter, explicit credentials, request/response validation, embedding-space identity, admission/telemetry | Chronicle's Problem/Context annotation prompts or automatic endpoint/model failover |
| `retrieval-core` | Typed document/chunk/generation/profile identities, candidate/result scope, deterministic fusion/deduplication policy interfaces | Session-specific DTOs, query grammars, permission decisions, arbitrary SQL supplied by callers |
| `retrieval-postgres` | Versioned library-owned projection tables/migrations, vector validation/indexing, authorized candidate retrieval and publication primitives | One global database, global user namespace, post-limit ACL filtering |
| Service modules | Domain projection, repositories, durable indexing jobs, live visibility, HTTP/MCP adapters, API models | Copies of the shared embedding and retrieval implementations |

Do not extract every utility at once. Start with the narrow seams used by Chronicle and the Haystack port; generalize only when the second real adapter exercises them. Leases/checkpoints/publication can become shared primitives, while each service retains its source-of-truth transaction and job eligibility rules.

Build details to settle in the foundation slice:

- Keep generated contracts in per-domain modules (`chronicle.api`, `haystack.api`, `manure.api`), with the current source-defined Scala 2.13 generated-code boundary and Scala 3 application code. Share one compatible Baboon runtime when contract modules meet; generated `baboon.runtime.shared` classes must not be silently selected by assembly `MergeStrategy.first`. Prove the supported generation/module arrangement before adding more domains.
- Use ordinary sbt project dependencies first. Nix builds the locked dependency closure and per-service artifacts; publishing a Maven library is unnecessary for in-repository consumers.
- Rework Squish lock generation/offline assembly for the common build, retaining file-only/offline compilation, pinned compiler/codegen and native toolchain. Review the regenerated dependency lock; do not regenerate in a working source tree with destructive upstream scripts.
- Preserve per-service source filtering and validation identities. A shared-library change invalidates its consumers; a Manure UI change must not unnecessarily rebuild Chronicle's native executable. A broad common build source may create an initial cache cost: measure and narrow it explicitly rather than claim free reuse.
- Produce independent server packages/entrypoints and launchers, with managed JDBC/HTTP/worker resources, blocking JDBC work off http4s compute threads, bounded concurrency and statement/lock/connection deadlines. A bounded JDBC pool is a possible implementation, not an assumption about Chronicle today (it currently uses `DriverManager` per transaction).
- Keep native deployment as a checked artifact, not a JVM fallback. JVM tests are the fast development path; native HTTP/WS/JDBC/TLS/filesystem behavior needs its own acceptance leg.

## 3. Baboon and compatibility boundary

Baboon defines each service's typed application commands/results and any new first-party wire API. Existing REST/MCP/byte transports are adapters to those commands, not an excuse to change deployed encodings.

- Keep Haystack `/api/v1` and MCP `get/put/search` shapes, faults, cookies and raw `document_json` string seam. Represent arbitrary JSON as a validated lossless payload type, not `f64`, a string-keyed catch-all DTO, or a narrowed `fields` object. Duplicate-key rejection, number lexemes, exact numeric comparison, Unicode and document bounds require explicit tests outside generated primitive codecs.
- Keep Manure REST JSON field names, numeric representations, status codes, headers, content paths and binary upload/download streams. Baboon `i64` JSON decimal strings cannot silently replace existing numeric byte counts. Keep the Python client and MCP bridge speaking the established API.
- Add a generated first-party API only with an explicit version route/negotiation and supported-version policy. Update owned TS clients deliberately; keep compatibility adapters until deployed consumers are migrated and removal is approved.
- Chronicle currently deliberately supports only its sole API model. Preserve that project-specific policy, not a generic instruction to resurrect old codecs. Legacy Haystack/Manure compatibility and new Baboon version evolution are separate decisions.
- Wire conversion does not migrate SQL or filesystem state. Record database versions, projection-policy versions and API versions independently. Regenerate with the pinned compiler; no handwritten generated-code patches.

Before declaring any divergence intentional, characterize existing executable behavior alongside normative docs. Stage 0 produces an explicit register: **documented promise → source observation → executable characterization → approved target behavior → compatibility treatment**. Source-only discrepancies are audit questions, not reproduced defects. Reproduce and adjudicate them rather than bundling speculative corrections into the port. Update/supersede implementation constraints in Manure's contract and Haystack's stack decisions alongside implementation; preserve agreed public contracts instead of leaving contradictory normative documents.

## 4. Reusable hybrid retrieval contract

An embedding endpoint is sufficient for vector retrieval infrastructure, **not** for deciding the corpus, access policy, chunking or freshness semantics. Annotation/summarization is optional service policy, not a prerequisite for Haystack/Manure hybrid search.

### 4.1 Preserve the two Chronicle paths

`Search.scala` implements published-passage PostgreSQL FTS + ANN, RRF and best-chunk-to-session grouping. `ArchiveIndex.scala` / `ArchiveSearch.scala` implement Boolean expression membership combining exact literal HEAD matches with bounded semantic published candidates, relevance ordering and source evidence. Their matching, counts, pagination and provenance differ.

Extract reusable embedding/vector/candidate/fusion/publication pieces, then retain two Chronicle adapters. Do not replace both with one FTS query or impose Chronicle's expression DSL on the other applications. Keep exact-search diagnostics outside ordinary API dispatch.

### 4.2 Shared invariants

- App-owned source IDs map to typed, namespaced index IDs; never assume every app ID is a UUID. Published results carry source version, index generation, policy and embedding-space identity. Hydration must not relabel old hits with current mutable metadata.
- Index jobs originate durably from the service's write transaction (outbox/job row), not an in-memory callback. The library must accept the same JDBC transaction for atomic projection/publication work. External model calls happen outside transactions; commit accepted work with source/profile/run/fence checks.
- Replace a complete source generation atomically; do not publish partial vector batches as a completed index. Retries reuse committed accepted batches. Failed/reclaimed/stale workers cannot publish over a newer source or target profile. Provider calls are not claimed exactly-once across response/commit crashes.
- Visibility and structured filters apply in SQL **before each candidate limit**, count, facet and evidence selection. Use a constrained trusted adapter/query-plan contract with bound values, not user-provided SQL predicates. Reauthorize at hydration/delivery as required by each application. Passing an allowed-ID list from a stale application cache is not equivalent.
- For the extracted Chronicle candidate algorithm, retain its source-observed initial policy: up to 1000 candidates per leg in semantic/hybrid mode, HNSW normalized `halfvec(dimensions)` discovery, exact original-vector cosine reranking, RRF k=60, deterministic ties and entity grouping. Its lexical-only path is not subject to that candidate-window cap. These are named policies to measure, not universal constants for every corpus. Selective ACLs/filters can underfill ANN results despite correct pre-limit authorization: measure authorized candidate yield and recall against an exact diagnostic reference. Preserve current finite scan limits and no-silent-fallback behavior; changing those policies requires separate evidence.
- Validate configured dimensions (current supported index domain 1..4000), finite/nonzero vectors, response cardinality/order and provider limits. Dimension/request options, model/revision, prefixes and normalization participate in profile identity. Same vector dimension or endpoint URL alone does not establish compatible embeddings.
- Preserve observable exact-versus-candidate-window count scope, ranking bounds and indexing lag. Candidate counts are not global totals; facets and legacy listings retain their own exact contracts. Scores are not confidence or semantic truth.
- Expose explicit lexical/semantic/hybrid modes. No configured endpoint means a declared lexical-only capability; requesting unavailable semantic/hybrid retrieval returns a typed error. An endpoint outage never silently changes mode or blocks ordinary authoritative reads/writes.
- A model/profile change requires an explicit rebuild/cutover policy. Keep old publication until replacement is validated; never mix vector spaces in a candidate leg. During rebuild, serve only a verified compatible published space or return explicit not-ready/unavailable, not an unlabelled partial result.
- Endpoint config includes full operation URL, model, immutable revision, dimensions, `sendDimensions`, document/query prefixes, normalization, runtime credential-file reference, finite deadline, response/body and batch bounds. No automatic retry with a different model, hidden dimension truncation or ambient credential fallback.

### 4.3 Per-service corpus and API proposals

| Service | Initial searchable material | Deliberate exclusions / compatibility |
|---|---|---|
| Chronicle | Existing current Problem/Context-derived published passages and literal archive projections | Preserve annotation policy, source spans, history pins, owner/group ACLs and both algorithms. No forced reindex just to move code. |
| Haystack | Current title, description, tags and string leaves of `fields`, with field/pointer provenance and segment boundaries | Exclude numeric/Boolean leaves and secrets by explicit projection policy; archived items remain excluded by default. Existing Boolean/pointer/link search and key/sort cursors stay unchanged. New relevance retrieval is additive. |
| Manure | Authorized ready/unexpired artifact metadata and manifest paths; explicitly approved text-file extraction can follow | Do not embed every binary, execute HTML/JS, dereference links or treat hosting permission as permission to send file contents to a model. Content indexing requires an explicit MIME/path/size/privacy policy. |

Propose a separate additive `search_content` operation/tool for Haystack and Manure, with free-text query, explicit mode, application-specific exact filters and a versioned relevance-page contract. Final public naming/schema is a contract-design deliverable, not an existing endpoint. Keep Haystack's current query DSL and Manure's catalogue substring search independent. No browser editor redesign is required for the backend port.

Manure search should initially require authenticated management access, consistent with its shared catalogue. Public/external visibility is permission to fetch a known artifact under current rules, **not** permission to enumerate it, expose private paths/snippets or index password-protected content anonymously. Passwords, token/grant hashes, credentials and upload-session secrets are never searchable or embedded. Expiry/deletion and incomplete-session ownership are enforced even while an index/sweeper lags.

An endpoint may be shared, but per-service admission alone cannot enforce a global GPU/provider capacity limit. Set per-service quotas whose sum fits capacity, or enforce admission at the model server. Retain per-service queue depth, lag, request/error and resource metrics so one bulk reindex cannot starve the others.

## 5. Haystack port: preserve the PostgreSQL domain

Prefer no physical data migration for the language port: reuse tables, migrations 0001–0003, metadata/activity namespace, immutable history and replay records. Cluster relocation is a separate operation.

Acceptance-critical invariants:

1. Canonical qualified IDs: exactly one separator, canonical percent escapes, decode once; preserve case/Unicode and raw project selectors.
2. Authoritative `document_text` remains lossless. Preserve arbitrary JSON leaves, lexical numbers such as `0.10`, `1e2` and `-0`, prototype-named keys, links/tags order and repetition; reject duplicate keys. Validate PostgreSQL JSONB projection limits against the admitted JSON domain instead of assuming JSONB can represent everything the text codec accepts.
3. Historical `haystack-op-v1` canonical digest bytes and replay identity `(userId, tokenId, requestId)` must agree with TypeScript, including JS key ordering/escaping. UUIDv7 validation, same-ID concurrency, stored terminal outcomes, CAS and uncertain-write replay remain intact. Do not recanonicalize history or ask clients to re-put documents.
4. A write atomically appends history, updates current/projections/links and persists replay outcome. Replayed/rejected writes do not emit committed-change notifications.
5. Preserve Boolean precedence, archive exclusion, strict RFC6901 pointer traversal, missing-versus-null, exact numeric comparisons, NFKC/lowercase tokenization, segment-bounded phrases and UTF-16 diagnostic positions. Pin normalization/Unicode behavior with cross-runtime vectors, not JDK defaults alone.
6. Preserve global browser sorting and query/scope/limit/sort-bound live cursors. PostgreSQL byte ordering is not JVM UTF-16 ordering. Cursor positions confer no access and are not snapshots.
7. Keep current human/agent authority, token-file validation, cookie/bearer ambiguity rules, exact Host/Origin/CSRF policy, MCP bearer-only behavior, no-store and sanitized logging. Do not replace it with Chronicle's owner/group/scoped-token model.
8. Keep process-local WS invalidations, heartbeat/revocation, reconnect/refetch, unsaved editor CAS and full lossless document transport. Preserve authoritative `activityProjectId` and pure GitHub artifact identity helpers, without introducing a new GitHub integration.

Adapt the existing browser harness: it currently imports TS server classes and seeds through `ItemService`, so merely rerunning it would not exercise the Scala executable. Make backend selection and public-API seeding explicit without weakening browser assertions. Retain the TS server as a temporary offline test oracle, not a hidden production dependency.

## 6. Manure port: PostgreSQL metadata, durable filesystem payloads

Manure is the higher-risk port. Build a filesystem capability spike before committing to the complete server rewrite: race-resistant descriptor-relative no-follow traversal, writes, rename/fsync, serving and deletion must work under the selected JDK and Graal native artifact. A normalized path plus `startsWith(root)` is insufficient. Evaluate JDK secure-directory APIs; if they cannot supply required primitives, specify and audit the smallest POSIX bridge rather than weaken containment or retain an accidental Python backend.

Manure's frozen contract currently prescribes Python/SQLite and excludes content search. Amend those implementation/configuration constraints explicitly for this requested migration, while retaining its public compatibility/security guarantees. Decide whether Python server import APIs such as `create_server()` are supported external APIs or test-harness details; retaining the Python client is not the same as preserving every server import.

Keep upload/download streaming and memory/body bounds, HTTP range behavior, manifest path validation, credential/grant separation, one-time password disclosure and TTL enforcement. Inventory the complete tested REST/browser/client behavior, not only successful uploads. Parameterize tests that currently construct the Python server or inspect SQLite internals to exercise the replacement executable and appropriate adapter; do not simply drop them.

### Metadata and migration

- Map artifacts, chunk receipts, one-time grants and content grants explicitly to PostgreSQL. Carry raw IDs, hashes, owners, byte counts, original timestamp precision and upload states. Preserve `uploading`, `publishing` and `ready`, staging sidecars and live files; exporting only published rows loses resumability/recovery.
- Preserve transactionally serialized quota reservation and per-artifact operation ordering. SQLite's one-instance lock/`BEGIN IMMEDIATE` cannot simply disappear: express required quota/receipt/publish/sweep locks and isolation in PostgreSQL, with concurrency tests and a declared lock order.
- Filesystem and PostgreSQL do not share a transaction. Preserve the durable publishing state machine, rename/fsync sequence, chunk-ack ordering, and reconciliation for every crash window. Never ACK bytes before the durability boundary or serve partial trees. Initially support one server process over the payload root, retaining an exclusive physical-root ownership claim and root-identity checks; a shared database is not authorization for multi-process/multi-host file-store concurrency.
- Preserve external password hashes and token/password-bound grants, including original expiry; never recover plaintext secrets. Keep runtime operator/client credentials, browser cookie codecs and hash algorithms stable unless a separately approved security change requires otherwise.
- URLs are derived from origin/suffix/content mode, not just persisted IDs. Preserve origin/alias/port/path/subdomain configuration and global chunk size during in-flight migration. Keep both path-mode's explicit trusted-content limitation and subdomain isolation protections; a new backend does not make path mode isolated.
- Keep legacy CLI/MCP list ordering and cursor format. Catalogue mode must retain Python Unicode **casefold** substring semantics, SQLite binary text order, typed keyset values, null expiry last in both directions and Python-compatible cursor fingerprint serialization. PostgreSQL `lower`/`ILIKE` and Java lowercase are not substitutes. Golden tests must cover astral/codepoint lengths, casefold expansion, timestamp precision and escaping.
- Audit actual source data for values PostgreSQL text cannot represent (notably NUL). Decide an explicit lossless representation or approved contract migration; do not silently drop, normalize or reject stored artifacts during import.

### Offline conversion and cutover rehearsal

Stop writes, sweeper and recovery work before taking the **matched** SQLite+WAL-consistent snapshot and staging/live/sidecar snapshot. Preserve protected credential/config references separately. The importer is a separately invoked, restart-safe command, with source identity/manifest, schema version and a completion marker; not an automatic service-start side effect.

Import into an isolated destination. Verify table/key/state counts, receipt coverage and offsets, reservation totals, grant bindings/expiry, filesystem manifest hashes and exact URLs. Reconcile the destination only after its complete data/metadata set is present. Rehearse interrupted upload resume, each publishing crash window, old external grants/password fetch, expiry, deletion and restart with the unchanged Python client/MCP bridge.

Before writable cutover, rollback means restarting the untouched old snapshot. **After new writes**, restarting old SQLite would lose acknowledged state; require a tested reverse conversion including new files/receipts or choose fix-forward. Record this boundary and any RPO explicitly; no automatic package rollback pretending data rolled back too.

## 7. One PostgreSQL cluster, explicit ownership and resource policy

Default proposal: one cluster **per co-located service host**, not a newly exposed central network database. Three databases and non-superuser service roles; application roles cannot connect to/read/write other databases. Model endpoints are a separate deployment concern. On HM a common Unix owner remains the trust boundary: database roles do not isolate processes that can read each other's credential files. Stronger OS-user isolation belongs to the NixOS/system-service deployment.

Introduce one generic PostgreSQL provisioning module/policy, with NixOS and HM lifecycle adapters. Service modules consume declared connection settings and request database/extension provisioning; none secretly creates a second cluster. Existing `manageLocal`/connection options need an explicit migration rather than silently adopting an unrelated data directory.

- Pin one PostgreSQL package/major and compatible pgvector; verify required `pg_trgm` and Unicode collation behavior. Keep extension installation privileged and scoped per database; app runtime does not need cluster superuser authority.
- Shared admin policy owns cluster settings, paths, socket/loopback binding, backup/WAL/upgrade policy and aggregate capacity. Revoke default `PUBLIC CONNECT` and unintended schema privileges, grant only the required database/schema access, review role memberships, and require negative cross-database connection/access tests. Database-scoped migrations own their schema; shared library migrations have a separate namespaced version ledger and per-database advisory lock.
- JDBC defaults to PostgreSQL loopback TCP/SCRAM, as Chronicle does, avoiding an unplanned Unix-socket JDBC dependency. Preserve API credentials; create/rotate database credentials only as part of the explicit connection migration. Bind only intended local interfaces; use exact HBA rules, not broad trust.
- Resource sizing requires observed RAM/CPU/storage, DB sizes, concurrent statements/workers and model-server memory use. Do not copy Chronicle SSD hints into a claim that tuning is complete.
- Budget `shared_buffers` once, `effective_cache_size` as a planner estimate rather than allocation, and `work_mem` per simultaneous sort/hash node and parallel worker. Budget autovacuum/maintenance/HNSW build memory, WAL/checkpoints, temporary files and disk headroom. Sum service connection/admission maxima with admin/maintenance reserve below `max_connections`; use per-role/database overrides for workload-specific statement/lock/idle-in-transaction timeouts and work memory.
- Retain `fsync`, full-page writes and synchronous durability policy; never trade acknowledged data for benchmark throughput. Configure planner/storage hints only from the selected host's measured storage behavior. Capture effective `pg_settings` and role/database overrides, not only Nix text.
- Shared cluster means shared restart/upgrade/WAL/disk/OOM failure domain. Monitor per-database latency/connections/temp IO/locks/dead tuples/size plus total WAL/checkpoints/disk. Bound bulk reindexing independently of serving traffic; test mixed workloads and selective-ACL ANN queries.
- Back up each full database (including receipts, auth, source truth, profile/jobs and search), global role/config information securely, and Manure's matched payload tree/sidecars. Derived search can be rebuilt where policy permits, but that is not a backup of authoritative state. Rehearse individual-service restore and whole-host recovery. Cross-database atomic snapshots are not required by this design because there are no cross-service data transactions.

Move existing Haystack and Chronicle clusters independently of backend replacements. Use rehearsed logical dump/restore into a separately named shared cluster, restore/assign each intended role's ownership and grants, verify extensions/migrations/auth, switch one consumer, then the other. Stop all writers/workers/collectors and other mutators for the final snapshot; any test writes happen in disposable rehearsal copies, not a destination whose production cutover comparison assumes no new writes. No in-place cross-major reuse or copying raw PG data directories between package sets. Preserve old clusters read-only until the rollback boundary is accepted.

### Nix wiring and downstream integration

- Export per-service packages and package factories using the selected package set; preserve current public factory/module entrypoints or migrate callers and their Ponygirls pin in the same downstream change.
- Update `nix/pkg/chronicle/{source,sbt-environment,server,native,toolchain}.nix`, corresponding Haystack/Manure packages, flake outputs/checks/dev shells and HM/NixOS module consumers together with source-layout changes.
- Preserve launch command/config translation, static UI paths, proxy buffering/body/deadline behavior, shutdown budgets, state directories, user ownership and runtime credential permissions. Haystack's current Node-specific static asset path must be deliberately changed at every proxy consumer.
- Update Paddock's `modules/hm/{agentic-services-server,chronicle-server}.nix` and relevant Home Manager tests/pin separately; use exported modules where feasible rather than growing another independent copy. Inventory direct Nix-config consumers too. Preserve `${state}/credentials` and existing operator secrets; no empty replacement tree after a module rename.
- Ensure one PostgreSQL unit per host, independent per-database provisioning/readiness/migration and service/backup dependencies. Disabling one application must not stop the shared cluster or delete another application's database. Application restart/package changes must not restart unrelated services; a cluster restart deliberately affects all clients and must be exercised.

## 8. Delivery sequence and acceptance gates

Each row is a reviewable milestone, not necessarily one commit. Work streams may run in parallel after the contract/foundation gates, with separate task worktrees. Deployment changes require their own explicit go-ahead.

| Stage | Deliverable | Required evidence before promotion |
|---|---|---|
| 0. Freeze | Protocol/data/state inventory; backend-selectable harnesses; deterministic cross-language golden vectors; adjudicated discrepancies | Existing backends pass the characterization corpus; source identities and exact commands recorded. Store inventory/restore prerequisites known before a production migration is scheduled. |
| 1. Foundation | Common sbt/toolchain/lock/source filtering, Baboon domain/runtime layout, minimal distage lifecycle/JDBC/http4s/model interfaces | Offline assembly; graph/wiring checks; codec regeneration/golden checks; unchanged Chronicle behavior and package entrypoints. No service port or reindex mixed in. |
| 2. Shared PG | HM/NixOS provider, three DBs/roles, per-role tuning, consumer connection mode, migration/backup tooling | Module checks prove one cluster, credential isolation and correct restart graph; mixed-load baseline plus failure/reconnect tests; independent DB restore rehearsals. |
| 3. Haystack parity | Lossless domain, JDBC repo/service, existing HTTP/MCP/WS adapters, package/UI wiring | Old fixture/replay/hash/cursor acceptance; dummy+PG contracts, real HTTP/official MCP-client/WS, complete browser and deploy/restart/privacy suites. No mandatory model dependency. |
| 4a. Manure feasibility | Descriptor-safe filesystem implementation and PG quota/upload/publication design | JVM **and native** no-follow/TOCTOU tests, fsync/rename/cleanup crash-window evidence, concurrent quota and receipt correctness. Stop the port here if containment/durability cannot be preserved. |
| 4b. Manure parity | Scala HTTP/storage/state machine, offline importer, unchanged Python client/MCP bridge and browser | Complete existing client/security/browser behavior against replacement executable; exact metadata+payload migration comparison, interrupted uploads/grants/URLs/expiry, corruption/interruption and rollback-boundary rehearsal. |
| 5. Search extraction | Shared embedding/profile/vector/candidate/publication modules, two unchanged Chronicle adapters | Baseline/candidate differential contracts on fixed corpus; ACL/revocation/limits/counts/pins/semantic failures; both native runtime and full Chronicle regression suites. No forced content-policy/model change. |
| 6. Hybrid adoption | Haystack/Manure projections/jobs, explicit config and additive API/UI affordances | Current-source fencing, idempotent job recovery, model outage/shape/deadline tests; authorized snippets/provenance; semantic held-out quality and mixed-load measurements, not just scripted vectors. |
| 7. Controlled rollout | Per-service promotion and downstream pin/module updates; old implementation retirement | Approved maintenance window, restorable backups, migration comparison and external-client smoke checks, monitored canary, explicit rollback/fix-forward boundary, verified post-cutover settings/identity. Remove old state only under separate approval. |

Dependency graph: 0 -> 1; 1 -> 2, 3, 4a, 5; 4a -> 4b; 3/4b/5 -> 6 for their respective adapters. Stage 7 is incremental: separate the **cluster move**, **language replacement** and **hybrid enablement** into distinct cutovers, even if their code is ready together. Prefer Haystack as the first backend replacement because it already uses PostgreSQL. Manure's feasibility spike can start alongside it.

### Test strategy

- Most behavior tests remain blackbox atomic/group tests. Repository and business-logic suites run the same scenarios with hand-written in-memory adapters and real PostgreSQL/filesystem adapters, selected through distage activation. Pure codec/parser/ranking vectors avoid a real provider.
- Keep exact transaction/lock/claim and filesystem crash/TOCTOU semantics in targeted controlled real-adapter tests; do not simulate a second database in the dummy. Full-verification runs fail if a required real adapter is skipped.
- Differential legacy-adapter tests use isolated deterministic fixtures. Record observable equivalence and any approved differences; do not require opaque secrets or nondeterministic timestamps to be literally equal across separately generated runs.
- Use controllable local embedding servers for protocol, ordering, malformed results, admission and cancellation tests. Live-provider trials use explicitly authorized versioned content, held-out tasks and negative controls. They measure relevance separately from correctness; model availability does not gate ordinary CI.
- Evaluate recall/ranking by source/entity on declared corpora, unauthorized-candidate exclusion, stale/delete/expiry behavior and indexing coverage. Compare lexical/semantic/hybrid rather than assuming hybrid improves every query. Measure p50/p95 latency, ingestion/index throughput, CPU/RAM/IO and serving impact under concurrent bulk indexing; select acceptance thresholds from a recorded baseline before implementation tuning.
- Do not mistake Nix's selected fast suites for full acceptance. Any implementation slice changing Chronicle must follow repository `AGENTS.md` (full owned-PG, current codecs, dashboard Node/Chromium, collector and relevant relevance suites). Preserve suite inventory, source/artifact identity, failure/error/skip counts. Test native package behavior separately from source/JVM success.

## 9. First implementation slice and outstanding choices

Recommended next task: **Stage 0 plus the smallest Stage 1 foundation**: executable compatibility corpus, lossless JSON/digest spike and one common-build design. An early descriptor-safe filesystem feasibility investigation can run alongside this; Stage 4a remains the later complete JVM/native acceptance gate, not a claim that an exploratory spike validates the port. This task should not switch running services, move databases or enable embeddings. After those gates, implement Haystack parity first and continue Manure separately.

Choices to resolve before their dependent implementation, not blockers for this plan:

1. Selected host/cluster state path/package, measured resource envelope, backup retention/RPO/RTO and approved cutover order. Prefer co-location and logical moves, not a new remote DB service.
2. New Baboon transport/version policy and exact additive search operation/cursor shape. Preserve legacy APIs by default; explicitly choose deprecation timing later.
3. Manure corpus: metadata-only first; opt-in bounded text content later, with stated visibility/privacy policy. Haystack `fields` indexing also needs a deliberate policy for any sensitive leaves.
4. Embedding endpoint/model/revision and globally enforced request capacity. Same endpoint is allowed; no obligation to use the same model for every corpus. No annotation endpoint is required for the new services.
5. Manure filesystem/JDK/native feasibility and actual Unicode/NUL/timestamp edge data; resolve representation before schema freeze. Do not silently weaken accepted input or security boundaries.

## 10. Source map and planning evidence

Read-only research was delegated separately for Haystack contracts, Manure storage/security and Chronicle search/Nix boundaries. Findings were reviewed against representative source by the parent. No runtime parity, performance, migration or deployment result is claimed by this plan.

- Chronicle: [`README`](../../chronicle/README.md), [`CONTRACT`](../../chronicle/CONTRACT.md), [`build.sbt`](../../chronicle/build.sbt), [`Search.scala`](../../chronicle/server/src/main/scala/chronicle/Search.scala), [`ArchiveIndex.scala`](../../chronicle/server/src/main/scala/chronicle/ArchiveIndex.scala), [`ArchiveSearch.scala`](../../chronicle/server/src/main/scala/chronicle/ArchiveSearch.scala), [`Models.scala`](../../chronicle/server/src/main/scala/chronicle/Models.scala), [`IndexProfiles.scala`](../../chronicle/server/src/main/scala/chronicle/IndexProfiles.scala), [`Database.scala`](../../chronicle/server/src/main/scala/chronicle/Database.scala), [`ChroniclePlugin`](../../chronicle/server/src/main/scala/chronicle/plugins/ChroniclePlugin.scala).
- Haystack: [`model`](../../haystack/docs/model.md), [`API`](../../haystack/docs/api.md), [`query`](../../haystack/docs/query.md), [`auth`](../../haystack/docs/auth.md), [`operations`](../../haystack/docs/operations.md), [`json.ts`](../../haystack/server/src/domain/json.ts), [`digest.ts`](../../haystack/server/src/domain/digest.ts), [`text.ts`](../../haystack/server/src/query/text.ts), [`postgres.ts`](../../haystack/server/src/storage/postgres.ts), [`test suites`](../../haystack/server/tests/suites), [`browser harness`](../../haystack/web/tests-browser/run.mjs).
- Manure: [`CONTRACT`](../../manure/CONTRACT.md), [`README`](../../manure/README.md), [`storage.py`](../../manure/manure/storage.py), [`server.py`](../../manure/manure/server.py), [`tests`](../../manure/tests).
- Nix: [`HM hosting`](../../nix/hm/agentic-services-server.nix), [`HM Chronicle`](../../nix/hm/chronicle-server.nix), [`NixOS Haystack`](../../nix/nixos/haystack.nix), [`NixOS Manure`](../../nix/nixos/manure.nix), [`NixOS Chronicle`](../../nix/nixos/chronicle.nix), [`Chronicle source filtering`](../../nix/pkg/chronicle/source.nix), [`Chronicle package`](../../nix/pkg/chronicle/server.nix), [`flake`](../../flake.nix).

Planning validation: 34 local repository links checked successfully; separate Haystack/general and Manure reviewers completed read-only review, with material corrections incorporated; staged whitespace/diff checks passed. Application suites were not run for this documentation-only change. Implementation milestones above retain their own mandatory execution gates.

Skill generalization was reviewed separately against the four applicable installed skills and memory-search overlap leads. No new draft is proposed: this work establishes planning hazards, not an executed migration procedure; existing compatibility/DI/testing guidance already covers the reusable procedures used here.
