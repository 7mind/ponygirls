# Test-suite and check-graph overhaul plan (Chronicle, Haystack, Manure, shared, Nix)

Base commit `f153d1ae`. Planning only: no product code, test or Nix expression is changed by this document.
Author: test-overhaul lead. Inputs: the build profile and five triage reports in
`/home/pavel/work/flakes/ponygirls/.local/overhaul-20261117/reports/tests/` (raw data next to them under `reports/{build-profile,triage-*}/`).

Evidence labels used throughout: **[M]** measured by a report (report and section cited), **[H]** historical Nix log durations
(`build-profile/hist-durations.txt`), **[E]** estimate (derivation given), **[S]** static reading, **[L]** checked by me in the
source tree while writing this plan. Every measurement was taken on a host at load 130–190 on 128 cores, so absolute values are
inflated; ratios and fixed real-time waits are the reliable part.

Row references: `BP §n` build profile; `NX #n` nix-machinery row; `CB #n` chronicle-backend row; `HS #n` haystack-shared row;
`MN #n` and `CC #n` = 1-based index into the manure / chronicle-clients JSON arrays (those two tables carry no row numbers).

---

## 1. Summary

### What is slow, and why

1. **Package builds are not slow because of tests.** A backend edit rebuilds a service package in 114–131 s; native-image is 56–59 %
   of that, tests ≤ 5 s and off the critical path [M, BP §1, §4]. The owner's hypothesis is false for `nix build .#<service>`.
2. **Verification is slow.** Agents pay ≈ 1,575 s (26 min) of serial Chronicle verification on every task, whatever the task
   touched [M, BP §8]. `nix flake check` has a critical path of ≈ 17–18 min through `manure-native` [E, BP §6] and re-runs three
   expensive checks on every commit [M, BP §3].
3. **The causes are structural, not the number of tests** [M, BP §1, §5; CB §1; MN §1; HS §1; CC §1]:
   - *Serial execution at 0.3–1.0 effective cores*: Chronicle backend 909–936 s, Chronicle browser 601–628 s, Manure target suite
     906–1,043 s, Haystack native transport 204–226 s.
   - *No caching of the mandated suites*: the Chronicle full backend suite, the Chronicle browser suite, the Haystack Scala suites
     and every `shared/*` suite except lossless-json are in no Nix derivation.
   - *Spurious invalidation*: `self.rev` in three checks, whole-repo `self.outPath` in one, over-broad source sets that re-run
     220–232 s checks on dashboard-only or web-only edits.
   - *A few real-time waits* that set the floor of each suite once it is parallel (65 s ×2, 60 s TTL ×4, 30 s heartbeat ×2 …).
   - *Duplicate runs*: both CLI suites execute twice inside their package builds; Haystack's browser check re-runs the web unit tests.
4. **Junk exists but is small in time**: ≈ 1 % of Chronicle backend cases, ≈ 10 % of Haystack cases, 18 Manure rows that take 7.5 s,
   21 Nix-machinery rows that take 11 s. It is large in LOC (≈ 24 k lines, §9) and in maintenance coupling (five JUnit-XML
   parsers, three test-name inventories, receipts about receipts). It goes for honesty and maintenance, not for speed.

### What we do

- **A.** Make every mandated suite an exact-input Nix check, grouped per service under `verify-<service>`. Unchanged inputs are a cache hit.
- **B.** Put parallelism *inside the runners* (sbt test groups with a database per group, Node file/`describe` concurrency, Python
  class shards, a browser script pool) so that the same command is parallel in the sandbox and in the developer shell.
- **C.** Remove spurious invalidations and duplicate runs.
- **D.** Delete receipt/evidence/inventory machinery; one shared 40-line gate fails a run on any failure, error, skip or empty run.
- **E.** Delete, merge or cheapen the tests the triage (as amended in §12) marks, with a per-group safety record.
- **F.** Remove the real-time waits that set a suite's parallel floor; keep honest real-time tests and run them in parallel.
- **G.** Replace the Chronicle-only `AGENTS.md` section with a short tier policy that applies to all three services.

### Expected result (details and labels in §9)

| | Now | After phase 1 (structure only) | After all phases |
|---|---|---|---|
| Agent verification, task that does not touch the service | 26 min Chronicle [M] | cache hit: evaluation only, ≈ 5–20 s [E] | same |
| Agent verification, Chronicle backend edit | 26 min [M] | ≈ 3–3.5 min [E from M] | ≈ 2.5–3.5 min [E] |
| Agent verification, Chronicle web edit | 26 min [M] | ≈ 2–2.5 min [E from M] | ≈ 2 min [E] |
| `nix flake check` critical path after a Manure backend edit | ≈ 17–18 min [E, BP §6] | ≈ 17 min (Manure untouched in phase 1) | ≈ 4–5 min [E] |
| Checks re-run by an unrelated commit | 3 checks, 170 s + two VM tests [M/H] | none | none |
| Test and harness LOC in the five triaged areas | ≈ 89 k [M] | ≈ 89 k | ≈ 65 k [E] |

---

## 2. Target validation architecture

Four tiers. The design principle: **one runner script per suite, used unchanged by the Nix check and by the developer command**;
Nix adds only the sandbox, pinned inputs and caching.

### Tier P — package gate (what `nix build .#chronicle|haystack|manure` runs)

Proves: the artifact that deploys compiles, and its cheap database-free contracts hold. It is deliberately not full verification.

| Package | Test steps on the build path | Change |
|---|---|---|
| `chronicle` | fast backend subset (`chronicle/scripts/test-fast.sh`), protocol codec fixtures, web `npm test`, collector `npm test` | Keep the dependency edge; delete the receipt chain (§3.4). Add the database-free suites that cost < 1 s each to `fast-suites.txt` (§6.1). |
| `chronicle-cli` | `npm test`, then 133 of the same cases again in `installCheck` | Concurrent cases; `installCheck` becomes a 5-case wrapper smoke (§3.3). |
| `haystack` | web `npm test` (14 s, 87 % of it a test of a test helper) | Delete harness tests → ≈ 1.5 s [E, HS §6]. |
| `haystack-cli` | 58 cases twice | Run once; `installCheck` smoke. |
| `manure` | viewer `npm test` (0.3 s) | none |

Commands: `nix build .#chronicle`, `.#haystack`, `.#manure`, `.#chronicle-cli`, `.#haystack-cli`.

### Tier F — full verification (cacheable Nix checks; the evidence for "done")

Proves: every suite of the service passed on exactly these inputs, on an owned PostgreSQL cluster where needed, with no failure,
error, skip or empty run. A cache hit is the same proof, obtained earlier.

Command: `scripts/verify <chronicle|haystack|manure|all>`, a thin wrapper around `nix build -L --no-link .#verify-<service>` that
first refuses to run if `git status --porcelain` shows untracked files under source roots (untracked files are invisible to flake
builds and would silently be left out). `verify-<service>` is a `linkFarm` of the checks below; `nix flake check` builds the same derivations.

| Aggregate | Member checks (new ones in **bold**) |
|---|---|
| `verify-chronicle` | `chronicle` (package incl. Tier P), **`chronicle-backend-full`**, **`chronicle-browser`**, `chronicle-web`, `chronicle-collector`, `chronicle-cli`, `chronicle-protocol`, **`chronicle-eval`** (relevance Python + Node unit tests, ≈ 4 s), **`chronicle-native`** (ELF smoke, added last, §10 U31), `chronicle-modules`, `chronicle-models`, `chronicle-hm-server`, **`shared-jvm`** |
| `verify-haystack` | `haystack`, **`haystack-jvm`** (Scala `testFull`, owned PG), `haystack-native` (ELF transport), `haystack-browser`, `haystack-proxy`, `haystack-cli`, **`haystack-cli-real`** (CLI against ELF + PG), module checks, **`shared-jvm`**, **`account-web-browser`** |
| `verify-manure` | `manure`, `manure-backend`, `manure-native` (target suite, sharded), `manure-client`, `manure-config`, `manure-direct-jni`, `manure-posix-acceptance` (native leg), `manure-nixos-eval`, `manure-hm-eval`, **`shared-jvm`**, **`account-web-browser`** |
| `verify-all` | the three above plus the cross-service module checks (`shared-services-modules`, `service-accounts`, `service-cli-hm`, `shared-postgres`, `provider-credential-transports`, `agentic-services-*`, `runtime-token`, `oci-images`, both unit-graph VM tests) |

Each check's `$out` holds the JUnit XML it produced and a `counts.json` (`suites`, `cases`, `failures`, `errors`, `skipped`). The
consumers are the shared gate (§3.5) and the before/after accounting of §7. Nothing else is written: no source hashes, no
receipts, no inventories. Logs are read with `nix log`.

### Tier D — developer / agent inner loop (outside Nix, same runners)

Proves nothing for the record; it is for iteration. One command per service, each running its parts concurrently and each part
internally parallel:

| Command (inside `nix develop .#chronicle`) | Runs |
|---|---|
| `chronicle/scripts/test.sh [backend\|fast\|web\|browser\|collector\|cli\|codecs\|eval]` (default: all) | grouped `test-postgres.sh`, `npm test` ×3, the browser pool, `test-codecs.sh`, eval unit tests |
| `haystack/scripts/test.sh [jvm\|native\|web\|browser\|cli]` | `test-postgres-scala.sh`, `test-current.sh`, web/CLI `npm test`, `test-browser.sh` |
| `manure/scripts/test.sh [jvm\|target\|viewer]` | `test-backend.sh`, `test-target.sh native full --shards N`, viewer `npm test` |
| `shared/scripts/test.sh` | all six shared sbt modules against one owned cluster; `account-web` browser test |

Local runs keep the sbt disk cache (compile ≈ 3 s instead of ≈ 51 s in the sandbox [M, BP §7.2]), so a focused inner loop stays
faster than the check. Each existing script keeps its name and its serial mode (`…_TEST_GROUPS=1`) as a fallback.

### Tier X — on demand (not in `checks`; `nix build .#onDemand.<name>` via `legacyPackages`, or a documented manual command)

| Item | Why not in Tier F | Must run when |
|---|---|---|
| `manure-vm` (313–642 s [H], QEMU TCG) | depends on the Manure package, so it would re-run on every Manure backend or dashboard edit; no KVM on this host | `nix/nixos/manure.nix`, `nix/hm/manure*.nix`, nginx/TLS edge or HM client wiring change |
| `manure-portable-root` (183–246 s [H], VM) | depends on `manure.native`; loop mounts and namespaces need a VM | root-authority / root-binding code or its module options change |
| `backend-coassembly` (21–30 s [H]) | the per-assembly `verifySingleBaboonRuntime` guard already runs in every native build | Baboon runtime or `build.sbt` contract settings change |
| Chronicle `tests/indexing-recovery.test.ts`, `cli/scripts/test-server.py`, `tests/cuda/*` | need a native ELF with a model server, a real server, or GPUs; never measured by the triage [CC §2] | indexing worker recovery, CLI server contract, embedding runtime changes |
| Relevance live-provider and acceptance legs | external model providers | as the existing "Search-quality experiments" section says |
| Manure `test-target.sh jvm full` | re-executes the 412 native cases against the jar; no check runs it [MN §9 Q4] | never mandatory; debugging aid |
| Layout-pinning browser groups (owner decision D6) | invalidated by the UX redesign | owned by the UX workstream |

The two unit-graph VM tests are **not** demoted: once `self.rev` is removed (§3.1) their inputs are the NixOS/HM modules only
[M, BP §3 rows "any commit" and "(e)"], so they are cache hits for every service-code task and re-run only when a module changes,
which is what they test. See §12 item 9.

---

## 3. Build / check-graph changes

Ownership rule for implementers: **only the Nix-graph unit of each phase edits `flake.nix` and `nix/pkg/chronicle/source.nix`**;
service units deliver runner scripts and state the check they need. Both files are touched by almost every change below.

### 3.1 Remove spurious invalidation (all verified by the rebuild matrix [M, BP §3])

