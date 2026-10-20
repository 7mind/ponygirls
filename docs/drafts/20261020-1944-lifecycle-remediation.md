# Lifecycle remediation follow-up

Status: requested remediation implemented and verified. Earlier audit corrections are preserved. Final acceptance results below supersede the chronological checkpoints.

## Final verified state

- Governing notices use the patched SDK's **`pi.enqueueMessage(message, { triggerTurn:true, deliverAs:"steer" })`**, not the legacy fire-and-forget API. Its synchronous return transfers in-process ownership; it never waits for a full governor run. Unsupported SDKs fail before delegation, with no fallback.
- This is an additive SDK boundary: **`pi.sendMessage` keeps its original transformation pipeline**, and direct SDK `sendCustomMessage` keeps its full-run promise. Retained context emits public message events but does not replay extension message-transformation hooks. Both scheduling fields are explicit; deferred `nextTurn` is rejected before acceptance rather than promising unsupported retention.
- Accepted busy payloads survive clearQueue/abort and flush faults; cancellation clears wake intent only. Safe steering, follow-up priority, compaction, terminal-boundary races, reporter exceptions and disposal have regression coverage. Failed storage rollback disables further appends until repair/reopen.
- Final package: `/nix/store/5k5scs5iin2zrxsqvl4xb4z18qvww7zb-pi-coding-agent-1.2.0`; source patch SHA-256 `749263be3928a22e06349f7c0e31dee33830de26b16ae84954675ba3fd0c6bc8`. Ordinary Git-backed Nix build succeeded, including upstream TypeScript build, bundle construction and version install check. The retained-ingress validator is present in the compiled CLI bundle as well as the SDK tree.
- All ignored SDK test dependency links and `PI_SUBAGENTS_SDK_ROOT` were pointed at that artifact. Its actual CLI shebang selects **Node 24.21.0**, which executed the final suite: **631 passed, 0 failed/cancelled/skipped**. Strict extension TypeScript checking and `git diff --check` passed. At verification, no contents were staged; new files had Git intent-to-add only.
- Logs: `debug/20261020-1944-patched-sdk-build-6.log` and `debug/20261020-1944-final-packaged-full-suite-6.log`. Earlier packaged builds passed all 629 and then 630 tests. The final case verifies that preparation failure releases busy state without publishing premature successful settlement to worker completion consumers.
- Sandbox correction is test-only. Real bubblewrap checks passed in the final suite, including direct home sentinels, canonical/alias controls and read-only runtime markers; no production mount restriction was weakened.
- The current running Pi/profile was **not deployed or switched**. Rebuild the configured Pi/Home Manager profile and restart to load the new SDK and extension together. No upstream filings.
- Reusable sandbox diagnostic draft saved and revision-checked at `corporate-activity:skill-draft-mount-namespace-sentinel-probes`, revision 1; inert, not installed. Delegated ingress-pattern review found substantial overlap with installed `tass`, so no generic duplicate queue skill was created.
- Remaining boundary: attachment cursors and SDK pending ownership are not crash-durable session receipts. Reattachment still intentionally skips prior journal history; no universal or cross-process exactly-once delivery/action guarantee is claimed. Permanent external failures require intervention after bounded retries.

## Explicit requirements

- User requested fixing the remaining cases and explicitly rejected `triggerTurn:false` for lifecycle notices.
- Actionable subagent notices must reach a model request without new user input, while preserving assistant/tool-result ordering.
- Explicit abort must not immediately restart the aborted run merely to consume an already queued notice. Preserve its received context; genuinely new child activity can wake an idle session.
- Correct the reproduced Pi 1.2.0 asynchronous ingestion, destructive custom-message drain, flush/idle cleanup, and minimal-binding reload failures at their source, packaged through a local Nix patch.
- Diagnose and correct the baseline sandbox assertion without weakening isolation checks.

## Historical evidence

`ac84a13084e0ce57fead1004a5222a7b03ed3877` explicitly introduced “context-only notice delivery … without requesting idle inference.” The change fixed visibility, not automatic coordination. No technical necessity for forbidding automatic resumption was found in that commit message.

## Plan and acceptance criteria

