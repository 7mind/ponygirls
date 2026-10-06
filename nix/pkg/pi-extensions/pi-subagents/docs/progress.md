# pi-subagents implementation progress

Started: 2026-10-05. Target: pi 1.0.0 (`@earendil-works/*` namespace),
Node 24.20.0, Linux bubblewrap 0.12.0 backend.

Plan: `/home/pavel/work/safe/flakes/subagents-plan.md` (`*.bak` preserved,
never edited). Pinned sources: `/srv/nvme/tmp/pi-subagents-research-20261005/`.

## Milestones

- [x] M1 SDK integration proof (event trace, sequential tools, deterministic driver)
- [x] M2 domain + protocol
- [x] M3 durable root store (file + in-memory contract pair)
- [x] M4 policy + tool brokering
- [x] M5 sandbox + workspace adapters (real + dummy contract pair)
- [x] M6 async flat delegation (worker lifecycle)
- [x] M7 messages / waits / interruption / close
- [x] M8 observation + TUI inspector
- [x] M9 reload + crash reconciliation
- [x] M10 bounded nesting
- [x] M11 gate controller
- [x] M12 release checks + docs

## Verification log of the initial commit (local + nix, 2026-10-05)

Superseded by the review below: several "verified" items did not hold.


- `nix build .#checks.x86_64-linux.pi-subagents` (tsc + suite in the
  nix sandbox): **97 pass, 0 fail** on forced rebuild. Local
  `node --test tests/*.test.ts` agrees (3 SDK tests NOT-EXECUTED
  without `PI_SUBAGENTS_SDK_ROOT`; all execute with the pi 1.0.0
  monorepo root).
- M1: real worker fork performs handshake, native file-backed session
  (`sessionId` + `session.jsonl`), listener-before-prompt proxy execution
  over IPC, `agent_settled` finalization; mixed wait+bash batch sequential
  (`maxConcurrent 1`), tool-call/result pairing; settled-boundary
  checkpoint bytes contain the task text with the selected leaf;
  evict + reload restores the recorded leaf via `branch()` and the
  resumed transcript contains both runs.
- M5: real bwrap 0.12.0 + git — allowed reads pass; absolute/symlink
  escape denied; supervisor-named hides (`hidePaths`) cover siblings
  regardless of TMPDIR; `/home` hidden; no netns routes; cancellation;
  worktree isolation; dirty-prune refusal; metadata-only fingerprints.
- Extension load in real pi 1.0.0 (`--mode rpc`, isolated agent dir): all
  8 tools registered with correct schemas. `turn_end` boundary drain is
  skipped for `--no-session` (pi-core diagnostic, saved sessions only).
- Failing reproductions captured before fixes (all confirmed for the
  expected reason, then verified): question preemption gap, phantom-run
  pumpQueue dispatch, reload model-allowlist overreach, resident-capacity
  parking, close/autodispatch race, parked-startup liveness, tool-answer
  direction validation, double-wrapped event detail, handler arg order,
  inactive custom tools (empty allowlist), stub bypassed by session
  stream path (moved to registered provider), provider baseUrl
  validation, typebox schema requirement, asker's awaiting flag on the
  wrong record, task text lost on the reload path, broker PATH on NixOS,
  dedup view/record confusion, missing checkpoint-leaf selection.
- Self-review findings fixed: question deadlines now enforced by sweep;
  approvals validate agent/tool/args/generation/consumption;
  wait targets validated; UI message/task/answer/gate-retry are real
  supervisor calls with human origin; receipts bind to branch-checked
  entries via `find_entry`; gate evidence retained per round;
  stagnation warnings recorded; file-backed sessions with fsync'd
  settled-boundary checkpoints; journal replay restores a new supervisor
  process (tree, authority, mailbox text, queues, outcomes, usage, gate
  rounds/candidates/decisions, pending-lost runs); pid+boot-identity
  ownership verification with quarantine; close-actor cancels sibling
  gate (tested); reviewer eviction under resident pressure.

## Adversarial review and corrections (2026-10-05)

Independent read-only reviews (sandbox/policy, durability/recovery,
controller/gate) plus a governing review found the defects below in the
initial commit. Each was reproduced first (failing test, script, or live
journal) and is now covered by a regression test unless noted.

