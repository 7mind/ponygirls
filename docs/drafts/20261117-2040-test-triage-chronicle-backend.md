# Test triage — Chronicle backend (Scala server)

Scope: `chronicle/server/src/test/**` (108 Scala files, 17 556 LOC, 1.27 MB; 116 sbt suites; 1 009 cases) plus the selection/run machinery (`chronicle/scripts/test-{fast,postgres}.sh`, `fast-suites.txt`, `sbt.sh`, `validation-report.py`, root `build.sbt`, `nix/pkg/chronicle/backend-validation.nix`). Analysis only; no product or test code changed.
Machine-readable companion: `docs/drafts/20261117-2040-test-triage-chronicle-backend.json`. Raw data: `/home/pavel/work/flakes/ponygirls/.local/overhaul-20261117/reports/triage-chronicle-backend/`.

## 1. Executive summary

**The owner's hypothesis does not hold for the routine build of this component.** The routine Nix path (`checks.chronicle-backend`, also a dependency of `packages.chronicle` through `validationEvidence`) runs 13 suites / 132 cases whose test bodies take **2.1–3.9 s** (measured). The remaining backend cost on that path is compilation: on a nearly cold sbt cache, compiling the 108 test sources took **15 s** and the main chain took **28 s** (sbt-reported, load ≈150). Deleting every test in this area would save at most ≈15 s of compile time on the routine path. Whatever makes routine builds slow, the Chronicle backend test bodies are not it.

The mandatory *full* backend run (agent responsibility under `AGENTS.md`) is where the time goes: **909 s wall (15 min 9 s), 899.5 s of test time** in one forked JVM with serial execution (measured, run 2). That time is concentrated:

- 23 cases ≥ 5 s account for 480 s (53 %); the top 4 suites take 393 s (run 2).
- Most of it is **real-time waiting on hard-coded or fixture deadlines** (65 s ×2, 30 s, 17+19 s, 10/20/10 s WebSocket liveness, 6 s, 2 s worker back-off ×29, 5 s ×4) and **two performance-purpose corpus tests** (IndexedSearch*: 134 s).
- A per-test floor of ≈0.27–0.42 s for each of the ~700 PostgreSQL cases comes from fixture work. PBKDF2 at 600 000 iterations alone costs ≈150 ms per `Fixtures.config()` (measured), plus `Database.initialize()` and TRUNCATE in every test.

Junk is rare by volume. Read against the brief's criteria, this suite is mostly genuine behavioural contracts, many of them concurrency, durability and security regressions, and many in proper dual form (Dummy + PostgreSQL). Clear junk: the finished-port differential (`SharedExtractionDifferentialTest` plus the 35 KB frozen copy `ExtractionBaseline.scala`), a SQL-text assertion, a migration-DDL text assertion, a PostgreSQL-characterization case and about 10 duplicated cases. That is about 1 % of cases and 5 % of test LOC.

**Parallelism is the biggest lever and is proven.** Without changing any code, I split the 116 suites into 8 LPT shards, each with its own owned PostgreSQL cluster and private copy. All 1 009 cases passed, and the run took **173.6 s wall versus 909 s serial (5.2×)** (measured). The critical path was the single 145 s `ModelTransportTest`.

Verdicts (per file; counts by file / cases / run-2 seconds): KEEP 90 / 910 / 388 s · REWRITE-CHEAPER 7 / 69 / 358 s · MERGE 7 / 23 / 34 s · DELETE 3 / 3 / 7.6 s · DEMOTE 1 / 4 / 111 s. Case-level deletions inside KEEP/MERGE files are listed in §4.

Projected effect (estimates derived from the measured per-case times; §6):

| Path | Now (measured) | After verdicts, serial | After verdicts + 8–16 shards |
|---|---|---|---|
| Routine (fast subset) test time | 2–4 s, 13 suites/132 cases | ≈ 6–25 s, 42 suites/≈ 405 cases (adds coverage) | unchanged (too small to shard) |
| Mandatory full backend | 909 s wall | ≈ 340–440 s | ≈ 50–75 s |
| New slow/perf tier (explicit or scheduled) | — | ≈ 200 s | ≈ 130 s (one suite per shard) |

**Ten highest-value actions** (ordered by value per effort):

1. **Shard the full run** across N forked JVMs, each with its own database cloned from a migrated template (`CREATE DATABASE … TEMPLATE`), using sbt `Test / testGrouping` with per-group `CHRONICLE_TEST_JDBC`. Measured 5.2× with 8 shards and no code change. (§5)
2. **Move `IndexedSearchTest` and `IndexedSearchSnapshotTest` into a performance tier** that runs on demand or on a schedule. Both assert planner index choice and ANN recall over 12k–30k-row corpora (134 s). Share one seeded corpus between them, and move the one functional case (`IndexedSearchTest.scala:166`) to `ArchiveProjectionTest`.
3. **Make the WebSocket liveness timings injectable** (hello 10 s, ping 20 s, pong 10 s in `Http.scala:249-254`). Test them with sub-second values and keep a BA assertion on the production constants. This saves ≈ 68 s in `HttpTest` and ≈ 12 s in `BrowserWebSocketTest:197`.
4. **`ModelTransportTest`: replace the two 65 s regressions with one.** Both prove that the client idle timeout follows `Models.transportTimeout` (`Models.scala:35`) rather than Ember's 60 s default. Keep one in the slow tier and add a BA check on the derived client setting (saves 131 s from the mandatory run).
5. **Inject the Worker failure back-off** (`IO.sleep(2.seconds)`, `Models.scala:219`), or run those cases under cats-effect `TestControl`. This removes ≈ 58 s from 29 cases and makes the dummy halves fast-path eligible.
6. **`ArchiveSearchTest` deadlines:** the "default 30 s" case only re-measures the fixture's own `JdbcLimits` (`Fixtures.scala:31`; there is no product default, `Core.scala:112-120`). Use a 1 s configured statement deadline for it and for the 6 s lock-wait case. Shrink the 2 MiB literal case. Saves ≈ 50 s.
7. **Fixture hygiene:** hash the fixture password once per JVM and initialize the database once per suite. Delete the `legacyOnly`/`passages` alias extensions (`Fixtures.scala:4-8`), which make several "transition" tests degenerate and make `OwnerProfilePostgres.withDatabase` initialize twice per test (`OwnerProfilesTest.scala:96-103`). Estimated ≈ 100 s serial.
8. **Delete the finished-extraction scaffolding:** `SharedExtractionDifferentialTest.scala` and `ExtractionBaseline.scala`, which says "Keep while extraction is validated" (`:3-4`); the extraction landed in d3de9f96 on 2026-11-03.
9. **Promote 29 PostgreSQL-free suites (273 cases) to the fast subset:** dual-test dummy halves and pure suites such as `ModelRejectionTest` (66 cases), `McpTestRunsTest`, `ModelTelemetryTest` and `ArchiveDummyTest`. Measured with the fast-path environment (JDBC unset, `CHRONICLE_REQUIRE_POSTGRES=1`): they pass in 33 s wall including sbt start, ≈ 22 s of test time. After action 7 most of that disappears. This raises routine coverage instead of lowering it.
10. **Remove duplicates and trivia (≈ 12 cases):** see §4. These include the triple long-title continuation test, `McpTagSearchTest` cases that repeat `TagSearchTest`, a relocated-identity case, `ProtocolEvolutionTest`, `ArchiveLiteralPlanTest` (CTE-name grep), the DDL text assertion in `ModelTelemetryTest:322-326` and `ArchiveLexicalIndexTest:18` (PostgreSQL characterization).

## 2. Method and measurement conditions

