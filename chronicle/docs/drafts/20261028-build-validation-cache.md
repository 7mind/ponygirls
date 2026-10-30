# Chronicle build and validation cache contract

## Current policy (2026-10-29)

The user superseded the original mandatory-full-suite package policy: routine
Nix builds use the explicit13-suite backend subset, retained-version TypeScript
codec checks, dashboard typecheck/build/fast Node tests and collector tests.
Full PostgreSQL/concurrency/deadline and Chromium suites are required by
repository-root `AGENTS.md` before agents finish a Chronicle task; they are not
a mandatory separate Nix release gate. Their commands and assertions remain
available and unfiltered.

Fast evidence must explicitly name its selected scope and suite allowlist,
validate actual reports against discovered suites, reject missing/extra/stale
reports and failures/errors/skips, and remain bound to immutable sources and the
exact installed ELF. It must never carry the old full-source claim. Cached fast
checks do not establish full-suite success or native-runtime equivalence.

Source boundaries and exact-input cache reuse remain; changing the gate changes
its evidence identity. Do not infer a measured speedup from selecting less
coverage. Report actual compilation/cache state and counts. See `README.md` for
current commands.

## Historical policy and evidence

**Everything below describes the earlier full-gate contract and its measured
runs, not current mandatory package requirements.** Preserve these observations,
failures and limits rather than retroactively relabeling them as fast validation.

The original contract was implemented and the supported production-graph package
passed full mandatory validation. A separate controlled artifact-cold run failed
closed in web validation, as detailed below; it was not a successful cold-build
result.
Latency work does not authorize deployment,
service restarts, active migration changes, model changes or production writes.
The previously validated indexing candidate remains frozen in its own worktree.

## Baseline and scope

The supplied activation log records 678 tests, 12m02s in package checkPhase,
2m18s in buildPhase and 1m16s in native-image. The newer indexing candidate has
717 tests in 92 classes: its Nix checkPhase took 11m32s, buildPhase 2m56s and
native-image 1m46s. These are different source revisions, not a before/after
performance experiment. Both show validation dominating compilation.

Per-suite and per-test measurements must distinguish intentional deadline tests,
SQL/index fixture work, acquisition and shutdown. A slow suite is not itself a
defect. Production timeouts must not be reduced. Any defect correction needs a
failing behavioral reproduction before the correction.

## Deployment safety contract

1. The supported `chronicle` package and `lib.mkChroniclePackage` always return
   a validated deployment wrapper. There is no weaker automatic fallback or
   validation opt-out.
2. Backend runtime sources include main Scala, generated Scala, runtime
   resources, migrations, build/plugin files and dependency pins. Test inputs
   additionally include all tests, fixtures, protocol/schema inputs and release
   commands. Component source boundaries are explicit and tested.
3. The full validation artifact runs the unfiltered PostgreSQL, protocol and
   concurrency suite with PostgreSQL mandatory. The retained-version generated
   TypeScript codec matrix also remains mandatory. Fast development selection
   is not release evidence. Existing full-suite assertions and serial execution
   remain unchanged unless independently justified and verified.
4. A separate receipt derivation depends on both the exact native artifact and
   successful full validation for its runtime source. It hashes the actual ELF
   after native fixup/stripping and records native/validation derivations,
   immutable runtime/test/build identities and counts derived from execution.
   The backend builder rejects empty reports, missing discovered suites,
   failures, errors and skipped tests. Counts come from executed cases; discovery
   is suite-level, not independent enumeration of individual cases. The receipt
   verifier rechecks the derivation-produced summaries and final ELF, not every
   persisted raw XML report. Validation policy/toolchain changes participate in
   cache identities. The
   deployment wrapper checks and installs this receipt and references that exact
   ELF without copying or transforming it; a passthru attribute is not a gate.
   This binds the ELF to source-level validation, not native behavioral proof.
5. Warm deployment builds reuse cached artifacts/evidence only for the same
   derivation graph. A cold supported package build must build the mandatory
   evidence or fail clearly when validation or its dependencies are unavailable.
   No untracked marker, cached result from different inputs, zero-test pass,
   silently skipped PostgreSQL leg or partial-suite fallback is accepted.
