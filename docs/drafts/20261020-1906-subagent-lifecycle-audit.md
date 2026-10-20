# Subagent lifecycle propagation audit

Scope: `nix/pkg/pi-extensions/ponygirls-subagents`, repository baseline `e657f26a131eea4dc275dbd8d899d13522f2dd0c`, pinned Pi **1.2.0**, Node **24.20.0**. Changes are local; nothing was deployed or filed upstream.

> Historical audit snapshot, before the user's automatic-resumption clarification.
> Current remediation, regression evidence and verification are recorded in
> [the follow-up](20261020-1944-lifecycle-remediation.md). The observations below
> preserve the original baseline; `triggerTurn:false` is no longer current policy.
> The final follow-up Nix build and strict typecheck passed; all 631 tests passed
> with no failures or skips against the packaged SDK and its pinned Node runtime.

## Original audit conclusion

**The audited baseline had no unconditional delivery or autonomous-resumption guarantee.**

1. A successful child normally produces a durable terminal record and a custom message without another user input. Real-worker checks verify this for file-backed and in-memory governing sessions.
2. **The governing model intentionally stays idle:** `index.ts:187` calls `pi.sendMessage(message, { triggerTurn: false })`. Existing tests explicitly require no extra inference. Appending a notice is not scheduling its consumption by a model. If autonomous resumption was the intended requirement, the existing policy does not meet it—even with fault-free delivery.
3. Multiple reachable producer, scheduling, wait, and recovery defects were reproduced and corrected below.
4. Separate failures in pinned Pi's custom-message ingestion/flush/reload paths remain reproducible. These prevent claiming universal delivery, even after the local corrections.

The ordinary end-of-turn microtask path did **not** reproduce a lost notice: all named boundaries, retry backoff, manual/automatic compaction, queue clearing and abort passed. Failure injection does reproduce lost notices and a busy-state hang.

## What counts as propagation

These are distinct postconditions:

| Stage | Evidence required |
|---|---|
| Worker finished | Native finalized assistant response / worker idle acknowledgment |
| Supervisor accepted completion | Valid IPC event, current epoch/worker/task/generation ownership |
| Completion is durable | Committed `generation.settled` and, when appropriate, `task.terminal` |
| Join can finish | Exact captured task-run ID in the durable-terminal projection |
| Notice was submitted | Attachment-local delivery cursor advanced after the void API returned |
| Governing context/display received it | Native custom-message entry and public message events |
| Model acted on it | A subsequent model request containing that context |

The last three are **not equivalent**. In particular, the extension has a submission cursor, not a durable session-delivery receipt.

## End-to-end trace

Paths below are relative to `nix/pkg/pi-extensions/ponygirls-subagents/`.

1. `src/worker.ts::onSessionEvent` observes native SDK events. Normal settlement is driven by `agent_settled`, not merely `agent_end`; pending usage observations are joined by `settleGeneration`.
2. `settleGeneration` chooses succeeded/failed/interrupted, bounds diagnostic presentation, retains larger text through a synchronized file, and emits one generation-bound `settled` event.
3. `src/worker-launch.ts::onInbound` validates the protocol envelope and forwards the fenced identities. Invalid non-request frames are dropped; process exit is a separate fallback.
4. `src/supervisor.ts` checks current worker/task/generation ownership, records usage and generation settlement, joins active descendants, then either admits a gated candidate or calls `settleTaskTerminal`.
5. `settleTaskTerminal` now persists before exposing the terminal in memory. Waiters are evaluated after the committed projection is updated. A failed commit retains a recovery obligation and blocks follow-up dispatch on that agent.
6. Publication invokes the session-scoped `onChange` callback. `index.ts` updates the independent badge and calls `NoticeDelivery.changed()`.
7. `src/notice-delivery.ts` coalesces changes into a microtask, drains every page, sanitizes text, submits context-only messages, and advances its attachment cursor. Changes arriving during submission are drained by the same pump.
8. Pinned Pi `AgentSession.sendCustomMessage` appends immediately while idle; while busy it queues custom messages until a safe boundary after tool results. None of this requests another model turn with `triggerTurn:false`.

