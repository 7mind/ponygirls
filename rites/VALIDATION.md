# Rites validation ledger

**Status: controlled native, actual-browser/native and configured-model/native
acceptance passed. No deployment or real-forge acceptance is claimed.**
No deployment, actual remote repository changes or real PR/MR creation occurred.

## Native acceptance and corrected integration failure

On the previous `d6ade379...` ELF the full native harness reported 9 cases:
3 passed, 6 failed, 0 errors/skips. The actual browser/native case also failed
at `PublicationUncertain/publication-reconciliation-required`, after successful
login, credential, repository, rite and manual-run admission. Runtime evidence
identified execution and periodic reconciliation racing on the same run.
Barrier-driven Scheduler tests reproduced original/reconciler overlap and
repeated reconciliation. The correction is integrated as `c62cfb98`: reserve
per-run ownership before dispatch, release after complete processing, and persist
prepared base/prompt evidence before publication. The new native rebuild and
full PostgreSQL validation passed (86 tests / 17 suites, no failures/errors/skips);
the full nine-case native suite and actual Chromium/native workflow now pass.
These failures were not model-availability failures.

The real SDK/bubblewrap probe executed and observed both credential-content and
original-path denials, followed by a brokered write. This establishes the
exercised containment path, not overall native workflow success. Harness commits
`653d64e8` and `2c243705` correct premature terminal-state interpretation and phase
accounting: publication without a terminal timestamp is still active, and
supersession remains pending until closure completes. The controlled live native
workflow also passed: exact synthetic edit/publication and read-only NoChange
preserving the proposal. Private settings and raw receipts remain outside every
checkout. Earlier passing fixture receipts started with uncommitted harness
changes. The final parent rerun at `2c243705` records clean owned harness paths:
9 native cases and 1 actual-browser/native case passed without failures or skips.
The final source-bound Nix backend rerun also passed all 86 tests / 17 suites.

## Current source and artifacts

- Integration branch: `feature/rites`, dedicated task worktree. Concurrent main
  changes through `5cdff1c1` were merged without discarding local edits.
- Worker hardening: `a4c2080e`; environment/source-input corrections: `18722252`.
- Browser UI: `bfe7cdca`.
- Backend security/state corrections: `b5e8076e`; live JDBC row lifetime and actual
  scheduler reconciliation corrections: `524ca065`; per-run execution ownership
  and prepared metadata persistence: `c62cfb98`.
- Portable, correctly quoted Git credential helper: `1257f7be`.
- Nix package/source checks: `b8049799`; native/browser harness: `32f8a0d3`,
  with actual UI selector correction `17a1f1c5`.
- Current built bundle: `/nix/store/ypim6hqamm82vp893hgyxwzava27dk5c-rites-0.1.0`.
- Current native ELF SHA-256:
  `9bc9803718343f430477ff7bd9573acc75164edd6e1bf2796a2091be25da6b9c`.
- Worker artifact: `/nix/store/fkmcg98yi8i1xmmpmvq1082bd09m1yl8-rites-worker-0.1.0`.
  Its launcher SHA-256 is
  `eb6bc8606550853e6330511974886443daedfdf268af375b54ff7523cfc4acc7`.

Package build inputs are filtered Nix sources. Native compilation records the
exact input manifest, source store path and toolchain. A later source change
invalidates evidence for its affected inputs, even if unrelated suites passed.

## Parent-observed successful checks