- **Worktree:** a fresh checkout of f153d1ae. Toolchain: `nix develop .#chronicle` (GraalVM 25.0.4.1.1, sbt 2.0.12, PostgreSQL 18.6 + pgvector from the flake). All runs used the repository scripts unchanged, a private `TMPDIR=/tmp/ctb.Un1v` and ephemeral ports. All processes I started were stopped and temporary copies removed.
- **Host:** 128 cores, shared, load average 130–166 throughout (each run's load is recorded in the logs). Absolute times are therefore inflated by an unknown factor; ratios between runs taken minutes apart are more trustworthy than absolute values.

| Run | Command | Conditions | Result |
|---|---|---|---|
| Run 1 (full) | `bash chronicle/scripts/test-postgres.sh` | **Under the `LD_PRELOAD` inotify shim** (`shim/libnoinotify.so`), needed before the host limit was raised. Load 151 → 154. | 1 009 passed; sbt "elapsed 945 s"; wall 995 s (includes a 43 s compile step). |
| Run 2 (fast) | `bash chronicle/scripts/test-fast.sh` | No shim (limit raised to 8192 at 20:55Z). Load 150. | 132 passed; wall 11.7 s; test time 3.9 s (JUnit). |
| Run 2 (full) | `bash chronicle/scripts/test-postgres.sh` | No shim. Load 139 → 144. | 1 009 passed; wall **909.5 s**; test time 899.5 s. **This is the primary dataset for every number in this report.** |
| Shards | `run-shards.sh`: 8 LPT shards by run-1 suite times; each shard is a private tar copy of the worktree with its own initdb cluster, running `scripts/sbt.sh "testOnly …"` | No shim. Load 150 → 154. | 1 009 passed (sum of the 8 sbt totals); wall **173.6 s**; shard walls 138.7–171.4 s. |
| Promotion probe | `testOnly` of 30 candidate suites with `CHRONICLE_TEST_JDBC` unset and `CHRONICLE_REQUIRE_POSTGRES=1` | Mimics `test-fast.sh`. | 273 passed, 3 failed (all in `McpMessageContextTest`, which needs PostgreSQL through `ReadSourceFixture`); wall 33.2 s. |
| Near-cold compile | Private copy without `target/`, `set Global / localCacheDirectory := file("/tmp/…")`, then `chronicleServer/compile` and `chronicleServer/Test/compile` | sbt still reported "cache 31 %" (dependency resolution), so the cache was not fully cold. | Main chain incl. contracts: 28 s. 108 test sources: 15 s. |
| PBKDF2 micro-benchmark | `java Pb.java`: 600 000-iteration PBKDF2-HMAC-SHA256, the parameters used by `ponygirls.auth.Password` | Load 146. | Warm: ≈ 150 ms per hash; first calls ≈ 250–270 ms. |

Per-case timings come from sbt JUnit XML (`summary.json` next to each run's reports). Fixture cost is not reported separately by munit. I derived it from the per-case floor (p25 ≈ 0.27 s, median 0.42 s across 701 cases in suites averaging ≥ 0.15 s per case) and from the PBKDF2 measurement. Every fixture-overhead number in this report is therefore an **estimate**.

**Static analysis depth.** I read in full, or in the relevant part, the fixtures, every heavy suite (all cases ≥ 1.5 s) and every DELETE/MERGE candidate:

- Fixtures: `Fixtures`, `ReindexCohortTest`'s `CurrentIndexDatabase`, `OwnerProfilePostgres`, `ReadSourceFixture`.
- Heavy and candidate suites: `IndexedSearch*`, `HttpTest`, `ModelTransportTest`, `ArchiveSearchTest`, `BrowserWebSocketTest:197`, `VersionedSearchTest`, `Owner*`, `SharedExtractionDifferentialTest`/`ExtractionBaseline`, `ArchiveLexicalIndexTest`, `ArchiveLiteralPlanTest`, `RelocatedModelIdentityTest`, `ProtocolEvolution`/`ApiVersionCompatibility`, `CodecFixtureTest`, `NativeResourcesTest`, `ProviderUsage`, `RevisionSortAnchor`, `ProblemsPublication`, `TokenVisibility`/`StaticToken`, `IndexProfilesTest`, `DashboardOperationsTest`, and the cursor cases of `RetryFailedActionsTest`, `ActivityTest` and `CursorWebSocketTest`.

For the other suites, the verdict rests on:

- all test names (`file:line`);
- greps for PostgreSQL use, TRUNCATE, `initialize()`, Ember servers, WebSockets, sleeps, repository-file reads and DDL/role/trigger creation;
- the measured timings.

Their KEEP verdicts mean "no evidence of junk found at this depth", not "line-by-line verified". Two reader subagents were planned for a full line-by-line pass. They never left the scheduler queue, so I closed them and did no delegated review.

## 3. Inventory

**How the suites run:**
- **Routine:** `scripts/test-fast.sh` runs `Test / validationInventory` and then `testOnly` on the 13 suites in `scripts/fast-suites.txt`. It runs inside `nix/pkg/chronicle/backend-validation.nix`, which is `checks.chronicle-backend`, and therefore also inside every `nix build .#chronicle` (via `server.nix` → `validationEvidence`). `validation-report.py` then requires the selected suites' XML to be non-empty, failure-free and skip-free, and requires them to match the allowlist and the discovered inventory.
- **Full:** `scripts/test-postgres.sh` creates an owned PostgreSQL cluster on an ephemeral port and runs `testFull`. sbt settings: one forked JVM, `Test / parallelExecution := false`, `build.sbt:209-210`.
- **PostgreSQL gating:** PostgreSQL-backed suites skip only when `CHRONICLE_TEST_JDBC` is unset and `CHRONICLE_REQUIRE_POSTGRES` is unset; otherwise they fail.

"Runs in": `fast+full` means the suite is in the routine subset and also runs in the full run; `full` means the full run only; `helper` means non-suite code compiled into every run. "Needs" codes:
- `PG`: PostgreSQL;
- `HTTP`/`WS`: a real loopback Ember server/client or WebSocket (always on port 0, i.e. ephemeral);
- `SLEEP`: real-time waits;
- `FILE`: reads a repository file.

Seconds are from run 2 (no shim); the JSON additionally carries `secondsShimRun` from run 1, which was taken **under the inotify `LD_PRELOAD` shim**. Tags use the constructive taxonomy: `BA` = Blackbox-Atomic, `BG` = Blackbox-Group, `B-Good`/`E-Good`/`W-Good` = Blackbox/Effectual/Whitebox × Good Communication (real local PostgreSQL or real loopback server), `Perf-` = Performance purpose.

| # | File | Suites | Cases | LOC | s (run 2) | Runs in | Needs | Tags | Verdict | Rationale |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | AccountAuthorityTest.scala | AccountAuthorityTest | 8 | 129 | 4.33 | full | PG | BG-Good | KEEP | Login/logout/credential-reconciliation races (stale logout, reassigned session); real security contract. |
| 2 | AccountHttpTest.scala | AccountHttpTest | 6 | 247 | 7.13 | full | PG,HTTP | BG-Good | KEEP | Account HTTP routes: Origin/Host checks, ambiguous credentials, revalidation after mutation lock; real security contract. |
| 3 | ActivityExpressionTest.scala | ActivityExpressionTest | 12 | 208 | 0.02 | fast+full | none | BA | KEEP | Pure Activity expression parser bounds/semantics; cheap (0.03 s). |
| 4 | ActivityTest.scala | ActivityDummyTest, ActivityPostgresTest | 40 | 699 | 18.22 | full | PG (Postgres half) | BG / B-Good (dual: ActivityDummyTest + ActivityPostgresTest) | KEEP | Proper dual-test contract for Activity paging/sorting/ACL; promote ActivityDummyTest to the fast set. Case ActivityTest.scala:504 duplicates CursorWebSocketTest.scala:21 (delete that case). |
| 5 | AgentKindTest.scala | AgentKindTest | 2 | 27 | 0.0 | fast+full | none | BA | KEEP | Pure classifier; cheap. |
| 6 | AnnotationAttemptsTest.scala | DummyAnnotationAttemptsTest, PostgresAnnotationAttemptsTest | 13 | 140 | 3.88 | full | PG (Postgres half) | BG / B-Good (dual) | KEEP | Annotation retry-budget durability across reclaim/crash; dual contract; promote DummyAnnotationAttemptsTest to fast. |
| 7 | ApiVersionCompatibilityTest.scala | ApiVersionCompatibilityTest | 3 | 29 | 0.01 | fast+full | none | BA | KEEP | Sole-API acceptance and removed/future version rejection; merge target for ProtocolEvolutionTest. |
| 8 | ArchiveApplicationTest.scala | ArchiveApplicationTest | 3 | 67 | 0.85 | full | PG | BG-Good | KEEP | Application dispatch never calls models for lexical/metadata reads; fails explicitly on model failure. |
| 9 | ArchiveContentBoundaryTest.scala | ArchiveContentBoundaryTest | 3 | 60 | 3.9 | full | PG | BG-Good | KEEP | Regressions for sigma folding and >100000-position paging ceilings. |
| 10 | ArchiveContract.scala | ArchiveDummyTest, ArchivePostgresTest | 18 | 453 | 4.39 | full | PG (Postgres half) | BA / B-Good (dual: ArchiveDummyTest + ArchivePostgresTest); hosts DummyArchive | KEEP | Core ingest/NUL/CAS/stale-publish contract in dual form; the in-memory DummyArchive is the fast-path enabler; promote ArchiveDummyTest to fast. |
| 11 | ArchiveExpressionTest.scala | ArchiveExpressionTest | 31 | 308 | 0.08 | fast+full | FILE (tests/archive-expression-cases.json, shared with web) | BA | KEEP | Pure parser + cross-language fixture shared with chronicle/web; cheap. |
| 12 | ArchiveHeadCandidateTest.scala | ArchiveHeadCandidateTest | 8 | 266 | 3.43 | full | PG | E-Good | KEEP | HEAD-advance atomicity, RR snapshots and concurrent backfill/prune regressions; real durability/concurrency. |
| 13 | ArchiveIndexTest.scala | ArchiveIndexTest | 18 | 315 | 15.31 | full | PG | BG-Good (one Perf case) | KEEP | Archive browse/sort/cursor/ACL contract. Case :268 (5.8 s) is the plan-shape check that should absorb ArchiveLiteralPlanTest. |
| 14 | ArchiveLexicalIndexTest.scala | ArchiveLexicalIndexTest | 4 | 110 | 2.37 | full | PG | E-Good (PG characterization) | REWRITE-CHEAPER | Case :18 tests PostgreSQL trigram/ILIKE behaviour on temp tables with no Chronicle code (DELETE); case :78 keeps an 'old lower predicate' migration oracle (drop it); cases :38/:64 check pinned-PG Unicode assumptions behind ArchiveProjection.overlapScalars (keep). |
| 15 | ArchiveLiteralPlanTest.scala | ArchiveLiteralPlanTest | 1 | 18 | 0.15 | full | none (constructs Database without PG) | WA | DELETE | Asserts SQL text contains the CTE name 'g0 AS MATERIALIZED' (ArchiveLiteralPlanTest.scala:13) — implementation trivia; keep the performance intent only as a plan/behaviour check in ArchiveIndexTest (:268) before deleting. |
| 16 | ArchiveProjectionTest.scala | ArchiveProjectionTest | 16 | 333 | 5.17 | full | PG | BA + E-Good | KEEP | Fragment projection, migration/backfill ordering, rollback and non-superuser trigram install; real durability/migration contract. |
| 17 | ArchivePublishedFormatTest.scala | ArchivePublishedFormatTest | 2 | 64 | 1.19 | full | PG | B-Good | KEEP | Published-format provenance independent of job state; 2 cases. |
| 18 | ArchiveRelevanceTest.scala | ArchiveRelevanceTest | 10 | 213 | 6.24 | full | PG | B-Good | KEEP | Relevance ordering/cursors per mode; product search contract. |
| 19 | ArchiveSearchTest.scala | ArchiveSearchTest | 14 | 282 | 66.77 | full | PG,SLEEP | B-Good | REWRITE-CHEAPER | Cases :215 (6 s lock hold) and :231 (waits the full 30 s) test the statement deadline using the *fixture's* 30 s JdbcLimits (Fixtures.scala:31; JdbcLimits has no product default, Core.scala:112-120) — use a 1 s configured deadline; case :103 (22 s) ingests a 2 MiB message — shrink to the smallest size that crosses the relevant bound. Remaining 11 cases KEEP. |
| 20 | BrowserWebSocketTest.scala | BrowserWebSocketTest | 21 | 780 | 44.78 | full | PG,HTTP,WS,SLEEP | BG-Good | KEEP | Browser WS authority/cancellation/flooding contract. Case :197 (13 s) waits 1.2 s + 4 s real time for heartbeat behaviour — becomes cheap once WS liveness timings are injectable (see HttpTest). |
| 21 | CheckpointSnapshotBudgetTest.scala | CheckpointSnapshotBudgetTest | 5 | 107 | 1.96 | full | PG | E-Good | KEEP | Immutable snapshot binding and constant validation traffic per claim. |
| 22 | ChronicleJdbcRuntimeTest.scala | ChronicleJdbcRuntimeTest | 6 | 96 | 0.97 | full | PG,FILE (config.example.json) | BG-Good | KEEP | Mandatory JDBC policy fields, deadlines, migrate CLI; validates the shipped example config. |
| 23 | CodecFixtureTest.scala | CodecFixtureTest | 13 | 114 | 0.06 | fast+full | FILE (server/src/test/fixtures/*.json shared with scripts/codec-fixtures.mjs) | BA | KEEP | Cross-language golden bytes shared with the TypeScript codec check; cheap. 'API1.x' names are shape-introduction labels decoded by the sole 1.9.0 codec, not retained protocol versions. |
| 24 | CollectorProgressHttpTest.scala | CollectorProgressHttpTest | 1 | 68 | 0.89 | full | PG,HTTP | BG-Good | KEEP | Production route auth/size cap for collector progress; 1 case. |
| 25 | CollectorProgressTest.scala | CollectorProgressDummyTest, CollectorProgressPostgresTest | 5 | 73 | 3.73 | full | PG (Postgres half) | BA / B-Good (dual) | KEEP | Owner-scoped durable sequences; dual; promote CollectorProgressDummyTest to fast. |
| 26 | ContextCoverageTest.scala | ContextCoverageTest | 6 | 60 | 0.01 | fast+full | none | BA | KEEP | Pure context-coverage kernel. |
| 27 | ContextWorkerRecoveryTest.scala | DummyContextWorkerRecoveryTest, PostgresContextWorkerRecoveryTest | 24 | 281 | 43.13 | full | PG (Postgres half),SLEEP (product back-off) | BG / B-Good (dual) | REWRITE-CHEAPER | Valuable worker recovery contract, but 16 of 24 cases pay Worker.process's fixed 2 s post-failure IO.sleep (Models.scala:219): Dummy half 18.3 s for 12 cases. Inject the back-off (or run under cats-effect TestControl) and promote the dummy half to fast. |
| 28 | CoreTest.scala | CoreTest | 7 | 54 | 0.98 | fast+full | FILE (config.example.json) | BA | KEEP | Config/HTTP policy/profile identity basics; merge target for IngestionBoundsTest and RelocatedModelIdentityTest:25. |
| 29 | CursorWebSocketTest.scala | CursorWebSocketTest | 1 | 106 | 1.72 | full | PG,HTTP,WS | BG-Good | KEEP | Strongest of three long-title continuation tests (real frame guard); merge target for the cursor cases misfiled in RetryFailedActionsTest. |
| 30 | DashboardOperationsTest.scala | DashboardOperationsTest | 3 | 73 | 1.48 | full | PG | B-Good | KEEP | Dashboard dispatch without provider calls; rename 'retained 1.4' wording (sole API is 1.9.0). |
| 31 | ExpressionHintContextTest.scala | ExpressionHintContextTest | 16 | 213 | 0.06 | fast+full | none | BA (labelled BG) | KEEP | Pure hint-context editing semantics. |
| 32 | ExpressionHintsTest.scala | ExpressionHintsDummyTest, ExpressionHintsPostgresTest | 21 | 384 | 5.24 | full | PG (Postgres half) | BA / B-Good (dual) | KEEP | Hint corpus/ACL contract; dual; promote ExpressionHintsDummyTest to fast. |
| 33 | ExtractionBaseline.scala | — | 0 | 375 | 0 | helper | — | helper (frozen production copy) | DELETE | 35 KB test-only copy of pre-extraction production SQL ('Keep while extraction is validated', ExtractionBaseline.scala:3-4); extraction landed in d3de9f96 (2026-11-03). Only user is SharedExtractionDifferentialTest. |
| 34 | Fixtures.scala | — | 0 | 62 | 0 | helper | PG | helper | REWRITE-CHEAPER | Remove the alias extensions legacyOnly/passages that silently map to current (Fixtures.scala:4-8) — they make transition tests degenerate and double fixture work; Fixtures.config() hashes a password per call (~0.15 s, measured indirectly) — hash once per JVM. |
| 35 | HistorianFixtures.scala | — | 0 | 16 | 0 | helper | FILE | helper | KEEP | Historian ingest fixture. |
| 36 | HttpTest.scala | HttpTest | 3 | 192 | 72.82 | full | PG,HTTP,WS,SLEEP | BG-Good | REWRITE-CHEAPER | Cases :19 (17 s model delay + waits past the 20 s ping) and :72 (waits the 10 s hello and 20+10 s pong deadlines) use the hard-coded liveness constants in Http.scala:249-254; make them injectable and test with sub-second values (~67 s saved). Case :114 KEEP. |
| 37 | IndexCheckpointsTest.scala | DummyIndexCheckpointsTest, PostgresIndexCheckpointsTest | 10 | 104 | 2.87 | full | PG (Postgres half) | BG / B-Good (dual) | KEEP | Checkpoint immutability across retry/reclaim; promote dummy to fast. |
| 38 | IndexProfilesTest.scala | IndexProfilesTest | 5 | 73 | 1.26 | full | PG (2 cases) | BA + E-Good | KEEP | Profile/embedding identity and migration seeding. |
| 39 | IndexProgressTest.scala | IndexProgressTest | 5 | 121 | 4.59 | full | PG | B-Good | KEEP | Fenced monotonic progress; one case pays the 2 s worker back-off. |
| 40 | IndexedSearchSnapshotTest.scala | IndexedSearchSnapshotTest | 1 | 96 | 23.14 | full | PG,large corpus (30k rows) | E-Good / W-Good (counts ANN statements via JDBC proxy) | MERGE(→IndexedSearchTest) | Seeds its own 24k+6k-row HNSW corpus (23-30 s) to prove one ANN traversal serves count+page; share IndexedSearchTest's corpus and move with it to the slow tier. |
| 41 | IndexedSearchTest.scala | IndexedSearchTest | 4 | 212 | 111.41 | full | PG,large corpus (12k rows ×32d, 2048×2048d) | Perf-E-Good (planner index choice, ANN recall) | DEMOTE | Performance-purpose assertions (EXPLAIN uses HNSW/GIN, recall ≥0.95) cost 111-133 s; move to a scheduled/explicit slow tier outside the mandatory agent full run. Case :166 (projection/purge) is functional — move it to ArchiveProjectionTest. |
| 42 | IngestionBoundsTest.scala | IngestionBoundsTest | 1 | 9 | 0.14 | full | none | BA | MERGE(→CoreTest) | One config-bound assertion (9 LOC); belongs with the other Config.validate cases. |
| 43 | JsonUtf8SizeTest.scala | JsonUtf8SizeTest | 3 | 34 | 0.01 | full | none | BA | KEEP | Exact UTF-8 accounting vs Circe printer; promote to fast. |
| 44 | LiveMcpGraphTest.scala | LiveMcpGraphTest | 2 | 155 | 1.31 | full | PG | BG-Good | KEEP | Production MCP graph wiring and cancellation of in-flight model request. |
| 45 | McpMessageContextTest.scala | McpMessageContextTest | 3 | 46 | 0.95 | full | PG (via ReadSourceFixture) | BG-Good | KEEP | MCP context tool parser/budgets over a real archive; NOT promotable (measured: fails without PostgreSQL, ReadSourceFixture.scala:110). |
| 46 | McpSearchGuidanceTest.scala | McpSearchGuidanceTest | 6 | 151 | 2.68 | full | PG | B-Good | KEEP | MCP discovery/search syntax guidance against real websearch semantics. |
| 47 | McpSourceAdmissionTest.scala | McpSourceAdmissionTest | 15 | 145 | 4.63 | full | PG | W-Good (JDBC proxy via ReadSourceFixture) + BG-Good | KEEP | Admission-before-payload is a real resource-safety contract, but 9 of 12 cases are whitebox (observe JDBC column reads); accept as deliberate, do not extend. |
| 48 | McpSourceBoundaryTest.scala | McpSourceBoundaryTest | 14 | 190 | 16.22 | full | PG,SLEEP (5 s product deadline) | BG-Good / W-Good | KEEP | Revocation/logout races and SELECT-only role; case :143 waits a product 5 s constant. |
| 49 | McpTagSearchTest.scala | McpTagSearchTest | 9 | 160 | 3.21 | full | PG | B-Good | MERGE(→TagSearchTest) | Cases :81, :88, :97 repeat TagSearchTest :61, :92, :69 (empty tag position, long legacy tags, Unicode-lower substring) through the MCP layer; keep only MCP-specific cases (:37 discovery, :105 strict args, :122 scopes, :134 admission, :147 logout). |
| 50 | McpTestFixtures.scala | — | 0 | 125 | 0 | helper | none | helper | KEEP | Manual clock/model fixtures for MCP test runs. |
| 51 | McpTestLimitsTest.scala | McpTestLimitsTest | 11 | 249 | 3.1 | full | none | BG | KEEP | MCP test-run limits (product feature 'MCP test runs', not test machinery); pure; promote to fast. |
| 52 | McpTestModelTest.scala | McpTestModelTest | 9 | 208 | 4.8 | full | HTTP | BG + B-Good (loopback) | KEEP | MCP tester model adapter contract. |
| 53 | McpTestRunsTest.scala | McpTestRunsTest | 23 | 618 | 1.75 | full | none | BG | KEEP | Run lifecycle/cancellation/authorization races with a manual clock — a good cheap vehicle; promote to fast. |
| 54 | McpTestWireTest.scala | McpTestWireTest | 4 | 79 | 0.01 | full | none | BA | KEEP | Tester wire encoding/caps; promote to fast. |
| 55 | McpTextPresentationTest.scala | McpTextPresentationTest | 12 | 320 | 2.4 | full | PG (ReadSourceFixture cases) | BG / B-Good | KEEP | Opt-in text presentation contract. |
| 56 | MessageContextBoundaryTest.scala | MessageContextBoundaryTest | 10 | 120 | 8.26 | full | PG,SLEEP (5 s product deadline) | B-Good / W-Good | KEEP | Context read bounds, SELECT-only role, lock deadline; case :104 waits MessageContext.statementDeadlineMillis=5000 (MessageContext.scala:19) — make injectable if the slow tier is not adopted. |
| 57 | MessageContextFailureTest.scala | MessageContextFailureTest | 2 | 38 | 0.01 | full | none | BG | KEEP | Failure attribution in one-shot runs; pure; promote. |
| 58 | MessageContextHttpTest.scala | MessageContextHttpTest | 8 | 139 | 6.28 | full | PG,HTTP | BG-Good | KEEP | Public HTTP context authority/framing. |
| 59 | MessageContextTest.scala | MessageContextDummyTest, MessageContextPostgresTest | 28 | 220 | 8.72 | full | PG (Postgres half) | BG / B-Good (dual) | KEEP | Context excerpt contract; promote MessageContextDummyTest. |
| 60 | ModelAccountingHttpTest.scala | InProcessModelAccountingTest, LoopbackModelAccountingTest | 14 | 261 | 8.59 | full | HTTP (loopback half) | BG / B-Good (InProcess vs Loopback) | KEEP | Usage accounting/cancellation; promote InProcessModelAccountingTest. |
| 61 | ModelAdmissionTest.scala | ModelAdmissionTest | 3 | 40 | 0.18 | full | FILE (config.example.json) | BA | KEEP | Capacity defaults/validation; promote. |
| 62 | ModelFixtures.scala | — | 0 | 25 | 0 | helper | none | helper | KEEP | Model graph fixtures. |
| 63 | ModelGraphTest.scala | ModelGraphTest | 1 | 42 | 0.22 | full | none | BG | KEEP | Production graph shares telemetry; promote. |
| 64 | ModelHttpTest.scala | ModelHttpTest | 6 | 95 | 10.24 | full | HTTP | BG-Good | KEEP | Provider request/response validation. |
| 65 | ModelIdentityMigrationTest.scala | ModelIdentityMigrationTest | 9 | 268 | 6.12 | full | PG | BG-Good | KEEP | Retained-data model identity migration; KEEP only while deployed databases may still hold pre-migration rows (open question). |
| 66 | ModelRejectionTest.scala | ModelRejectionTest | 66 | 197 | 0.03 | full | none | BA | KEEP | 66 cheap table-driven typed rejection cases (0.03 s); promote. |
| 67 | ModelTelemetryTest.scala | ModelTelemetryTest | 19 | 404 | 0.42 | full | none | BA | KEEP | Manual-clock telemetry; promote. Case :316 asserts the verbatim ch_users DDL line from 001.sql (ModelTelemetryTest.scala:322-326) — delete that source-text assertion. |
| 68 | ModelTransportTest.scala | ModelTransportTest | 4 | 51 | 142.22 | full | HTTP,SLEEP (65 s ×2) | B-Good | REWRITE-CHEAPER | Two 65 s regressions (:23 headers, :28 body gap) both prove that the client idle timeout derives from Models.transportTimeout (Models.scala:35) instead of Ember's 60 s default: keep one in the slow tier and add a BA check on the derived client setting; :34/:42 KEEP. |
| 69 | ModelUsageViewTest.scala | ModelUsageViewTest | 4 | 98 | 0.03 | full | none | BG | KEEP | Usage API semantics; promote. |
| 70 | NativeResourcesTest.scala | NativeResourcesTest | 3 | 29 | 0.01 | full | FILE (migrations/, native-image.properties) | BA (packaging) | KEEP | Case :14 guards native-image resource selectors vs migrations (real packaging regression); cases :8/:11 are subsumed by it and by every PG suite that loads migrations from the classpath — delete them; promote. |
| 71 | NulIngestionTest.scala | NulIngestionTest | 1 | 80 | 2.15 | full | PG,HTTP | BG-Good | KEEP | Regression for NUL survival through HTTP ingestion. |
| 72 | OwnerDisabledTest.scala | OwnerDisabledTest | 7 | 72 | 2.79 | full | PG | B-Good / E-Good | KEEP | Disabled-owner claim semantics incl. lock-wait race. |
| 73 | OwnerLeaseBoundaryTest.scala | OwnerLeaseBoundaryTest | 8 | 43 | 12.25 | full | PG,SLEEP (1.2 s lease expiry) | E-Good (8 generated) | KEEP | Real lease-expiry-during-lock-wait regressions; leases use the DB clock with 1 s minimum, so real time is the honest vehicle; parallelism removes its wall cost. |
| 74 | OwnerProfilesTest.scala | OwnerProfilesDummyTest, OwnerProfilesPostgresTest, OwnerProfilePostgresTest | 17 | 210 | 6.14 | full | PG | BA / B-Good (dual) + E-Good | KEEP | Owner reindex contract; fix OwnerProfilePostgres.withDatabase, which initializes twice per test because both catalogs alias current (OwnerProfilesTest.scala:96-103). |
| 75 | OwnerReindexActionsTest.scala | OwnerReindexActionsTest | 16 | 279 | 11.62 | full | PG | B-Good / E-Good | KEEP | Receipt/savepoint/rollback contract of owner reindex actions. |
| 76 | OwnerTargetConcurrencyTest.scala | OwnerTargetConcurrencyTest | 4 | 100 | 4.08 | full | PG,SLEEP | E-Good | KEEP | Lock-order/lease concurrency regressions with pg_sleep trigger; real concurrency value. |
| 77 | OwnerTargetRegressionTest.scala | OwnerTargetRegressionTest | 2 | 39 | 0.69 | full | PG | B-Good | MERGE(→OwnerProfilesTest) | Case :18 ('another owner's pending legacy claim') duplicates OwnerProfilesTest.scala:13 and is degenerate since passages() aliases current (Fixtures.scala:7) — delete; move case :30 into OwnerProfilesTest. |
| 78 | PassagePersistenceTest.scala | PassagePersistenceDummyTest, PassagePersistencePostgresTest | 22 | 224 | 7.08 | full | PG (Postgres half) | BG / B-Good (dual) | KEEP | Passage persistence/ACL/pin contract; promote dummy. |
| 79 | PassagePostgresBoundaryTest.scala | PassagePostgresBoundaryTest | 8 | 137 | 7.24 | full | PG,SLEEP (lease expiry) | E-Good | KEEP | Atomic rollback on lease expiry/SQL failure; real durability. |
| 80 | PassageWorkerTest.scala | DummyPassageWorkerTest, PostgresPassageWorkerTest | 20 | 279 | 30.97 | full | PG (Postgres half),SLEEP (product back-off) | BG / B-Good (dual) | REWRITE-CHEAPER | Valuable worker contract; ~10 of 20 cases pay the 2 s Worker failure back-off (Models.scala:219). Inject it; promote DummyPassageWorkerTest. |
| 81 | PersistentBrowserSessionTest.scala | PersistentBrowserSessionTest | 12 | 290 | 23.39 | full | PG,HTTP,SLEEP | BG-Good / E-Good | KEEP | Session persistence/renewal/expiry races; sleeps of 1.2 s and seconds+0.1 track DB-clock expiry (:55, :183, :210) — acceptable. |
| 82 | PostgresBehaviorTest.scala | PostgresBehaviorTest | 22 | 334 | 11.25 | full | PG | BG-Good | KEEP | 22 PostgreSQL adapter regressions; grab-bag but each guards distinct behaviour. |
| 83 | ProblemPassageHttpTest.scala | ProblemPassageHttpTest | 17 | 188 | 4.02 | full | HTTP | BG + loopback half of ProblemPassageContract | KEEP | Re-runs the ProblemPassage contract against the HTTP adapter plus adapter-specific cases. |
| 84 | ProblemPassagesTest.scala | ProblemPassagesTest | 23 | 336 | 0.74 | fast+full | none | BA/BG | KEEP | Core passage kernel; fast set. |
| 85 | ProblemsPublicationTest.scala | ProblemsPublicationTest | 3 | 76 | 0.05 | fast+full | none | BG | KEEP | Publication builder invariants; fast set. |
| 86 | ProtocolEvolutionTest.scala | ProtocolEvolutionTest | 2 | 17 | 0.0 | fast+full | none | BA | MERGE(→ApiVersionCompatibilityTest) | Removed/future version rejection (ProtocolEvolutionTest.scala:12-16) duplicates ApiVersionCompatibilityTest.scala:18-23; merge the version-info assertion (:6-10) there. |
| 87 | ProvenanceTest.scala | ProvenanceTest | 3 | 13 | 0.48 | full | none | BA | KEEP | Snapshot parent/record-index validation; promote. |
| 88 | ProviderUsageTest.scala | ProviderUsageTest | 10 | 86 | 0.03 | fast+full | none | BA | KEEP | Provider usage parsing; fast set. |
| 89 | ReadSourceFixture.scala | — | 0 | 121 | 0 | helper | PG | helper (whitebox JDBC proxy) | KEEP | Shared proxy driver for admission tests; keep but treat as a whitebox smell. |
| 90 | ReadSourcesTest.scala | ReadSourcesTest | 2 | 16 | 0.0 | full | none | BA | KEEP | Read budget arithmetic; promote. |
| 91 | RebuildRetirementTest.scala | DummyRebuildRetirementTest, PostgresRebuildRetirementTest | 2 | 43 | 0.61 | full | PG (Postgres half) | B-Good (dual) | KEEP | Retirement of superseded views; promote dummy. |
| 92 | RecordedYoloProfileTest.scala | RecordedYoloProfileTest | 1 | 16 | 0.0 | full | FILE (tests/recorded-yolo-profile-cases.json, shared with web) | BA | KEEP | Cross-language fixture; promote. |
| 93 | ReindexCohortTest.scala | ReindexCohortTest | 9 | 180 | 4.37 | full | PG | B-Good | KEEP | Reindex cohort status/replay; also hosts CurrentIndexDatabase helper (discovered: it is a FunSuite, run normally). |
| 94 | RelocatedModelIdentityTest.scala | RelocatedModelIdentityTest | 3 | 40 | 0.16 | full | none | BA / WA | MERGE(→ModelIdentityMigrationTest (case :4), CoreTest (case :25)) | Case :31 duplicates CoreTest.scala:30-37 and IndexProfilesTest.scala:25 (relocation preserves identity) — delete; other two cases move to their owners. |
| 95 | RetryFailedActionsTest.scala | RetryFailedActionsTest | 19 | 375 | 11.31 | full | PG | B-Good | KEEP | Retry preview/apply receipts and rollback. Cursor cases :303-:360 are misfiled; :319 duplicates CursorWebSocketTest.scala:21 (delete), move :303/:335/:360 to CursorWebSocketTest. |
| 96 | RetryFailedJobsTest.scala | RetryFailedJobsTest | 18 | 464 | 7.37 | full | PG | E-Good / W-Good | KEEP | Retry selection/lock order/TEMP privilege; real concurrency. |
| 97 | RevisionSortAnchorTest.scala | RevisionSortAnchorTest | 4 | 43 | 0.01 | fast+full | none | BA | KEEP | Pure; fast set. |
| 98 | RunAuthorizationTest.scala | DummyRunAuthorizationTest, PostgresRunAuthorizationTest | 25 | 237 | 11.94 | full | PG (Postgres half),SLEEP (:214 600 ms) | BG / B-Good (dual) | KEEP | Captured-authority revalidation; promote DummyRunAuthorizationTest. |
| 99 | SessionMessageSearchBoundaryTest.scala | SessionMessageSearchBoundaryTest | 5 | 60 | 6.54 | full | PG,SLEEP (5 s product deadline) | B-Good | MERGE(→SessionMessageSearchTest (Postgres half)) | Five more cases of the same feature with its own fixture; case :29 waits SessionMessageSearch.statementDeadlineMillis=5000 (SessionMessageSearch.scala:24). |
| 100 | SessionMessageSearchTest.scala | SessionMessageSearchDummyTest, SessionMessageSearchPostgresTest | 28 | 200 | 7.61 | full | PG (Postgres half) | BG / B-Good (dual) | KEEP | Find-in-session contract; promote dummy. |
| 101 | SharedExtractionDifferentialTest.scala | SharedExtractionDifferentialTest | 2 | 66 | 7.41 | full | PG | B-Good (differential vs frozen copy) | DELETE | Characterization scaffolding for the finished retrieval extraction: compares production against ExtractionBaseline incl. SQL text equality (SharedExtractionDifferentialTest.scala:40,:58); 7.4 s. |
| 102 | StaticHttpTest.scala | StaticHttpTest | 14 | 170 | 2.54 | full | HTTP | B-Good | KEEP | Static asset caching/traversal/security headers (regression #34); no PG — promote. |
| 103 | StaticTokenTest.scala | StaticTokenTest | 3 | 67 | 1.19 | full | PG (1 case),FILE | BA + BG-Good | KEEP | Static token config/reconciliation. |
| 104 | StoredPublicationFixtures.scala | — | 0 | 29 | 0 | helper | PG | helper | KEEP | Historical payload importer; lifetime tied to the retained-data question. |
| 105 | TagSearchTest.scala | TagSearchTest | 15 | 233 | 4.48 | full | PG | BG-Good / W-Good | KEEP | Tag catalog contract; merge target for McpTagSearchTest duplicates. |
| 106 | TestPublications.scala | — | 0 | 39 | 0 | helper | none | helper | KEEP | Synthetic publication builder. |
| 107 | TokenVisibilityTest.scala | TokenVisibilityTest | 3 | 54 | 2.64 | full | PG | B-Good | KEEP | Revoked-history must not hide active tokens; 100-token cap. |
| 108 | VersionedSearchTest.scala | VersionedSearchTest | 1 | 156 | 9.28 | full | PG,HTTP,WS | BG-Good (E2E smoke) | KEEP | Single end-to-end WS workflow over a 1205-row corpus; rename (no other versions exist). |

## 4. Detailed findings

### 4.1 DELETE

| What | Evidence | Cost now | Why it is junk |
|---|---|---|---|
| `SharedExtractionDifferentialTest.scala` (2 cases) **and** `ExtractionBaseline.scala` (375 LOC, 35 KB) | `ExtractionBaseline.scala:3-4`: "Test-only differential oracle copied from pre-extraction source e9fda183 … Keep while extraction is validated." Only user is `SharedExtractionDifferentialTest.scala:32,46`. The extraction commit is d3de9f96 (2026-11-03). The test also asserts SQL **text** equality (`SharedExtractionDifferentialTest.scala:40,58`). | 7.4 s; 441 LOC of test code that must keep compiling against product interfaces. | Characterization scaffolding for a finished port. Production search behaviour is covered directly by `ArchiveIndexTest`, `ArchiveSearchTest`, `ArchiveRelevanceTest`, `PostgresBehaviorTest` and `TagSearchTest`. |
| `ArchiveLiteralPlanTest.scala` (1 case) | `:13` asserts `sql.text.contains("g0 AS MATERIALIZED")` and `:14` asserts that the SQL contains `head_candidate`. | 0.2 s | Asserts implementation trivia (a CTE name). The performance intent, materializing global trigram candidates, should be a plan/behaviour assertion in `ArchiveIndexTest` (see `:268`, which already uses exact scan control). Add that before deleting. |
| `ModelTelemetryTest.scala:322-326` (assertion inside the case at `:316`) | Reads `001.sql` and compares one DDL line verbatim. | ≈ 0 | Greps migration source text. The behaviour (opaque owner IDs are accepted end-to-end) is asserted by the rest of the case. |
| `ArchiveLexicalIndexTest.scala:18` (case) | Creates a temp table and a raw `ILIKE` GIN index and asserts that PostgreSQL drops the Kelvin sign under the C locale. No Chronicle code is exercised. | 0.5 s | Characterizes the dependency, not the product. The product's folded-GIN agreement is covered by `:78`. |
| `OwnerTargetRegressionTest.scala:18` (case) | Same scenario as `OwnerProfilesTest.scala:13`: rebuilding owner "a" must keep owner "b"'s claim publishable. Its "legacy" vs "new policy" distinction no longer exists because `IndexProfileCatalog.passages(...)` is an alias of `current` (`Fixtures.scala:4-8`). | 0.3 s | Duplicated by a stronger test, and degenerate. |
| `RelocatedModelIdentityTest.scala:31` (case) | Same assertion as `CoreTest.scala:30-37` and `IndexProfilesTest.scala:25`: transport relocation preserves profile/space identity. | ≈ 0 | Duplicate. |
| `ActivityTest.scala:504` and `RetryFailedActionsTest.scala:319` (cases) | Both prove that a long-Title Activity continuation fits the WebSocket frame bound, which `CursorWebSocketTest.scala:21` proves through the real frame guard (Archive and Activity). | ≈ 1 s | Triple coverage of one regression. Keep the real-transport version. |
| `McpTagSearchTest.scala:81, :88, :97` (cases) | Repeat `TagSearchTest.scala:61` (empty tag keyset position), `:92` (long legacy tags as positions) and `:69` (Unicode-lower literal substring) through the MCP tool, with the same data shapes. | ≈ 0.6 s | Domain behaviour is already covered at the index layer. The MCP-specific argument parsing is covered by `McpTagSearchTest.scala:105`. |
| `NativeResourcesTest.scala:8, :11` (cases) | Assert that two specific migration files are on the classpath. | ≈ 0 | Subsumed by `:14` (all migrations included in the native-image resource selectors) and by every PostgreSQL suite, since `Database.initialize()` loads all migrations from the classpath. |
| `ProtocolEvolutionTest.scala:12-16` (case) | Same loop over `1.0.0..1.8.0`, `2.0.0` and the empty offer as `ApiVersionCompatibilityTest.scala:18-23`. | ≈ 0 | Duplicate. Merge `:6-10` (version info) into `ApiVersionCompatibilityTest`. |

Not deleted, though they may look like junk:

- **`CodecFixtureTest`**: the "API1.4/1.6/1.7/1.8" goldens are cross-language byte fixtures shared with `scripts/codec-fixtures.mjs` and decoded by the sole 1.9.0 codec.
- **`ArchiveExpressionTest` and `RecordedYoloProfileTest`**: their JSON case files are shared with `chronicle/web/tests`.
- **`NativeResourcesTest:14`**: a real packaging guard.
- **`ChronicleJdbcRuntimeTest`, `CoreTest`, `ModelAdmissionTest`, `StaticTokenTest`**: they parse `config.example.json`. That keeps the shipped example decodable, which is product documentation that would otherwise rot.
- **`ModelIdentityMigrationTest`, `PersistentBrowserSessionTest:61`, `StoredPublicationFixtures`, and the `LegacyAnnotations` cases in `DashboardOperationsTest:46` and `PassagePostgresBoundaryTest:77`**: these guard reading or migrating retained data. Whether such data still exists in deployed databases decides their fate (Open question 2).

### 4.2 MERGE

| Source → target | Evidence | Gain |
|---|---|---|
| `ProtocolEvolutionTest` → `ApiVersionCompatibilityTest` | See §4.1. | One version-policy suite. |
| `IngestionBoundsTest` → `CoreTest` | 9 LOC, one `Config.validate` bound (`IngestionBoundsTest.scala:3-8`), next to `CoreTest`'s config cases. | Fewer files. |
| `RelocatedModelIdentityTest` → `ModelIdentityMigrationTest` (`:4`, plan-file loader) + `CoreTest` (`:25`, standby wiring); `:31` deleted | A three-case grab-bag. | Ownership. |
| `OwnerTargetRegressionTest:30` → `OwnerProfilesTest` (Postgres half); `:18` deleted | Same `OwnerProfilePostgres` fixture family. | Fixture reuse. |
| `McpTagSearchTest` → keep MCP-specific cases (`:37`, `:59`, `:105`, `:122`, `:134`, `:147`); move nothing else | See §4.1. | −3 cases. |
| `SessionMessageSearchBoundaryTest` → `SessionMessageSearchTest` (Postgres half) | Five more cases of the same feature with a parallel fixture (`SessionMessageSearchBoundaryTest.scala:9-44`). | One fixture. |
| `IndexedSearchSnapshotTest` → `IndexedSearchTest`, in the slow tier | Seeds its own 24 000 + 6 000-row HNSW corpus (`IndexedSearchSnapshotTest.scala:13-14`) next to `IndexedSearchTest`'s 12 000-row corpus (`IndexedSearchTest.scala:10`). | ≈ 20 s per slow-tier run if one corpus serves both. |
| `RetryFailedActionsTest:303, :335, :360` (cursor-continuation cases) → `CursorWebSocketTest` | Misfiled in a retry suite (`RetryFailedActionsTest.scala:300-375`). | Cohesion. |

I did not propose merging the many small `Archive*`, `Owner*` and `MessageContext*` files wholesale. Each has its own fixture per test, so merging files without changing fixture scope saves no time. The time win comes from per-suite fixtures (§5), not from moving files.

### 4.3 REWRITE-CHEAPER (the bulk of the recoverable time)

| Suite / cases | Current vehicle (measured, run 2) | Cheaper vehicle | Saving (estimate) |
|---|---|---|---|
| `ModelTransportTest:23`, `:28` | Real Ember server that sleeps 65 s for headers and for a body gap: 65.5 s + 65.6 s. | One 65 s case moved to the slow tier, plus a BA assertion that `ModelHttp.client(config)` sets the idle/header timeout from `Models.transportTimeout` (`Models.scala:35`). Needs a small seam exposing the derived settings. | −131 s mandatory (+65 s slow tier) |
| `HttpTest:19`, `:72` | Real server, model delayed 17 s, client waits 19 s to cross the 20 s ping; four sockets wait for the 10 s hello and 20 + 10 s pong deadlines. 36.9 s + 34.0 s. | Pass a `SocketLiveness(hello, pingEvery, pongWithin)` into `Http.routes`; constants live in `Http.scala:249-254`. Tests use 100–300 ms; one BA test pins the production values. | −65 s |
| `BrowserWebSocketTest:197` | 1.2 s + 4 s real sleeps around heartbeat/refresh: 14.3 s. | Same liveness seam. | −12 s |
| `ArchiveSearchTest:231` ("default 30 s deadline") | Holds an ACCESS EXCLUSIVE lock and waits 30.2 s. The "default" is the fixture's `JdbcLimits` statement timeout (`Fixtures.scala:31`); production requires an explicit value (`Core.scala:112-120`). | Configure 1 s and assert `deadline` plus elapsed time ≥ 1 s. | −29 s |
| `ArchiveSearchTest:215` (6 s wait) | 6.3 s | Configure a 2 s statement timeout and hold the lock 1 s. | −4 s |
| `ArchiveSearchTest:103` (2 MiB literal) | 21.1 s (11 literal searches plus context reads over a 2 MiB message). | Use the smallest message that still places the match beyond the fragment/overlap bound; probably tens of KiB (verify against `ArchiveProjection` constants). | ≈ −15 to −18 s |
| `ContextWorkerRecoveryTest` (both halves), `PassageWorkerTest` (both halves), `IndexProgressTest:84` | 29 cases ≥ 2 s, 70.9 s in total. Each failed job pays `IO.sleep(2.seconds)` (`Models.scala:219`). | Inject the post-failure back-off (production default 2 s, pinned by a BA test), or run under `cats.effect.testkit.TestControl`. | ≈ −58 s |
| `Fixtures.config()` / per-test PostgreSQL fixture | Per-case floor 0.27–0.42 s. PBKDF2 600k iterations ≈ 150 ms per call (measured); `Database.initialize()` plus a wide `TRUNCATE … CASCADE` per test; `OwnerProfilePostgres.withDatabase` initializes twice. | Hash once per JVM (`lazy val`), initialize once per suite, reset with one TRUNCATE (or clone a template database per suite, §5), and remove the alias extensions. | ≈ −60 to −140 s (estimate; not measured directly) |
| `ArchiveLexicalIndexTest:78` | Includes an "old lower predicate" oracle (`:90`, `:102`, `:105`), which is migration scaffolding. | Drop the old-predicate leg and keep stored-index vs scan vs `ILIKE` original. | small |
| Product 5 s statement constants (`MessageContext.scala:19`, `SessionMessageSearch.scala:24`, `ExpressionHints.scala:107`): `SessionMessageSearchBoundaryTest:29`, `MessageContextBoundaryTest:104`, `McpSourceBoundaryTest:143` | ≈ 5.3 s each. | Optional: make the deadline injectable. Low priority once sharded. | ≈ −15 s |

DEMOTE (to a new slow/perf tier, outside the mandatory agent run): `IndexedSearchTest` (Performance purpose: `EXPLAIN` must show HNSW/GIN, ANN recall ≥ 0.95; 111 s). Do the same for the merged snapshot case and the surviving 65 s `ModelTransportTest` case. These are worth running before releases and on schedule. They should not gate every agent task. This is a policy change (Open question 1).

Kept despite real-time cost (honest vehicles):
- **`OwnerLeaseBoundaryTest`** (8 × 1.5 s): leases expire on the **database** clock with a 1 s minimum.
- **`OwnerTargetConcurrencyTest`**: uses a `pg_sleep` trigger.
- **`PassagePostgresBoundaryTest`** lease-expiry cases.
- **`PersistentBrowserSessionTest`** expiry cases: also on the database clock.

Their cost disappears under sharding.

### 4.4 Taxonomy observations
- **Dual tests exist and are good:** 15 contracts run against an in-memory dummy and PostgreSQL (or in-process vs loopback HTTP). The dummy halves are the obvious fast-path material and are currently unused there.
- **Whitebox clusters:**
  - `ReadSourceFixture` is a JDBC proxy recording statements and payload-column reads. It is used by `McpSourceAdmissionTest` (9 WG cases), `TagSearchTest:187-215` and `MessageContextBoundaryTest`.
  - `IndexedSearchSnapshotTest`'s statement counter.
  - These guard a real resource-safety property: nothing is materialized before admission. They are refactoring-hostile, though. Accept them and do not extend the pattern.
- **Names carry taxonomy labels** ("BG GoodCommunication specified: …") that are often inaccurate: `ExpressionHintContextTest` is labelled BG but is pure BA, and `ActivityTest` is labelled "Atomic/GoodCommunication". The labels belong in metadata, not test names.

## 5. Parallelism: blockers and plan

Blockers (observed):
1. **sbt configuration:** a single forked test JVM with `Test / parallelExecution := false` (`build.sbt:209-210`, comment: "PostgreSQL suites truncate shared tables and mutate profile state").
2. **One shared database** (`postgres` on one cluster):
   - nearly every PostgreSQL fixture runs a wide `TRUNCATE … CASCADE` and resets the singletons `ch_profile` and `ch_owner_targets`;
   - `IndexedSearchTest` keeps a seeded corpus in a mutable field across cases (`:21`);
   - tests install **triggers on shared tables** (`OwnerTargetConcurrencyTest:85-86`, `PassagePostgresBoundaryTest:32,48`, `ArchiveHeadCandidateTest:227`, `ArchiveProjectionTest:118`).
3. **`Database.initialize()` takes `pg_advisory_xact_lock(71393721)`**, which serializes initialization across connections. That is fine per database, but it is a cluster-wide contention point if all suites share one database.
4. **Lock-wait probes poll `pg_stat_activity WHERE datname=current_database() AND query LIKE …`** (`OwnerLeaseBoundaryTest:9`, `OwnerDisabledTest:46`, `OwnerTargetConcurrencyTest:10`). Concurrent suites in the *same* database would produce false positives. Separate databases fix this.
5. **Cluster-global objects:**
   - `CREATE ROLE` with random names (`McpSourceBoundaryTest:125`, `TagSearchTest:221`, `ArchiveProjectionTest:298`, …) and `CREATE DATABASE` (`ArchiveProjectionTest:300`). These do not collide, but they need a cluster shared safely.
   - `CREATE EXTENSION IF NOT EXISTS`: race-prone across databases only on first creation; pre-create it in the template.
6. **Process-wide state:**
   - `DriverManager.registerDriver` with unique URL prefixes. Safe across JVMs; within one JVM, prefix-scoped.
   - Global `cats.effect.unsafe.implicits.global` runtimes. CPU-bound only.
7. **Clean on other axes:** no fixed ports (every server uses `Port.fromInt(0)`), no fixed temp paths (`Files.createTempDirectory`).

Cheapest safe route:
1. In `test-postgres.sh`, create one cluster. Run migrations once into a `chronicle_template` database (users and extensions included).
2. In `build.sbt`, set `Test / testGrouping` to N groups (LPT by recorded suite time, or simply hash-sharded). Each group is a `Tests.SubProcess(ForkOptions().withEnvVars(Map("CHRONICLE_TEST_JDBC" -> …/chronicle_g$i)))`, with `Test / concurrentRestrictions += Tags.limit(Tags.ForkedTestGroup, N)`. Before the run, clone each database with `CREATE DATABASE chronicle_g$i TEMPLATE chronicle_template`.
3. Keep `parallelExecution := false` inside a group, so suites in one group still share their database serially. The invariant becomes "one suite at a time per database".
4. Extend `validation-report.py`'s union check, which already compares discovered, reported and selected suites, so that it is unchanged in meaning across groups.

Measured proof of concept: 8 groups, implemented here as 8 sbt processes in private copies with 8 clusters (heavier than the template plan), ran all 1 009 cases green in **173.6 s vs 909 s**. The shard walls (138–171 s) are bounded below by the longest suite (`ModelTransportTest`, 145 s) plus ≈ 25 s of sbt start, cluster start and compile cache check per shard. After the §4.3 rewrites, the longest suites are ≈ 30–45 s (`BrowserWebSocketTest`, `ArchiveSearchTest` after rewrite). 8–16 groups would then be bounded by ≈ 50–75 s total.

## 6. Projected impact

Basis: run 2 (measured). Savings are estimates computed from measured case times and the residual costs stated in §4.3.

| Metric | Now | After verdicts | After verdicts + sharding |
|---|---|---|---|
| Suites (sbt classes) | 116 | ≈ 108, of which 107 mandatory (−SharedExtractionDifferential, −ProtocolEvolution, −IngestionBounds, −RelocatedModelIdentity, −OwnerTargetRegression, −SessionMessageSearchBoundary, −ArchiveLiteralPlan, −IndexedSearchSnapshot as a separate class; IndexedSearch* move to the slow tier) | same |
| Cases in the mandatory full run | 1 009 | ≈ 990 (−≈ 14 deleted/duplicate, −5 moved to the slow tier) | same |
| Test LOC | 17 556 | ≈ 17 000 (−≈ 550, mostly `ExtractionBaseline`/differential) | same |
| Mandatory full backend, serial | 909 s wall / 899.5 s test | **≈ 440 s** without the fixture work; **≈ 340 s** with it | — |
| Mandatory full backend, 8 groups | 173.6 s (measured) | — | **≈ 60–75 s** |
| Mandatory full backend, 16 groups | — | — | **≈ 50 s** (bounded by the longest suite + startup) |
| Slow/perf tier | — | ≈ 200 s serial (`IndexedSearch*` 134 s + one 65 s transport case) | ≈ 130 s (2 groups) |
| Routine (fast) subset | 13 suites / 132 cases / 2–4 s test | 42 suites / ≈ 405 cases / ≈ 22 s test with today's fixtures (measured for the 29 promotable suites) → ≈ 8 s after the fixture-hash fix (estimate) | — |
| Routine compile share attributable to tests | ≈ 15 s (near-cold, 108 sources) | ≈ 14 s | — |

Contributions to the serial reduction (estimates):

| Change | Saving |
|---|---|
| Perf tier | −134 s |
| Transport | −131 s |
| WebSocket liveness | −77 s |
| `ArchiveSearch` deadlines and size | −50 s |
| Worker back-off | −58 s |
| Scaffolding delete | −7 s |
| Duplicates | −3 s |
| **Subtotal** | **−460 s** |
| Fixture hash/initialize work | further −60 to −140 s |

## 7. Risks of acting on these verdicts and how to verify nothing valuable was lost

- **Injected timings drift from production values.** A seam for liveness/back-off/deadline values could let tests pass while production constants change. Mitigation: one BA test per seam asserts the production default (e.g. hello 10 s, ping 20 s, pong 10 s, back-off 2 s). The tests must keep exercising the **same code path**, only with smaller values. Check by mutation: temporarily remove the timeout/back-off call and confirm the cheap test fails.
- **The single 65 s transport regression ends up in the slow tier.** If that tier is never run, an Ember upgrade could silently reintroduce the 60 s cutoff. Mitigation: the BA test on the derived client settings, plus a scheduled slow tier with an owner. Make the tier's last-run timestamp visible.
- **Deleting duplicates.** Before each deletion, record `retained test that covers it` (the JSON's `rationale` names it). Verify by temporarily breaking the guarded line in a scratch branch:
  - long-title continuation: `CursorWebSocketTest`;
  - tag keyset: `TagSearchTest`;
  - relocation identity: `CoreTest`;
  - version rejection: `ApiVersionCompatibilityTest`.

  The retained test must fail.
- **Removing `ExtractionBaseline`** loses the only proof that the post-extraction SQL equals the pre-extraction SQL. Two weeks after the extraction landed and with the direct suites green, this is acceptable. Run the differential one last time on the deletion commit and record the green result.
- **Sharding exposes hidden order dependence.** The shard experiment reshuffled suites into eight different orders and everything passed. That is one sample. Run the grouped configuration ≥ 3 times with different group assignments (e.g. a seeded shuffle) before declaring it stable, and keep a serial fallback command.
- **Promoting dummy halves to the routine path** makes routine builds depend on more code. All 29 suites were measured green in the fast-path environment. The routine fast-test time grows from ≈ 4 s to ≈ 22 s until the fixture-hash fix lands.
- **Coverage accounting.** Collect line/branch coverage (scoverage or a JaCoCo agent on the forked JVM) on the pre-change commit and on the post-change commit. Diff by file and investigate any newly uncovered branch before merging. This is the most direct check that a deletion lost nothing.

## 8. Documentation and policy that must change with the suites

- **Root `AGENTS.md` ("Chronicle validation"):**
  - "Keep shared-database tests serial" (`:21`) must become "one suite at a time per database; groups use separate databases cloned from the migrated template".
  - "Preserve real deadline/concurrency assertions; do not shorten deadlines" (`:41-42`) currently forbids the §4.3 rewrites as literally worded. Re-word it to distinguish *shortening a deadline to obtain a pass* (still forbidden) from *testing the deadline mechanism with an injected small value while a separate test pins the production value* (allowed). State that the slow/perf tier exists, what it contains and when it must run.
- **`chronicle/README.md`:**
  - "Fast Nix checks and full agent verification" (`:44-84`): the 13-suite count (`:46`), the full-run command and the serial-database wording (`:82-84`).
  - Document the slow tier command.
- **`chronicle/scripts/fast-suites.txt`:** add the 29 promoted suites. The validation regex in `test-fast.sh` (`^chronicle\.[A-Za-z][A-Za-z0-9]*Test$`) already accepts their names.
- **`chronicle/scripts/test-postgres.sh`:** template database plus grouping, a slow-tier entry point and an explicit serial fallback.
- **`build.sbt`:**
  - `chronicleServer` `Test / testGrouping` and `concurrentRestrictions`;
  - the comment on `parallelExecution` (`:209-210`);
  - `Test / validationInventory` stays the discovered-suite list. Decide whether slow-tier suites are excluded from `testFull` by a tag (munit `Tag`) or by a separate sbt configuration.
- **Other agents' areas** (`nix/tests/…`; please coordinate) that pin the current runner shape:
  - `nix/tests/backend-runner-contract.py:25,39-40` asserts the exact sbt task list of `test-postgres.sh` and `test-fast.sh`;
  - `nix/tests/backend-source.nix:72-74,148-150` and `nix/tests/chronicle-evidence-layout.nix:17` reference `fast-suites.txt` and `validation-report.py`;
  - `nix/pkg/chronicle/validation-evidence.py:52-58` and `nix/tests/chronicle-validation-policy.py:186` bind the inventory into the package receipt.

  Changing `fast-suites.txt` changes the receipt's claimed scope (README `:67-73`).
- **Test-name labels:** if taxonomy tags are kept, move them from test names into munit tags so renames are not churn.

## 9. Open questions (with recommendations)

1. **May the mandatory agent full run exclude a slow/perf tier** (`IndexedSearch*` and one 65 s transport case)? *Recommendation:* yes. Run the tier on a schedule and before releases, with its own documented command and an owner. Keeping it mandatory costs ≈ 200 s serial, or ≈ 145 s on the critical path even when sharded.
2. **Can deployed Chronicle databases still contain pre-migration data** (`LegacyAnnotations` generations, pre-persistent browser sessions, old model identities)? If no, `ModelIdentityMigrationTest` (9 cases), `PersistentBrowserSessionTest:61`, `StoredPublicationFixtures` and the legacy-format cases in `DashboardOperationsTest`/`PassagePostgresBoundaryTest` can be deleted together with the corresponding product migration code. *Recommendation:* the owner checks the production databases; keep the tests until then.
3. **Is a small product seam acceptable** (injectable `SocketLiveness`, worker failure back-off, `ModelHttp` client settings exposure) purely for testability? *Recommendation:* yes. Each is a constructor parameter with the current constant as its default, pinned by a BA test.
4. **Number of groups for the sharded full run.** *Recommendation:* start with `min(16, nproc/8)`. The work is I/O- and sleep-bound, so contention matters less than the longest suite.
5. **Host note:** run 1 needed an `LD_PRELOAD` shim because the per-user inotify instance limit (128) was exhausted by `git fsmonitor--daemon` processes. The limit is now 8192, and all conclusions here use the shim-free runs. Should the build environment keep `core.fsmonitor` enabled for agent worktrees? Outside my scope; I flag it because it can break sbt at project load.

## 10. Important behaviour without a test (brief; searched by name and grep only)

- **Production timing constants:** none of the WebSocket hello/ping/pong constants, the worker back-off or the renewal cadence (`Models.scala:208`, 30 s lease renewal) is pinned by a cheap test. They are only exercised indirectly through real-time waits, which is why those waits exist.
- **Native binary behaviour:** backend tests run on the JVM only. The native image is checked only for resource-selector completeness (`NativeResourcesTest:14`). No test in this area starts the native binary. README `:192` records a one-off manual SIGTERM probe.
- **Graceful shutdown under load:** SIGTERM with in-flight WebSocket/MCP runs. I found no test by name; README `:190-192` documents a manual observation.
- **Upgrade from the previous *released* schema dump:** migrations are tested from synthetic partial schemas (`ArchiveProjectionTest`, `IndexProfilesTest:40`, `ModelIdentityMigrationTest`), not from a snapshot of a real prior release.
