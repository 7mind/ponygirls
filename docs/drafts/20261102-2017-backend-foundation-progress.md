# Unified backend foundation — execution log

## Scope and authority

User approved the next implementation slice and requested subagents/worktrees. Subsequent clarification: backward API/codec compatibility is unnecessary because there are no independent deployments. Target one current contract and coordinate owned client changes; do not build legacy adapters or retain historical wire versions. Persisted data, credential secrecy, authorization and durability remain correctness requirements. No live activation or database migration in this slice.

Base: `0ebe81ad49a4a0583216ecf1fdeb7f0bbbf95382` (main observed 2026-11-02). Unrelated epistemics documents committed since the planning baseline are preserved.

## Work allocation

All writers use separate precreated Git worktrees under the main checkout's ignored `.worktrees/`; harness `workspace_path` routing was denied, so children were explicitly restricted to their absolute assigned worktrees using `isolation:none`.

- Integration/docs/validation: `wt-ponygirls-backend-foundation`, branch `feature/backend-foundation`.
- Common sbt/Nix build: `wt-ponygirls-backend-build`, branch `feature/backend-build`, subagent `8091c0a3-6b1a-41c0-b6c0-8069c68a8bf3`.
- Lossless JSON boundary: `wt-ponygirls-lossless-json`, branch `feature/lossless-json`, subagent `d27a1c6a-37e0-4636-b570-acf3c2bd0eb5`.
- Manure filesystem feasibility: `wt-ponygirls-manure-filesystem`, branch `feature/manure-filesystem`, subagent `4c98d3c6-a6ce-48f4-a7c5-58ab41e4a513`.

Codegraph exploration again refused daemon PID-namespace ownership; direct source inspection is used.

## Verification goals

1. One active root multi-project sbt build, unchanged pinned dependencies, working Chronicle/package wrappers, Nix source/lock/validation wiring. Verify offline assembly, full affected suites and policy/module checks, not merely fast package checks.
2. A typed Scala lossless JSON module with explicit validation limits and behavioral tests. No binary floating-point rounding or legacy JavaScript digest requirement.
3. A narrowly scoped descriptor-safe Manure filesystem capability with real-filesystem tests and honest JVM/native capability evidence. Missing JDK primitives must be reported explicitly, never replaced by race-unsafe paths.
4. Integrate only verified task commits, review, commit on the integration branch, fast-forward safely into main, verify the integrated tree, remove only clean task worktrees.

## Execution evidence

Foundation slice implemented and verified. The Haystack/Manure server ports, shared search extraction and database consolidation are not completed by this slice. No deployment or live-data migration performed.