6. Nix-store integrity and configured trusted substituters are trust premises,
   not independent proof that a remote builder ran its declared commands.
7. Raw native output is an explicitly labeled development artifact. Building it
   is not release validation and it is not the supported deployment package.
   Web and collector retain their component checks. Existing `dependencies`,
   `web`, `toolchain`, `offlineAssemblyCheck`, and `pname` attributes remain.
   Explicit service package overrides remain the operator's responsibility;
   this contract secures the default factory, not arbitrary supplied packages.
   Validation includes config.example.json, archive-expression fixtures, all
   server fixtures, migration/native-resource inventory and release commands.

## Cache boundaries to prove

- UI-only change: web/wrapper change; backend native/full validation reuse.
- Collector-only change: collector changes; server/web reuse.
- Documentation or agent-policy change: no backend native/full validation change.
- Test-only change: full validation/receipt/wrapper change; native reuses.
- Runtime Scala/generated Scala/resource/migration/build-pin change: native and
  full validation change.
- Protocol/schema/codec change: the appropriate component and mandatory protocol
  evidence change; never stale retained-version evidence.
- Deliberately failing/missing full validation prevents the supported wrapper
  from building. Wrong artifact hash/source identity, missing/malformed receipts
  and failing web validation must also fail behavioral build controls. A
  fast-suite success cannot satisfy the gate.

Derivation-identity tests need both expected reuse and invalidating negative
controls. Comparisons must exclude bookkeeping noise and record actual paths.

## Initial measured findings and controls

The parent parsed all717 per-case JUnit timings. A separate owned diagnostic
run retained the original12,000-row fixtures, SQL and assertions for the first
two indexed-search cases. Metadata backfill took47.821/45.840s, each with3,001
fresh JDBC connections; acquisition was7.932/7.260s of that total. The first
case's disabled-index negative control itself took13.415s. These are measured
fixture/SQL costs, not evidence of a violated production contract. The often
quoted6,515 full-class backfill transactions includes an unmeasured high-dimension
case:6,002 were measured;513 are inferred.

Three controlled continuous-body trials finalized body consumption at1.002–1.044s
but response release drained for5.002–5.010s, returning at6.006–6.060s. Fixture
client release was below1ms. Pinned http4s0.23.38 bytecode confirms its5s response
drain default. Existing tests assert the timeout outcome, not a stricter hard
return deadline. No production drain policy, timeout or indexing behavior is
changed. Two65s idle-boundary regressions and real WebSocket deadlines remain.

Initial cache-contract controls found37 unwanted invalidations. All12 identity
cases then passed after splitting sources. Static review identified two omitted
web fixture inputs and the root TS module-policy file; an actual source-presence
RED confirmed all five affected component paths absent before correction. The
checks were preserved and their inputs included. A controlled pinned-Node exit7
was masked by `tee` without pipefail; protocol checking now explicitly preserves
upstream exit status. Failed/setup attempts remain evidence, not full passes.

## Measured development feedback

The explicit fast command executed134 tests in13 named suites with0 failures,
errors or ignored tests. With the pinned dependency store warm and compilation
cold, wall time was77.28s (sbt69s). An unchanged-input warm repeat took10.49s
(sbt7s). This intentionally has less coverage than the717-test release run and
must not be presented as an acceleration of the full suite. The first harness
attempt failed before compilation because its SBT Unix socket path was too long;
that setup error is retained and excluded from timing comparisons.

The ordinary package factory with synthetic dependency derivations passed one
positive build and rejected all six expected-failure controls: failed backend,
failed web, missing receipt, malformed receipt, wrong ELF digest and wrong source
identity. These are gate-policy checks, not real release test evidence. The
expanded17-case derivation-identity matrix passed, including explicit resource,
module-policy and cross-component fixture controls.

## Verified package and cache reuse

The corrected production graph completed with717 tests in92 discovered suites,
0 failures/errors/skips and identical per-suite case counts to the prior full
717-test candidate. The parent rechecked the actual persisted JUnit reports and
inventory as well as the receipt. The eight-version protocol gate passed46
golden groups and26 retained-branch rejections. Web validation passed107 Node
tests and223 Chromium checks; collector validation passed90 tests. The policy
check passed11 tests. All17 identity controls also passed on the final validated
source, including required invalidation and reuse cases.