## Lifecycle case matrix

“Notice” means eligibility for the custom-message pump, not automatic inference. Existing suites execute ordinary and exceptional paths; additional regressions are in `tests/lifecycle-propagation.test.ts`, `tests/worker-terminal-ipc.test.ts`, and `tests/notice-delivery-sdk.test.ts`.

| Case | Producer / observation path | Governing-session behavior |
|---|---|---|
| Spawn rejected before acceptance | Admission/policy validation | Synchronous tool error; no accepted task requiring a terminal |
| Accepted/parked startup | `agent.spawned`, `task.queued` | Activity/inspection; no completion notice until terminal |
| Worker starts | `generation.started`, `started` | Journal/runtime status; no completion notice |
| Preview/tool start/tool end | Worker events | Runtime/UI progress; not all are durable journal events |
| Ungated success | Generation settlement → task terminal | Notice plus captured join satisfaction |
| Provider/adapter/prompt failure | Failed generation → task terminal | Failed notice; oversized diagnostic case now tested through real IPC |
| Startup or task-delivery rejection | `startupFailed` / `deliverRun` | Failed terminal rather than an indefinitely running accepted task |
| Abrupt worker exit | Exit handler → cancellation/fencing → finalization | Failed/uncertain terminal; incomplete usage remains unknown |
| Old/duplicate worker event | Epoch/instance/task/generation checks | Ignored; must not create another terminal or affect newer work |
| Follow-up queued on same agent | Mailbox/task queue → capacity pump | Waits for the prior completion barrier and durable terminal; each run keeps its ID |
| Parent settles with active ordinary children | Interrupt/join descendants → deferred continuation | Child terminals precede owner terminal/candidate admission |
| Child note/question to governor | `mailbox.accepted` | Notice without autonomous inference; exact-run activity attribution now includes sender's run |
| Nested child note/question to owner | Native mailbox delivery + journal inbox | Delivered to owner; not a governor-addressed message notice |
| Question during an existing settlement wait | Explicit question preemption | `needs_response`, never fabricated settlement |
| Question before settlement-wait registration | Open-question check at registration/evaluation | Now also `needs_response`, independently of cursor |
| Already answered/expired question | Answer/cancellation state | Does not preempt a new join; expiry is lazily swept, not timer-driven |
| Question to another addressee | Recipient routing | Does not preempt the unrelated caller's settlement wait |
| Question/note during exact-run activity wait | Sender run captured in mailbox record | Now wakes the matching activity wait; recipient and sender IDs are not conflated |
| Wait for historical/queued/already-terminal run | Captured ID + known ownership | Immediate terminal join when appropriate, independent of cursor; reused reviewers retain historical gate membership |
| Unknown/empty/wrong-agent explicit run ID | Boundary validation | Now rejected instead of hanging or claiming a vacuous successful join |
| New input / wait-tool abort | Caller wait cancellation | Wait returns promptly; children continue |
| Interrupt accepted | Command + interruption record | Acceptance is not proof of termination; terminal follows actual settlement |
| Interrupt parked startup/repair | No executing generation to stop | Explicit interrupted terminal |
| Worker ignores interrupt | Worker still active | No invented completion; explicit close has bounded join/fencing/forced retirement |
| Close active/queued subtree | Interrupt, join, retire | One terminal per unfinished accepted task; dirty worktrees/sessions retained |
| Close idle agent | `agent.closed` | Explicit close result; no new task completion is implied |
| Candidate succeeds under gate | Generation settlement → candidate/round/evidence | Not a task success; joins await panel/gate result |
| Required checks / individual panel feedback | Evidence/decision/failure records plus phase/feedback publication | Activity/inspection; not individual completion notices |
| Panel unanimous approval | Workspace/recheck barrier → `passed` | Terminal notice and join satisfaction |
| Revise/repair | One repair command, same task, new generation | Progress; terminal only after final gate outcome |
| Round limit/blocked/error/drift | `review_limit_reached`, `gate_blocked`, `gate_error`, `candidate_superseded` | Normal terminal notice path |
| Advisory review | Wait for whole panel, preserve every report | Task `succeeded` even when advisory feedback objects/fails; reports must be read separately |
| Interrupt/close main during review | Gate termination + reviewer cancellation | Main task ends interrupted; does not infer approval |
| Interrupt reviewer alone | Review becomes interrupted/resumable | Activity/state, but **no completion notice**; main intentionally stays nonterminal |
| Resume a closed reviewer | Reviewer-start precondition | Now explicit reviewer failure/gate error; neither resurrection nor permanently parked review |
| Retry/bypass older terminal run | Linked task run | New ID; now rejected while a newer run on that actor remains unfinished |
| Evict/reload idle worker | Checkpoint/native branch restoration | No new inference solely for reload; mailbox reconciliation preserves pending notes |
| Recovery: active/lost main or repair | Reconcile effects/ownership → lost generation terminal | Interrupted/uncertain notice; quarantine when required |
| Recovery: ordinary accepted but undispatched task | Retain ID and queue | Held for explicit resume, not automatically inferred/executed |
| Recovery: ordinary deferred owner | Rebuild deferred terminal after descendants | Terminal notice; no stranded old join |
| Recovery: gated owner before candidate/review admission | No resumable committed review/repair for settled generation | Now interrupted explicitly; no candidate/review/approval is invented |
| Crash after candidate capture but before round admission | Replay actual first/repair candidate journal prefixes | Now interrupted instead of stranded |
| Crash during linked-run registration/round publication | Linked run may have no persisted candidate or not yet be current | Now retains and terminalizes the linked ID as interrupted; original terminal stays immutable |
| Recovery: running/partially reported panel | Preserve reports/counters, mark interrupted | Explicit `resume_review`; no automatic verdict inference |
| Recovery fails while persisting its own terminal | Retained lost-run identity / terminal obligation | Retriable without losing the run in the same supervisor instance |
| Quarantined writer reattached again | Replay `agent.quarantined` | Quarantine and prohibition now survive another attachment |
| Controller callback/finalization error | Durable `controller_error` record | Now wakes activity evaluation and has a context-notice projection |
| Late usage / external late effects | Dedicated usage/uncertainty accounting | Not a replacement task terminal; see residual visibility limits below |
| Shutdown/session replacement | Dispose notice attachment before stopping subtree | Old scheduled notices deliberately fenced; unfinished work reconciles on attachment |
| Reattachment after prior delivery failure | Cursor starts at current durable journal end | Old history is deliberately not replayed; no exactly-once receipt guarantee |