| Change | File | Effect |
|---|---|---|
| Drop `sourceRevision = self.rev or ""` | `flake.nix` (haystack-browser, service-unit-graph-vm, hm-service-unit-graph-vm) and the three test files | these three stop re-running on every commit (170 s [M] + 349 s + 311 s [H medians]) |
| Delete `backend-runner-contract` (takes `${self.outPath}`) | `flake.nix:1255-1258`, `nix/tests/backend-runner-contract.py` | no whole-repo copy per evaluation; the check is junk anyway (NX #13, HS #91) |
| `manure-backend` uses a JVM-only source (new `manureJvmTests`: `common ++ shared ++ manure/generated/scala, manure/backend/src, manure/server/src, manure/server/native-image, manure/migrations`) instead of `manureTargetTests` | `source.nix`, `nix/tests/manure-backend.nix:6` | dashboard, viewer, Python-test and docs edits stop re-running 221 s of JVM tests |
| `manureTargetTests` lists what the target suite reads (`manure/tests`, `manure/manure`, `manure/scripts`, `manure/web`, `shared/account-web`) instead of all of `manure/`; drop `manureWitnesses` (it reads the inventory JSON at evaluation time, `source.nix:28-29` [L]) | `source.nix` | docs edits stop re-running the target suite; unblocks deleting the inventory |
| Haystack test `node_modules` keyed on `package.json` + `package-lock.json` only | `nix/pkg/haystack/test-dependencies.nix` | Haystack web edits stop re-running `haystack-native` (232 s) |
| `haystackTests` drops `haystack/server/src` (Scala tests) for the Node transport check; the Scala tests get their own source in `haystack-jvm` | `source.nix` | Scala test edits stop re-running the ELF transport suite |
| Chronicle `web` source drops `web/tests-browser` and `server/src/main/scala/chronicle/Http.scala`; a new `webBrowserTests` source adds `tests-browser` | `source.nix:83` [L] | browser-test edits and `Http.scala` edits stop rebuilding the deployed web package (the `Http.scala` entry exists only for the CSP grep that §6.2 deletes) |

Acceptance for the whole table: re-run the build-profile probes (`build-profile/tools/matrix-probes*.sh`, rows "any commit", (b) Manure
Python test, (c) Manure dashboard, (c) Haystack web, (b) Haystack backend test, Chronicle browser-test edit) and show that the
listed checks keep their derivation paths. `backend-source.nix` shrinks to the ≈ 10 cache-poisoning invariants (NX #15, HS #93) and
gains one assertion per new source set.

### 3.2 New exact-input checks

| Check | Builder | Inputs | Notes |
|---|---|---|---|
| `chronicle-backend-full` | sbt environment of `backend-validation.nix` + owned PG; runs `chronicle/scripts/test-postgres.sh` (grouped, §4.1) | `sources.backendTests` | prior art: the ad-hoc harness `build-profile/tools/adhoc-sbt.nix` ran all 1,009 cases green in the sandbox in 983 s serial [M, BP §4] |
| `chronicle-browser` | Node + pinned Chromium (as `haystack-browser` and `manure-native` already have) + the script pool (§4.4) | `sources.webBrowserTests` | no backend, no PG: the scripts use the hand-written in-process `ChronicleFixture` [CC §1] |
| `chronicle-eval` | `python3 -m unittest discover -s chronicle/eval/relevance/tests` and `node --test` of the eval `.test.mjs` files | `chronicle/eval/relevance` | 4 s [M, BP §8] |
| `haystack-jvm` | `haystack/scripts/test-postgres-scala.sh` | Haystack runtime + `haystack/server/src/test` | 79.7 s cold in the sandbox [M, BP §4 C2] |
| `haystack-cli-real` | `haystack/cli/tests/run-real.sh` against the ELF + owned PG | CLI source + `haystack.nativeArtifact` | 84 s today, 65 s of it one real two-heartbeat case [M, HS §1] |
| `shared-jvm` | one sbt invocation: `testFull` of `losslessJson`, `serviceRuntime`, `serviceAuth`, `modelHttp`, `retrievalCore`, `retrievalPostgres`, owned PG | `common ++ shared ++ sharedTests` | replaces `backend-foundation` (NX #11, HS #95); 168 s serial as four scripts today [M, HS §6], ≈ 100 s as one process, ≈ 30 s of tests after the `AuthorizedCandidateTest` rewrite [E] |
| `account-web-browser` | `node shared/account-web/tests/browser.mjs` with pinned Chromium | `shared/account-web` | 7 s, 22 cases, run by nothing today [M, HS #89] |
| `chronicle-native` | start the ELF against owned PG and run `chronicle/tests/workflow.test.ts` | `chronicle.nativeArtifact` + `chronicle/tests` | closes "no check executes the Chronicle ELF" (NX §9); cost unknown, measure first (§10 U31) |

`manureStorage/testFull` stays only in `manure-backend` (it ran twice, BP §2).

### 3.3 Remove duplicate runs

- `nix/pkg/chronicle/client.nix:59-63` [L]: `installCheck` re-runs `cli.test`, `transport.test`, `presentation.test` (133 cases). Replace with a
  5-case smoke against `$out/bin/chronicle` (`--help`, one bearer read, one uncertain-mutation exit code, one usage error, one presentation case; CC §9 Q5).
- `nix/pkg/haystack/client.nix:39,55`: same pattern, 58 cases twice (HS §1). Same fix.
- `scripts/haystack-native-acceptance.sh:47-52`: the browser check re-runs the 82 web unit tests and the markup check that the web package already ran (HS §1 item 3). Remove.
- `manure-browser` is an alias of `manure-native`; delete the alias (NX #19).

### 3.4 Delete the receipt / evidence / inventory machinery

The only operative gate in each case is "the test command exited 0 and the run was not empty". Everything below duplicates that or
tests the duplication (NX §4.1–4.4).

- Chronicle receipt chain (owner decision D2): `nix/pkg/chronicle/validation-evidence.py`, the `validationInputs`/`validationEvidence`
  derivations and the wrapper `verify` step, `share/chronicle/validation.json`, `chronicle/scripts/validation-report.py`, checks
  `chronicle-validation`, `chronicle-validation-policy`, `chronicle-evidence-layout`, orphan `nix/tests/chronicle-validation-fixtures.nix`
  (NX #1–6). `wrapper.nix` keeps a plain build-time reference to `backendValidation` and `protocolValidation`, so the package still
  cannot be built unless both pass.
- `protocol-validation.nix`: delete `expectedFixtureGroups = 17` and the Python regex receipt (lines 34–40 [L]); the derivation
  stays and fails on the script's exit code (NX #8, CC #147).
- JUnit/inventory parsers and their tests: `scripts/backend-foundation-report.py` + `nix/tests/backend-foundation-report.py`,
  `nix/tests/jvm-inventory-receipt.py`, `nix/tests/native-receipt.py`, `scripts/manure-acceptance-report.py` +
  `nix/tests/manure-acceptance-report.py` + `nix/tests/fixtures/manure-posix-acceptance/*.log`, the embedded Python in
  `scripts/haystack-native-acceptance.sh:68-95`, `nix/tests/manure-unittests.nix` + `manure-check-matrix.md` (NX #12, 17, 20, 28, 37).
- Test-name inventories: `haystack/server/tests-current/inventory.json`, `haystack/web/tests-browser/inventory.json`,
  `manure/tests/current-test-inventory.json` with the inventory half of `manure/scripts/target-suite.py` and
  `manure/docs/behavior-inventory.md` (HS #40, #58; MN §4 action 5).
- Source/artifact binding inside checks: `manure/scripts/artifact-source.py` comparison, `compiled-inputs.sha256`, before/after
  source hashing in the Haystack acceptance scripts, `nix/pkg/services/verify-manure-assembly.py` (NX #35, #37; MN §9 Q3). Nix input
  addressing already provides the binding.
- sbt `Test / validationInventory` tasks in `build.sbt` and their callers: no consumer remains.

### 3.5 The one shared gate

`scripts/junit-gate.py DIR…` (≈ 40 lines, no tests of its own): reads JUnit XML and exits non-zero when there are zero test cases,
any `failure`, any `error`, or any `skipped` element; on success prints and writes `counts.json`. Every Tier F runner calls it:
sbt writes JUnit XML already; Node runners add `--test-reporter=junit`; the Manure Python runner writes the same counts from
`unittest.TestResult` (`testsRun > 0`, no failures, errors, skips, expected failures or unexpected successes). For the grouped sbt
run, the grouping setting itself asserts that the union of groups equals `definedTests` (a `require`, the idiom `build.sbt` already
uses), which replaces the discovered-versus-reported inventory comparison.

### 3.6 Not doing

- **One shared "JVM build" derivation** feeding native-image and all test derivations (BP §9 proposal 10; NX action 7). It saves CPU
  (2–9 sbt start-ups and compiles per JVM change) but about 0 s of wall and can lengthen the critical path [E, BP §9]. Revisit only if
  host CPU contention becomes the binding constraint.
- **native-image changes**: none (BP §9 proposal 12).
- **Nix-level shards** (N derivations per suite). They give no extra cache granularity, because every shard of a suite has the same
  inputs, and they would force a second parallel mechanism for the developer loop. Derivations are split by *input boundary*
  (service × kind of suite), parallelism lives in the runner (§4).

### 3.7 `nix.conf`

No change is required. The design has ≈ 13 heavy derivations in a full invalidation (3 native images, 5 sbt suites, 3 browser
suites, 2 transport suites), each internally parallel and sized from `NIX_BUILD_CORES`; `max-jobs = 8 × cores = 16` already equals
the 128 CPUs, and the critical path is a dependency chain (native image → suite against the ELF), not slot contention [E]. If the
final measurement (§10 U33) shows derivations queueing behind the eight slots, the change to request is `max-jobs = 16`,
`cores = 8`: same product, twice the slots; native-image already caps itself at 8 threads [M, BP §6] and the test pools are
sleep- and I/O-bound.

---

## 4. Parallelism design

### 4.1 sbt — Chronicle backend (116 suites, 1,009 cases, 909–936 s serial [M])

- **Mechanism**: `chronicleServer / Test / testGrouping` builds N groups, each a `Tests.SubProcess` with its own
  `CHRONICLE_TEST_JDBC`; `Tags.limit(Tags.ForkedTestGroup, N)`; suites inside a group stay serial. The invariant changes from "all
  suites serial" to "one suite at a time per database" (CB §5).
- **Databases**: `test-postgres.sh` starts one owned cluster, migrates once into `chronicle_template` (extensions included, which
  removes the `CREATE EXTENSION` first-use race), then `CREATE DATABASE chronicle_g$i TEMPLATE chronicle_template` for each group
  before sbt starts. Separate databases remove every observed blocker: wide `TRUNCATE … CASCADE`, the `ch_profile`/`ch_owner_targets`
  singletons, triggers installed on shared tables, the advisory lock in `Database.initialize()`, and the `pg_stat_activity … datname =
  current_database()` lock-wait probes (CB §5 blockers 2–4). Roles with random names and the one `CREATE DATABASE` in
  `ArchiveProjectionTest` are cluster-global but collision-free (blocker 5). There are no fixed ports or temp paths (blocker 7).
- **Group assignment** (no timing file to maintain): a short `isolated` list in `build.sbt`, one suite per group, each entry with its
  reason: `IndexedSearchTest` (111–130 s), `IndexedSearchSnapshotTest` (23 s corpus), the two transport suites (≈ 66 s each, §5),
  `HttpTest` (73 s), `ArchiveSearchTest` (67 s), `BrowserWebSocketTest` (45 s), `ContextWorkerRecoveryTest` classes (43 s),
  `PassageWorkerTest` classes (31 s). All other suites: round-robin over the sorted names into the remaining groups. Default
  N = 16; `CHRONICLE_TEST_GROUPS=1` is the serial fallback.
- **Evidence**: 8 LPT shards ran all 1,009 cases green in **173.6 s** against 909 s serial, with no code change [M, CB §2, §5]. That
  experiment used 8 sbt processes in 8 private copies with 8 clusters. The single-process `testGrouping` + template-database form
  is **not measured**; it is lighter but unproven, including whether sbt 2.0.12 honours `testGrouping`/`Tags.ForkedTestGroup` as
  sbt 1 did [E]. The implementing unit starts with a spike; the measured multi-cluster form is the fallback (one cluster per group,
  the group's environment points at its port).
- **Must stay serial, and why**: suites that share a database (the reason for the existing `parallelExecution := false`,
  `build.sbt:209-210` [L]); cases inside one munit suite (shared fixtures, e.g. `IndexedSearchTest` keeps a seeded corpus in a field).
- **Expected**: phase 1 with `ModelTransportTest` split in two classes: wall bounded by `IndexedSearchTest`, ≈ 115–135 s of tests,
  plus ≈ 25 s local or ≈ 66 s sandbox sbt start and cold compile [E from M].

### 4.2 sbt — Manure, Haystack, shared

- **Manure** (`manureServer`, 241 cases, 135–153 s at 1.5 cores [M]): fixtures already create a unique database and role per test and
  use port 0 and temp roots (`BackendFixture.scala:44,49`, MN §5 item 7). Use the same grouping helper with 4–6 forked JVMs; no
  database-per-group step is needed. The triage's "set `parallelExecution := true`" is not sufficient: with `Test / fork := true` a
  single forked group still runs its suites serially [S]. Acceptance: 10 consecutive green grouped runs (MN §7). Raise or drop
  `-XX:ActiveProcessorCount=4` in `manure-backend.nix` accordingly. Expected ≈ 40–60 s of tests [E, BP §9 item 9; MN §6].
- **Haystack** (715 cases, 37 s [M]): stays serial. Not worth the risk; noted in case the suite grows (`TestSupport.scala` wipes one
  shared database, HS §5).
- **Shared**: one sbt process, modules serial, one owned cluster. The only slow item is `AuthorizedCandidateTest` (76.7 s, 1 case),
  fixed by its rewrite (§5), not by parallelism. Whether `retrieval-postgres` fixtures can share a cluster with `service-auth` and
  `service-runtime` was not inspected by the triage (HS §5); the unit verifies it and otherwise gives each module its own database.

### 4.3 Node test runner

| Suite | Today | Change | Evidence |
|---|---|---|---|
| Chronicle CLI `cli.test.ts` (126 cases) | 27.8 s, serial within the file | `describe(…, {concurrency: 16})`; every case owns port 0 and a temp root | 2.4 s at 16-way, 126/126 pass, one run [M, CC §4.3]; repeat ×10 before merging |
| Chronicle web, collector | already parallel across files (1.2 s, 5.7 s) | none | [M, BP §6; CC §3.3] |
| Haystack `tests-current` (42 cases, 204–226 s) | `--test-concurrency=1`, hard `timeout 240s` (14 s headroom under load) | delete the two harness tests whose `process.env` mutation is the process-global hazard, one shared fixture per file, precomputed PBKDF2 hash, then drop the flag (Node runs files in separate processes); every file already has its own temp dir, random database and port | [S, HS §5]; expected wall ≈ 65–70 s, bounded by the one real two-heartbeat case (§5) [E] |
| Haystack CLI `cli.test.mjs` (51 cases) | 40 s, serial; module-level mutable mock-server state (`cli.test.mjs:20`) | per-test mock server on port 0, then file/`describe` concurrency; table-like cases call `main` in-process | [S, HS §4.3] |

Port allocation rule for all Node fixtures: bind port 0 and read the bound port wherever the code under test allows it; where a
"find a free port, close it, pass it on" helper remains (`haystack/server/tests-current/fixture.mjs` `freePort` [L]), the fixture's
readiness check that it is talking to its own child stays in place and keeps one sub-second test (§12 item 7), because concurrency
makes that race more likely, not less.

### 4.4 Browser suites

Target shape for all three services: **one server and one browser per shard; every scene owns a browser context and its own fixture
or database; no scene writes screenshots, metrics or result files; pool size from the CPU count, capped.** Reaching that shape fully
means touching every scenario file, and those files are owned by the UX workstream. So:

- **Chronicle, now** (no scenario edits): replace the 20-command `&&` chain in `web/package.json:12` with `tests-browser/run-all.mjs`,
  a pool that runs the existing scripts as child processes, 7 at a time, each with its own Vite `cacheDir` (today all share
  `.cache/vite`, `vite.config.ts:24` [L]; BP §6 names the race). Split the `activity-tables.mjs` cases (imported at `ux.mjs:7`, run at `:398` [L]) out of `ux.mjs` into their own
  entry so that the longest script is no longer 105 s. Evidence: all 20 scripts passed 7-way concurrently in ≈ 105 s wall against
  628 s serial, with `run.mjs` taking the same 65.5 s in both modes [M, CC §5]. Expected ≈ 95–105 s, bounded by `rebuild.mjs` (94 s).
- **Chronicle, with the redesign** (UX workstream): scenario files export scenes; the runner starts one Vite server and one Chromium
  and runs scenes with bounded concurrency (start at 4, require 20 consecutive green runs, never lengthen timeouts to compensate;
  CC §7). Expected ≈ 45–60 s [E, CC §6].
- **Haystack, now**: run the legs (`layout`, `account`, `run`, `restart`, `quick-preview`) concurrently instead of chained; each is a
  separate process with a random database and free ports (HS §5). Expected ≈ 110 s, bounded by `run.mjs` (108.6 s), against 153 s
  + 14 s duplicate [E from M]. Scale the 575 s whole-job timeout down with it. Sharding `run.mjs` journeys 3–4 ways rests on an
  unverified assumption that journeys use disjoint keys (HS §5) and is left to the UX rewrite.
- **Manure**: browser cases are Python `unittest` classes driving Node/Chromium; they shard with the Python runner (§4.5).
- Pool sizes: Chronicle 7 (measured), Haystack 5 legs, Manure 8 class shards. Under host load three Chronicle scripts failed in the
  inotify-exhausted run and passed in the clean rerun [M, BP §10]; the acceptance checks therefore require repeated green runs.

### 4.5 Python — Manure target suite (412 Python + 35 Node + 1 codec case, 906–1,043 s serial [M])

- **Runner**: `target-suite.py` becomes a plain runner: discover, optionally select `--shard i/n`, run, fail on any failure, error,
  skip or empty run. The exact-ID inventory gate goes; it is the main obstacle to sharding (MN §5 blocker 2).
- **Shard unit**: the `TestCase` *class* (class fixtures are per class), sorted by qualified name, the eight heaviest classes named
  in a short list so that they land in different shards, the rest round-robin. `test-target.sh` launches n = 8 worker *processes*
  (not threads: `browser_fixtures.py:519-528` monkeypatches `socket.getaddrinfo` process-wide, blocker 6) against one owned cluster.
  Each module already creates a fresh database, payload root and server on port 0; database creation is serialised by the existing
  `flock`, which is safe (blocker 9).
- **`localhost` versus `127.0.0.1`/`::1`** (reproduced failure, MN §5 blocker 3): the server binds `127.0.0.1:<ephemeral>`, tests
  navigate to `localhost:<port>`, Chromium resolved `localhost` to `::1`, where another process listened on the same port number.
  Fix in the fixture: add `MAP localhost 127.0.0.1` to the existing `--host-resolver-rules` (`browser_fixtures.py:48-50`), which keeps
  the URL (and so cookie and secure-context behaviour) unchanged. Must land before sharding.
- **Port TOCTOU**: `test_target_search.py:81,253` binds, closes and reuses a port (blocker 4). Keep the socket bound and hand it over,
  or let the child bind port 0 and report it.
- **Fixed in-tree paths**: `test-backend.sh` and `test-target.sh` write `manure/backend/target/test-reports` and `target-runs`
  (blocker 8). Workers write to per-shard directories under one run directory.
- **Expected**: ≈ 100–120 s wall once the 60 s TTL waits are gone (§5), otherwise bounded near 150 s by the class that waits 60 s in
  `setUpClass` [E, MN §6].

### 4.6 Nix level

Independent derivations already build concurrently and no false chain exists on the package paths [M, BP §6]. The changes are: the
new checks of §3.2 (so the mandated suites exist as derivations at all), the invalidation fixes of §3.1, deleting the
`manure-unittests` aggregator that serialised four heavy checks behind one receipt (NX §5), and scaling the fixed whole-job timeouts
(`haystack-native.nix:38` 240 s, `haystack-browser.nix:21` 575 s, `manure-native.nix` 1800 s) to the parallel durations.
Evaluation: `nix flake check` spends 102 s evaluating 112 checks before building anything [M, BP §6]; `verify-<service>` evaluates
only its members, and `chronicle-modules`/`chronicle-models` drop from 40 s to ≈ 12 s of evaluation with stubbed `evalModules`
instead of 33 `nixosSystem` evaluations [E, NX #41, #42].

---

## 5. Real-time waits and seams

Principle: a seam is a **constructor parameter or fixture configuration with the production value as default**; no production
configuration key is added only for tests. The production default is pinned by one cheap test. The test keeps exercising the same
code path and the same kind of assertion ("fires after the interval, not before"). A test whose subject is real elapsed time against
something we do not control keeps real time and runs in parallel.

After sharding, a wait matters for wall time only if it sets the floor of its suite or shard. Priority 1 rows do; priority 2 rows
save CPU and serial time only and can follow at leisure.

| # | Wait (location) | Cost now | Seam / vehicle | Pinned by | Prio |
|---|---|---|---|---|---|
| W1 | Manure 60 s minimum TTL waited in real time by four cases: `test_browser_dashboard.py:794-796`, `test_browser_dashboard_ux.py:23,35` (in `setUpClass`), `test_client_realserver.py:689-698`, `test_target_search.py:225-227`. Production enforces `ttl ≥ 60` (`Domain.scala:185` [L]) | ≈ 245 s, 24 % of the Python run [M, MN §1] | The fixture owns the database (`OwnedDatabase.runtime_sql`): create with a valid TTL, then set `expires_at` into the past with SQL. No product change. | Scala controlled-clock expiry tests (`ArtifactsContract.scala:304`, `CatalogueContract.scala:112`) plus one native case asserting `410` for a stored past expiry (MN §7) | 1 |
| W2 | Chronicle `ModelTransportTest:23,:28`: a real Ember server sleeps 65 s before headers / inside the body | 131 s in one suite [M] | **No seam.** The subject is "our client outlives Ember's 60 s default", which needs > 60 s of real time; the two cases guard two different client settings (`withTimeout` and `withIdleConnectionTime`, `ModelHttp.scala:38` [L]). Split them into two suite classes so they run in parallel groups (≈ 66 s each). | themselves | 1 |
| W3 | Chronicle `IndexedSearchTest` (not a wait; 88 s first case) | 111–130 s, the floor of the grouped run [M] | Fixture only: batch the corpus seeding and metadata backfill. An earlier measurement attributed 46–48 s per case to backfill over 3,001 fresh JDBC connections and 13 s to the disabled-index control (`chronicle/docs/drafts/20261028-build-validation-cache.md`, different revision). Assertions (planner uses HNSW/GIN, recall ≥ 0.95) unchanged. Measure before committing to it. | unchanged assertions | 1 (optional) |
| W4 | Haystack live-socket heartbeat, hard-coded `Stream.awakeEvery[IO](30.seconds)` (`http/Http.scala:334` [L]), waited by `authority-lifetime.test.mjs:44` (62 s), `mcp-live.test.mjs:82` (32 s), CLI `real.acceptance.mjs` (65 s) | 159.5 s serial [M, HS §1] | Recommended (owner decision D7): **no production change.** Keep one real two-beat server case and the CLI's own two-beat case (its subject is the CLI answering pings), fold the 32 s single-beat case into the two-beat one, and run test files concurrently: the wait leaves the critical path (§9). Alternative: constructor-injected interval with an in-process Scala test under `TestControl`, or a config key so that the ELF tests run at ≈ 300 ms. | the real two-beat case asserts ≥ 59 s (`authority-lifetime.test.mjs:52`) | 1 |
| W5 | `shared/retrieval-postgres` `AuthorizedCandidateTest` (not a wait): 2,212 single-row commits + HNSW build | 76.7 s for 1 case [M, HS #75] | Make the 1,000-candidate window a parameter (test uses 25 with ≈ 60 rows), batch inserts, drop the printed plan and the `RETRIEVAL_DIAGNOSTIC_DIR` writer. Assertion "ACL and filters precede the candidate window; exact-scan negative control" unchanged. | one case asserting the production window constant | 1 |
| W6 | Chronicle web: `refresh-regression.mjs:171-174` waits the real 20 s `ARCHIVE_REFRESH_MS`; `run.mjs:157-160` waits real 4 s polls | 21 s + 29 s [M, CC §4.3] | `page.clock.install()` + `fastForward`, the pattern `live-archive.mjs` already uses 25 times | the constants are imported, not copied | 2 |
| W7 | Chronicle WebSocket liveness: hello 10 s, ping every 20 s, pong within 10 s, literals in `Http.scala:249-254` [L]; `HttpTest:19,:72`, `BrowserWebSocketTest:197` | ≈ 77 s [M, CB §4.3] | `SocketLiveness(hello, pingEvery, pongWithin)` parameter of the routes, default = today's values; tests use 100–300 ms | one test asserting the default triple | 2 |
| W8 | Chronicle worker failure back-off `IO.sleep(2.seconds)` (`Models.scala:219` [L]): 29 cases in `ContextWorkerRecoveryTest`, `PassageWorkerTest`, `IndexProgressTest:84` | ≈ 58 s [M] | constructor parameter for the back-off, default 2 s (or run the cases under `TestControl`) | one test asserting the default | 2 |
| W9 | Chronicle `ArchiveSearchTest:231` waits 30.2 s on the *fixture's* statement timeout (`Fixtures.scala:31`; production has no default, `Core.scala:112-120`); `:215` waits 6.3 s | 36 s [M] | Test configuration only: 1 s statement deadline, assert the `deadline` error and elapsed ≥ 1 s | n/a (no production value involved) | 2 |
| W10 | Chronicle `ArchiveSearchTest:103` (not a wait): 2 MiB literal | 21 s [M] | smallest message that still crosses the fragment/overlap bound (derive from the `ArchiveProjection` constants) | the bound constants | 2 |
| W11 | Chronicle `Fixtures.config()`: PBKDF2 at 600,000 iterations per call (≈ 150 ms [M]); `Database.initialize()` + wide TRUNCATE per test; `OwnerProfilePostgres.withDatabase` initialises twice | est. 60–140 s serial [E, CB §4.3] | hash once per JVM (`lazy val`); remove the `legacyOnly`/`passages` alias extensions (`Fixtures.scala:4-8`) | n/a | 2 |
| W12 | Haystack `tests-current/fixture.mjs` `passwordHash` (PBKDF2 600,000, synchronous, per fixture [L]) and one native server + database per case in `account.test.mjs` (7) and `authority-lifetime.test.mjs` (3) | ≈ 60–90 s [E, HS §1] | hash once per process; one fixture per file with distinct users and keys per case, as `http.test.mjs` already does | n/a | 1 |
| W13 | Manure `RootAuthoritySuite` body deadline (6.4 s); `CheckConfigSuite` (14.8 s of child JVMs) | 21 s [M, MN §3] | configure a shorter deadline in the fixture; drop `CheckConfigSuite` once its single case is confirmed to be covered by the native `manure-config` check (1.1 s) | `manure-config` | 2 |
| W14 | Harness tests with real deadlines: `provision.test.mjs` (10 s), `ownership.test.mjs` (15 s), `web/tests/database.test.mjs:68` (10 s) | 40 s [M] | deleted or reduced to sub-second safety cases (§6.3, §12 item 7) | — | 1 |

Left on real time on purpose (they run in parallel and are honest): database-clock lease expiry with a 1 s minimum
(`OwnerLeaseBoundaryTest`, `PassagePostgresBoundaryTest`, `PersistentBrowserSessionTest`), `pg_sleep` trigger races
(`OwnerTargetConcurrencyTest`), the three 5 s statement-deadline cases (`MessageContext.scala:19`, `SessionMessageSearch.scala:24`,
`ExpressionHints.scala:107`), `EmbeddingHttpTest` (150 ms / 3 s deadlines), `IndexingWorkerTest` (4 s heartbeat), Chronicle CLI
`transport.test.ts`, Manure `test_target_durability` (SIGKILL windows) and `test_cli_process`.

Proposed policy wording: §8.1, "Timing rule".

---

## 6. Consolidated action lists

Verdicts are the triage verdicts unless marked **⟲** (overruled or amended by me; reason in §12). "UX" marks content owned by the
UX workstream: this plan may delete it or change how it is run, and does not rewrite it.

### 6.1 Chronicle backend (108 files, 116 suites, 1,009 cases, 17,556 LOC; CB)

| Action | Items | Notes |
|---|---|---|
| DELETE files | CB #33 `ExtractionBaseline.scala` + #101 `SharedExtractionDifferentialTest` (2 cases, 441 LOC, 7.4 s); #15 `ArchiveLiteralPlanTest` (CTE-name grep) | run the differential once on the deletion commit and record the green result; before deleting #15 add the plan assertion to `ArchiveIndexTest:268` |
| DELETE cases | `ModelTelemetryTest:322-326` (DDL text compare); `ArchiveLexicalIndexTest:18` (PostgreSQL characterisation) and the "old lower predicate" leg of `:78` (#14); `OwnerTargetRegressionTest:18`; `RelocatedModelIdentityTest:31`; `ActivityTest:504` and `RetryFailedActionsTest:319` (third and second copy of `CursorWebSocketTest:21`); `McpTagSearchTest:81,:88,:97`; `NativeResourcesTest:8,:11`; `ProtocolEvolutionTest:12-16` | ≈ 12 cases; surviving guard named per case in CB §4.1 |
| MERGE | #86 `ProtocolEvolutionTest` → `ApiVersionCompatibilityTest`; #42 `IngestionBoundsTest` → `CoreTest`; #94 `RelocatedModelIdentityTest` → `ModelIdentityMigrationTest` (`:4`) + `CoreTest` (`:25`); #77 `OwnerTargetRegressionTest:30` → `OwnerProfilesTest`; #99 `SessionMessageSearchBoundaryTest` → `SessionMessageSearchTest` (Postgres half); `RetryFailedActionsTest:303,:335,:360` → `CursorWebSocketTest`; `IndexedSearchTest:166` (functional case) → `ArchiveProjectionTest` | update `fast-suites.txt` for the two merged fast suites |
| REWRITE-CHEAPER | #36 `HttpTest`, `BrowserWebSocketTest:197` (W7); #27 `ContextWorkerRecoveryTest`, #80 `PassageWorkerTest`, `IndexProgressTest:84` (W8); #19 `ArchiveSearchTest` (W9, W10); #34 `Fixtures.scala` (W11); ⟲ #68 `ModelTransportTest`: split into two classes, keep both 65 s cases (W2); ⟲ #41 `IndexedSearchTest`: cheaper seeding only (W3) | product seams are constructor parameters with today's values as defaults |
| DEMOTE | none. ⟲ #41 `IndexedSearchTest` stays in Tier F in its own group; ⟲ #40 `IndexedSearchSnapshotTest` stays a separate suite (own group) instead of merging | no "slow tier": §12 items 1–3 |
| PROMOTE to the fast subset (Tier P) | the database-free suites that passed with JDBC unset (29 suites, 273 cases, 33 s wall incl. sbt [M, CB §2]); ⟲ first only those under 1 s each; `DummyContextWorkerRecoveryTest` (18 s) and `DummyPassageWorkerTest` follow W8. `McpMessageContextTest` is not promotable (needs PostgreSQL, measured) | raises routine coverage from 132 to ≈ 380–405 cases |
| KEEP | all other rows (90 files / 910 cases), explicitly including the ones that look like junk and are not: `CodecFixtureTest` (cross-language golden bytes), `ArchiveExpressionTest` and `RecordedYoloProfileTest` (JSON shared with the web tests), `NativeResourcesTest:14`, the suites that parse `config.example.json` (CB §4.1 "Not deleted") | retained-data suites (`ModelIdentityMigrationTest`, `PersistentBrowserSessionTest:61`, `StoredPublicationFixtures`, `LegacyAnnotations` cases) depend on owner decision D8 |
| Depth caveat | KEEP for suites the triage did not read line by line means "no evidence of junk at grep depth" (CB §2) | no further review is planned; say so if one is wanted |

### 6.2 Chronicle dashboard, collector, CLI, codecs, evaluation (CC)

| Action | Items | Notes |
|---|---|---|
| DELETE now | screenshot / `metrics.json` / `results.json` writers in 17 browser files (CC #137; one writes into repo-level `.local/ui-evidence`); `theme-retry.mjs:183` CSP grep of `Http.scala` (#136) and the in-test `vite build` at `:182`; `admission.test.ts:77-79` (#141); `contracts.test.ts:9-16` (#142); `reparse.test.mjs` (#126); `test_source_observations_v3.py:189-240` (#144); `test_runner_integration_v3.py:136,193` (#145); `test_workflow_v3.py:266-272` (#146); `protocol-validation.nix` count pin + receipt (#147) | the CSP header gets a server-side assertion in `StaticHttpTest` (which already tests security headers, CB #102) before the grep goes; eval deletions assume captured v2 runs are finished (D8) |
| DELETE or move out of the gate (owner decision D6), UX | `tab-layout.mjs` (#64, 22.7 s), `activity-layout.mjs` (#32, 16.9 s), `popup-regression.mjs` matrix (#57, keep 1 scene), `rebuild-occlusion.mjs` (#60), copy-text scenes `run.mjs:81-97` (#133), `goal50.mjs:27-30` (#134), `tab-layout.mjs:15-21` (#135) | ≈ 135 s of the 628 s serial [M + E, CC §6]; the redesign needs one contrast + no-overflow invariant sweep written against the new design (requirement handed to UX) |
| MERGE (ours) | `more-contracts.test.ts` → `contracts.test.ts` (#93, #94); `agent_bindings.test.mjs:10-13` calls the exported `verifyCatalogV3` instead of slicing source text (#122) | |
| MERGE / table-drive (UX owns; not done by this plan) | `goal50*` rename and split, fixture chain `fixture ← goal50-fixture ← history/search-fixture` (#33–37, #43, #44); refresh/prune ×3 (#139); bulk/receipt matrix ×4 and `activity-tables.mjs` (#31); `usage-presentation.mjs` (#69), `source-filters.mjs` (#63), `prior-error-regression.mjs` (#58); `rebuild.mjs` invalid-status ×5 (#59), `search-serp.mjs` failure matrix (#62), `ux.mjs` header sorts (#30), `filter-table-ux.mjs` geometry (#53), `theme-retry.mjs` visuals (#65) | ≈ 58 s table-driving + merges [E, CC §6]; handed over as guidance with the runner contract of §4.4 |
| REWRITE-CHEAPER (ours) | `cli.test.ts` concurrency (#92); CLI UUID family `cli.test.ts:424-484` → pure tests on `src/wire.ts`, keep 2 end-to-end (#143); `client.nix` installCheck smoke; `page.clock` in `refresh-regression.mjs:171-174` and `run.mjs:157-160` (#138, #140; W6; coordinate with UX, ≈ 10 changed lines) | |
| ⟲ KEEP as a separate derivation | `protocol-validation.nix` (#108): not merged into `web.nix` | §12 item 4 |
| DEMOTE → Tier X | `tests/indexing-recovery.test.ts` (#99), `tests/cuda/*` (#100, #101), `cli/scripts/test-server.py` (#97); `tests/workflow.test.ts` (#98) becomes the `chronicle-native` check if it passes and is affordable (U31) | none of them was executed by the triage |
| ⟲ stay in `chronicle-eval` (Tier F) until D8 | `test_assess_batch.py` (#109), `test_proposition_support.py` (#111), `test_runtime.py` (#114), `probe_policy_v3.test.mjs` (#124), receipt/fingerprint cases of #113 and #119 | the whole eval unit suite is ≈ 4 s and cached; a separate tier for it saves nothing. They are deleted with the v2 layer or kept |
| KEEP | web Node suite (147 cases, 0.64 s), collector (152 cases, 5.7 s), `transport.test.ts`, `presentation.test.ts`, `codec-fixtures.mjs`, authority-fence and security groups in `history-find`, `search-serp`, `live-archive`, `persistent-login`, `tool-catalog`, `transcript`, `ui-controls`; eval scoring suites | CC §4.5 |

### 6.3 Haystack and shared modules (HS)

| Action | Items | Notes |
|---|---|---|
| DELETE | HS #37 `provision.test.mjs`; #40, #58 both `inventory.json`; #47 `web/tests/database.test.mjs`; #48 `proxy-config.test.mjs`; #49 `preview-state.test.mjs`; #56 `browse-markup.mjs`; #65 `tests-deploy/local-boot.sh`; #66 `haystack/characterization/node/` + #67 generators and the `build:characterization` script (owner decision D4; fixture bytes and manifests stay); #79 `shared/retrieval-postgres/validation/`; #80 both `VALIDATION.md`; #90 `shared/baboon-runtime/test-build-guards.sh`; #91, #92 flake checks `backend-runner-contract`, `backend-foundation-policy`; case `HistoricalAdmissionTest.scala:37` (asserts manifest provenance); case `authority-lifetime.test.mjs:8` (duplicated more broadly by Scala `HttpAuthorityLifetimeTest`) | 5.8 k LOC, ≈ 40 s; HS §4.1 |
| ⟲ REWRITE instead of DELETE | #38 `ownership.test.mjs` → `tests-current/fixture-safety.test.mjs`: at most 4 sub-second cases with an injected readiness deadline (fixture never probes a foreign listener on its port; fixture refuses a non-loopback or credential-bearing database descriptor) | §12 item 7 |
| MERGE | #11–13 three `Historical*` suites → one table-driven `HistoricalCompatTest` (64 → ≈ 21 cases; contract stays because production holds old-format rows, D8); #74 model-http FIFO case → service-runtime `CredentialBoundarySuite`; #36 `static.test.mjs` → `http.test.mjs`; `authority-lifetime.test.mjs:27` → `mcp-live` capacity case | |
| MERGE (UX owns) | #52 `layout.mjs` 16 → 10 cases inside `run.mjs`'s browser; #53 `account.mjs` → `run.mjs` login journey | not done by this plan |
| REWRITE-CHEAPER | #31, #32, #34, #39 `tests-current` shared fixtures, precomputed hash, heartbeat de-duplication (W4, W12); #17 `HttpAuthorityLifetimeTest` one fixture + route table; #75 `AuthorizedCandidateTest` (W5); #60 `cli.test.mjs` in-process table cases; #63, #64 `real.acceptance.mjs`/`run-real.sh` (drop receipt and the hard-coded `12`); #68, #69 runner scripts reduced to PG bootstrap + run + gate; #57 one shared provision-helper module; #93 `backend-source.nix` | |
| REWRITE-CHEAPER (UX owns the content) | #51 `run.mjs`: `storageState` login reuse and journey sharding; #59 browser README | this plan only runs the legs concurrently |
| DEMOTE | #94 `backend-coassembly` → Tier X. ⟲ #50 `preview-lifecycle.test.mjs`: out of the web package check (Tier P), into `haystack-browser` (Tier F); ⟲ #55 `quick-preview.mjs` stays a concurrent leg of `haystack-browser` (9 s, off the floor) | |
| ADD to a check (gaps) | `haystack-jvm` (715 Scala cases gate nothing today); `shared-jvm`; #89 `account-web/tests/browser.mjs` (UX owns its content) | HS §1 surprises 1 |
| KEEP | all other rows: the dual memory/PostgreSQL contracts, PostgreSQL semantics/migration/projection suites, `AccountLockOrderTest`, pure domain/query/auth tables, `http.test.mjs`, `mcp-live` (minus the wait), `runtime-model`, `restart.mjs`, `haystack-proxy`, the shared-module suites | HS §4.5 |

### 6.4 Manure (MN)

| Action | Items | Notes |
|---|---|---|
| DELETE | MN #1–7 the seven retired-server modules (6,253 LOC, 165 cases, never executed; owner decision D3a); #8 `test_artifact_source_manifest`; #9 `test_catalogue_casefold_oracle`; #16 `test_client_stateful`; #22 `test_current_test_inventory`; #23 `test_dashboard_markup` (UX); #24 `test_mcp_environment`; #30 `test_retired_server_entrypoint`; #50 `network-capture.test.mjs`; #76 `ProbeRuntimeClasspathSuite`; #79 `server/native-tests/verification/**`; classes `TestE1FailFirstRecords` (`test_client_hardening.py:1793-2031`), `TestAssetHygiene` (`test_browser_dashboard.py:29-108`, UX), helper tests `test_browser_isolation.py:302-330`; the inventory gate (`current-test-inventory.json`, inventory half of `target-suite.py`, `docs/behavior-inventory.md`); JVM leg of `manure-posix-acceptance`; the `1257/1263` assertion-count pin in `direct-jni.nix` | before deleting #1–7 extract the `invariantGroups` mapping once into a coverage note (invariant → current test) and check every `targetRefs` test still exists (MN §7); fix `manure/README.md:534`, whose `unittest discover` instruction would run the retired modules |
| ⟲ KEEP instead of DELETE | #21 `test_current_target_harness.py` (6 cases, 0.3 s) | safety interlock, §12 item 6 |
| MERGE | #25 `test_mcp_hardening` → `test_mcp_protocol`; #53 `codec-fixtures.mjs` → a `node:test` case in `current-protocol.test.mjs` (removes `requiredOutputLines`); #36 `test_browser_isolation.py:114,277` header set and reserved prefixes → `HttpSuite` (already checks `frame-ancestors` at `:527`); #47 `test_target_root_identity.py:54,74,100,115` → drop (duplicates of `RootBindingPolicySuite`/`RootMigrationSuite`), keep `:136,:140` | |
| MERGE (UX owns the flows; optional) | #41 `test_browser_unlock` table-driven modes; #32 `test_browser_dashboard` flows ×2 modes; #42 `test_browser_viewers` per-mode repetition; #85–91 the seven unwired viewer `*.browser.mjs` files | class-level sharding (§4.5) removes most of their wall cost without touching content; the viewer files run in no gate: run them once, wire them if green, otherwise hand the failure list to UX |
| REWRITE-CHEAPER | W1 TTL waits (#32, #33, #44, #48); `localhost` and port fixes (§4.5); #56 `RootAuthoritySuite` deadline; #59 `CheckConfigSuite` (W13) | |
| DEMOTE → Tier X | #54 `portable_root_probe.py` (VM); `DashboardLayoutTests` layout matrix (35 s, UX, D6). ⟲ #28 `test_offline_conversion` and #46 `test_target_migration` stay in the sharded Tier F run until D3b is answered, then they are deleted with the converter or kept | 39 s of cached, parallel work costs no wall time |
| KEEP | all other rows (51): client and CLI suites, browser access/handoff/TLS/path-mode/quick-upload cases, `test_target_durability`, `test_cli_process`, the Scala dual Memory/Postgres contracts, `PostgresAdmissionSuite`, viewer unit tests, `manure-client`, `manure-config`, `manure-direct-jni` | MN §4 |

### 6.5 Nix-level tests and machinery (NX)

| Action | Items | Notes |
|---|---|---|
| DELETE | NX #1, #3–6 Chronicle receipt chain (D2); #12 `backend-foundation-policy`; #13 `backend-runner-contract`; #16 `rites-worker-source`; #17 receipt writers; #20 `manure-unittests` + `manure-check-matrix.md`; #23 `manure-vm-audit.py`, `manure-vm-runtime.py`, `test_manure_vm_acceleration.py` and two narrative `.md` files (2,009 LOC); #24 `test_manure_vm_current_client.py`; #25 `test_manure_release_guards.py` (936 LOC, unwired); #26 `manure-installed-shells.py` (orphan); #28 `manure-acceptance-policy` + frozen logs (the fixture asserts 26 contracts, the live probe prints 32); #29 `manure-toolchain-routing`; #35 `verify-manure-assembly.py`; #45 `agentic-services-legacy.{json,md}` + snapshot test; #56 both unit-graph harness tests; #57 both `service-fixture-*` checks; #59 three `dev-llm-*` import checks | ≈ 4.9 k LOC, 11 s. #23 assumes test VMs are never launched outside `nix build` (NX §9 Q2); #45 first replaces the five baseline assertions in `agentic-services-hm-eval.nix` with direct expectations and diffs the evaluated artifacts before and after |
| ⟲ no alias period | `manure-unittests`, `manure-browser`, `chronicle-validation` names are removed outright | §12 item 10 |
| MERGE | #9 `chronicle-sbt-lock-helper` → `chronicle-sbt-lock`; #11 `backend-foundation` → `shared-jvm`; #39 inline `haystack-*` module tests (`flake.nix:491-804`) → `nix/tests/haystack-modules.nix`; #49 `shared-postgres-modules`, #50 `readme-hm-server` + `chronicle-operations-example` → `shared-services-modules`; the "migration unit `Requires` its database unit" invariant asserted in ≥ 10 places → one assertion there; the static-ELF `readelf` check (4 copies) → once in `nix/pkg/services/native.nix`; #60 `scripts/test-service-favicons.mjs` → per-service browser suites (UX) | |
| REWRITE-CHEAPER | #2 package plumbing (plain dependency edge); #7 `chronicle-backend` gate (6-line "suites ran" check becomes the shared gate); #8 protocol; #10 `chronicle-sbt-lock` (one updater derivation for nine fixtures); #15 `backend-source.nix` (≈ 10 invariants); #36, #37 Haystack acceptance vehicles; #41, #42 module-evaluation cost; #44 `agentic-services-hm-eval` | |
| ⟲ REWRITE deferred | #22 `manure-vm`, #54, #55 unit-graph VMs: shrinking each to one smoke per deployment shape (1,334 s → ≈ 450 s [E]) is optional follow-up work | after §2 they no longer run on routine paths; §12 item 9 |
| DEMOTE → Tier X | #14 `backend-coassembly`; #21 `manure-portable-root`; ⟲ #22 `manure-vm` | |
| ⟲ KEEP instead of DEMOTE | #27 `manure-posix-acceptance`, native leg only | §12 item 8 |
| KEEP | all other rows (20): `manure-backend`, `manure-native`, `manure-config`, `manure-client`, `manure-direct-jni`, module evaluation checks, `haystack-proxy`, `runtime-token`, `service-accounts`, `service-cli-hm`, `shared-services-modules`, `agentic-services-credentials`, `provider-credential-transports`, `shared-postgres`, `oci-images`, fixture infrastructure | skimmed files (NX §2) carry verdicts based on structure and references, not a line-by-line read |

### 6.6 Files owned by the UX workstream

`chronicle/web/tests-browser/*.mjs|tsx|html` (scenario content, fixtures chain), `haystack/web/tests-browser/{run,browse,layout,account,restart,quick-preview}.mjs`,
`manure/tests/browser/*.mjs`, the flow content of `manure/tests/test_browser_*.py`, `manure/web/viewer/test/*.browser.mjs`,
`shared/account-web/tests/browser.mjs`, `scripts/test-service-favicons.mjs`.
This plan touches them only to (a) delete junk listed above, (b) change how they are launched, (c) make the fixture-level fixes of
§4.5 and W1, and (d) the two `page.clock` edits of W6. Guidance handed to UX for the rewritten tests: scenes register with the
runner and own their context and fixture; role-based locators; `page.clock` for every timer; table-driven variants with a named
row per case; no screenshot/metrics writers; one contrast + no-overflow invariant sweep per service instead of pixel matrices.

---

## 7. Safety net

1. **One commit per group** (one table row of §6, or one seam of §5), so that any group can be reverted alone. The commit message
   carries the group's record (item 2).
2. **Deletion record per group**: for each deleted file or case, either the surviving test that guards the same contract
   (`file:line`; the triage reports already name it for almost every DELETE) or the sentence "contract intentionally unguarded:
   <reason>". Known intentionally unguarded items: SQL text equality with the pre-extraction baseline; the absence of banned
   identifiers in dashboard sources (`TestAssetHygiene`) and of removed marketing copy; test-name inventories; QEMU argv policy for
   hand-launched test VMs.
3. **Counts and timings before and after**: the baseline is the triage raw data (JUnit XML and logs under
   `reports/triage-*/`, `reports/build-profile/runs/`). Every unit reports suites, cases, failures, errors, skips and wall time
   from `counts.json` before and after, with `uptime`. A case-count change that the unit's record does not explain blocks the merge.
4. **Old and new side by side** for merges, matrix collapses and runner changes: run both on the same commit and diff the pass
   sets (per-case names). For sharded or grouped runs: at least 3 runs with different group or shard assignments, then 10
   consecutive green runs for Manure sbt grouping and Chronicle CLI concurrency, 20 for scene-level browser concurrency.
5. **Mutation spot-checks** (scratch branch, never committed): break the guarded line and confirm that the *surviving* test fails.
   Minimum set:

   | Mutation | Must fail in |
   |---|---|
   | remove the WebSocket liveness close / the worker back-off call | the shortened-interval tests (W7, W8) |
   | long-title continuation exceeds the frame bound | `CursorWebSocketTest` |
   | relax the tag keyset position check; relocation changes identity; accept a removed API version | `TagSearchTest`; `CoreTest`; `ApiVersionCompatibilityTest` |
   | Haystack: `decodeStored` limits; loader whitespace predicate | `HistoricalCompatTest` |
   | Haystack: revocation after body admission still dispatches | `HttpAuthorityLifetimeTest` |
   | retrieval: apply ACL after the candidate window | `AuthorizedCandidateTest` at the small window |
   | Manure: drop a CSP header; accept a reserved prefix; disable the unlock rate limit; ignore a stored past expiry | `HttpSuite`; `DomainSuite`/`HttpSuite`; `test_browser_unlock`; the native `410` case |
   | name a non-existent suite in `fast-suites.txt`; make a suite `assume(false)`; empty a shard | the runner / `junit-gate.py` (non-zero exit) |
   | break the provisioning command; point a fixture at a non-loopback database | the suite fails loudly; `fixture-safety` and `test_current_target_harness` |
   | remove `Requires=` from a migrate unit; grant `CREATEDB` to a service role; build a non-static ELF | `shared-services-modules`; `shared-postgres`; the assertion in `services/native.nix` |

6. **Line coverage diff for the Chronicle backend only** (the one area where cases are deleted from a suite nobody read line by
   line): a JaCoCo agent on the forked test JVMs before and after the delete/merge unit; any newly uncovered branch is explained or
   the deletion is reverted (CB §7).
7. **Nothing is lost irrecoverably**: every deletion names the last commit containing the file.

---

## 8. Policy and documentation changes

### 8.1 Proposed `AGENTS.md` text (replaces the whole "Chronicle validation" section; "Search-quality experiments" stays unchanged)

```markdown
## Validation

A task on Chronicle, Haystack, Manure or `shared/` is complete when the verify target of every service it
touches builds on the final tree:

    scripts/verify chronicle | haystack | manure | all      # nix build .#verify-<service>

Each target is a set of exact-input Nix checks: the complete backend suites on an owned PostgreSQL cluster,
protocol and codec checks, dashboard Node tests and the complete Chromium suite, collector, CLI, native
transport tests and module checks. A cache hit is valid evidence: those exact inputs passed before. Report
the command, the source identity, which checks were built and which were reused, and the case counts of the
built ones (`counts.json` in each check output). A check that fails or cannot run is reported, not worked around.

- Stage new files before verifying (`git add -N`): untracked files are invisible to flake builds, and
  `scripts/verify` refuses to run while any exist under the source roots.
- `nix build .#chronicle` (or `.#haystack`, `.#manure`) runs only the fast package gate. It is not evidence
  that the full suites passed. Source or JVM tests do not establish native-runtime behaviour or deployment.
- Inner loop: `nix develop .#chronicle --command <service>/scripts/test.sh [part]` runs the same runners
  outside the sandbox. Use it to iterate; it does not replace `scripts/verify`.
- On-demand checks are not part of verify. Run them when you change what they guard and report the result:
  `nix build .#onDemand.manure-vm` (Manure NixOS/HM modules, nginx/TLS edge), `.#onDemand.manure-portable-root`
  (root authority), `.#onDemand.backend-coassembly` (Baboon runtime, contract build settings); Chronicle
  indexing-recovery, CLI real-server and CUDA tests as described in `chronicle/README.md`.
- Runners fail on any failure, error or skip and on an empty run. Do not add lists of expected test names,
  receipts, evidence files, or tests whose subject is test tooling. Cheap tests of fixture safety interlocks
  (a fixture refusing a database or process it does not own) are the exception.
- PostgreSQL tests run one suite at a time per database. Parallel groups use separate databases cloned from a
  migrated template; never point two concurrent suites at the same database.
- Timing rule. A test may exercise a timeout, heartbeat, back-off or expiry mechanism with a controlled clock,
  or with a short interval supplied through a constructor parameter or fixture configuration, when all three
  hold: the production code path is the one executed; a separate test asserts the production default; the
  assertion keeps its kind (the event happens after the configured time and not before). It is forbidden to
  lengthen a test timeout, shorten a production deadline, add retries, filter cases or relax an assertion in
  order to obtain a pass. A test whose subject is real elapsed time against a value we do not control (for
  example a third-party default timeout, or a database-clock lease) keeps real time and runs in parallel.
```

### 8.2 Other documentation and configuration

| File | Change |
|---|---|
| `chronicle/README.md:28, 44-84` | tiers, `scripts/verify chronicle`, `chronicle/scripts/test.sh`; remove "13 explicitly named suites", "17 fixture groups", `chronicle-validation`, the receipt paragraph and `share/chronicle/validation.json`; Tier X commands |
| `chronicle/web/README.md:85-119` | drop the per-script counts ("22 retained scenario groups" …), the screenshot statement, "Goal50 selectors"; describe the pool runner |
| `chronicle/cli/README.md`, `chronicle/tests/README.md`, `chronicle/docs/operations.md:172`, `chronicle/eval/relevance/README.md` | Tier X wording; `chronicle-eval` |
| `chronicle/docs/drafts/20261028-build-validation-cache.md` | add a "superseded by this plan" header; keep as history |
| `chronicle/scripts/fast-suites.txt` | promoted suites; merged suite names |
| `haystack/server/README.md:86-91, 100-112`, `haystack/web/tests-browser/README.md`, `haystack/cli/README.md:301-309`, `haystack/docs/operations.md` (`tests-deploy/local-boot.sh`), `haystack/docs/port-contract-inventory.md`, `haystack/docs/decisions.md` | remove inventory exactness and frozen counts; `port-acceptance-20261103.md` gets a "superseded" note and is otherwise left as a record |
| `manure/README.md:524-566`, `manure/server/README.md:153-155`, `manure/server/native-tests/README.md`, `manure/docs/acceptance-toolchain.md` (+ `manure/scripts/acceptance-tools-x86_64-linux.json`, pinned to Chromium 156 while the check uses 157), `manure/docs/*-validation.md`, `path-session-continuation-evidence.md` | runner commands; remove receipts, counts and the retired `unittest discover` instruction; archive evidence narratives |
| `manure/migration/VALIDATION.md`, `manure/docs/offline-conversion.md` | follow owner decision D3b |
| `README.md:150-151` | check list |
| `shared/retrieval-postgres/README.md`, `shared/service-runtime/` | links to deleted `VALIDATION.md` |
| Deleted with their subjects | `nix/tests/{manure-check-matrix,manure-vm-current,manure-vm-acceleration}.md`, `fixtures/agentic-services-legacy.md`; `nix/tests/{service-unit-graph,hm-service-unit-graph}.md` shrink to a header comment |
| `docs/drafts/*` (historical) | untouched |

---

## 9. Before / after

Wall times in seconds. "Phase 1" = structure only (units U01–U06). "Final" = all units. The measurement to repeat is named in the
last column and is part of U33.

| Tier / path | Now | After phase 1 | Final | Repeat measurement |
|---|---|---|---|---|
| **P** `nix build .#chronicle`, backend main edit | 131 [M, BP G1] | 131 | ≈ 131 (native-bound) [E] | BP run G1 |
| **P** `.#chronicle`, backend test-only edit | 67 [M, G2] | 67 | ≈ 70–75 (more fast suites) [E] | G2 |
| **P** `.#haystack`, web-only edit | 23 [M, G5] | 23 | ≈ 9 [E, HS §6] | G5 |
| **P** `chronicle-cli` package tests | ≈ 56 [M, CC §1] | ≈ 4 (2.4 [M] + smoke [E]) | same | `nix build --rebuild .#chronicle-cli` |
| **P** `haystack-cli` package tests | ≈ 82 [M, HS §1] | ≈ 45 (single run) [E] | ≈ 12 [E, HS §6] | same for `haystack-cli` |
| **F** Chronicle verify, nothing in Chronicle changed | ≈ 1,575 serial [M, BP §8] | cache hit, ≈ 5–20 evaluation [E] | same | `time scripts/verify chronicle` twice |
| **F** Chronicle verify, backend edit — backend suite alone, serial | 909–936 [M, CB run 2; BP H03] | 909–936 (fallback mode) | ≈ 575–715 [E]: −10 junk and duplicates, −77 W7, −58 W8, −50 W9/W10, and a further −60…−140 if W11 delivers | `CHRONICLE_TEST_GROUPS=1 test-postgres.sh` |
| … backend suite, grouped, local shell | — | ≈ 140–165 [E from 173.6 M with 8 shards; `ModelTransportTest` split, bound = `IndexedSearchTest` 111–130 + ≈ 25 start] | ≈ 95–160 [E]; lower end needs W3 | `test-postgres.sh` ×3 |
| … `chronicle-backend-full` in the sandbox | 983 as an ad-hoc derivation [M, BP §4 C] | ≈ 190–215 [E]: 15 start + 51 compile [M] + 115–135 tests + ≈ 10 cluster/template/group start-up [E] | ≈ 135–200 [E] | `nix build --rebuild` |
| … whole `verify-chronicle`, backend edit | ≈ 1,575 [M] | ≈ 190–215 [E] (max of native 131 and backend-full) | ≈ 150–200 [E] | `scripts/verify chronicle` after a probe edit |
| **F** Chronicle verify, web edit — browser suite | 601–628 serial [M, BP D2; CC §2] | ≈ 105 + sandbox overhead [M 7-way outside the sandbox, CC §5] | ≈ 95–105 [E]; ≈ 45–60 after the UX rewrite adopts scenes [E, CC §6] | `nix build --rebuild .#checks…chronicle-browser` ×5 |
| **F** Haystack verify, backend edit (critical path) | native 115 → `haystack-native` 232 = ≈ 347 [M, BP G4, A13]; Scala suites not gated | ≈ 347; Scala + shared suites now gated and cached | native 115 → `haystack-browser` ≈ 110 = ≈ 225 [E]; `haystack-native` ≈ 65–70 [E]; `haystack-cli-real` ≈ 85 [E] | `scripts/verify haystack` after a probe edit |
| Haystack + shared, serial sum of all suites | ≈ 757 [M, HS §6] | ≈ 757 | ≈ 450 [E]: HS §6 gives ≈ 320 with all heartbeat waits removed; recommendation D7(a) keeps two real cases (62 s + 65 s) | per-runner timings |
| **F** Manure verify, backend edit (critical path) | native 114 → `manure-native` 910 = ≈ 1,024 [M, BP G6, A16]; 1,043 outside the sandbox [M, MN §1] | ≈ 1,024 | native 114 → `manure-native` ≈ 100–120 = ≈ 215–235 [E, MN §6] | `scripts/verify manure` after a probe edit |
| `manure-backend` | 220–229 (135–153 tests) [M] | same; no longer re-run by dashboard/Python/docs edits | ≈ 110–135 (≈ 76 sbt + 40–60 tests) [E] | `nix build --rebuild` |
| Manure edit that touches no code (docs, Python test only) | ≈ 21 min of re-run checks [M, MN §1] | JVM suite cached; target suite re-runs only for test edits | ≈ 0 for docs; ≈ 2 min for a Python test edit [E] | rebuild-matrix probes |
| VM tests on a service-code task | up to 4 tests, 1,334 serial [H medians, NX §1]; two of them on every commit | 0 (two cached, two on demand) | same | rebuild-matrix probe "any commit" |
| `nix flake check`, everything invalidated — critical path | ≈ 17–18 min + 102 s evaluation [E/M, BP §6] | ≈ 17 min | ≈ 4–5 min + ≈ 75 s evaluation [E] | `time nix flake check` cold and warm |

| Area | Cases now | Cases after | LOC now | LOC after | Basis |
|---|---|---|---|---|---|
| Chronicle backend | 1,009 (132 on Tier P) | ≈ 995 (≈ 380–405 on Tier P) | 17,556 | ≈ 17,000 | [M] / [E, CB §6, amended: nothing moves to a slow tier] |
| Chronicle clients | ≈ 978; 312 browser groups; CLI cases executed twice | ≈ 930; ≈ 270 browser groups in the gate before the UX rewrite | 14.2 k | ≈ 13.4 k | [M] / [E, CC §6 minus the UX-owned merges] |
| Haystack + shared | 1,156 | ≈ 1,045 | 16,633 | ≈ 10,800 | [M] / [E, HS §1, +4 retained safety cases] |
| Manure | 412 Python + 35 Node + 1 codec executed; 274 Scala; 165 retired never run | ≈ 340 Python/Node; ≈ 272 Scala | 27.4 k (tests incl. JSON) | ≈ 17 k | [M] / [E, MN §6] |
| Nix machinery | 63 rows | ≈ 38 rows | ≈ 13,270 | ≈ 6,400 | [M] / [E, NX §6] |
| **Total** | | | **≈ 89 k** | **≈ 65 k** | sum of the rows; the areas overlap slightly (a few Nix files appear in two reports) |

---

## 10. Work breakdown

Sizes: one implementation agent per unit. "Builds on" names the analysis agent whose knowledge the unit reuses. Units in the same
phase with different owners are parallel unless a dependency is listed. Exact commands in the acceptance column are run from the
repository root; "probe" = the rebuild-matrix scripts in `reports/build-profile/tools/`.

### Phase 1 — structure: caching and parallelism, no test content changes (cuts agent time at once)

| Unit | Scope and file ownership | Depends on | Acceptance | Saving | Risk | Conflicts |
|---|---|---|---|---|---|---|
| **U01** Invalidation fixes | §3.1 complete. Owns `flake.nix` (checks), `nix/pkg/chronicle/source.nix`, `nix/tests/{haystack-browser,service-unit-graph-vm,hm-service-unit-graph-vm,manure-backend,backend-source}.nix`, `nix/pkg/haystack/test-dependencies.nix`; deletes `backend-runner-contract`. Builds on: nix-machinery + build-profile | — | probes "any commit", (b)/(c) rows show no spurious rebuild; `nix build .#checks.x86_64-linux.{backend-source,manure-backend,haystack-native}` | 170 s + two VM runs per commit; 221 s / 232 s per web or docs edit [M] | low | none |
| **U02** Chronicle backend: grouped full suite | `build.sbt` (`chronicleServer` block: `testGrouping`, tags; delete `validationInventory` later in U10), `chronicle/scripts/test-postgres.sh` (template + per-group databases, serial fallback), split `ModelTransportTest` into two classes (test-only). Spike first: does sbt 2.0.12 honour `testGrouping`; fallback = one cluster per group. Builds on: chronicle-backend (scripts `run-shard*.sh`) | — | `nix develop .#chronicle --command bash chronicle/scripts/test-postgres.sh` → 1,009 cases, 0 failures/errors/skips, three runs with different round-robin seeds; wall ≤ 180 s local; `CHRONICLE_TEST_GROUPS=1` still green | 909 → ≈ 150 s [E from M] | medium (hidden order dependence; one shuffle sample exists) | `build.sbt` is also edited by the accounts workstream if it adds dependencies: announce the block being edited |
| **U03** Chronicle browser pool | `chronicle/web/tests-browser/run-all.mjs` (new), `web/package.json` scripts, per-process Vite `cacheDir`, split the `activity-tables` cases out of `ux.mjs`. No scenario edits. Builds on: chronicle-clients (`run-par.sh`) | — | `npm run test:browser` green 5 consecutive times at pool 7, wall ≤ 130 s; same `PASS` group names as the serial chain (diff) | 601–628 → ≈ 105 s [M] | medium (timing-sensitive UI assertions under load) | UX workstream: launch mechanics only; give them the runner contract |
| **U04** CLI duplicate runs and concurrency | `chronicle/cli/test/cli.test.ts` (`describe` concurrency), `nix/pkg/chronicle/client.nix` and `nix/pkg/haystack/client.nix` installCheck smokes; Haystack CLI single run. Builds on: chronicle-clients, haystack-shared | — | `npm test` in `chronicle/cli` ×10 green, wall < 6 s; `nix build .#chronicle-cli .#haystack-cli` | ≈ 52 s + ≈ 41 s per CLI package build [M] | low | none |
| **U05** New checks, gate and aggregates | `scripts/junit-gate.py`, `scripts/verify`, checks `chronicle-backend-full`, `chronicle-browser`, `chronicle-eval`, `haystack-jvm`, `shared-jvm`, `account-web-browser`; `verify-*` aggregates; `legacyPackages.onDemand` with `manure-vm`, `manure-portable-root`, `backend-coassembly`. Owns `flake.nix`, `source.nix`. Builds on: nix-machinery + build-profile (`adhoc-sbt.nix`) | U01, U02, U03 | `scripts/verify chronicle` green; second run builds nothing; a comment appended to one Chronicle collector file rebuilds only `chronicle-collector`; an untracked file makes `scripts/verify` refuse; `nix flake check` does not build `onDemand.*`; an `assume(false)` in a scratch suite makes the check fail | 26 min → cache hit or ≈ 3–3.5 min [E] | medium (Chromium and sbt in the sandbox; both have precedents) | accounts workstream: `shared-jvm` runs `serviceAuth/testFull` unchanged (see below) |
| **U06** Policy switch | `AGENTS.md` (§8.1), `chronicle/README.md` validation section | U05 green | review; the commands in the text run as written | — | low | none |

`shared/service-auth` and the accounts workstream: this plan changes **no** file under `shared/service-auth/src`. `shared-jvm` (U05)
runs `serviceAuth/testFull`, which discovers suites, so the new contract suites (in-memory dummy and PostgreSQL) are picked up
without registration. `shared/service-auth/scripts/test-postgres.sh` keeps its name and interface; U13 removes only its
`validationInventory` task argument and report plumbing. `build.sbt` `serviceAuth` settings are unchanged (serial, forked).

### Phase 2 — junk removal (parallel by area; one commit per group; safety record per §7)

| Unit | Scope | Depends on | Acceptance | Saving | Risk | Conflicts |
|---|---|---|---|---|---|---|
| **U10** Nix machinery | §6.5 DELETE and MERGE rows, §3.4 Nix parts, receipt chain (D2), `build.sbt` `validationInventory` tasks. Owns `flake.nix`, `nix/tests/**`, `nix/pkg/chronicle/{server,wrapper,backend-validation,protocol-validation}.nix`. Builds on: nix-machinery | U05; D2 | `nix build .#chronicle` still fails when a fast suite fails (mutation); canary mutations of §7 item 5 (module rows); `nix flake check` evaluates | ≈ 4.9 k LOC; ≈ 11 s | medium (largest diff in `flake.nix`) | none |
| **U11** Chronicle backend junk and merges | §6.1 DELETE/MERGE rows; promote sub-second database-free suites in `fast-suites.txt`. Owns `chronicle/server/src/test/**`, `chronicle/scripts/fast-suites.txt`. Builds on: chronicle-backend | U02 | deletion record; JaCoCo diff (§7 item 6); mutations for the four duplicate families; `scripts/verify chronicle` | ≈ 550 LOC, ≈ 10 s; routine coverage 132 → ≈ 380 cases | low–medium | accounts workstream if it touches Chronicle auth tests: none of the listed files |
| **U12** Chronicle clients junk | §6.2 "DELETE now" and "MERGE (ours)" rows; D6 items per the decision; `page.clock` edits (W6); CSP header assertion in `StaticHttpTest` (coordinate with U11). Owns `chronicle/web/tests-browser` deletions, `chronicle/cli/test`, `chronicle/eval/relevance/tests`. Builds on: chronicle-clients | U03; D6, D8 | `PASS` group diff explained by the record; `scripts/verify chronicle` | ≈ 0.8 k LOC; ≈ 135 s serial browser time if D6 = delete/move; ≈ 39 s W6 | low | **UX**: deletions and two timer edits in files they will rewrite; agree the cut-over commit |
| **U13** Haystack and shared junk | §6.3 DELETE and MERGE rows (not the UX-owned ones), runner scripts reduced to bootstrap + run + gate, `fixture-safety.test.mjs`. Owns `haystack/server/tests-current`, `haystack/web/tests`, `haystack/scripts`, `haystack/characterization` (D4), `shared/*/VALIDATION.md`, `shared/retrieval-postgres/validation`. Builds on: haystack-shared | U05; D4, D8 | deletion record; mutations (`decodeStored`, loader predicate, broken provisioning); `scripts/verify haystack` | ≈ 5.8 k LOC; ≈ 40 s; web package tests 14 → ≈ 1.5 s | low | accounts workstream: shared scripts keep their interface |
| **U14** Manure junk and plain runner | §6.4 DELETE and MERGE rows (not the UX-optional ones); `target-suite.py` → plain runner with the skip/empty gate; coverage note from `invariantGroups`; `source.nix` `manureWitnesses` removal is requested from the Nix owner. Owns `manure/tests/**`, `manure/scripts/target-suite.py`, `manure/server/native-tests/verification`. Builds on: manure | U01; D3a | deletion record; old and new runner on the same commit give the same executed case IDs minus the deleted ones; `nix build .#checks.x86_64-linux.manure-native` | ≈ 10 k LOC; unblocks sharding | medium (the inventory gate is entangled with `source.nix` and the check) | UX: `test_dashboard_markup`, `TestAssetHygiene` deletions |

### Phase 3 — seams, cheaper vehicles, remaining parallelism

| Unit | Scope | Depends on | Acceptance | Saving | Risk | Conflicts |
|---|---|---|---|---|---|---|
| **U20** Manure target suite: waits and shards | W1 (SQL expiry + one native `410` case), `localhost` resolver rule, port hand-over, `--shard i/n` by class, `test-target.sh` workers, per-shard report directories; timeouts in `manure-native.nix`. Builds on: manure (`timed-target-suite.py`) | U14 | pass-set diff against the serial run; 3 runs with different shard assignments; wall ≤ 150 s; mutation "ignore stored past expiry" | 906–1,043 → ≈ 100–120 s [E] | medium (browser + owned PG per worker; one load-induced failure already seen) | UX (fixture files only) |
| **U21** Manure JVM grouping and deadlines | grouping helper for `manureServer`, W13, `HttpSuite` header and prefix cases moved from the browser test. Builds on: manure | U02 (shares the helper) | 10 consecutive green grouped runs; `manure-backend` ≤ 140 s | ≈ 90–110 s [E] | medium | none |
| **U22** Haystack native transport and CLI | W12, W4 (per D7), drop `--test-concurrency=1`, timeouts, CLI in-process table cases and per-test mock server, `haystack-cli-real` check. Builds on: haystack-shared | U13; D7 | same case names minus the recorded ones; `haystack-native` ≤ 90 s; CLI package tests ≤ 15 s | 226 → ≈ 65–70 s; CLI 41 → ≈ 8 s [E] | low–medium | none |
| **U23** Haystack browser legs and shared rewrites | concurrent legs, drop the duplicated unit/markup run and the receipt harness; `AuthorizedCandidateTest` (W5); `HttpAuthorityLifetimeTest` single fixture; `HistoricalCompatTest`. Builds on: haystack-shared | U13 | `haystack-browser` ≤ 130 s, 5 green runs; mutation "ACL after window"; `shared-jvm` ≤ 120 s | 166 → ≈ 110 s; 76.7 → ≤ 5 s [E] | medium | UX (launch mechanics of browser legs) |
| **U24** Chronicle backend seams | W7, W8, W9, W10, W11; promote the two worker dummy suites after W8. Each seam its own commit with the default-pinning test. Owns `chronicle/server/src/main/scala/chronicle/{Http,Models}.scala` (parameters only) and the affected tests. Builds on: chronicle-backend | U11 | per seam: mutation check; serial run time before/after; `scripts/verify chronicle` | ≈ 250–330 s serial/CPU; wall only with U25 | medium (product code touched) | accounts workstream if it edits `Http.scala`: announce |
| **U25** `IndexedSearchTest` seeding (optional) | W3; measure where the 88 s of the first case go before changing anything. Builds on: chronicle-backend | U02 | assertions byte-identical; suite ≤ 60 s; otherwise close the unit with the measurement | up to ≈ 50 s of wall on every backend-changing run [E] | low | none |

### Phase 4 — remaining graph work, gaps, measurement

| Unit | Scope | Depends on | Acceptance | Saving | Risk |
|---|---|---|---|---|---|
| **U30** Module-test cost and merges | NX #41, #42 stubbed `evalModules`; NX #39, #49, #50 merges; NX #10 lock fixtures; static-ELF assertion in `services/native.nix`. Builds on: nix-machinery | U10 | same assertion messages evaluated; `nix eval` time of `chronicle-modules` + `chronicle-models` ≤ 15 s | ≈ 28 s evaluation; ≈ 400 LOC | low |
| **U31** `chronicle-native` smoke | run `chronicle/tests/workflow.test.ts` against the ELF + owned PG in a check; measure first; if it fails or exceeds ≈ 150 s, report and leave it in Tier X. Builds on: nix-machinery (`haystack-native` pattern) + chronicle-clients | U05 | check green ×3 with its wall time recorded | new coverage (no check starts the Chronicle ELF today) | medium (never run by the triage) |
| **U32** VM shrink (optional) | NX #22, #54, #55 as written in NX §4.7. Builds on: nix-machinery | D5 | canary mutations 4 and 5 of NX §7 | 1,334 → ≈ 450 s when the VMs do run [E] | medium |
| **U33** Documentation sweep and final measurement | §8.2; repeat every "repeat measurement" of §9 on a quiet and on a loaded host; publish the filled table | all | table with [M] in every "Final" cell | — | low |

Order and parallelism in one view: `U01 ∥ U02 ∥ U03 ∥ U04` → `U05` → `U06` → `U10 ∥ U11 ∥ U12 ∥ U13 ∥ U14` → `U20 ∥ U21 ∥ U22 ∥ U23 ∥ U24 ∥ U25` → `U30 ∥ U31 ∥ U32` → `U33`.
`flake.nix`/`source.nix` edits are serialised through U01 → U05 → U10 → U30; other units request their Nix changes from that owner.

---

## 11. Owner decisions

| # | Decision | Options | Recommendation | Assumed if unanswered |
|---|---|---|---|---|
| D1 | May a cached exact-input `verify-<service>` build satisfy "run the full suites before declaring done"? | (a) yes; (b) yes but force a fresh run of checks whose inputs the task changed (that is what Nix does anyway); (c) no, always re-execute | (a). `AGENTS.md` already permits exact-input reuse; Nix caches only successes. A pass obtained once from a flaky test is cached too; `nix build --rebuild` re-executes on request | (a) |
| D2 | Remove the Chronicle receipt chain (`validation.json`, wrapper `verify`, policy and layout checks) and keep the package dependent on the fast gate and the protocol check through a plain dependency | (a) remove; (b) keep | (a). `verify` re-runs `create` on identical inputs; the only reader of `validation.json` is the README (NX §4.1) | (a) |
| D3 | Manure legacy. **a**: delete the seven retired Python-server test modules (never executed). **b**: are all deployments migrated off SQLite, so that the offline converter, its tests (`test_offline_conversion`, `test_target_migration`), `manure/manure/{server,storage,domain}.py` and the legacy refusal cases can go | a: delete / keep. b: migrated → delete; not sure → keep | a: delete now (nothing that runs is lost). b: confirm, then delete | a: delete. b: not migrated; the converter tests stay in the sharded, cached run |
| D4 | Delete `haystack/characterization/` and the two fixture generators (the committed fixture bytes and manifests stay) | delete / keep | delete; the port was accepted on 2026-11-03 and nothing imports the directory | delete |
| D5 | VM tests on hosts without KVM | (a) all four on demand; (b) the two unit-graph VMs stay in `checks` without `self.rev` (cached unless modules change), `manure-vm` and `manure-portable-root` on demand; (c) keep all four in `checks` | (b) | (b) |
| D6 | Layout-pinning browser tests (Chronicle `tab-layout`, `activity-layout`, `popup-regression` matrix, `rebuild-occlusion`, copy-text scenes; Manure `DashboardLayoutTests`) | (a) delete now; (b) move out of the gate now, delete when the redesign merges; (c) keep in the gate | (a): the redesign invalidates them and git keeps them | (b), the reversible option |
| D7 | Haystack WebSocket heartbeat interval configurable for tests | (a) no product change: keep one real two-beat server case and the CLI's own, run files concurrently (the 62–65 s waits leave the critical path); (b) constructor-injected interval + in-process Scala test; (c) a config key so ELF tests run at ≈ 300 ms | (a) now; (b) later if serial time matters; not (c), which adds a production setting for tests | (a) |
| D8 | Which legacy data still exists in production? Chronicle pre-migration rows (`ModelIdentityMigrationTest`, `LegacyAnnotations` cases, pre-persistent sessions); Haystack rows written by the retired Node service (`Historical*` fixtures); captured evaluation v2 runs (`assess_batch`, `reparse`, legacy trace formats) | per item: gone → delete tests and the product compat code; exists/unknown → keep | check the production databases; nobody in this effort can observe them | all three exist: keep (Haystack table trimmed to ≈ 21 cases; `reparse.test.mjs` and the 8 legacy eval cases are deleted only if the v2 runs are confirmed finished) |

---

## 12. Disagreements between the reports, and my rulings

Rulings marked **overrule** change a triage verdict; I re-read the cited source for each.

1. **Chronicle "slow/performance tier" (CB Q1, #41 DEMOTE) — overrule: no slow tier.** There is no scheduler or CI in this
   repository's workflow, so a tier that is "run before releases" has no executor. With grouping, `IndexedSearchTest` in its own
   group costs wall time only as the floor of the run (≈ 115–135 s against ≈ 70 s without it), and only on tasks that change backend
   inputs. That is cheaper than an unowned tier. W3 can lower the floor.
2. **`ModelTransportTest` (CB #68: keep one 65 s case in the slow tier, add a settings assertion) — overrule: keep both, split the
   class.** The two cases exercise different client settings (`withTimeout` for headers, `withIdleConnectionTime` for a body gap;
   `ModelHttp.scala:38` [L]), and a settings assertion would not detect an Ember default that changes meaning. In separate groups they
   cost 66 s of wall in parallel, below the floor.
3. **`IndexedSearchSnapshotTest` → `IndexedSearchTest` (CB #40 MERGE) — overrule: keep separate.** Merging puts 23 s more into the
   group that already sets the floor; as its own suite it runs in parallel.
4. **`protocol-validation.nix`: merge into `web.nix` (CC #108) versus keep and simplify (NX #8) — NX wins.** The protocol check has its own
   narrow source set (`source.nix:82` [L]: generated TypeScript, models, server test fixtures). Merging would make the deployed web
   package rebuild on server fixture edits to save ≈ 2 s.
5. **Browser gate policy: "core smoke per change, full on release" (CC Q4) versus exact-input caching (BP §9.1) — BP wins.** The complete
   browser suite stays mandatory, pooled (≈ 105 s) and cached; a second, weaker tier is not needed.
6. **Manure `test_current_target_harness.py` (MN #21 DELETE) — overrule: KEEP.** Its six cases (0.3 s) assert that the fixture
   refuses to provision or reset a database it does not own and never falls back when the launcher is missing
   (`test_current_target_harness.py:16-33` [L]). A failure of that interlock destroys data; that is a different class from a test of
   an inventory or a receipt. The proposed `AGENTS.md` text states the exception.
7. **Haystack harness tests (HS #37, #38, #47 DELETE) — partial overrule.** `provision.test.mjs` and `database.test.mjs` go (helper
   stdout protocol, 14 invalid-mode subtests, real 10 s deadlines). `ownership.test.mjs` is rewritten into ≤ 4 sub-second safety
   cases: its subject, "the fixture never talks to a foreign listener on its port", is exactly the failure the Manure triage
   reproduced on this host (another agent's process on the same port number), and file-level concurrency raises the odds of the
   find-then-bind race in `fixture.mjs` [L].
8. **`manure-posix-acceptance`: DEMOTE (NX #27) versus keep the native leg (MN §3) — MN wins.** It is exact-input and re-runs only when
   Manure storage sources or shared JVM inputs change [M, BP §3]; the JVM leg (identical to `ConfinedDirectorySuite`), the report
   parser and the frozen-log policy test go.
9. **VM tests: shrink three and demote one (NX #21, #22, #54, #55) versus "demote all four" (brief) — different ruling.** The rebuild
   matrix shows that the two unit-graph VMs depend only on modules once `self.rev` is gone; they stay in `checks` as cache hits.
   `manure-vm` and `manure-portable-root` depend on the Manure package and go on demand. Shrinking becomes optional (U32).
10. **Alias period for `manure-unittests` / `manure-browser` / `chronicle-validation` (NX §9 Q4) — overrule: none.** The triage found
    references only in documentation; deployments consume packages and modules, not checks. Assumption stated here: no external
    consumer of these check names exists. If one does, a `linkFarm` alias is a one-line addition.
11. **Manure sbt: "`parallelExecution := true`" (MN action 8) — amended.** With forked tests that setting does not run suites
    concurrently; the grouping helper is needed (§4.2).
12. **`validation-report.py`: extend it for groups (CB §5 step 4) versus delete it (NX #3) — NX wins**, with the shared gate and a
    `require` on the group union in `build.sbt` (§3.5).
13. **`backend-foundation`: KEEP (HS #95) versus MERGE (NX #11) — NX wins**; `shared-jvm` supersedes it and closes the gap that no
    check runs the other shared suites.
14. **DEMOTE verdicts for cheap, cacheable tests** (MN #28, #46; CC #109, #111, #114, #124; HS #55) — amended to "stay in Tier F until
    deleted". After caching and parallelism a third tier for a few seconds of tests saves nothing and creates tests nobody runs.
15. **Chronicle fast-subset promotion (CB action 9)** — amended: promote the sub-second suites first; the two worker dummy suites
    (18 s + ≈ 9 s on the package path) follow the back-off seam.
16. **Haystack heartbeat seam (HS action 1) and Chronicle seams (CB actions 3, 5)** — re-prioritised. After sharding they no longer
    set any wall-time floor except through `IndexedSearchTest`; they are CPU and serial-time savings. Haystack: no product change
    is recommended (D7). Chronicle: constructor parameters, phase 3.

Numbers that differ between reports (none changes a decision):

| Quantity | Values | Explanation |
|---|---|---|
| Chronicle full backend, serial | 936.2 (BP H03), 944.7 (BP E03, shim), 983.1 (BP C, sandbox, cold compile), 909.5 (CB run 2), 995 (CB run 1, shim) | different runs and load; ±4 % |
| Chronicle grouped run | "8 separate databases cloned from a migrated template" (orchestrator summary) versus "8 private copies with 8 clusters, heavier than the template plan" (CB §5) | **the report is right; the template form is unmeasured** (§4.1) |
| Chronicle browser, serial | 601 (BP D2), 625 with 3 failures (BP D, inotify-exhausted), 628.0 (CC) | CC's serial run pre-dates the inotify fix |
| Chronicle fast gate test time | 5.2 s (BP A02), 3.9 s (NX, CB run 2), 2.1–3.9 s (CB) | all "a few seconds" |
| `manure-native` | 909.6 with 1 failure (BP A16, sandbox), 1,043 (MN, outside the sandbox, ≈ 75 s of host-collision timeouts), 631 median (hist.) | load and the `localhost` collision |
| `manure-backend` | 220.5 wall / 139 test (BP), 229 / 153 (MN), 122 median (hist.); "241 tests" (BP, `manureServer` only) versus "274 cases" (MN, + 33 `manureStorage`) | consistent |
| `haystack-native` | 232.4 (BP), 225.7 (HS), 151 median (hist.) | load |
| Haystack JVM | 79.7 cold in the sandbox (BP C2), 61.7 warm local (HS); 37 s of tests in both | compile cache |
| Concentration of Chronicle backend time | "top 4 suites 399 s" (BP), "23 cases ≥ 5 s = 480 s" (CB) | different cuts of the same data |

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| sbt 2 `testGrouping` with per-group environment and template databases is unproven (only the multi-process, multi-cluster form was measured) | U02 starts with a spike; fallback is the measured form; serial mode stays available |
| Hidden order or cross-suite dependence appears under a different grouping (one reshuffle sample exists) | three seeded assignments before merge; group assignment is deterministic afterwards |
| Parallel runs on a host at load 150 make timing-sensitive tests flaky (3 browser scripts failed once under inotify exhaustion; one Manure dashboard case failed under load) | repeated-green acceptance counts; pools sized from `NIX_BUILD_CORES`; timeouts are never lengthened to compensate; honest real-time tests are isolated in their own groups |
| A cached pass hides a flaky test | accepted and stated in D1; `nix build --rebuild` on demand; flakiness found during the repeated-green runs is fixed or reported, not retried away |
| Untracked files silently excluded from flake builds give a false green | `scripts/verify` refuses; stated in `AGENTS.md` |
| Removing inventories and receipts removes the "a suite silently ran nothing" guard | `junit-gate.py` (empty run, any skip), the `require` on the group union, and the three runner mutations of §7 |
| Seams let tests pass while production constants drift | one default-pinning test per seam; mutation check per seam; no config keys for tests |
| Deleting duplicates loses a unique assertion in suites nobody read line by line | deletion record, JaCoCo diff for the Chronicle backend, mutation set, one commit per group |
| On-demand checks are never run | triggers are written into `AGENTS.md`; both VM checks are exact-input, so running them when nothing changed is free; the unit-graph VMs stay in `checks` |
| `flake.nix` and `source.nix` conflicts between units and with other workstreams | single owner per phase (U01 → U05 → U10 → U30) |
| UX workstream rewrites browser files while this plan edits them | this plan limits itself to launch mechanics, deletions and fixture-level fixes; cut-over commit agreed with UX; D6 decides the layout groups |
| Accounts workstream lands tests while `shared` runners change | `shared/service-auth` sources untouched; script interface kept; `shared-jvm` discovers new suites |
| Estimates are derived from measurements on an overloaded host | every [E] cell of §9 has a named measurement in U33; phase 1 numbers rest on two direct measurements (173.6 s grouped backend, 105 s pooled browser) |
| Sandbox behaviour of the new checks differs from the shell runs (cold sbt compile ≈ 51 s, Chromium in the sandbox, 16 advertised cores) | precedents exist for each (`adhoc-sbt.nix`, `haystack-browser`, `manure-native`); U05 measures before U06 switches the policy |
| The Chronicle native ELF is still executed by no check until U31, and U31's test has never been run by the triage | U31 measures first and reports instead of forcing it into Tier F |

Not covered by this plan and worth knowing: Haystack and Manure packages ship without any backend test gate on the package path
(only Chronicle has one); `oci-images` never runs a container; no check starts the three real binaries together under the shared
provider (NX §9). These are coverage gaps the triage found, not regressions introduced here.