Measured locally with substitutions disabled and the dependency store retained:

| Operation | Wall time | Cache/compilation state |
|---|---:|---|
| Fast134-test command | 77.28s | Compilation cold; dependencies warm |
| Fast134-test repeat | 10.49s | Unchanged inputs and compilation warm |
| Full backend + receipt + supported package | 738.91s | Backend validation cold; native/web/protocol outputs warm |
| Actual backend-test-only input edit | 738.80s | Full717/92 rerun; native/web/protocol reused |
| Supported package repeat | 2.45s | Exact validated graph warm; zero builders |
| Backend-only repeat | 1.04s | Exact validation output warm; zero builders |
| Controlled artifact-cold attempt | 1076.24s, **failed** | Native/backend/protocol cold; web browser gate failed |

The backend builder itself took735.20s, including61s of discovery compilation
and665s for unfiltered `test`. This is not a speedup of the full suite: its
observed behavior remains expensive. Slowest suites were ModelTransport141.186s,
IndexedSearch135.253s, Http70.211s and VersionedSearch45.212s. Intentional deadlines,
real PostgreSQL plans/negative controls and fixture backfill remain intact.

A test-source mutation was shown to change backend validation, receipt and
wrapper identities while preserving native/web/protocol/collector identities.
It was then executed through the supported factory: an appended newline in one
existing test file triggered another full717/92 run with0 failures/errors/skips,
taking738.80s. Actual build events show only backend validation, input metadata,
receipt and wrapper builders; the native ELF, web and protocol outputs were reused.
The parent rechecked its persisted XML/inventory, equal per-suite case counts,
changed test-source binding and unchanged native digest/file. The mutation changed
no assertions and lived only in a benchmark snapshot. The earlier738.91s result
is backend-cold completion, not a complete artifact-cold measurement. Earlier cold attempts failed before backend tests
(deep derivation context, then missing shebang patching); their successful
component timings must not be summed and labeled a successful end-to-end run.

The controlled artifact-cold run used separate component source names, with
identical input NAR content/modes verified for every component. All artifact
outputs were absent before launch; existing toolchain/dependency outputs were
retained. Native compilation, full717/92 backend validation and protocol
validation passed, but Chromium's malformed-stored-preference case timed out
selecting an existing hidden theme selector. The checked web output and supported
wrapper remained absent, despite successful backend/native receipt creation.
This demonstrates fail-closed enforcement, not a successful cold deployment build.

Three instrumented selected-case runs, three unmodified selected-case runs
(each desktop/mobile), and one unmodified complete theme-suite run passed in
bounded followup diagnostics. They do not erase the failing build or establish
its cause. A native-popover/ARIA timing race and placement/focus dismissal are
hypotheses only. No production/test patch, forced interaction, timeout increase,
test suppression or automatic package retry was applied. The complete successful
artifact-cold timing remains unavailable.

The final production-graph ELF SHA-256 is
`7a74aa71e33b5bc3a5e1dbbd6ce4912411eea7e6b0c2e9faf6eafba0fae17608`.
The supported wrapper symlinks those exact post-fixup bytes and carries the
verified receipt. The source-level suite does not establish new native runtime
behavioral equivalence. No deployment or activation was performed.

## Development feedback and measurements

Provide an explicit deterministic fast command and focused component commands.
Document their selected scope and counts; do not call them a release pass.
The full mandatory gate is a separate explicit command/CI output and remains a
hard dependency of the supported package. Shared PostgreSQL truncation, global
profile state, filesystem, port and child-process ownership must be audited
before considering any bounded parallelism; unrestricted parallelism is not
part of this design.

Report artifact-cold local build, test-only and warm supported-package build
wall times with dependency-cache state and observed counts. Because deployment
is forbidden during this task, a warm package build is a deployment-build proxy,
not a measured activation/restart. Preserve failed attempts and distinguish
measured results from projected benefits.