Nested `gate`/`review` configuration is explicitly forbidden. A suggested nested-gated-child/sibling-reviewer hang was rejected after checking these preconditions; it is not a supported reachable finding. A **top-level gated main owning an ordinary child** is supported and was reproduced/tested.

## Reproduced defects corrected locally

Every correction had a failing reproduction before its production edit.

| Failure | Correction |
|---|---|
| A streaming provider diagnostic exceeded IPC's 256 KiB limit; worker was idle, receiver accepted only `started` | 8 KiB **JSON-encoded UTF-8** terminal diagnostic budget, including explicit truncation marker; full native diagnostic, outcome, retained result/file and usage preserved |
| Queued next task dispatched synchronously during runnable release before descendant join was installed | Install completion barrier before releasing capacity |
| Already-open question missed by new settlement wait | Evaluate still-open, addressed questions independently of event cursor |
| Exact-run activity wait ignored incoming child note/question | Persist sender task attribution and use it in target filtering |
| Wrong/unknown/empty explicit IDs hung or fabricated empty successful joins | Validate known task ownership, including historical reviewer membership |
| Fresh attachment stranded a gated main before candidate capture or between candidate and round admission | Require a resumable review/committed repair before preserving a nonterminal gate; otherwise recover explicit interrupted outcome |
| Linked review crashed between registration, actor switch, round admission and candidate publication | Retain an interrupted terminal obligation for registered linked IDs lacking a candidate, including noncurrent IDs |
| Retry/bypass of older terminal orphaned newer interrupted linked review | Quiescence requires current task terminality, not merely absence of active workers |
| Resuming permanently closed reviewer parked forever or relaunched it | Fail at reviewer-start boundary; existing panel failure mechanism propagates the error |
| Writer quarantine disappeared on second attachment | Replay quarantine records |
| Failed terminal append satisfied joins without durable terminal | Commit before terminal-map/result updates; retain failed terminal obligation keyed by task run |
| Follow-up dispatch could hide older failed terminal obligation on reattach | Pending lifecycle obligations lock that agent's queue until recovery |
| Generation append failure cleared the only active-run identity | Persist generation settlement before retiring the active run |
| Recovery/forced close lost identities when their own generation append failed | Retain recovery/terminal obligation before destructive in-memory transition |
| Observer callback threw after commit and aborted remaining finalization | Isolate callback failure, preserve committed progress and publish observable controller failure |

