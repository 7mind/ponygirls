# ponygirls-bg-tasks

Background shell tasks for Pi 1.0.0 (Linux): one agent tool, `bg_task`, one
command, `/bg`, and completion notices that wake an idle session. Implements
`bg-tasks-plan.md` (repository root); deviations are listed at the end.

A small Python supervisor (stdlib only) owns each session's tasks: one PTY and
one POSIX process group per task, the durable registry, and the outbox state.
The TypeScript extension owns Pi integration, the tool, the viewer, and
notice delivery. They talk over private newline-delimited JSON pipes.

## Scope

- **A task** is one explicitly launched shell command
  (`bash --noprofile --norc -c <command>`, packaged bash) and the process group
  it was started in. Supported commands keep their children in that group.
- **Platform:** Linux only. The supervisor fails with `PLATFORM_UNSUPPORTED`
  if `PR_SET_CHILD_SUBREAPER`, `waitid(WNOWAIT)`, `pidfd_open`,
  `pidfd_send_signal`, or `/proc/<pid>/task/<pid>/children` is unavailable.
- **Ownership:** the native Pi session ID. Tasks are shared across branches of
  a session; a fork or a new/other session never sees them or their notices.
- **Viewer:** "view terminals" means a **read-only** line view of the PTY
  transcript and its scrollback. It is not a terminal emulator: no input, no
  resize, and full-screen/alternate-screen programs (vim, top) are not
  rendered faithfully. Control sequences are stripped, carriage-return progress
  lines are collapsed; raw bytes stay in the log.
- **Lifetime:** tasks do not outlive their Pi activation. Quit, `/reload`,
  `/new`, `/resume`, and `/fork` stop the activation's tasks (TERM, then KILL),
  keep their records and logs, and start a fresh supervisor for the next
  session. One-shot print runs stop their tasks on exit (JSON mode shares the
  print-mode disposal path but was not tested).
- **State** lives beside the native session file:
  `<session>.jsonl.bg-tasks/{owner.lock,tasks.json,tasks/<id>/terminal.log,clearing/}`
  (directories 0700, files 0600). `--no-session` is refused with
  `NO_PERSISTENT_SESSION`. Inside yolo, the session directory must be a
  persistent writable bind.

## Agent surface

`bg_task` takes flat arguments: a required `action` plus that action's fields
(all top-level primitives; each action's exact field set is checked at
execution):

| action | arguments | result |
|---|---|---|
| `spawn` | `label`, `command`, absolute `cwd`, `notify` (required boolean) | task ID, state, log path, notice policy; returns after launch |
| `list` | `cursor` (`null` = newest page), `limit` ≤ 50 | compact summaries newest first, `nextCursor` |
| `read` | `id`, `offset` (bytes or `"tail"`), `limit` ≤ 32768 | sanitized text, accurate `nextOffset`, size, EOF |
| `signal` | `id`, one of SIGINT SIGTERM SIGKILL SIGHUP SIGUSR1 SIGUSR2 SIGSTOP SIGCONT | delivery to the owned group; state stays observed |
| `terminate` | `id` | TERM → 5 s → KILL → 2 s; the observed outcome, or `TERMINATION_UNCONFIRMED` |
| `notify` | `id`, `enabled` | the persisted policy |
| `clear` | `id` | deletes a finished task's record and log |

Domain errors fail the tool call (`NOT_FOUND`, `TASK_UNFINISHED`,
`TASK_CLOSING`, `TASK_FINALIZED`, `LAUNCH_FAILED`, `CURSOR_INVALID`, ...).
Every response is bounded to 32 KiB including `details`; pages shrink and
reads report fewer consumed bytes instead of truncating silently.

`/bg` (TUI only; RPC gets a plain first page) lists ID, label, state/phase,
elapsed time, exit evidence, reason, notice state, and log size. Enter opens
live output (follow mode); ↑/PgUp pauses and scrolls back, `f`/End resumes.
`t` terminate, `s` signal (selector), `m` mute/unmute, `c` clear (finished
tasks only, with a confirmation naming the ID and bytes). Closing the viewer
never affects a task. The detail view holds at most 128 KiB of a log.