| Check | Result | Scope |
|---|---|---|
| Fresh pinned Baboon regeneration | 48 Scala / 52 TypeScript files byte-identical | Current worker/browser schemas, not application behavior |
| Integrated protocol and worker typechecking/full tests | 104 passed, 0 failures/cancellations/skips | Includes model binding, metadata parity, witnessed detached-child cleanup and environment regression |
| Full pinned Rites Chromium Nix check | 59 passed / 10 modules, 0 failed | Actual browser against synthetic API, not native API conformance |
| Full filtered-source backend Nix check | 86 tests / 17 suites, 0 failures/errors/skips | Owned PostgreSQL, exact inventory/XML verification, no `.git` dependency |
| Filtered five-domain coassembly | 1,661 classes / 148 canonical runtime classes | All five current domains after main integration |
| Shared build/policy checks | All seven selected checks passed | Source layout, coassembly, worker exclusions, lock policy, validation policy and foundation checks |
| Dependency-lock workflow | 490 artifacts; regenerated owned copy equals repository lock | Repository lock was not overwritten |
| Shared backend PostgreSQL suites | 34 tests / 9 suites, 0 failures/errors/skips | Full discovered shared runtime/retrieval inventory |
| Full Chronicle PostgreSQL backend | 972 tests / 114 suites, 0 failures/errors/skips | Final run archived prior XML first, used fresh inventory/reports and verified input hashes |
| Shared protocol/dashboard/collector/relevance | 16 protocol TS groups / 17 Scala cases; 147 dashboard, 125 collector, 172 relevance tests | Full commands and end-of-run input hashes passed |
| Complete Chronicle browser command | All 17 declared command-chain stages passed | Unfiltered chain; search sub-run reports 45 groups; no single unified browser case counter |
| Git askpass helper | 3 focused cases plus 2 minimal Linux filesystem probes passed | Actual production-generated script, pinned executables, no host `/bin` dependency |
| Direct configured-model worker smoke | 2 passed, 0 failures/errors/skips | Genuine configured inference, actual SDK/tool sandbox, synthetic edit and read-only cases |
| Full actual-ELF native suite | 9 passed, 0 failures/errors/skips | Real SDK/bubblewrap tools, owned PostgreSQL, Git smart HTTP, GitHub/GitLab/OAuth fixtures |
| Actual Chromium/native API | 1 passed, 0 failures/errors/skips | Actual UI through native login, write-only secret, repository, rite, publication and principal switch |
| Configured-model/native coordinator | 2 passed, 0 failures/errors/skips | Exact synthetic edit/publication and read-only NoChange with predecessor preservation; not a semantic-quality benchmark |
| Native harness self-tests | 11 passed | Fixture/report behavior; not a substitute for native acceptance |

The direct live smoke validated an unpredictable file nonce, ordering/sum output,
absence of project-extension execution and an unchanged read-only follow-up.
It is not a semantic-quality benchmark, native coordinator/forge acceptance or
proof about every possible tool path. Private settings, model/provider identities,
endpoints and traces remain outside every checkout and all Nix inputs. A catalog
failure for an additional selection did not prevent the successfully tested
selection; Q44 was clarified rather than treated as permission to waive tests.

## Fail-first corrections

1. A real bubblewrap probe read a synthetic credential from a read-only mounted
   model file (`EXPOSED`, expected `DENIED`). The trusted SDK controller now holds
   inference authentication; all seven tools execute in credential-free
   namespaces. Networking remains ordinary and is not an exfiltration boundary.
2. Worker build inputs initially included unrelated/local files. A reproduced
   filter failure led to explicit inputs and exclusion checks.
3. Partial worker test environments were incorrectly treated as complete.
   Missing-value provisioning now has a regression.
4. Worker review reproduced unconfigured model lookup reaching runtime creation,
   dropped tool metadata and a detached-child test whose incorrectly named tool
   never ran. Binding happens before runtime creation, metadata is preserved,
   and the test requires real execution/result witnesses. Numeric PID signaling
   is not a pidfd guarantee; no unproven PID-reuse correction is claimed.
5. Browser response headers could clear a deadline before its body completed.
   A real-deadline reproduction now passes with bounded, deadline-covered body
   consumption. Test-only timing query knobs were removed.
6. The coordinator copied private model configuration into the tool workspace.
   Completed/failed fake-worker reproductions preceded private external
   materialization, private HOME and cleanup. Later actual native SDK tool probes
   confirmed both original-path and recursive credential-content denial.
7. The live driver imported a nonexistent protocol constant. After correcting
   that observed failure, a witnessed inherited-pipe test separately reproduced
   a watchdog hang after leader exit; the corrected guard settles and terminates
   its owned fixture child.
8. Backend fail-first cases covered authority/intent ordering, background
   revocation, numeric forge IDs, split API/clone hosts, Unicode vault bounds,
   duplicate coordinator ownership, exact recorded predecessor identity, and
   crash-after-push recovery. Known pre-dispatch denial releases the active run;
   possibly dispatched creation remains explicit uncertainty, not blind replay.
9. Actual native workflows failed before Git/model calls. A positive public
   authority contract reproduced the same JDBC failure: a `ResultSet` escaped
   its live mapping scope and was read after close. Decoding now completes in
   the callback and returns immutable domain data. Safe JDBC code/SQLState
   diagnostics supplement phase/class/frame logging without raw messages.
10. A minimal Linux filesystem reproduced the Git helper's implicit `/bin/sh`
    and `/bin/cat` dependencies. The helper now uses provisioned executable
    entrypoints and quotes credential paths. A focused test also caught that
    canonicalizing a multicall executable changes its invocation semantics;
    preserving the entrypoint fixes that observed regression.