The fault-injection store rejects one append **before commitment** and then becomes available. This does not establish automatic recovery from a real permanently failed filesystem; `FileRunStore` can require reopening and operator repair.

## Original pinned SDK failures (before the follow-up patch)

Probe: `nix/pkg/pi-extensions/ponygirls-subagents/tests/notice-delivery-fault-probe.mjs` (separate diagnostic command, not a passing-delivery contract test). It uses temporary configuration and a scripted provider, never real credentials/network services.

Observed output:

```json
{"probe":"idle-append-failure","notices":0,"sinkErrors":0,"sdkErrors":["send_message"],"requests":1,"isIdle":true}
{"probe":"turn-end-flush-failure","notices":0,"sinkErrors":0,"sdkErrors":[],"runError":null,"isIdle":true}
{"probe":"final-flush-failure","notices":0,"runError":"Error: audit one-shot custom append rejection","isIdle":false,"sessionStreaming":true,"agentStreaming":false}
{"probe":"reload-session-start","onErrorBound":false,"lifecycle":["start:1","shutdown:1"]}
{"probe":"reload-session-start","onErrorBound":true,"lifecycle":["start:1","shutdown:1","start:2"]}
```

Source references below are in pinned Pi `dist/core/agent-session.js`:

- **Void submission is not acknowledgment:** binding at `2735–2743` catches asynchronous `sendCustomMessage` failure out-of-band. The extension pump has already advanced its cursor. Retrying `changed()` does not restore the failed notice.
- **Destructive batch drain:** `_flushPendingCustomMessages`, `1863–1871`, clears the entire pending array before appending. Rejecting its first append loses all three queued pages in the 47-notice probe.
- **Busy-state hang:** `_startRun` final cleanup, `1432–1439`, flushes before `_emitAgentSettled`. A flush exception skips settlement; the SDK session says busy while the low-level agent is stopped. Later notices queue without a consumer. Another input is not a reliable recovery mechanism.
- **Minimal SDK reload misses initialization:** initial `bindExtensions` starts listeners, but reload's binding-presence test at `2992–3001` does not count empty/mode-only binding. It shuts down the old extension without sending the new one `session_start`. Binding `onError` avoids this specific path. Normal TUI/RPC hosts generally bind more callbacks; this probe is an SDK embedding case, not evidence of ordinary CLI reload failure.

These are API/SDK boundary defects, not corrected by changing the notice wake policy. No guessed retry loop or private-session-field workaround was added.

## Policy/coverage limits at the original audit checkpoint

