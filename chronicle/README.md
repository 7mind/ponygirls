# Chronicle server

Internal session archive: Scala3/http4s, explicit distage constructor graph, Lifecycle-managed startup, PostgreSQL FTS+pgvector, Baboon Scala/TypeScript codecs. Collector and dashboard are independent consumers of `CONTRACT.md`.

## Build and verification

Pinned toolchain: sbt1.13.1, server Scala3.9.0, generated-only Scala2.13.18, Izumi1.2.25, Baboon0.0.198, PostgreSQL18.6+pgvector0.8.7. Generated Scala runtime contains Scala2 `do/while`, so it compiles separately under `generated/.build`; server remains Scala3. Circe/cats/http4s use their2.13 artifacts consistently at this boundary. Izumi macros require `-Yretain-trees`. Scala3.10.0 was tested and rejected: PluginDef's ForcedRecompilationToken macro expands to an incompatible singleton type (retained sanitized failure in `server/scala-3.10-izumi-repro.log`). Scala3.9.0 is the newest compatible stable3.9 release verified.

```bash
export SBT_LAUNCH_JAR=/path/to/sbt-launch.jar
./scripts/sbt.sh compile test assembly
# Fresh unprivileged real cluster; full suite MUST execute PostgreSQL leg:
POSTGRES_HOME=/path/to/postgresql-with-pgvector ./scripts/test-postgres.sh
BABOON=/path/to/baboon ./scripts/generate.sh
# No JVM fallback; actual native executable:
GRAALVM_HOME=/path/to/graalvm ./scripts/native.sh
```

Assembly: `target/chronicle-server.jar`; native executable: `target/native/chronicle-server`. sbt/coursier standard caches are used (`~/.sbt`, `~/.ivy2`, `~/.cache/coursier`); Nix integration supplies project-local cache homes and repository override/offline settings. No downloads are performed by the service. Generated sources are checked in and regenerated with pinned executable checksum and model lockfile. `models/chronicle.baboon` is the only self-contained API schema (1.9.0); edit it in place for this owned deployment. No retained-version codecs, conversion chains or post-generation rewriting are used.

For full manual verification on a fresh checkout, run commands inside the pinned
shell (`nix develop .#chronicle --command bash -c '<commands>'` from the repository
root). Provision locked JavaScript dependencies with
`(cd chronicle/web && npm ci)` and `(cd chronicle/collector && npm ci)` using an
approved registry/cache; this replaces local node_modules without changing the
lockfiles. From `chronicle/`, the protocol command is
`TSC="$PWD/web/node_modules/.bin/tsc" ./scripts/test-codecs.sh`. The shell supplies
Python, PostgreSQL/pgvector, Node, Chromium and font configuration. Missing
prerequisites are failures to report, not reasons to skip suites.

### Fast Nix checks and full agent verification

Routine Nix builds use the 13 explicitly named parser/codec/pure/dummy suites
in `scripts/fast-suites.txt`, not the full PostgreSQL/concurrency/deadline suite.
The fast command is `nix develop .#chronicle --command bash chronicle/scripts/test-fast.sh`
from the repository root. It clears the PostgreSQL URL and makes accidental
PostgreSQL use fail rather than silently skip. Selected-suite reports must be
nonempty, match the allowlist/discovered inventory, and contain no failures,
errors or skips. Their scope is explicitly a fast subset, not full validation.

```bash
# Fast backend subset:
nix build .#checks.x86_64-linux.chronicle-backend
# Complete fast sole current1.9.0 generated TypeScript codec checks (14 fixture groups):
nix build .#checks.x86_64-linux.chronicle-protocol
# Exact-artifact receipt for fast backend + single-version codec checks:
nix build .#checks.x86_64-linux.chronicle-validation
# Native package + fast checked dashboard + scoped evidence:
nix build .#chronicle
# Compile-only artifact; no test pass implied:
nix build .#chronicle-native-dev
```

Dashboard packaging retains typechecking, bundling and its complete fast Node
suite; Chromium is run separately, not on ordinary Nix rebuilds. Collector
packaging retains its fast tests. The package receipt at
`share/chronicle/validation.json` binds immutable runtime/test and validation
identities to the final post-fixup ELF, but explicitly claims only the selected
backend subset and single-version codec coverage. It is not evidence that the
full backend or browser suites passed, nor native behavioral equivalence.

