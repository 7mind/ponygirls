# Manure test-suite triage (analysis only)

Source: commit `f153d1ae` (worktree `wt-ponygirls-f153d1ae3f48-1794947845118`).
Machine-readable rows: `docs/drafts/20261117-2040-test-triage-manure.json` (91 rows).
Raw timing data: `/home/pavel/work/flakes/ponygirls/.local/overhaul-20261117/reports/triage-manure/`.

## 1. Executive summary

**Where the time goes (measured, shared host, load average 132–192 on 128 cores):**

| Vehicle | Runs | Wall | Notes |
|---|---|---|---|
| `checks.manure-native` equivalent (target-suite `--scope full` against the native ELF) | 412 Python + 35 Node + 1 codec | **1043 s** | Rerun outside the sandbox with the derivation's exact inputs. 1 failure was caused by the host (see §5). Python cases took 1040 s, run serially. |
| `checks.manure-backend` (`nix build --rebuild`) | 22 munit suites / 274 cases | **229 s** | 153 s of serial test time; about 76 s of sbt start-up and compilation. |
| `checks.manure-posix-acceptance` | 32 FS cases × (JVM + static native probe) | 70 s | Includes the probe's native-image build. |
| `checks.manure-client` | 4 phases | 23.5 s | |
| `checks.manure-direct-jni` | 1257 assertions | 3.4 s | |
| `checks.manure-config` | 4 | 1.1 s | |
| `manure` package build (viewer `checkPhase`) | 30 Node cases | 7 s total; tests take 0.25 s | This is the **only** Manure testing inside the package build. |
| `checks.manure-portable-root` (VM), `checks.manure-vm` | — | not measured | Their outputs were absent from the store at this commit. |

The routine package path is therefore already cheap. The cost is in the checks, and almost entirely in two of them:
- **`manure-native`** (17 min, serial): Chromium plus the real server.
- **`manure-backend`** (4 min).

Both checks take `sources.manureTargetTests` as input, which is the whole of `manure/` plus `shared/`. As a result, **editing a doc, a Python test or the 2.2k-line inventory JSON reruns both**: about 21 min of tests for a non-code change (`nix/tests/manure-backend.nix:6`, `nix/tests/manure-native.nix:30`).

**Verdict totals (91 rows):**

| Verdict | Rows | Cases | LOC | Measured seconds |
|---|---|---|---|---|
| KEEP | 51 | 1861 | 13.4k | 536 |
| REWRITE-CHEAPER | 6 | 34 | 1.8k | 505 |
| MERGE | 13 | 104 | 2.6k | 205 |
| DEMOTE | 3 | 45 | 1.5k | 39 |
| DELETE | 18 | 220 | 7.6k | 7.5 |

- Case counts include the 1257 JNI assertions and the 64 probe legs.
- DELETE is large in LOC but small in time: the 7 retired modules (6.3k LOC, 165 cases) never run.

**Top 10 actions, by value:**
1. **Remove the 60-second real-TTL waits** (REWRITE-CHEAPER). Four cases spend about 245 s, roughly 24 % of the full Python run, sleeping until the minimum 60 s TTL expires:
   - `test_browser_dashboard.py:794-796` (63.5 s)
   - `test_browser_dashboard_ux.py:23,35` (60.7 s in setUpClass)
   - `test_client_realserver.py:689-698` (63.9 s)
   - `test_target_search.py:225-227` (63.7 s)

   Fix: the fixture already owns the database (`OwnedDatabase.runtime_sql`), so set `expires_at` in the past with SQL. Keep a single real-clock expiry assertion at the Scala level, where `TestClock` exists (`BackendFixture.scala:15`).
2. **Shard `manure-native` into parallel derivations or workers** (§5). Every module already uses a fresh database, a fresh payload root and port 0. Estimated wall time after sharding: about 100 s instead of about 1040 s.
3. **Narrow the test-source inputs** so that `manure-backend` depends only on Scala/SQL sources and `manure-native` does not depend on docs, the inventory or unrelated test files (Nix agent).
4. **DELETE the 7 architecture-retired modules** (6253 LOC, 165 cases, never executed; `scripts/target-suite.py:27-28`). Also delete the test-the-harness and evidence modules:
   - `test_current_test_inventory`, `test_current_target_harness`, `test_artifact_source_manifest`, `test_mcp_environment`
   - `test_dashboard_markup`, `test_catalogue_casefold_oracle`, `test_retired_server_entrypoint`, `test_client_stateful`
   - `network-capture.test.mjs`, `ProbeRuntimeClasspathSuite`
   - `TestE1FailFirstRecords`, `TestCurrentErrorEnvelope`, `TestAssetHygiene`
   - the frozen `server/native-tests/verification/` receipts