- `triggerTurn:false` remains unchanged. Completion, question and controller-failure notices do **not** autonomously resume an idle governing model.
- Review interruption/recovery requires explicit intervention but is not a terminal notice. Inspect state or use activity waits; a main-targeted activity wait does not necessarily match a reviewer-only interruption record.
- The notice projection is deliberately narrower than the journal. It includes terminal outcomes, quarantine, controller failures and governor-addressed mail—not every progress/checkpoint/usage/recovery record.
- Accepted nested notes use native reconciliation receipts; governing notices do not. Reattachment skips old journal history, including a previously unacknowledged notice.
- Question expiry is lazily swept on relevant operations. It has no independent deadline timer.
- Late billing/uncertainty records do not rewrite old terminal outcomes. Source inspection found secondary post-terminal ORIGINAL failures can be stderr/accounting-only, and usage-free external late evidence need not invoke the governing notice callback. No new runtime reproduction was executed for those paths.
- Worker event transport has no application-level terminal receipt/retry. Epoch/stale-generation rejection is intentional, but malformed-event drop, isolated IPC errors without process exit, process death between send and commit, and permanent storage failure are not a general reliable-delivery protocol.
- Further SDK cases were source-traced, not fault-injected: partial real I/O writes, throwing public subscribers, startup/bash flush errors, raw session disposal during activity, and active quit. A plain SDK `dispose()` does not substitute for the documented extension shutdown lifecycle.
- Real worker/local-provider tests establish native transcript and public message-event behavior. No new PTY-rendering test or live paid-provider run was performed.

## Verification and artifacts

- Initial lifecycle/gate/recovery/notice/real-worker selection: **118 passed**, no skips.
- Focused controller lifecycle/gate/panel regressions after adding four committed-prefix crash cases: **52 passed**, no skips (`debug/20261020-2145-lifecycle-gate-final.log`); the new lifecycle file contains **28 cases**.
- Real SDK delivery-boundary suite: **13 passed**, no skips; includes the three new retry/manual/automatic-compaction cases.
- New real-worker diagnostic suite: **8 passed**, no skips; existing adapter/protocol/result/transport selection: **38 passed**, no skips (captured by implementation subagent and included in broader parent runs).
- Typecheck: pinned-flake TypeScript **7.0.2**, `tsc -p nix/pkg/pi-extensions/ponygirls-subagents/tsconfig.json` passed after changes.
- `git diff --check` passed.
- Final complete suite: **594 tests; 593 passed, 1 failed, 0 skipped/cancelled** (`debug/20261020-2155-full-suite.log`). All **39 newly added regression/boundary cases** passed. The sole failure is the independently reproduced baseline sandbox assertion below.
- A full-suite failure in `[bwrap] allowed reads succeed; traversal escape and secret access fail`, `tests/sandbox-workspace.test.ts:89`, was independently reproduced on an untouched **HEAD archive**. Its `/home` entry-count assertion expects `0`, observes `1`. The cause remains uninvestigated; changing `TMPDIR` did not resolve it. No sandbox implementation/test change was made for this unrelated baseline failure.

Commands (from repository root):

```bash
cd nix/pkg/pi-extensions/ponygirls-subagents
node --test tests/lifecycle-propagation.test.ts tests/notice-delivery-sdk.test.ts tests/worker-terminal-ipc.test.ts
PI_OFFLINE=1 PI_TELEMETRY=0 node --test tests/*.test.ts
# Historical diagnostic: run only against the original unpatched SDK.
# Its success confirms defective baseline observations, not corrected delivery.
node tests/notice-delivery-fault-probe.mjs
```

Fail-first captures are under ignored `debug/`: lifecycle ordering, gate recovery/linked runs, closed reviewer, quarantine reattach, exact-run messages, journal/observer failures, recovery/forced-close failures, invalid targets and the real-worker oversized error. The complete ordinary-baseline sandbox reproduction is `debug/20261020-2118-sandbox-baseline.log`.

## Review and reusable procedure

Read-only delegated audits covered supervisor/worker producers, gates/reviews, and downstream SDK delivery. Their source-derived claims were not treated as execution evidence; consequential reachable findings were reproduced locally before correction. Independent correction review found additional retry/forced-close and empty-ID cases, also reproduced before editing. Final static review found no material flaw in the committed-prefix replay corrections; it did not independently execute tests. An unreachable nested-gate hypothesis was explicitly withdrawn.

A reviewed, sanitized inert skill candidate, `serialized-diagnostic-budgets`, was saved to `corporate-activity:skill-draft-serialized-diagnostic-budgets`, revision **1**, and verified with `get`. It is not installed or activated. Installed-skill and Haystack-draft overlap search was best effort; this procedure generalizes one demonstrated diagnostic-budget defect, not observed recurrence.