Security:
- Host shell injection: `fingerprintWorktree` passed writer-chosen file
  names to `sh -c` (`$(...)` executed on the host). Now no shell.
- Host git followed the worktree's writable `.git` file, so a writer could
  plant `core.fsmonitor` and run code on the host. Host git now targets the
  git dir recorded at creation, with hooks/fsmonitor/ext-diff disabled.
- `git worktree add` ran repository hooks.
- The bwrap view was `--ro-bind / /` with a denylist (nix daemon socket,
  `/sys`, unlisted trees visible); now an allowlist on an empty root.
  Hidden paths inside read roots were re-exposed; `auth.json` was not
  hidden; no `--new-session`.
- Owner delegation grants were never checked.

Function:
- File tools never worked: generated scripts did `JSON.parse("src/a.ts")`.
  Proxy tools had no schemas and the wrong argument names (a pi-shaped
  `edit` would have been a silent no-op). Now pi's shapes, validated, with
  arguments on stdin.
- Every spawn failed in production: placeholder default model
  `default/default` and no SDK root. Children now inherit the governing
  model; the wrapper sets `PI_SUBAGENTS_SDK_ROOT`.
- Children had no control tools: nesting and child→parent questions were
  unreachable; questions to the governing session were rejected. Child
  waits now release their runnable lease.

Lifecycle and correctness:
- Aborted or errored generations were reported as `succeeded` (an
  interrupt became success). Prompt rejection after acknowledgement, a
  rejected delivery, or a worker crash left runs `running` forever; a late
  tool reply after worker death crashed the governing process
  (`ERR_IPC_CHANNEL_CLOSED`).
- Terminal outcomes were idempotent per agent instead of per task run:
  resumed tasks, recovered replacements, retry/bypass runs never published
  their outcome; gate detail overwrote the deliverable text.
- `wait_agent` scanned only 50 journal records past the cursor and ignored
  already-settled runs; question preemption dropped waiters; untargeted
  `all_settled` returned on the first terminal; waits ignored Escape.
- `maxRunnable` was bypassed by queued and resumed tasks; parked agents
  took a second resident lease and lost their initial task; interrupting a
  parked agent did nothing; settled workers held resident capacity forever.
- Gate: reviewer admission failures were unhandled rejections; a gated
  spawn without `maxRounds` was rejected and failed gated spawns leaked
  identities and leases; interrupting a gated main published `gate_error`
  while it ran; parked reviewers launched for cancelled tasks; closing the
  main left its reviewer open; `set_limits` was not journaled and could be
  decreased mid-repair; reviewers were not re-linked after restart; the
  stagnation summary ignored file content.
- Store: the journal adopted synced-but-unacknowledged records and merged
  torn tails into the next acknowledged record; committed damage, a short
  or missing journal, and an unreadable manifest were accepted; checkpoints
  sorted lexically (generation 10 restored generation 9 and deleted the live
  copy); a crashed owner's lock could never be reacquired; the process
  "start time" was actually vsize.
- Replay/recovery: stale task phases blocked terminal outcomes; question
  records overwrote their messages; receipted notes absent from a restored
  branch were not reinserted; lost-run usage was zero instead of unknown;
  the extension never called `recover()` and silently fell back to an
  in-memory store on corruption; the root notice drain resent the five
  oldest notices every turn; cancelled tool jobs recorded two outcomes.

A second pair of read-only reviews of the corrected tree found further
defects, all reproduced and fixed with regression tests
(`tests/lifecycle.test.ts`, `tests/transport.test.ts`, and additions):
- Queued tasks stranded when the agent had no worker (crash, eviction for a
  reviewer, failed reload for capacity); queued tasks of a closed agent
  never settled.
- An owner joining its descendants accepted a new task and lost its
  deferred outcome; an owner joining at a crash never settled.
- An interrupt or close queued behind a parked startup's launch was lost.
- Interrupting during review produced `gate_error`; interrupting the
  reviewer did not leave a resumable review.
- Restart gaps: parked startups, linked retry runs mid-review, and reserved
  repairs were not restored or resumed.