1. Convert the prior diagnostic observations into failing behavioral regressions for intended delivery/idle/reload behavior; add autonomous-governor wake checks.
2. Patch pinned Pi source with retained custom-message ownership and acknowledgment distinct from full-run completion, non-destructive flush handling, guaranteed cleanup, and explicit extension-binding state. Verify against rebuilt pinned SDK, not a monkeypatched installed package.
3. Update the subagent delivery pump and contradictory no-inference tests. Test idle/busy/final-boundary arrivals, multiple pages, late questions, transient/permanent append faults, clearQueue/abort, disposal/reload and source cursor progression.
4. Investigate sandbox assertion separately with a single writer subagent scoped to sandbox source/tests. Require synthetic sentinel evidence before changing either boundary or assertion.
5. Typecheck; run complete subagent suite and relevant SDK tests; keep all new failures and remaining limitations explicit.

## Evidence and work ownership

- Original working tree still contains all prior audit corrections, no commits/deployment.
- Pinned Pi 1.2.0 source resolved through the Nix build graph and realized at `/nix/store/iqgb8vsyr499g1xzcn06wr0q35s17wxq-source`.
- Installed SDK is unchanged at `/nix/store/rvf511r34fdw3wcnllkf8z61i01b74ji-pi-coding-agent-1.2.0/lib/node_modules/pi-monorepo`.
- `fix-sandbox-baseline`: only writer subagent, in-place but restricted to sandbox source/tests; parent owns SDK packaging, notice delivery and associated tests/docs.
- `review-wake-delivery-design`: read-only design/edge-case analysis. Reports are not execution evidence.

## Follow-up evidence and current implementation

- `debug/20261020-1944-sdk-retention-before.log`: 8 of 10 new behavioral regressions failed against the unchanged SDK for their intended causes (idle rejected append never recovered for either wake policy, 47 queued notices discarded, final flush stranded streaming state, empty/mode-only reload omitted start, clearQueue lost triggering custom context, real EISDIR persistence failure advanced native memory/leaf). Two baseline controls passed.
- `debug/20261020-1944-governor-wake-before.log`: both real-child file/memory cases delivered completion to context but timed out waiting for automatic governor resumption.
- Parent now sends notices with `triggerTurn:true, deliverAs:"steer"` and has bounded three-attempt, 100 ms retry for rejected ingress; disposal cancels the retry. Dummy pump and extension wiring tests: 17 passed; pinned extension typecheck passed.
- Chosen SDK contract: preserve `pi.sendMessage():void`; synchronous return transfers ownership, not native commit/fsync or full-run completion. An idle precommit append failure throws before ownership transfer, allowing pump retry. Busy messages live in SDK-owned pending records, not the disposable low-level steering/follow-up queues. Idle preparation cannot block further notice acceptance.
- First implementation lives in ignored `debug/20261020-1944-pi-source`, with pre-change six-patch source copies in `debug/20261020-1944-pi-base`. Generated repository patch: `nix/pkg/pi-coding-agent/patches/retained-custom-message-ingress.patch` (not yet declared by package.nix). First build uses an explicit override adding that patch to the existing six.
- First build background id: `bgt-9118fa2ac2fd811d`; log also retained as `debug/20261020-1944-patched-sdk-build.log`. Do not test only the old installed SDK links; rebuild and relink local ignored test dependencies to the new artifact.
- Sandbox subagent finished: only `tests/sandbox-workspace.test.ts` changed (+49/-8), no production boundary change. Agent reports 116 tests pass with real bwrap, targeted canonical PATH control passes, typecheck/diff checks pass. Parent inspected diff; full independent suite still required.

## Review findings captured before correction (historical)

- New SDK tests already added for followUp-before-steer priority, postcommit observer+error-reporter failure, delayed before_agent_start accepting a later question, settlement-boundary wake, and disposal mid-flush. Run against first rebuilt artifact before correcting new implementation defects.
- FollowUp head currently blocks later steering at turn_end: filter eligible records without changing priority semantics; preserve per-mode ordering.
- Throwing error reporter after a committed observer exception can propagate rejection and cause duplicate caller retry; reporting must not reclassify already accepted delivery.
- Reentrant clearQueue/abort during an idle native custom-message observer may be overwritten by the idle enqueue finally rearming its local wake intent. Needs cancellation-version/ownership evidence and regression before change.
- Reentrant dispose during flush must fence subsequent writes AND subsequent automatic start in that same drain.
- Storage reader found remaining `appendFileSync` call sites outside _persist; import was removed in first implementation and must be restored after observing build diagnostic.
- Reader identified closeSync failure outside persistence rollback catches: need real-close-then-throw fault regression comparing memory/disk and retry; no claim that close errors are corrected yet.
- Durability scope remains explicit: no fsync/crash-atomic/cross-process transactional guarantee. Permanent I/O/rollback failure can require operator repair; bounded retries must report exhaustion, not spin.