- `e21afb9b00ab5bcce55b91c67898db8e83be5fc5` merged: dependency-free `shared/lossless-json`. Writer ran clean pinned-shell compilation and 35 MUnit cases; parent integrated Nix check confirmed the same 35 cases with zero failures/errors/skips.
- Baseline full backend task `bgt-0e8137e2dac7c433` completed: 952 cases, 110 suites, zero failures/errors/skips. Parent validated inventory/XML with `chronicle/scripts/validation-report.py` and moved reports/inventory to `debug/backend-foundation-evidence/chronicle-baseline/` before the post-refactor run.
- Baseline frontend task `bgt-df64cf9b9c561014` completed web installation/typecheck/Node tests and reached the full browser command, then failed in `tests-browser/activity-tables.mjs:96`: timeout waiting for collector header `HistoricalUnleasedRunning` after a stale/resume event. No `chronicle/web` source changes exist relative to the base. This is a pre-foundation failure, not established as a regression or diagnosed root cause. No timeout/assertion changes made. The compound command stopped before collector/relevance; those subsequently passed independently as `bgt-ae091a36343b3cab`.
- `18c5cec6c863c78e0c4d97d155d2b946ba1fa5b8` merged: confined filesystem capability/probe. Writer reports 17 passing JVM tests and actual descriptor-dot `fsync`/`renameat` traces; full durable activation still refuses mkdirat, physical-root claim and existing-file type-verification gaps. Parent preserved final/initial native artifacts and logs under `debug/backend-foundation-evidence/`, checked final committed Scala source hashes, and independently reran the exact final native executable (SHA256 `e2ef154c0cd240a9004350fb0223456648a0752b53f0f8d5291a6bfb66c8df0d`). It exits 1 at read-only preflight because the provider returns `sun.nio.fs.UnixDirectoryStream`, not `SecureDirectoryStream`, before payload creation. This is reproduced feasibility rejection, not native acceptance.
- Collector/relevance continuation `bgt-ae091a36343b3cab` completed: collector typecheck plus 125 tests passed; Python relevance suite 172 passed. Baseline web Node suite had 147 passes before the browser failure.
- Independent build review found a root-layout regression in `validation-evidence.py`: the reader still looked for `testSource/scripts/fast-suites.txt`. Parent reproduced `FileNotFoundError` against the actual filtered source/store backend report before any fix; old synthetic fixtures had masked it. Correction `a5df4443010e49920b1a7dc9b3148f47ad9b9b68` is merged: one current path, corrected fixtures and a real-filtered-source layout regression. Writer executed actual Chronicle receipt construction plus good synthetic package successfully; parent final package/policy gates also passed.
- Integrated Nix foundation check `bgt-19e0ce91f1a29fc4` passed: `losslessJson` 35 cases and `manureStorage` 17, zero failures/errors/skips. Parent read immutable receipt `/nix/store/4h3yd3yppawzyzsbksjczvfmhf015ldb-backend-foundation-validation/foundation.json`, scope `complete-jvm-foundation-modules`, with native/Chronicle claims explicitly false. Reporter policy has seven direct tests; source-filter policy check passed.
- Parent regenerated both Scala/TypeScript contract trees and model lock in an isolated debug copy using pinned Baboon 0.0.198; `diff -qr`/`cmp` matched current checked-in outputs exactly. No generated-source edits.
- Post-refactor full PostgreSQL task `bgt-b3a7eaa326ba09f5` passed: 952 cases, 110 suites, zero failures/errors/skips. Parent independently validated inventory/XML and preserved them in `debug/backend-foundation-evidence/chronicle-final/`. Its consumed JVM/build/test inputs are unchanged from start source `0ee1687aaf4295c8ca528b72b01210f73c6c55f1`; subsequent changes are Nix receipt checks/docs only.
- Skill-generalization analysis by a subagent was reviewed against actual evidence and five complete adjacent memory drafts. Inert candidate `corporate-activity:skill-draft-jvm-native-filesystem-capability-gate` was saved and read back at revision 1; no skill installed.
- Fresh toolchain observation at 2026-11-02T20:23:56Z via integration `nix develop .#chronicle`: JVM/native-image are `/nix/store/6pfiwq699rwsdl6scfvjqdzzg5hsmx43-graalvm-ce-25.4.4.1.1/bin/{java,native-image}`, native flags `--static --libc=musl`.

- Parent final Nix package/policy task `bgt-d83ab1b03c6fb773` completed successfully: actual Chronicle package, foundation modules/report policy/source filters, receipt-layout regression, validation policy, lock updater fixtures, NixOS module and HM server checks. Package `/nix/store/y37jl94hhgh9r4k7m5zcxdf34jn1fl5c-chronicle-0.1.0` contains ELF SHA256 `38037a4f9d101231d5ac9ff4d8f080cbaea37ae1c19884ec95ca764a71ef7ce4`; parent recomputed it and matched the installed receipt. Its receipt claims only the 13-suite/131-case fast subset and 16 protocol fixture groups, not the full suite.
- Parent ran actual native recovery acceptance against that ELF: `nix develop .#backend`, locked `chronicle/tests/npm ci`, then `CHRONICLE_SERVER_COMMAND='["/nix/store/y37jl94hhgh9r4k7m5zcxdf34jn1fl5c-chronicle-0.1.0/libexec/chronicle-server"]' node --import tsx --test indexing-recovery.test.ts`. One focused native workflow passed, zero failures/skips, exercising owned PostgreSQL, controlled models, checkpoints, restart and owner retry. It is not semantic-quality or deployment evidence.
- Build-review follow-up closed the reproduced receipt-layout finding with no further findings. It was source review, not an independent execution.

