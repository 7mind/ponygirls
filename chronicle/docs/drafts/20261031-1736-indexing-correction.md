# Indexing correction work log

## Scope and source

User authorized implementation of the staged correction plan. Start: 2026-10-31 17:36 UTC. Baseline commit: `77fb680340e1e1aae032d45c6a86c6d5b676f36f`. Worktree: `.worktrees/wt-ponygirls-indexing-correction`, branch `agent/indexing-correction`.

Production deployment and recovery follow verified code and explicit operator coordination; no production mutations have occurred in this task. No private archive content may be sent to additional providers. Controlled provider experiments use synthetic/versioned content only.

## Earlier read-only observations (historical, not current state)

At 2026-10-31 17:27 UTC local PostgreSQL reads found 724 live HEADs, 591 Complete and 133 Failed current jobs. Every current failure was `model-output`, Annotation, attempts=5. Journal correlation for all 133 final fences: incomplete partition 118; noncanonical coordinates 13; gap/overlap/empty/range 1; invalid JSON 1. Each job had five window failure events; 83 advanced to later failing ordinals, 50 failed the same ordinal repeatedly. Accepted checkpoints: 1597 Annotation and 6284 Embedding over 130 jobs. Failed heads: 59 with prior publication, 74 without. Historical Failed=2826; 2664 are supersession outcomes.

The observed executable SHA-256 `82fa42b3136181ad05d1a546b73b48b82da33743a392fe73d1e12572f8af7306` matched its validation receipt. Runtime source equality was checked for Models.scala, ProblemPassages.scala, ProblemPassageHttp.scala. These observations establish rejection invariants, not the unseen rejected payloads' exact shapes.

## Milestones

- [x] Capture fresh sanitized, fixed-cohort baseline (no raw transcript/exported credentials): `debug/chronicle-indexing-20261031/baseline.json` (133 jobs; 1597/6284 accepted checkpoints).
- [x] Fail-first worker reproductions: progressing seven-window source remains unindexed after fifth independent failure; persistent truncation calls=25, expected5. New tests ran before fixes. Lost-reason reproduction also observed in the same logs (`reason=unknown` for incomplete coverage).
- [x] Typed privacy-safe diagnostics implemented (`8b17e34a`, integrated from isolated diagnostics branch); correct annotation validation accounting implemented, awaiting integrated tests.
- [x] Finite durable per-window rejection accounting implemented; no nested retry multiplication. Awaiting integrated dummy/PostgreSQL verification.
- [x] Deterministic recovery/reclaim/unknown-commit tests implemented against dummy and PostgreSQL; actual native recovery acceptance passed. Full-suite inventory validation remains pending.
- [x] Controlled synthetic baseline/candidate coverage experiments v1/v2 completed; no production policy change justified or made.
- [x] Full unfiltered verification with fresh reports and exact source identities:933 backend cases/108 suites,0 failures/errors/skips;16 TS codec fixture groups and17 JVM protocol cases/3 suites,0 failures/errors/ignored. Input manifests unchanged across the full run.
- [ ] Commit own changes and safely integrate; verify before removing owned worktrees.
- [x] Report deployment/recovery prerequisites and remaining limitations. Q7: operator deploys, agent analyzes afterward.

## Invariants

No invented Context, ambiguous coordinate repair, silently relaxed coverage, checkpoint identity rewriting, unbounded retries, or automatic retarget/rebuild. Keep exact source slices, fencing, lease authority and accepted-work reuse. Any prompt/schema/window policy change requires a new profile and owner confirmation.

## Validation receipts

Fail-first: `nix develop .#chronicle --command bash -c 'cd chronicle; ./scripts/sbt.sh "testOnly chronicle.DummyContextWorkerRecoveryTest"'` at baseline plus two new regression tests. Result:7 tests,5 passed,2 failed,0 errors/ignored; failures are expected indexedRevision=None vs Some(1), and25 calls vs5. Log: `debug/chronicle-indexing-20261031/worker-red.log`. No production fixes existed at this run.

Review: Opus5.5/high reviewed the design twice. Adopted its blocking boundary correction: provider retry wraps only unaccepted annotation+validation, never accepted checkpoint decode, checkpoint write or `accept`. Adopted separate rejection/authorization limits, per-attempt fence, idempotent rejection records, retained retry epochs and a hard authorization backstop. Current candidate is under independent Opus review.

Diagnostics child commit `7b7520381aad3385caa23621efd09623fa28ea91`, integrated as `8b17e34a`: fail-first subtype assertion failed before its fix; child focused run149 cases/8 suites passed, no failures/errors/ignored. Parent has not substituted that for final full verification.

Annotation accounting fail-first: `testOnly chronicle.InProcessModelAccountingTest -- --tests *actual*annotation*` failed at failedCalls=0 versus expected2 for invalid decoder outputs while preserving provider usage. Log `accounting-red.log`.

Pinned `npm ci` completed for both locked trees; no lockfile changes or dependency upgrades.