## Earlier implementation checkpoint (superseded)

- First Nix build failed with the two missing appendFileSync references; import restored after inspecting the actual compiler errors.
- Intermediate Nix build `bgt-b8149e789f9adc50` uses the selected-file snapshot at `debug/20261020-1944-flake-snapshot`, log `debug/20261020-1944-patched-sdk-build-2.log`. It predates the final append-quarantine and priority changes. A fresh ordinary Git-backed `nix build .#packages.x86_64-linux.pi-coding-agent --no-link --print-out-paths -L` is REQUIRED for final verification after collecting this intermediate build's notification.
- SDK source edits remain in `debug/20261020-1944-pi-source`; the generated package patch now contains all final source changes (three files: agent-session, session-manager, extension API documentation). Current patch SHA-256: `b27459550cdf6cc234397c89368cde2c07d0944fb880909a2a411243218f7b37`.
- Reentrant cancellation/disposal, priority inversion, postcommit error-observer replay, close/disk divergence and failed-rollback retry were reproduced against intermediate code before corrections. Their logs are `debug/20261020-1944-sdk-{first-runtime,reentrant-before,projection-before,rollback-before,followup-priority-before,lowlevel-queue-before}.log`; pump reporter failure is in `debug/20261020-1944-pump-observer-before.log`.
- Corrections now preserve steering priority at natural and stop boundaries, prevent a retained low-level queue from spinning idle recovery, version cancellation across observers, fence mid-flush disposal, isolate reporter failures, include close in persistence rollback, and reject further appends after rollback failure until repair/reopen.
- A projection-loss hypothesis did NOT reproduce: the existing preparation path refreshed context before inference. Kept the positive boundary test; no speculative refresh fix added.
- **50 focused diagnostic tests passed**, zero skips/failures (`debug/20261020-1944-diagnostic-final-focus.log`). They use a local SDK copy with two files transpiled from the patched pinned source, not a claimed final Nix artifact. `--noCheck` was used for this fast diagnostic emit only; Nix must supply the actual upstream full typechecked build.
- Earlier full diagnostic suite: 620 tests, 619 passed, 1 failed, zero skips (`debug/20261020-1944-diagnostic-full-suite.log`). The sole failure was a one-event-loop-tick assumption at agent_settled, corrected to await the native delivery event with a deadline. Final suite now includes additional regressions and must run again against the new Nix artifact.
- Ignored local dependency link `.../ponygirls-subagents/node_modules/@earendil-works/pi-coding-agent` currently points to `debug/20261020-1944-sdk-runtime`; other links still reference the old immutable SDK. Repoint ALL local SDK-related links and `PI_SUBAGENTS_SDK_ROOT` to the final built package for verification.
- New task files are marked Git intent-to-add (no contents staged, no commit) so normal flake evaluation can see them. `patches/.gitattributes` scopes whitespace exclusion to unified-diff data files; their leading context spaces/tabs are protocol syntax. Validate the added source lines separately for trailing whitespace, and verify patch application through Nix. This new attribute still needs intent-to-add.
- User documentation and README now describe automatic steering/coalesced idle wake, explicit abort semantics, retry bounds, exact patched Pi 1.2.0, runtime-alias ancestors, and non-durable attachment cursors. Original audit explicitly marked historical instead of deleting its baseline evidence.

### Compatibility correction after that checkpoint

An additional reproduction showed that repurposing the legacy sendMessage bridge bypassed custom-message transformation hooks (`debug/20261020-1944-sdk-message-hooks-before.log`). Restored that pipeline and introduced the additive retained enqueueMessage action across types, runtime initialization, loader revocation and runner binding. Added a pre-delegation capability check and preserved both legacy and retained stale-handle rejection. A separate automatic-compaction reproduction showed the next request missed accepted context; flushing safe queued context after compaction and before rebuilt request projection corrected it. Unsupported nextTurn ownership was then reproduced against the intermediate packaged artifact and removed from the retained API's supported domain. Those cases pass in the final packaged suite; the older checkpoints and hashes are provenance, not current instructions.

A final SDK regression reproduced a premature agent_settled event when preparation rejected before the low-level run (`debug/20261020-1944-sdk-preparation-settled-before-2.log`). Source tracing showed that worker completion consumers could treat that as success before their prompt-rejection handler ran. Cleanup now resets the busy state and resolves idle waits without emitting that settlement before entering the prompt. The initial projection-injection attempt did not reproduce a preparation rejection; it was replaced by a phase-checked settings failure. The corrected case and all other cases pass against the final Nix artifact.