Full-suite execution is an agent responsibility, documented in repository-root
[`AGENTS.md`](../AGENTS.md), rather than a mandatory Nix release gate. Before
completing a Chronicle task, run the unfiltered owned-PostgreSQL backend suite,
generated protocol checks, full dashboard Node/Chromium suites and collector
suite. The backend command is
`nix develop .#chronicle --command bash chronicle/scripts/test-postgres.sh`.
Use `scripts/sbt.sh 'testOnly chronicle.SuiteName'` only for focused iteration,
not as a substitute for final full runs. Keep shared-database tests serial and
preserve real deadline/concurrency assertions; no timeout is shortened to make
routine builds faster.

Nix reuses checks only for matching input identities. UI-only changes reuse
native/backend checks; collector changes do not rebuild the server; test-only
changes reuse native compilation. Missing or malformed scoped evidence and
failing fast checks still fail closed. Nix trusted-builder/cache assumptions
apply; arbitrary explicit service-package overrides remain the operator's
responsibility. See [the cache contract and historical measurements](docs/drafts/20261028-build-validation-cache.md).

### Controlled search relevance experiments

[`eval/relevance/README.md`](eval/relevance/README.md) describes the isolated
HTTP/MCP ingestion, publication preflight, lexical retrieval traces and exact
source-citation scorer. Its synthetic corpus includes distractors, pagination,
held-out tasks and inaccessible sources. Scripted providers and evaluator gold
controls verify workflow plumbing, not agent reasoning or semantic relevance.
Real-agent trials need an enforced tools-only boundary. Tokenfactory trials have
no token/cost caps; runtime deadlines and runaway-loop safeguards are separate
execution controls. Do not tune ranking without reproducing and classifying a
retrieval failure on fixed inputs.

### Nix dependency lock

From the Ponygirls repository root:

```bash
nix build .#chronicle
nix build --no-link .#packages.x86_64-linux.chronicle.offlineAssemblyCheck
nix run .#chronicle-update-sbt-lock -- "$PWD/chronicle/deps.lock.json"
```

Pinned Squish reconstructs the Coursier cache from `deps.lock.json`, verifying each public artifact separately. The compiler build uses a fresh home, offline Coursier and a file-only Maven repository, including launcher bootstrap; Nix fetches the locked artifacts before that build. The pinned sbt launcher, Graal toolchain, native flags and PostgreSQL-required checks are unchanged. Squish's default sbt/JDK are not used.

The update command runs `lockfile-config.json` only in a disposable filtered source copy, with separate tool/bootstrap and project caches. Never run the upstream generator in a working project: it deletes build targets. Failures before publication leave the selected lock untouched, and failed work is retained. After interruption or a cleanup failure, inspect the destination before retrying: atomic publication may already have completed. Review the lock diff and rerun the offline/native checks after dependency changes.

Consumers with a dedicated package set should use `ponygirls.lib.mkChroniclePackage { pkgs = chroniclePkgs; }`, which supplies the pinned Squish library without changing that package set. Update an existing direct caller and its Ponygirls pin together; an older pin does not expose this factory.

Native metadata is in `server/src/main/resources/META-INF/native-image/chronicle/` and preserved by assembly (JDBC reflection/service loader, SQL resources, TLS/security providers). `scripts/native.sh` consumes explicit `CHRONICLE_NATIVE_IMAGE_FLAGS` as whitespace-separated extra arguments. Nix Linux uses the supported Graal musl toolchain with `--static --libc=musl`: the glibc Graal distribution's static-libm/dynamic-libc combination failed final C linkage against glibc2.44 (`_dl_x86_cpu_features`), also reproduced independently using C `log2()`. This is a toolchain boundary, not a JVM fallback or an application workaround. Standard non-Nix Graal installations may leave extra flags unset. Root integration owns native binary workflow verification; compilation alone does not establish runtime compatibility.

Tests classify cheap blackbox contracts and controlled local communication separately. The same archive contract executes against a hand-written dummy and PostgreSQL through distage; full-verification script requires real PostgreSQL, never silently substitutes the dummy. Additional actual HTTP/WS tests use the production graph; OpenAI simulator tests require no live models. Only synthetic transcripts are used.

## Configure and run

Copy `config.example.json` outside the store, provision PostgreSQL database/role and pgvector extension permission, then:

```bash
java -jar target/chronicle-server.jar password-hash < /protected/password-input > /protected/password-hash
java -jar target/chronicle-server.jar serve /protected/config.json
# or the identical native CLI:
target/native/chronicle-server serve /protected/config.json
```