5. **Replace the inventory gate** (`current-test-inventory.json` 2231 lines + `target-suite.py` 420 lines + `docs/behavior-inventory.md` 739 lines) with a plain runner that fails on any failure, error or skip. The exact-ID gate is the main obstacle to sharding, and it doubles every test-change edit.
6. **Collapse the browser suffix-mode matrices** (MERGE):
   - `test_browser_unlock`: `UnlockRateLimitCase` inherits and reruns all 8 flows (`:363`).
   - `test_browser_dashboard` flows × 2 (`:826/:830`).
   - `test_browser_isolation` × 2.
   - `test_browser_viewers`: the full ~76-check script runs in both modes (142 s).

   Run origin-sensitive cases in every mode and everything else once.
7. **Move plain-HTTP assertions out of browser tests** into `HttpSuite`: the isolation header set and reserved prefixes (`test_browser_isolation.py:114,277`). Remove the executable-level duplicates of `RootBindingPolicySuite` (`test_target_root_identity`).
8. **Enable parallel suites for `manureServer` in sbt.** The fixtures create a unique database and role per test (`BackendFixture.scala:44,49`), but `Test / parallelExecution := false` comes from the shared `serviceSettings` (`build.sbt:88`). Estimated test time drops from 153 s to about 40 s. Also make `CheckConfigSuite` cheaper (14.8 s of child JVMs, duplicated by the 1 s `manure-config` check) and the 6.4 s real deadline in `RootAuthoritySuite`.
9. **DEMOTE to full verification only:**
   - offline SQLite→PG conversion (`test_offline_conversion`, `test_target_migration`), pending an owner decision to retire it (§9);
   - the 35 s layout matrix;
   - the portable-root VM probe.
10. **Fix the `localhost` ↔ `[::1]` hazard** before any parallelisation. It is a reproduced cross-process failure (§5).

## 2. Method and measurement conditions

- **Static inventory:** read all of `manure/tests/**`, the Scala suites, `server/native-tests`, the viewer tests, `scripts/{target-suite.py,test-backend.sh,test-target.sh,run-owned-target.sh}`, `build.sbt`, `nix/pkg/manure/*`, `nix/pkg/services/native.nix`, `nix/tests/manure-*.nix` and the check matrix. Case counts come from `current-test-inventory.json` for current Python modules and from counting `def test_` for retired modules. LOC is from `wc -l`.
- **`manure-native` timing:**
  - Script: `bin/run-native-full-timed.sh`. It reproduces `nix/tests/manure-native.nix` outside the sandbox with the exact store paths from its `.drv`:
    - native ELF `50rjsjb…-manure-native-artifact`;
    - Chromium 157, playwright-core 1.64.1 and the MCP SDK;
    - source `10zgmf…-manure-target-tests-source`;
    - `with-owned-postgres.py` with a short `/tmp` TMPDIR.
  - `bin/timed-target-suite.py` wraps `target-suite.py` and records per-test start/stop times and the gap between tests. The gap is setUpClass, i.e. server/browser fixture cost.
  - Output: `native-full-timing.jsonl` and `native-full-per-module.txt`. Load went from 134.6 at start to 192.5 at end.
  - **Not measured:** wall time inside the Nix sandbox. The cached output carries no timings.
- **Scala timing:** `nix build --rebuild --keep-failed .#checks.x86_64-linux.manure-backend`. It runs as `nixbld`, so the inotify limit did not apply and the LD_PRELOAD shim was **not used** anywhere.
  - Per-case JUnit times come from the kept `.check` output and are copied to `backend-check-xml/`.
  - Load average at start: about 150.
  - `rc=1` only because `--rebuild` reported non-determinism: receipt timestamps differ. All tests passed.
  - A direct dev-shell `test-backend.sh` attempt failed at sbt load on the then-exhausted inotify limit (`backend-run.log`). It was not retried after the fix.