- Checkpoints of sessions over ~192 KiB exceeded the IPC payload cap and
  silently fell back to an older checkpoint (bytes no longer cross IPC);
  oversized tool requests were dropped and stalled the worker for 15
  minutes; a FIFO planted in a worktree blocked the governing process.
- Glob translation (`**/`, braces, brackets, unescaped `.`), unbounded
  `read` output, truncation without a marker, notices redelivered after a
  restart, a root-lock retirement race, and the missing `/etc/alternatives`.

## Live verification (2026-10-05, Linux x86_64, bubblewrap 0.12.0)

`pi --no-extensions -e index.ts` against a scratch Git repository:
- `zai/glm-5.3`: reader delegation (spawn → brokered `read` → join → result
  with usage/cost).
- `kimi-coding/k3`: writer fixed a bug in its own worktree via `bash`
  (`node test.js` in the sandbox) and a pi-shaped `edit`; main checkout
  untouched.
- Gated writer (`kimi-coding/k3` main, `zai/glm-5.3` reviewer): candidate
  recorded, reviewer approved, outcome `passed`.
- Nested: a child spawned a grandchild through its tools, joined it, asked
  the governing session a question (root wait ended `needs_response` with
  the text), received the `reply_to` answer, and finished.
- Interrupt: an in-flight `bash sleep 120` was killed; the run settled
  `interrupted` within a second; no process survived.
- Gated reader (`zai/glm-5.3` main and reviewer): revise on candidate 1 →
  repair generation → approve on candidate 2 → `passed`; reviewer usage
  accounted for both rounds. (An earlier run exposed a review prompt that
  named evidence references in a form the validator rejected, and a
  reviewer that kept running after its invalid decision; both fixed.)

## Isolation modes, child instructions, approvals removed (2026-10-06)

- `spawn_agent` takes `isolation`: `worktree` (default; host tool jobs, a
  writer gets its own worktree at the same project-relative directory, no
  policy file), `none` (host jobs in the owner's working directory, writers
  edit it in place), `sandbox` (the bubblewrap view of a registered
  repository, as before). A child is never less isolated than its owner
  (enforced in grant intersection); an omitted isolation takes the owner's
  where that is stricter. Spawn results and agent status report `workdir`.
  Host jobs run as their own process group, killed when the job ends, times
  out, or is cancelled. (`none` was the default first; a live governor that
  forgot the argument wrote the live checkout, so the default moved.)
- `skills` / `all_skills` and `context_files` / `all_context_files` select
  what a child's session lists from its owner's set (the governing
  session's set is what pi loaded for the current run, observed on
  `before_agent_start`). The selection is persisted with the agent and
  reused on reload; sandboxed children can read the selected skills'
  directories.
- The unused approval scaffolding (approval records/tokens, the
  `approval.recorded` journal kind, `awaiting_approval`, UI counters) is
  deleted; no policy setting ever created an approval.
- Defects found while building it: the worker never reloaded its resource
  loader, so loader overrides would never have applied (a child-session
  assertion failed until the worker served the snapshot through its own
  loader, which also keeps workdir discovery off); and `glm-5.3` sent the
  first `"all" | string[]` selection arguments as JSON strings (three
  rejected spawns), so the arguments became plain arrays plus booleans.
- Live (`zai/glm-5.3`, `kimi-coding/k3`): a reader given all context files
  and one skill reported the repository's `AGENTS.md` codeword and the
  skill's phrase, one given neither reported both unknown; a default writer
  fixed the live checkout (host `$HOME`); a `worktree` writer's file stayed
  in its worktree; a `sandbox` writer edited its worktree with a private
  `HOME`. The governor once omitted `isolation`, and that child wrote the
  live checkout, as the default specifies.
- Gate checks were implemented but undeclared in the `spawn_agent` and
  `manage_gate` schemas, so the governing model never learned of them; a
  check's `timeoutMs` was ignored (always 120 s); checks or promised outputs
  on a reader were accepted and failed only at review time. All three were
  reproduced by failing tests and fixed (shared gate schema, per-check
  timeout up to 600 s, writer requirement and command/timeout validation at
  spawn and retry).

## Not executed

- Interactive TUI flows (`/agents` inspector key handling, editor dialogs).
- Abrupt host reboot with kernel-buffer loss (guest/storage harness).
- Token/cost budget stops (not implemented).