Password helper reads one stdin line (interactive console input is not echoed), outputs `pbkdf2-sha256$600000$BASE64_SALT16$BASE64_DERIVED32`; never pass passwords on argv or put credentials in Nix strings. Restrict credential files to the service account. Endpoint credentials and DB password are required files; explicitly empty model credential files omit Authorization. Model endpoints are full operation URLs. HTTPS with Secure cookies is the default deployment policy; terminate TLS at a trusted reverse proxy and configure EXACT external Origin. Do not expose an unencrypted listener beyond the trusted host/network. Serve UI from explicit `CHRONICLE_WEB_ROOT` (packaged wrapper sets it), same origin as APIs; static file paths are contained including symlinks. API paths are not SPA fallback routes.

For deliberately trusted private-network HTTP, set the exact external Origin and opt in explicitly (all other JSON fields remain required):

```json
{"listenHost":"127.0.0.1","listenPort":47330,"allowedOrigin":"http://192.168.50.10:47330","secureCookies":false,"allowInsecureHttp":true}
```

`allowInsecureHttp` defaults to `false` when omitted. Without it, non-Secure cookies remain restricted to HTTP with both a loopback listener and loopback Origin. The opt-in does not restrict hosts to RFC1918 addresses: the operator must ensure the network is private/trusted. Plaintext exposes passwords, session cookies, tokens and archived data to network observers; prefer TLS. `chronicle_session` has no HTTPS-only name prefix and retains HttpOnly and SameSite=Strict, but must omit Secure for HTTP. Exact-Origin/CSRF and cookie/bearer separation remain enforced. For NixOS use `smind.services.chronicle.allowInsecureHttp = true` with an `http://` `publicUrl`; the module selects non-Secure cookies only for HTTP, retains a loopback backend and opens no firewall ports. Existing `loopbackDevelopment` remains loopback-only. Rebuild the packaged native server from patched sources before deploying this new field; changing JSON alone cannot update an old binary.

Users are stable IDs/logins in config, no registration. Restart applies config changes, removes browser sessions for disabled/removed users or changed password hashes; live database enabled checks prevent disabled users' data being shared. Browser sessions and hashed agent tokens survive ordinary server restarts. The default browser session lifetime is 30 days (`sessionTtlSeconds = 2592000`), renewed by the visible dashboard without storing credentials in JavaScript. Renewal extends both the existing server session and its HttpOnly cookie; it cannot revive an expired or revoked session. Hidden dashboards do not keep renewing indefinitely. After deploying the updated server and web UI, a still-valid session can renew; an already-expired session requires signing in again. Tokens are minted/revoked only through cookie-authenticated browser WS. Raw scope requires Read. Login concurrency is bounded; deployment proxy should additionally rate-limit login attempts by client address.

## Durability and authorization

Ingest validates bounded exact JSONL files/digests and normalized source provenance, CASes archive head and writes immutable revision + durable job + payload-bound receipt in one transaction before ACK. A collector namespace/discovery-root/format/producer/subagent identity distinguishes copied sources. Retrying an unchanged lost acknowledgement returns the same receipt; changed payload or stale head conflicts. Pi parent edges may point to preserved metadata records, not only normalized messages. recordIndex is in the concatenated nonempty JSONL records in files order.

Groups grant only direct same-group read visibility, never transitive access. Authorization precedes SQL rankings, counts, limits/facets/status and raw/message/ref reads; missing and unauthorized IDs are indistinguishable. There is no authorization-result cache. Open sockets authenticate each operation and heartbeat. A bounded32-entry per-socket queue serializes application work and reauthenticates at execution; a full queue returns an observable unavailable error. Hello/Ping/Pong remain inline so a valid slow model request cannot prevent heartbeat consumption. Server Hello/heartbeat deadline expiry closes with retriable1013 (Try Again Later), allowing bounded automatic replacement after suspension; genuine protocol4400, authentication4401 and version4406 failures remain terminal. Invitations target existing stable user IDs, require affirmative sharing acceptance, expire after24h and are consumed once. Owner cannot leave: delete group. Revocation/removal is immediate for subsequent reads. Mutation request IDs bind full typed operations durably. Minted secrets return once; an uncertain mint's receipt is Result.Token with metadata only. The dashboard recovers that token ID for revoke/remint, never secret replay.

Purge is owner-only, deletes raw/messages/index/jobs and leaves an irreversible source tombstone; a stale collector cannot recreate it. Existing receipts remain to resolve lost acknowledgements. To deliberately restore, change collector namespace and use a new request ID.

## Indexing and recovery