11. Real native workflows exposed concurrent execution and periodic publication
    reconciliation. A deterministic actual Scheduler test held the original
    worker after intent while 100 ms ticks ran; concurrent creation and authority
    revocation reproduced before the correction. A second barrier exposed repeated
    reconciliation. Instance-owned atomic per-run reservation now covers the whole
    operation and releases on completion, error or cancellation. Prepared evidence
    is committed before intent. The full 86-case suite and subsequent native,
    browser/native and controlled configured-model/native workflows pass.

## Preserved failures and evidence limits

- The first shared-client run failed at `conflict did not request a fresh
  read-only plan`. Its receipt is retained. A full unchanged-source browser rerun
  passed, as did the later complete source-bound client run.
- Earlier worker runs include the reproduced partial-environment failure and a
  historical 86-case pass whose detached-child assertion was later found
  vacuous. Neither substitutes for the hardened 104-case run.
- The first full backend Nix derivation failed before tests because it required
  Git metadata. Explicit immutable source identity now supports non-Git builds;
  no fake Git history or unknown-identity fallback was introduced.
- Two actual earlier native runs each reported 9 cases: 2 passed, 7 failed,
  0 errors/skips, with zero Git HTTP/model/OAuth calls. The separate browser/native
  attempt reached credential/repository/rite/manual admission, then failed on the
  same authority path. Missing credential-probe witnesses are **unknown**, not
  containment passes. Those failure receipts are retained.
- A later pre-ownership-fix native run reported 3 passed and 6 failed cases,
  plus a failed browser/native case, exposing concurrent publication/reconciliation.
  These receipts remain alongside the subsequent passing results. The corrected
  ELF passes all nine native cases, the actual browser/native case and two
  genuine configured-model/native cases. Only synthetic repositories/local forges
  were used; real forge acceptance and broad semantic quality are not claimed.
- After concurrent Cuckoo main changes were incorporated, the Rites bundle and
  backend artifact identities were rechecked; the bundle was unchanged. Prior
  complete Chronicle/backend and shared-client source manifests were reverified
  byte-for-byte. Those unaffected results are reused, not claimed as new runs.

The initial schema belongs to a new, undeployed service; compatibility with
unreleased disposable fixture schemas is not claimed. Actual persistent release
migrations will require append-only evolution. CreateDispatched/Created
uncertainty may require operator intervention; the service does not infer that
an unavailable response proves no remote effect.

## Receipts

Local generated reports are ignored validation artifacts, not published user
presentation artifacts. Failed receipts are retained separately; stale/failing
XML is never filtered out to manufacture a pass.

- Final committed-harness native/browser/backend:
  `rites/target/committed-native-20261109T020115Z.Oo0Ahy/`.
- Native report: `rites/server/target/native-validation-runs/20261109T020115.926454Z-2724612/`.
- Browser/native report: `rites/server/target/browser-native-validation-runs/20261109T020151.560788Z-2729547/`.
- Final backend inventory/XML: `/nix/store/xm3c41k7nsbs01lxppi2hd7vwfij3452-rites-backend-validation/validation-runs/20261109T020214Z.7uvapE/`.
- Native package build: `rites/target/serialized-release-20261109T014946Z.qbdk0J/`.
- Preserved prior worker native/browser and backend histories:
  `rites/target/acceptance-history-from-worker-20261109/` and
  `rites/target/backend-history-from-worker-20261109/`.
- Fresh Chronicle backend: `rites/target/chronicle-final-20261109T010504Z.nE19T0/`.
- Complete shared clients: `rites/target/shared-clients-20261109T004213Z.Jip7Hq/`.
- Shared backend: `rites/target/shared-backend-20261109T004412Z.95BB32/`.
- Shared policy: `rites/target/committed-policy-20261109T020241Z.Ibq77o/`.
- Lock workflow: `rites/target/lock-workflow-20261109T005612Z.JFQPDQ/`.
- Initial failed shared clients: `rites/target/shared-clients-20261108T224926Z.ryfjqw/`.

A generic inert credential-boundary skill draft was delegated, parent-reviewed,
saved and get-verified in Haystack. It grants no authority and was not installed.

## Operational boundaries and cleanup

Operator provisioning, HTTPS/database setup and deployment remain separate work;
none is authorized or performed by this implementation task. Real GitHub/GitLab
transport acceptance also requires separately authorized disposable repositories.

The indexed `.worktrees/wt-ponygirls-rites-acceptance` cannot be safely quiesced
from this process: the final explicit Codegraph query again refused foreign or
unknown PID-namespace ownership. Its clean source and index are retained rather
than deleting live or ownership-unknown index state. Its validation histories
were copied before cleanup of the other task worktrees.