- Final `chronicle/scripts/test-codecs.sh` passed in the pinned backend shell after preserving full backend reports: 16 TypeScript fixture groups and 17 Scala cases across three suites, zero failures/errors/skips. Parent checked fresh protocol XML separately; no selected-suite reports are mixed into full-suite evidence.
- Final collector/relevance task `bgt-a8982268d21320ce` passed again: collector typecheck/125 cases and Python relevance/172 cases.
- Parent confirmed unchanged consumed backend inputs, unchanged dependency-lock bytes versus the old Chronicle-local lock, unchanged flake pins and all local links in root/Chronicle READMEs and the migration plan.

- Final web task `bgt-a1d7bff190959d0d` completed successfully: typecheck, 147 Node cases and the complete unfiltered `npm run test:browser` command, including its final tab-layout leg. The baseline header timeout did not recur; its cause is not established and no UI assertion/deadline/source was changed. Browser case counts are not exported as a single machine inventory, so no aggregate browser-case count is claimed.
- Raw logs for all nine owned background tasks, including the unsuccessful baseline, are preserved under `debug/backend-foundation-evidence/background-logs/`. Full backend/protocol XML, source-bound native probe artifacts and local regression reproduction are preserved alongside them.

## Final verification summary

| Scope | Command / evidence | Result |
|---|---|---|
| Chronicle backend, before/after | `nix develop .#chronicle --command bash chronicle/scripts/test-postgres.sh`; separate fresh inventory/XML per run | Each 952 cases / 110 suites, zero failures/errors/skips |
| Shared modules | `nix build --no-link .#checks.x86_64-linux.backend-foundation` | 35 JSON + 17 filesystem cases; JVM only |
| Current codecs | Pinned `chronicle/scripts/test-codecs.sh` with dashboard TSC; isolated regeneration diff | 16 TS fixture groups + 17 Scala cases / three suites; regenerated trees/lock identical |
| Dashboard | Pinned shell: `npm run typecheck`, `npm test`, complete `npm run test:browser` | 147 Node cases and full browser command passed; earlier baseline timeout retained |
| Collector | Pinned shell: `npm run typecheck`, `npm test` | 125 cases passed |
| Relevance harness | `python3 -m unittest discover -s chronicle/eval/relevance/tests -v` | 172 cases passed; no semantic-quality claim |
| Actual Chronicle native artifact | Focused `indexing-recovery.test.ts` against verified installed ELF | One workflow passed, no fallback/production data |
| Nix package/policies/modules | Actual package plus foundation, source, reporter, receipt-layout, validation, lock and HM/NixOS checks | Passed; package receipt retains explicit fast-only scope |
| Manure native filesystem | Exact hashed actual native probe, independently rerun | Rejected missing SecureDirectoryStream before payload creation; **not accepted for a durable store** |

Consumed backend/build/test inputs were checked unchanged from full-run source `0ee1687aaf4295c8ca528b72b01210f73c6c55f1`; dependency-lock bytes and flake pins are unchanged. Later merges preserve unrelated main-checkout epistemics documents. Do not declare the full service ports or native Manure feasibility complete.

## Integration receipt

Foundation commits were fast-forwarded into the original clean `main` checkout at `e7519fb3`. On main, Nix re-resolved/reused the exact verified Chronicle package, foundation check and receipt-layout check identities; the checkout remained clean. Unrelated epistemics-journal commits were merged without editing their content.

All three writer worktrees were clean, their HEADs were ancestors of main, and their directories/Git registrations were removed without force. Meaningful source-bound evidence, initial failures, final native probes, full reports and all background logs were copied to the main checkout's ignored `debug/backend-foundation-evidence/` before removal.

This tracked receipt precedes removal of the integration worktree itself. The final generated local receipt `debug/backend-foundation-evidence/completion.json` records its post-removal directory/registration checks and final main commit. No service activation, live-data migration or push occurred.

## Subsequent POSIX bridge

The public-JDK capability refusal above is preserved as historical evidence, not a
fundamental stack limitation. A subsequent user-requested [POSIX/JNI bridge](20261102-2246-posix-bridge.md)
now passes the same 26 filesystem contracts on the JVM and actual static-musl native
artifact, including directory creation, existing-file verification and root ownership.
It resolves that primitive gap without a weaker fallback. Full artifact-store publish,
metadata and recovery semantics, service ports and deployment remain separate work.