Bounded PostgreSQL worker lanes claim `FOR UPDATE SKIP LOCKED`, increment a fencing token, renew300s leases every30s and perform bounded requests. Five automatic job claims maximum for infrastructure recovery; expired last-attempt leases become visible Failed. Annotation validation has its own durable, per-window limit of five rejected responses, rather than spending one job claim for each rejection at a different window. Raw/status reads do not depend on the index. New archive heads fence unfinished older jobs with `superseded-revision`. Failed retry preserves its run UUID, accepted work and historical error/stage, advances the annotation retry epoch, and retains prior reservation rows for audit; deliberate Complete recompute and confirmed force-all owner rebuild rotate runs. Every checkpoint read/write and final publication rechecks live owner, target/profile/epoch, immutable source binding, job/run/fence and lease. Accepted annotation decisions and exact-source vector batches survive reclaim/restart; response-before-commit crashes can still repeat an uncommitted provider call. Publication, search replacement and one-shot retirement are atomic and roll back together on lease loss. Ordinary future publications preserve current-policy history; explicit accepted rebuilds may retire obsolete derived pins, never raw revisions/receipts/job IDs.

The sole executable policy is `ContextAwareProblemsV1`: windows of at most64 original-source fragments, each at most2048 UTF8 bytes, explicitly cover every normalized scalar once as Problem or Context. Only Problem slices receive summaries/tags and exact-source vectors; no message joining, role/prefix blanket exclusion or fabricated Context metadata occurs. Context-only/empty sources publish complete zero-problem generations without embedding calls. Context does not close an open problem. Existing-problem carry is bounded to4096 source bytes/16 fragments; **zero Context text is carried across windows**, so older Context-only antecedents are a known bounded-quality limitation. All original normalized bytes/positions remain readable and searchable through selected-history Find.

Annotation requests require explicit `annotation.requestPolicy`; the maximum-reasoning policy retains65536 completion tokens, maximum reasoning and the configured900-second operation deadline. Both header/idle timeouts and whole-request body consumption respect the configured finite deadlines. Annotation `model-output` and exact `model-output/truncated` responses share a five-rejection limit per immutable window/input and explicit retry epoch, with identical input/policy on each local attempt. Transport/deadline failures are not locally retried and retain the five-claim infrastructure limit. Each provider-call authorization is reserved durably before invoking the annotator; cancellation/crash/admission wait may consume an authorization without an observed provider call, but not a validation rejection. A separate ten-authorization backstop bounds unknown outcomes; under the serial-window/five-claim invariant, at most nine authorizations are needed before terminal failure. Accepted checkpoints bypass authorization entirely. Rejection recording is idempotent per reservation and fenced to its original claim. Five rejections yield `annotation-attempts-exhausted`; the authorization backstop yields `annotation-reservations-exhausted`. Logs retain typed safe rejection reasons and bounded structural details, and the reservation ledger retains reason tokens, never rejected text. Annotation telemetry captures usage before decoding and counts decoder rejection as a failed call, not a successful annotation. Every validated decision and accepted embedding batch is durably checkpointed before later stages, not merely buffered in memory. Source/profile/run/input/carry identities are immutable, and corruption fails closed rather than causing a hidden recomputation. Logical revision UUID bindings survive logical restore; physical xmin is not a durable identity. Summary/tag limits use Unicode scalars, and generated NUL/unpaired surrogates are rejected. Annotation metadata is untrusted; collector metadata and source provenance remain distinct. See [CONTRACT.md](CONTRACT.md) for coverage, recovery, retirement and current-wire details.