- **Other checks:** `--rebuild` timings for `manure-client`, `manure-direct-jni` and `manure-posix-acceptance`, a first build of `manure-config` and a rebuild of `manure.viewer` (`rebuild-*.log`, `*-wall.txt`).
- **Pure Python modules, run standalone:** `pure-modules-timing.txt`, load about 151. 20 modules took about 37 s in total; only `test_cli_ux` (10 s), `test_client_secret_files` (6.9 s) and `test_credential_preflight` (5.7 s) exceed 2 s.
- **Caveat:** all numbers were taken on a host at 1.0–1.5× CPU oversubscription, so absolute values are inflated. Use the relative ordering. `test_browser_path_mode` (103 s) is inflated by about 75 s of step timeouts from the host-induced failure.

## 3. Inventory

Columns:
- **Runs in.** `N` = `checks.manure-native`; the same run also backs `manure-browser` and the `manure-unittests` composite, and in full verification `test-target.sh jvm|native full`. `B` = `checks.manure-backend` plus `test-backend.sh`.
- **Needs.** T = target server + owned PostgreSQL; C = Chromium; S = MCP SDK; PG = own initdb; VM = NixOS VM; FS = Linux filesystem / JNI.
- **Seconds.** Module total from the native run, including the fixture gap.

### Python (`manure/tests`)

| File | Cases | LOC | s | Runs | Needs | Tags | Verdict | Rationale |
|---|---|---|---|---|---|---|---|---|
| test_catalogue, test_server_http_opt_in, test_server_lifecycle, test_server_limits, test_server_path_mode, test_server_security, test_storage_durability | 12/5/18/29/9/41/51 | 288/155/935/1271/189/1398/2017 | 0 | none | — | Whitebox-Group (retired SQLite/Python server) | **DELETE** | Never executed; retired implementation |
| test_artifact_source_manifest | 4 | 129 | 0.5 | N | — | Effectual-Group on build-evidence script | **DELETE** | Tests evidence binding, not product |
| test_catalogue_casefold_oracle | 1 | 85 | 0.2 | N | — | Whitebox-Atomic (retired SQLite) | **DELETE** | Covered by CatalogueContract + native probe |
| test_cli_output | 19 | 337 | 0.5 | N | — | BG | KEEP | |
| test_cli_resume | 14 | 363 | 0.1 | N | — | BG | KEEP | |
| test_cli_ux | 17 | 349 | 10.2 | N | — | BG / Effectual (PTY) | KEEP | |
| test_client_external | 5 | 213 | 0.1 | N | — | BG (dummy) | KEEP | |
| test_client_hardening | 49 | 2031 | 1.7 | N | — | BG / Effectual-Group (FS) | KEEP (delete E1 class) | |
| test_client_secret_files | 8 | 198 | 6.7 | N | — | Effectual-Group | KEEP | |
| test_client_stateful | 3 | 292 | 1.6 | N | — | BG (Python fake server) | **DELETE** | Duplicated three times over |
| test_client_transport | 25 | 727 | 4.6 | N | — | BG | KEEP | |
| test_credential_preflight | 8 | 148 | 4.6 | N | — | BA/BG | KEEP | |
| test_current_client | 6 | 210 | 0.1 | N | — | BG | KEEP | |
| test_current_protocol | 10 | 119 | 0.1 | N | — | BG | KEEP | |
| test_current_target_harness | 6 | 110 | 0.3 | N | — | tests the harness | **DELETE** | |
| test_current_test_inventory | 14 | 172 | 0.2 | N | — | tests the inventory gate | **DELETE** | |
| test_dashboard_markup | 11 | 141 | 0.1 | N | — | Whitebox-Atomic (markup ids) | **DELETE** | Ids exercised by browser journeys |
| test_mcp_environment | 1 | 34 | 2.9 | N | T | tests the harness (reruns other tests) | **DELETE** | |
| test_mcp_hardening | 11 | 254 | 0.6 | N | — | BG | MERGE → test_mcp_protocol | Same subject/harness |
| test_mcp_protocol | 9 | 364 | 1.1 | N | S | BG | KEEP | |
| test_metadata_client | 8 | 132 | 0.1 | N | — | BA/BG | KEEP | |
| test_offline_conversion | 30 | 940 | 29.9 | N | PG | BA + Effectual-GoodComm | DEMOTE | One-time migration tool |
| test_query | 7 | 110 | 0.0 | N | — | BA/BG | KEEP | |
| test_retired_server_entrypoint | 5 | 196 | 1.3 | N | — | Effectual-Group (retired entrypoint) | **DELETE** | Moot once server.py deleted |
| test_browser_access_modes | 2 | 42 (+453 mjs) | 39.4 | N | T,C | Effectual-GoodComm | KEEP | |
| test_browser_dashboard | 29 | 836 | 124.9 | N | T,C | Effectual-GoodComm; hygiene = source grep | MERGE (+DELETE hygiene, REWRITE expiry) | |
| test_browser_dashboard_ux | 2 | 65 (+560+376 mjs) | 152.3 | N | T,C | Effectual-GoodComm | REWRITE-CHEAPER (+DEMOTE layout) | 60 s TTL wait |
| test_browser_handoff | 4 | 144 | 11.2 | N | T,C | Effectual-GoodComm | KEEP | |
| test_browser_http_opt_in | 1 | 51 | 6.8 | N | T,C | Effectual-GoodComm | KEEP | |
| test_browser_isolation | 15 | 333 | 27.8 | N | T,C | Effectual-GoodComm; 3 helper tests | MERGE → HttpSuite (+DELETE helper tests) | |
| test_browser_path_mode | 4 | 195 | 103.2* | N | T,C | Effectual-GoodComm | KEEP | *inflated by host failure |
| test_browser_query_expression | 2 | 68 | 8.2 | N | T,C | Effectual-GoodComm | KEEP | |
| test_browser_quick_upload | 3 | 171 | 16.6 | N | T,C | Effectual-GoodComm | KEEP | |
| test_browser_tls | 5 | 456 | 26.9 | N | T,C,openssl | Effectual-GoodComm | KEEP | |
| test_browser_unlock | 34 | 420 | 40.4 | N | T,C | Effectual-GoodComm | MERGE (table-driven) | Rate-limit class reruns 8 flows |
| test_browser_viewers | 2 | 195 (+454 mjs) | 143.6 | N | T,C | Effectual-GoodComm | REWRITE-CHEAPER | Full script repeated per mode |
| test_cli_process | 4 | 222 | 20.4 | N | T | Effectual-GoodComm | KEEP | |
| test_client_realserver | 15 | 967 | 97.8 | N | T,S | Effectual-GoodComm | REWRITE-CHEAPER | 64 s TTL wait |
| test_target_durability | 8 | 342 | 55.9 | N | T | Effectual-GoodComm | KEEP | Real crash/shutdown |
| test_target_migration | 2 | 224 | 9.1 | N | T,PG | Effectual-GoodComm | DEMOTE | Offline converter |
| test_target_root_identity | 7 | 142 | 10.8 | N | T | Effectual-GoodComm | MERGE (drop Scala duplicates) | |
| test_target_search | 2 | 314 | 77.6 | N | T,C | Effectual-GoodComm | REWRITE-CHEAPER | 64 s TTL wait |
| portable_root_probe.py | 13 checks | 312 | n/m | manure-portable-root | VM,T | Effectual-GoodComm | DEMOTE | Not measured |