While any task is unfinished the editor's bottom-left border shows `bg N
running` as a blue badge (next to the session goal and subagents badges
when they are present); it clears when no running task remains. Clicking
the badge opens the `/bg` inspector.

## Outcomes

| state | meaning |
|---|---|
| `running` + phase `starting`/`running`/`closing`/`stopping` | owned and unfinished |
| `completed` | root exit 0, process group settled, output finalized and fsynced |
| `failed` | `exit_nonzero`, `signaled`, `terminated`, `launch_failed`, `descendants_remaining`, `output_failed`, `output_drain_timeout`, or `session_shutdown` |
| `dead` | `owner_lost` (Pi vanished), `supervisor_lost` (found stale on recovery), or `cleanup_unconfirmed` |

`dead` is **not** proof that a process died and never an invented exit code;
exit evidence is kept only when it was observed. Records and logs persist
until an explicit `clear`; reading, notices, restarts, and history size never
remove them.

### Guarantees (verified by the test suites below)

- Root exit and PTY EOF alone never complete a task: after root exit the
  supervisor seals numeric-PGID signals, reaps the leader, and requires
  `waitpid(-pgid)` to report `ECHILD`. Surviving group members get a 1 s grace,
  then TERM/KILL through validated pidfds of direct/adopted children
  (subreaper), and the task fails with `descendants_remaining`.
- No numeric group signal after sealing; no pidfd for a non-child; recovery
  never signals saved PIDs/PGIDs (traced in the real-process tests).
- If Pi is killed (or its whole process group), the supervisor — in its own
  session — sees pipe EOF, cleans up, records `dead/owner_lost`, and releases
  the lock. A killed supervisor's unfinished records become
  `dead/supervisor_lost` on the next start.
- Durable mutations: temp file → fsync → rename → fsync directory; directory
  entries for the sidecar, task directory, and log are synced before the
  admission commit; clear commits an intent, renames into `clearing/`, syncs
  both parents, deletes and syncs, then drops the record. Recovery finishes an
  interrupted committed clear. Corrupt or unsupported metadata is an error,
  never an empty registry. Storage failure disables launches.
- Notices: the terminal state and its pending event are one registry commit.
  An enabled event is handed to Pi as a `bg-task-completion` custom message
  with `deliverAs: "followUp", triggerTurn: true` (idle → a new turn; active →
  queued behind the current work, preserving tool-call/result order). It is
  marked received only when a matching complete entry is in the session file.
  One batch (≤ 10 events) is in flight at a time.
- Delivery is **at least once** across crash windows, deduplicated by event ID
  where a receipt is observable; not transactional exactly-once.
- `notify: false` sends no notice and requests no inference; re-enabling an
  undelivered event makes it eligible again.

### Delivery policy details

- Missing after a successfully settled run: one retry at quiescence.
- Aborted run: those events are deferred quietly (no re-wake); independent
  later completions still notify. The next explicit input releases them when
  that input's run settles, after a receipt check (a kept queue item that Pi
  consumed in the meantime is reconciled, not resent).
- Error outcome, no classifiable outcome, a retry that still finds no entry, or
  no run starting within 3 s: `DELIVERY_UNCONFIRMED` is shown, the event stays
  pending, and it is retried only after the next explicit input or on resume.
- No idle submission between an accepted explicit input and its run start, or
  during compaction.
- Session transitions dispose the sender before teardown; a resumed session
  replays its own pending events and re-checks receipts against the file
  (a lost session-file suffix restores the notice).
- Muting or clearing stops further submissions but cannot recall an item Pi
  already accepted; clearing does not erase an already posted notice.

## Limitations

- Linux only; macOS needs an equivalent ownership backend and tests.
- Containment covers the original process group. A descendant that calls
  `setsid`/`setpgid`, or whose parent leaves the group while it stays, escapes
  settlement and cleanup. Guaranteed containment would need cgroups.
- If the supervisor itself is SIGKILLed, HUP-immune tasks become orphans that
  nothing signals (closing the PTY master hangs up ordinary ones).
- The registry snapshot is rewritten on each mutation: metadata cost grows with
  retained history; output memory is bounded, disk usage grows until clear.
- A notice can be duplicated after crash windows, or if a task is muted while
  its notice is queued and later re-enabled before Pi consumes it.
- Sending a notice that starts a turn can race a user prompt submitted at the
  same instant (Pi API level; the extension avoids the input→run window it can
  observe).
- Physical power-loss durability was not tested (synthetic stale registries and
  fault injection only).
- Teardown race (unreproduced): Pi aborts the active run before
  `session_shutdown`; if another extension's shutdown handler yields before
  this one runs, a drain released by that abort could still submit a notice to
  the closing runtime. The scenario is covered by a test that has not failed.
- A launch whose child is SIGKILLed after the 3 s start timeout is reaped with
  a blocking wait; a child stuck in uninterruptible sleep before `exec` would
  stall the supervisor loop until it leaves that state.
- A launch failure leaves runner-level evidence in the task log
  (`bg-tasks: launch failed: <detail>; the command never started`) and in the
  reason detail, so `list`/`read` distinguish a spawn failure from a fast
  command death (exit evidence plus an empty log) without guessing.
- Snapshots of unfinished tasks carry liveness evidence (`observedAt`,
  `leaderAlive`): polling `list`/`read` on a silent-but-running task shows the
  observation time advancing with the root alive ("no new output yet"); a
  task whose root already exited but whose group still drains reports the root
  exited with phase `closing`/`stopping`.
- An unexpected supervisor exception fails the request with
  `SUPERVISOR_FAULT` and starts a graceful teardown of the session's tasks.
  Any failure to create a task's log (including descriptor exhaustion) marks
  storage failed and disables launches for that supervisor's lifetime.

## Packaging

- `nix/hm/pi.nix` loads this directory as a local extension; the pi wrapper
  sets `PI_BG_TASKS_PYTHON` and `PI_BG_TASKS_SHELL` from `wrapper-args.nix`
  (pinned nixpkgs `python3` and `bash`). Missing variables fail tool calls
  with `CONFIG_MISSING`; nothing is guessed.
- `checks.<system>.ponygirls-bg-tasks` runs `tsc`, the Python suites, and all
  Node suites, including the packaged-binary tests against the wrapped pi.

## Tests

```sh
# From this directory, with the pinned SDK linked into node_modules (see flake check):
export PI_BG_TASKS_SDK_ROOT=<pi>/lib/node_modules/pi-monorepo PI_BG_TASKS_PYTHON=<python3> PI_BG_TASKS_SHELL=<bash>
export PI_BG_TASKS_PI=<wrapped pi> PI_BG_TASKS_EXTENSION=<extension dir> PI_OFFLINE=1 PI_TELEMETRY=0
python3 -m unittest discover -s tests -p '*_test.py'
node --test tests/*.test.ts tests/*.test.mjs
# From ponygirls/:
nix build ".#checks.$(nix eval --impure --raw --expr builtins.currentSystem).ponygirls-bg-tasks"
```

| suite | kind |
|---|---|
| `transitions_test.py` | outcome decisions, terminal/recovery transitions, record validation |
| `store_test.py` | registry contract on a memory store and the real filesystem; commit/fsync ordering; fault injection after every durability operation; lock exclusivity |
| `supervisor_test.py` | real PTYs and process groups: TTY, exits, UTF-8 splits, signals, TERM→KILL, redirected/PTY-holding/multi-generation descendants, fork races (signal-authority tracing), Pi kill, group kill, supervisor kill, cold recovery, unconfirmed cleanup |
| `backend.test.ts` | the task-service contract on the memory dummy and the real supervisor client |
| `tool.test.ts` | the public tool on both backends: pagination under inserts/clears, budgets, sanitization, errors |
| `pi-runtime-probe.test.mjs` | pinned Pi delivery semantics (scripted provider, `pi.sendMessage()` path) |
| `delivery.test.mjs` | the real extension in a scripted Pi runtime: idle/active/burst/opt-out, aborts, dropped follow-up, no-start, mute, crash windows, switch/fork, reload, compaction, provider retry |
| `delivery-unit.test.ts` | deterministic dispatcher guard transitions |
| `status.test.ts` | border badge text: running counts, singular/plural, clear when idle |
| `extension-status.test.ts` | the real extension with a faked host: the badge follows spawn/terminate/clear |
| `ui.test.ts` | the inspector on a real supervisor: live follow/scroll, escape fixtures, bounded windows, dead/missing labels, actions |
| `packaged.test.mjs` | wrapped pi binary + packaged extension in RPC, print, and TUI (PTY) sessions with a local fake provider |

## Deviations from the plan (with evidence)

- **Tool schema:** flat top-level primitives (`action` required, other fields
  optional) with the plan's discriminated union enforced at execution. A
  top-level union reaches Anthropic models as an empty object (Pi's adapter
  forwards only top-level `properties`/`required`,
  `pi-ai/dist/api/anthropic-messages.js` `convertTools`), and a nested
  `request` object was sent as a JSON string by `mimo-v2.6-pro` in live use,
  failing every call with `request: must be object`.
- **Explicit-input release timing:** deferred/unconfirmed events are released
  when the input's run settles, not when the input arrives. The probes show an
  SDK/RPC abort keeps the custom follow-up queued and Pi consumes it after the
  next prompt; resubmitting at input time would duplicate it. Pi also runs
  `input` handlers before several awaits that precede the user's run, so an
  idle submission there could start a competing run.
- **Abort detection:** via the run's `ctx.signal`, because `agent_before_settle`
  is skipped on abort (probe) and an abort during a tool leaves no `aborted`
  assistant message.
- **Added named constants:** `DESCENDANT_GRACE_MS = 1000` (a session leader's
  exit hangs up its terminal; ordinary background children die of SIGHUP
  within it and do not count as surviving descendants), `CLOSING_POLL_MS`,
  `FINAL_FLUSH_MS`, `MAX_NOTICE_BATCH`, `VIEW_WINDOW_BYTES`, label/command size
  limits.
- **Pages run newest first** (sequence order, descending) under the captured
  watermark; the cursor invariants of the plan hold.
- **Launch failures** are reported by the failed tool result and recorded with
  notice status `inline`; they are not notified again.
- **Supervisor loss during an activation:** the next operation starts a fresh
  supervisor, which recovers the lost records as `dead/supervisor_lost`.
- **Naming:** `ponygirls-bg-tasks` (repository convention) instead of the
  plan's tentative `pi-bg-tasks`; runtime names (`bg_task`, `/bg`,
  `bg-task-completion`) are as planned.