Current semantic/hybrid queries require a verified compatible embedding space and use HNSW ANN candidate retrieval, followed by exact cosine reranking on stored full-precision PostgreSQL `vector` values. The HNSW expression indexes normalized `halfvec(dimensions)`, supporting1..4000 dimensions (including2048); unsupported dimensions fail configuration validation rather than silently using exact scans. Current lexical queries use the GIN `@@` predicate and report exact matching-session totals. Hybrid unions up to1000 candidates per lexical/vector leg and uses RRF(k=60); semantic retains up to1000 chunk candidates. Candidate modes report `countScope=CandidateWindow`, `rankingLimit=1000` or2000, and candidate-session total—not a global total. Counts can be smaller after session deduplication, filters or graph scan budget exhaustion. Candidate offsets must be below rankingLimit. Strict iterative HNSW scanning applies live ACLs and filters before each limit (ef_search200, max_scan_tuples200000, scan_mem_multiplier4); it does not authorize global topK then postfilter. No exact fallback or old-version API dispatch occurs. The exact search oracle remains available to diagnostics, not negotiated sockets. Lexical is explicitly selectable and never silently substituted for hybrid. All API pages have a hard100 result maximum; GetSession returns the first100 indexed chunks; GetChunks/get_chunks pages every annotation in stable source order. `ContentView{revision,generationId}` binds every annotation, metadata and normalized message to the immutable source that produced it. Null view discovers current published content (or archive head if never indexed); callers then retain the returned view and reuse it for every subsequent page even if a newer generation publishes. SessionInfo separately reports current head/indexed revisions truthfully. Explicit archive-only views use a positive revision and null generationId. Raw null revision explicitly selects latest archive, while a positive revision pins bytes; files and actual revision are read atomically. Historical content is reauthorized on every operation. Accepted explicit rebuilds can retire derived generation payloads: exact full pins then return nonterminal `indexed-view-retired`, never redirect; revision-only reads/Find/raw remain available until purge. Structured tag filtering ANDs tags across the union of source metadata and all published chunk work tags; facets count distinct authorized sessions. Pending head metadata does not relabel older published search content.

Agents can call MCP `search_tags` to discover tag names beyond `list_facets`' popular top100. Supply `query:""` to browse, or a literal case-insensitive Unicode-lower substring; optional project/branch/time/exact-tag filters use the same authorized published corpus as search. Results reuse the generated Facets envelope with tag values and distinct-session counts only. Pages are alphabetical (`COLLATE "C"`), at most100 entries (`limit`, default20); continue using the last exact value as `afterTag`, including an empty string, until `tags` is empty. Pages are live rather than a frozen snapshot. No model/provider call or Raw/browser privilege is required. See [CONTRACT.md](CONTRACT.md) for Unicode, historical-value, authorization and request-budget semantics.

`embedding.dimensions` validates the expected response and index shape. Separately, `embedding.sendDimensions=false` omits the optional OpenAI dimensions request parameter for fixed-dimension models. Set true only for endpoints explicitly supporting requested dimensional truncation (MRL). Omitted flags in old public JSON configs mean false; new configs should always include the field. There is no400 retry/fallback, and the flag participates in profile identity.

Drain all old workers before deploying the reservation-aware worker: mixed versions still fence publications but old workers do not enforce the new annotation budget. Legacy terminal failures remain Failed until an explicit retry; no startup retry or retarget occurs. This diagnostics/retry change leaves the annotation profile identity unchanged and reuses accepted work.

Changes to model/revision/dimensions/sendDimensions/prefixes/prompt/window/schema identity require explicit owner intent. Deploy the current configuration without retargeting existing owners, then use browser `PreviewOwnerReindex` and freshly confirmed `ApplyOwnerReindex`; no global maintenance CLI or historical annotation executor remains. New ingestion/retry under an unexecutable retained target fails without mutation until confirmed Apply; collectors hold/retry durably, while authorized committed ingest receipts remain observable. Do not change model contents behind an unchanged revision identifier.

A rebuild replaces ALL selected live owner HEADs, including already-current/Running work (`alreadyCurrent=0`). `GetReindexStatus(requestId)` observes the fixed captured cohort, never a moving HEAD scan; complete/superseded/failed/pending sum to its immutable total. Prior publication/search remains until accepted atomic replacement. Retirement consent is one-shot per selected source/target epoch/profile: a superseding revision can fulfill retirement without completing the old exact member, and future ordinary history is not repeatedly retired. There is no ownership transfer, automatic raw redaction or attachment fetching.

Back up the entire PostgreSQL database (raw revisions, receipts, users/auth, groups, index, profiles/jobs together), plus protected config/credential files separately. Restore both before starting collectors. The service applies idempotent SQL migrations at startup under an advisory lock; Baboon codec evolution is separate from database migration. Migration002 backfills a dedicated published-search projection exactly once from current non-tombstoned generations. Publication replaces that source's complete projection in the same transaction as its generation-pointer swap; ordinary historical chunks/generations remain available to pinned reads but are not ANN indexed; explicitly retired derived pins fail with `indexed-view-retired`. Purge cascades into the projection. Startup creates the configured dimension's partial expression HNSW index under that lock; large existing deployments need a maintenance/startup budget for backfill/index construction (not concurrent DDL). Different dimension profiles may temporarily coexist during explicit owner rebuilds, but dimension/profile predicates fence semantic candidates. Existing profile-specific dimension indexes can be retained for reuse; no historical generation is backfilled into ANN. Native resource metadata includes all SQL migration resources. Monitor sanitized job state/attempt/error codes and indexing lag (`indexedRevision` versus archive revision); logs exclude transcripts, passwords and token plaintext.