Harness error: the first integrated compile and protocol validation ran concurrent SBT instances in the same worktree (the protocol script launches SBT internally), causing missing checkpoint classes/class-backup failures. This is not evidence of a source or compiler defect. Preserved old XML in `pre-clean-test-reports`; no source workaround. Both failed logs retained (`targeted-green.log`, first `full-nonbackend/protocol.log`). All subsequent SBT-backed checks must be serialized. Clean targeted run `targeted-clean.log` then passed87 cases/4 suites with0 failures/errors/ignored; final full suites still required.

## Native and nonbackend verification

New package: `/nix/store/r9yxgjdn755bybqyzqcgrviqh6wb3gwk-chronicle-0.1.0`. Actual ELF: `/nix/store/sq3vq06zzclr4y2adw4r1aqqvbqirqjf-chronicle-native-development-artifact-0.1.0/libexec/chronicle-server`, SHA-256 `37da33ad5d9443f7d95f87bbe00f40a4e1770b6494e02679b58ed7a203d92cf0`, computed and matched its receipt. Fast receipt scope only:131 cases/13 suites,0 failures/errors/skips.

The full-run input manifests match203 runtime files in `/nix/store/l5nlsdqb1b53hw232ll1wbskhyhf83zs-chronicle-server-source` and115 backend test files in `/nix/store/0drb9v7anjam24aphpb441jbmdavx94k-chronicle-backend-tests-source`. Manifest identities: runtime `sha256:fe023b018218e59ac42cc75080a940acde9a3148e245bc7e56036a9e89fef66a`; tests `sha256:66171dd0ff64951a31350b03251b35b6e55667ffd05083ee806b0f02336ebb24`. This binding is not by itself a full-suite or native-runtime behavioral pass.

Native acceptance source child commit `ab1a94b949cdc81c2c31a3ae6567a15e6be5a677`: baseline ELF failed before correction at five job claims/three completed windows, after three earlier validation rejections, exactly one503 and another rejection. New exact ELF passed the same case in18.756s: seven windows, seven rejections, one503, two job claims, fifteen annotation calls; every original source embedded once. Persistent invalid source terminated after five calls in one claim; restart made no additional call; owner RetryJob preserved run ID/old ledger rows, advanced retry epoch and completed with one new call. Fresh owned PostgreSQL and loopback provider, generated1.9 API; no external model or production database. Command: pinned shell, `CHRONICLE_SERVER_COMMAND='["<actual ELF>"]' node --import tsx --test indexing-recovery.test.ts`. Result:1 test passed,0 failed/cancelled/skipped. Source SHA-256 `d9ecd7792b8564a9b4449506d2f83df444e60153462bd2e2c57c441f5c7b7a58`; red log SHA-256 `901da38f8d44e7f528e7632e0d196d58af85485757e5958a43b35f6f0425e570`.

Fresh complete nonbackend command chain passed in `nonbackend-final/`: dashboard typecheck and133 Node tests; complete Chromium chain17 browser programs/285 named PASS records excluding numeric summary lines; collector typecheck and125 tests; relevance172 Python tests and29 Node tests. Node tests reported0 failures/cancellations/skips. Browser named checks are not a framework testcase inventory. Web/collector/generated sources and lockfiles remain unchanged from77fb6803.

`nix build --no-link --print-out-paths` satisfied `chronicle-validation-policy`, `chronicle-modules`, `chronicle-hm-server` using exact-input existing store outputs (reuse, not fresh test executions).

## Controlled provider experiments

Synthetic-only, no archive/database access or production mutation. Frozen configuration observed at18:00UTC: DeepSeek-V4.1-Flash-1017, glm-max-reasoning,65536 completion tokens,900s per-request deadline,1MiB response bound, concurrency4. Revisions here are configured labels, not independently verified provider identities.

V1 runner source `ed7edcfb`:22 calls/windows,22 coverage-valid, one baseline gold mismatch on meaningless filler. V2 runner `0cf82193`:28 calls/windows including dense24/65-message inputs with2048-byte fragments; baseline13/14 coverage-valid, candidate14/14. Baseline's sole failure was exact token-limit truncation on the filler fixture, not a reproduced incomplete partition. Candidate had one filler gold mismatch. All dense and runtime negative controls were coverage-valid; raw result directories and request/source/corpus/gold hashes are retained. Both experiment processes deliberately exited1 because their acceptance predicate includes classification/coverage failures; neither is an all-pass quality result. Filler gold is ambiguous and outcomes varied between runs. Do not infer robust semantic improvement or repair of the production incomplete-partition cohort. Candidate reminder remains outside production; no prompt/schema/window/profile change.

## Production boundary

Q7 was read at the verification milestone and is answered: **“You commit, I deploy, you analyze.”** No agent deployment or production job retry is authorized by that answer. Commit/integrate the correction, then let the operator deploy. After notification, freshly verify the active ELF/source/configuration and analyze current failures and the fixed original cohort. Do not infer deployment or successful publication from this build's receipts. Synthetic-only coverage experiment is being implemented separately; no prompt/schema/window change is in the production candidate.