### Node, codec and viewer

| File | Cases | s | Runs | Tags | Verdict |
|---|---|---|---|---|---|
| tests/browser/current-protocol.test.mjs | 10 | 0.21 | N | BG | KEEP |
| tests/browser/network-capture.test.mjs | 9 | 0.16 | N | tests a test helper | **DELETE** |
| tests/browser/query-expression.test.mjs | 8 | 0.27 | N | BA | KEEP |
| tests/browser/quick-upload.test.mjs | 8 | 0.32 | N | BG | KEEP |
| scripts/codec-fixtures.mjs | 1 (76 vectors) | 0.12 | N | BG | MERGE → current-protocol.test.mjs |
| web/viewer/test/{markdown,pdf-page,safety}.test.mjs | 30 | 0.25 total | package `manure` (viewer checkPhase) | BA | KEEP |
| web/viewer/test/*.browser.mjs (7 files) | 7 | n/m | **nothing** (`npm run test:browser` is not wired) | BG + Chromium | MERGE → one browser run in full verification, or delete |

### Scala (all in B; timings from the `--rebuild` JUnit XML)

| Suite | Cases | s | Needs | Tags | Verdict |
|---|---|---|---|---|---|
| HttpSuite | 32 | 25.2 | — | BG | KEEP |
| RootAuthoritySuite | 12 | 18.7 | TLS loopback | Effectual-Group | REWRITE-CHEAPER (6.4 s deadline) |
| PostgresCatalogueSuite / MemoryCatalogueSuite | 33/33 | 16.9/6.1 | PG / — | dual test | KEEP |
| CheckConfigSuite | 1 | 14.8 | child JVMs | Effectual-Group | REWRITE-CHEAPER (or rely on manure-config) |
| RootMigrationSuite | 19 | 13.8 | PG,FS | Effectual-GoodComm | KEEP |
| ArtifactsPostgresSuite / ArtifactsMemorySuite | 21/21 | 12.1/4.6 | PG / FS | dual test | KEEP |
| AccountsPostgresSuite / AccountsMemorySuite | 8/8 | 9.0/5.0 | PG | dual test | KEEP |
| RuntimeSuite | 10 | 6.3 | PG,FS | Effectual-GoodComm | KEEP |
| RootBindingPolicySuite | 12 | 5.4 | PG,FS | Effectual-GoodComm | KEEP |
| PostgresAdmissionSuite | 8 | 4.2 | PG | Effectual-GoodComm (concurrency) | KEEP |
| MetadataSearchSuite | 2 | 3.7 | PG | BG | KEEP |
| ConfinedDirectorySuite (FilesystemBehavior) | 32 | 2.6 | FS/JNI | Effectual-Atomic | KEEP |
| WideAudienceAuditSuite | 1 | 2.1 | PG | regression | KEEP |
| RootIdentitySuite, AcquisitionFailureSuite, WiringDiagnosticSuite, SecretBoundarySuite, DomainSuite | 7/1/3/2/7 | ≤1 each | — | BA/BG | KEEP |
| ProbeRuntimeClasspathSuite | 1 | 0.3 | — | tests the harness | **DELETE** |

### Other checks

| Check | What it runs | s | Verdict |
|---|---|---|---|
| manure-posix-acceptance | FilesystemBehavior on JVM `--shared` **and** a static native probe | 69.8 | KEEP the native leg; drop the JVM leg, which is identical to ConfinedDirectorySuite |
| manure-direct-jni | NativeSelfTest with `-Xcheck:jni` | 3.4 | KEEP; drop the hard-coded `1257/1263` assertion-count gate |
| manure-client | Installed CLI/MCP/SDK smoke | 23.5 | KEEP |
| manure-config | Native `check-config` parse-only | 1.1 | KEEP (it is in no composite) |
| server/native-tests/verification/** | Frozen logs and receipts | — | **DELETE** |

## 4. Detailed findings

### DELETE

- **Retired implementation, about 6.3k LOC.**
  - `scripts/target-suite.py:27-28` lists 7 modules as `LEGACY_IMPLEMENTATION_MODULES`.
  - The inventory registers them as `architecture-retired` with no cases; `select_tests` takes only `current` entries.
  - They import `manure.server` / `manure.storage` (`test_catalogue.py`, `test_server_*.py`, `test_storage_durability.py`).
  - Their only remaining role is as `sourceRefs` markers inside `invariantGroups`, which is evidence machinery.
  - `manure/README.md:534` still tells developers to `unittest discover`, which **would run them** against the retired Python server.
- **Harness and evidence tests:**
  - `test_current_test_inventory.py:31-172` tests registration, selection, report freshness and the hermetic environment of the gate.
  - `test_current_target_harness.py:16-110` tests that fixtures refuse unsafe URLs and descriptors.
  - `test_artifact_source_manifest.py:56-129` tests `scripts/artifact-source.py`, the source-binding manifest. Nix already content-addresses inputs.
  - `test_mcp_environment.py:12-34` runs other test IDs, including a real-server case, in a subprocess.
  - `test_browser_isolation.py:302-330` tests `bf.HttpResult`.
  - `network-capture.test.mjs` tests `network-capture.mjs`: "Test-only CDP network evidence capture", line 1.
  - `ProbeRuntimeClasspathSuite.scala` tests the test classpath.
  - `test_client_hardening.py:1793-2031` (`TestE1FailFirstRecords`) runs mutant "old branch" scripts to print FAIL records "so frozen suite output contains FAIL records" (its docstring).
- **Source-text greps:** `test_browser_dashboard.py:29-108` (`TestAssetHygiene`) asserts that banned identifiers or literal strings are absent from `app.js`/`unlock.js`/HTML. If the no-`innerHTML` policy matters, enforce it as a lint rule, not a unittest. XSS exploitability is tested in the browser (`b7_hostile_sibling`).
- **Markup trivia:** `test_dashboard_markup.py:40-141` asserts element ids and attributes. The same ids are driven by the journeys in `dashboard-ux.mjs` / `test_browser_dashboard`.
- **Retired behaviour:**
  - `test_catalogue_casefold_oracle.py:19` runs the historical SQLite oracle. Casefold is covered by `CatalogueContract.scala:67,237` (both legs) and `test_target_durability.py:104` (native all-scalar probe).
  - `test_retired_server_entrypoint.py:94-196` guards refusal of `manure/manure/server.py`, which should itself be deleted; its CLI/MCP registration cases are covered by `checks.manure-client`.
- **Duplicated by stronger tests:** `test_client_stateful.py`:
  - `:159` is covered by `test_current_client.py:113` and `test_client_realserver.py:121,193`;
  - `:186` by `test_cli_process.py:72-104` (actual target) and `manure-client`;
  - `:248` by `test_cli_process.py:108`.
- **Frozen logs:** `server/native-tests/verification/**` holds historical JNI logs, digests and setup-failure transcripts (its README: "historical … retained unchanged").

### MERGE

- `test_browser_unlock.py`:
  - `UnlockRateLimitCase(UnlockFlows, …)` (`:363`) inherits all 8 flow cases (34 = 8 × 4 + 2).
  - `Sibling`/`Separate`/`BuiltinSibling` (`:344-361`) rerun all flows.
  - Make it table-driven: full flows once; mode-dependent cases (round trip, wrong password, asset serving) per mode; the rate-limit class with only its 2 cases. Saves about 15 s.
- `test_browser_dashboard.py:110-770` (`DashboardFlows`) runs in two modes (`:826,:830`), 11 cases each, about 27 s per mode. Origin-dependent cases are `b1_*csp*`, `b1_*headers*`, `b7_*` and `d1_open_*`; the rest (list/detail/delete, rotate, logout DOM, detail failure) are mode-independent. Saves about 20 s.
- `test_browser_isolation.py:114` (header set) and `:277` (reserved prefixes) are plain HTTP checks repeated in two modes against the native binary.
  - `HttpSuite.scala:527` checks only `frame-ancestors`; add the remaining headers there.
  - `DomainSuite.scala:28` already rejects `api/x` and `__manure/x`.
- `test_target_root_identity.py:54,74,100,115` duplicate `RootBindingPolicySuite.scala:25,45,59,70` and `RootMigrationSuite.scala:111`. Keep `:136,:140` (CLI error stage) and one refusal smoke.
- `test_mcp_hardening.py` → `test_mcp_protocol.py`: same JSON-RPC subject and stdio harness.
- `scripts/codec-fixtures.mjs` → a `node:test` case in `current-protocol.test.mjs`. This removes the `requiredOutputLines` string matching in `target-suite.py:334`.
- `web/viewer/test/*.browser.mjs`: 7 files executed by no script or check. Run them in one browser launch inside the full check, or delete them.

### REWRITE-CHEAPER

- **Real 60 s TTL waits (about 245 s):** see action 1. Production enforces `ttl ≥ 60` (`Domain.scala:185`), so the tests wait in real time "by design" (`browser_fixtures.py:788-797`: "no backend clock override").
  - The fixture owns the database. An `UPDATE manure.artifacts SET expires_at_s_value=…` is already the style of `test_target_search.py:225`, which *reads* that column.
  - Real-clock expiry stays covered in Scala with a controlled clock: `ArtifactsContract.scala:304`, `CatalogueContract.scala:112`.
- `test_browser_viewers.py:191-195` with `browser/viewers.mjs` runs about 76 checks per mode, 68 + 74 s. Render checks once; authorisation and origin checks per mode. Saves about 65 s.
- **Layout matrix:** `DashboardLayoutTests` (35 s) runs 10 widths × light/dark. DEMOTE it to full verification; it is visual regression.
- `CheckConfigSuite.scala:20` spends 14.8 s spawning JVM children. `checks.manure-config` covers the same contract on the shipped native binary in 1.1 s. Keep one of the two.
- `RootAuthoritySuite` "body deadline …" takes 6.4 s waiting on a real deadline. Configure a shorter deadline in the fixture.

### DEMOTE

- `test_offline_conversion.py` (30 cases, 30 s) and `test_target_migration.py` (2 cases, 9 s) cover the one-time SQLite→PG migration. Move them to full verification; delete them with `manure/migration/offline.py`, `manure/manure/{server,storage,domain}.py` and the legacy refusal cases in `RuntimeSuite` once the owner confirms no legacy state remains (§9).
- `portable_root_probe.py` (VM): full and release verification only.

### KEEP (notable)

- The genuinely slow tests stay as they are:
  - `test_target_durability` (SIGKILL/shutdown windows with PG triggers, 56 s);
  - `test_cli_process` (kill/resume against the real binary);
  - `PostgresAdmissionSuite` (concurrency);
  - the dual-test Memory/Postgres contract suites, which are the textbook `dual-tests` pattern.
- The pure Python client tests are cheap: about 37 s for 20 modules standalone, almost all of it subprocess/PTY/FIFO cases.

## 5. Parallelism blockers and plan

**Blockers (observed in code unless stated):**
1. **A single serial runner per check.** `target-suite.py` runs every selected case in one `unittest` process under a 1800 s whole-suite timeout. `manure-native.nix` is a single derivation, so Nix cannot spread it across cores.
2. **The exact inventory gate.** `validate_declared_ids` and `select_tests(scope=full)` require the full selection in one process (`target-suite.py:97-105,155-178`). Sharding needs this gate removed, or shard-aware merging.
3. **`localhost` vs `[::1]` collision (reproduced).**
   - The target server binds `127.0.0.1:<ephemeral>`. Tests navigate to `localhost:<port>` (e.g. `test_browser_path_mode.py:67`).
   - Chromium resolved `localhost` to `::1`, where another agent's `java` (pid 2774887) was listening on the *same* port number: `ss -ltnp` showed `[::1]:40451`. The result was `ERR_INVALID_HTTP_RESPONSE` and about 75 s of timeouts.
   - Inside the Nix sandbox this cannot happen; on shared hosts, or with several shards on one host, it can.
   - Fix: navigate to `127.0.0.1`, or add `MAP localhost 127.0.0.1` to the existing `--host-resolver-rules` (`browser_fixtures.py:48-50`).
4. **Bind-close-reuse ports** in `test_target_search.py:81,253`: a TOCTOU race under parallel load.
5. **One Node+Chromium launch per `run_steps` call** (`browser_fixtures.py:105-129`, 26 call sites plus 5 standalone `.mjs` scenario launches) and **one server + database per test** in `test_client_realserver` and `test_target_*`. These cost time but do not prevent parallelism.
6. **Process-global monkeypatch** of `socket.getaddrinfo` (`browser_fixtures.py:519-528`). Shard by process, not by thread.
7. **sbt:** `Test / parallelExecution := false` from `serviceSettings` (`build.sbt:88`; the Chronicle comment at `:209` explains why it exists there). Manure fixtures use a unique database (`BackendFixture.scala:44`), a unique role (`:49`), port 0 and temp roots. Not yet verified to be parallel-safe.
8. **`test-backend.sh` / `test-target.sh`** write fixed in-tree paths (`manure/backend/target/test-reports`, `target-runs`) and run sbt in the checkout. Two runs in the same worktree are unsafe; use separate worktrees.
9. **Owned PostgreSQL provisioning** is serialised by `flock` (`nix/tests/provision-owned-database.py:30`). This is safe; it serialises only database creation.

**Plan, cheapest first:**
1. Fix 3 and 4.
2. Replace the gate (2) with "run, then fail on any fail/error/skip".
3. Split `manure-native` into 3–4 derivations: client/MCP/target non-browser; browser-A; browser-B; durability+migration. Each gets its own owned cluster, and Nix runs them concurrently.

   Alternatively, add `--shard i/n` to the runner and launch n workers against one owned cluster. Balance by module, using the measured seconds in the JSON.
4. Set `manureServer / Test / parallelExecution := true`. Verify by running the suite about 10 times with zero flakes.
5. Optionally reuse one Chromium per module through a long-lived step server instead of one launch per `run_steps` call.

## 6. Projected impact (estimates, derived from the measured numbers above)

| | Now (measured) | After verdicts (est.) | After verdicts + parallel (est.) |
|---|---|---|---|
| Python/Node suite (`manure-native`) | 1043 s; 412 + 35 + 1 cases; 48 modules | about 610 s routine / 685 s full; about 330 cases, about 37 modules | about 100–120 s wall: longest shard about the viewer module (~75 s) plus fixtures |
| Scala (`manure-backend`) | 229 s wall (153 s tests); 274 cases | about 210 s (−15 s CheckConfig, −5 s deadline) | about 110–120 s: about 76 s sbt + about 40 s parallel tests |
| Python test LOC (`manure/tests` incl. JSON/fixtures) | 27.4k | about 17k: −6.3k retired, −2.2k inventory JSON, about −1.5k harness/evidence/duplicates | — |
| Non-code edit under `manure/` | reruns about 21 min | — | about 0 once test inputs are narrowed (Nix agent) |

How the after-verdicts estimate is derived:
- Savings: TTL waits about −230 s; viewer matrix −65; dashboard/unlock/isolation matrices −45; DELETE rows −8; root-identity duplicates −4.
- DEMOTE rows (layout 35 s, offline+migration 39 s) leave the routine set.
- The 75 s host-collision inflation is excluded.

## 7. Risks and how to verify nothing valuable was lost

- **Retired-module deletion.** Their requirements are claimed to be mapped to current tests through `invariantGroups`. Before deleting, extract that mapping once into a short coverage note: invariant → current test ID. Confirm every `targetRefs` test still exists after the other deletions.
- **TTL rewrite.** Moving expiry into SQL skips the real clock path in the binary. Keep the Scala controlled-clock expiry tests, and keep one native case that checks `410` for an artifact whose stored expiry is in the past.
- **Matrix collapse.** For each dropped mode variant, record which origin, cookie or host property the case depends on. Run the full old matrix once before and once after on the same commit and diff the pass sets.
- **Mutation spot-check** of security-relevant collapses: revert a CSP header, the reserved-prefix check and the unlock rate limit one at a time, and confirm the reduced suite still fails.
- **sbt parallelism.** Run 10× under `parallelExecution := true`. Any flake means revert for that suite.
- **Inventory removal.** Replace it with a runner that refuses skips and a non-zero test count, so a mis-discovered module does not silently pass. That property is real; the per-ID ledger is not needed for it.

## 8. Documentation and policy text that must change

- `manure/tests/current-test-inventory.json`, `manure/scripts/target-suite.py` (`LEGACY_IMPLEMENTATION_MODULES`, `requiredOutputLines`, inventory/exact-ID validation), `manure/docs/behavior-inventory.md`.
  - The last one is already stale: it says "33 CURRENT Python modules / 335 case IDs"; 412 execute.
- `nix/tests/manure-check-matrix.md`.
- `nix/tests/manure-unittests.nix`: asserts the exact portable receipt keys and the backend/native receipt shape.
- `nix/tests/manure-native.nix`: receipt assertions on `inventoryMatches`.
- `nix/pkg/manure/direct-jni.nix`: assertion-count equality `1257/1263`.
- `manure/README.md:524-566` ("Tests"): the `unittest discover` instruction would run the retired modules; the `MANURE_FIREFOX_BIN` text and others need updating.
- `manure/docs/acceptance-toolchain.md` and `manure/scripts/acceptance-tools-x86_64-linux.json` pin Chromium 156 store paths; the check uses 157.
- `manure/server/native-tests/README.md`: references `verification/`.
- The evidence and validation docs (`manure/docs/*-validation.md`, `path-session-continuation-evidence.md`) quote counts and receipts. Archive them or drop the counts.
- `manure/migration/VALIDATION.md` and `docs/offline-conversion.md` go with the offline decision.
- `AGENTS.md` has no Manure section. If a routine/full split is introduced, document it there, as Chronicle's section does.

## 9. Open questions (with recommendations)

1. **Has every Manure deployment been migrated off SQLite?** If yes:
   - delete `migration/offline.py`;
   - delete `test_offline_conversion` and `test_target_migration`;
   - delete the legacy refusal cases in `RuntimeSuite`;
   - delete `manure/manure/{server,storage,domain}.py`, moving `auth.generate_token` and `sha256_hex` to a test helper;
   - drop the Python claim-interop case in `FilesystemBehavior`.

   Recommendation: confirm and delete. Until then, DEMOTE.
2. **Is `manure-portable-root` / Kubernetes CSI root authority on the roadmap?** The VM probe was not built at this commit. Recommendation: full verification only, plus a timing run before deciding.
3. **Should the source/artifact binding machinery stay?** This covers `artifact-source.py`, `compiled-inputs.sha256` comparison and receipts. It is the Nix agent's call. Recommendation: remove it; Nix input addressing already guarantees it.
4. **JVM target mode.** `test-target.sh jvm full` re-executes the same 412 cases against the jar. No Nix check runs it. Recommendation: drop it from mandatory policy; native is what ships.

## 10. Important behaviour without tests (brief)

- The viewer browser behaviours in `web/viewer/test/*.browser.mjs` (heading permalinks, image fit, Mermaid, section copy, sibling links, task state, raw Markdown) run in **no** gate.
- `checks.manure-config` is not part of any composite, so a native-only config-parse regression is caught only if someone builds that check explicitly.
- The behaviour of servers bound to `127.0.0.1` when clients use `localhost` (IPv6-first resolution) is untested in the product. The test suite tripped over it.