### Shutdown policy

SIGTERM runs the application/resource finalizers. http4s Ember0.23.38's unchanged default shutdown timeout is30seconds: it stops accepting work and waits for active connections to drain, then cancels remaining connections at that deadline. An open WebSocket counts as an active connection; clients need not close voluntarily for the process to exit. Therefore a5second forced-kill oracle is not valid while a test still owns an open socket. Close owned clients before fast restart tests, and separately allow40seconds when testing the active-connection drain deadline. Configure systemd `TimeoutStopSec=60s` (or a larger explicit operational budget); do not rely on an unknown manager default. No backend timeout reduction or JVM fallback is used.

Observed JVM process probe against a fresh local PostgreSQL cluster: with an authenticated/Hello-negotiated WebSocket left open, SIGTERM closed transport at30.017seconds and process exited unforced at30.881seconds (standard SIGTERM exit143); closing the WebSocket first produced unforced exit in0.495seconds. A10second thread dump showed IOApp waiting for cancellation completion with idle compute workers. These observations match the library's bounded drain implementation, not an indefinite finalizer deadlock. A WebSocket remaining until the drain deadline can report abnormal transport close1006; clients must treat server restart as stale/reconnect, never auto-replay mutations.

## Managed tokens and progress

`staticTokens` is a list of `{id,userId,name,scopes,tokenFile}`. Omission in older JSON means an empty list; new configs should specify it explicitly. IDs are stable UUIDs and owners must exist in `users`. Scopes must be nonempty/distinct; Raw requires Read. Use separate Ingest-only collector and Read-only agent mappings unless additional access is explicitly needed. The runtime file must be private, outside `/nix/store` (including resolved symlinks), and contain a strong randomly generated bearer value (at least 43 token characters). Never embed plaintext tokens in Nix/JSON/logs. NixOS `smind.services.chronicle.staticTokens` accepts the same metadata plus runtime `tokenFile`; systemd LoadCredential transfers the file without copying its contents into the store.

Startup reconciles mappings after user synchronization, preserving ID and creation time for metadata/secret rotations. Removing a mapping deletes its token; rotating its file invalidates the previous bearer. Issued-ID collisions, owner changes, duplicate values, invalid scopes or unreadable/insecure files fail startup transactionally. The API denies static-token revocation. Token lists expose `ListedToken.info` and `source=StaticConfig`/`Issued`, never static secrets; persisted TokenInfo and minted-token receipts keep their existing shapes. Disabled owners cannot authenticate. Each owner may have at most 100 active issued plus configured tokens. Startup rejects mappings that exceed this unified limit; API lists prioritize active/configured entries and use remaining capacity for revoked history, so revoked entries cannot hide usable credentials.

`POST /api/collector/progress` requires Ingest bearer transport (no cookies/query secrets), with an independent 64KiB body cap. Generated progress/ack codecs preserve 64-bit quantities as decimal strings. Reports contain sanitized identifiers/error codes, never paths/transcript/error text. Progress is owner-scoped durable latest state, not an ingest receipt. A strictly increasing per-collector sequence advances server-received freshness; duplicates/older reports return the latest sequence and `accepted=false` without refreshing it. At most 100 collector identities per owner are accepted atomically. `CollectionStatus` requires Read/browser access, returns only the caller's collectors, and computes stale after more than 120 seconds without an accepted report. Uploaded bytes mean acknowledged payload bytes, not bytes sent; queued uploads from previous runs need not be a subset of newly enqueued work.

Job `completedWindows`/`totalWindows` count actual source windows, advancing only after annotation and embedding finish. Claim fencing, current revision and target profile gate progress updates; retries/new claims reset to zero/unknown. Historical jobs without measurements remain unknown rather than fabricated 100% completion. Publication still uses the existing generation transaction/fence.

The default ingest body bound remains 8MiB; the named hard maximum is 512MiB. Size the explicit body limit for JSON encoding overhead, not raw source bytes alone. The observed import needs a 256MiB body limit, 256MiB per-file bound and 100,000-message bound; configure these explicitly rather than raising every deployment's defaults. Only ingestion uses the larger limit. Login remains capped at 16KiB; MCP, WebSocket frames and collector progress remain capped at 64KiB. Each small transport also respects a smaller configured body limit. Request streams remain bounded. Native resources include migrations001–005.
