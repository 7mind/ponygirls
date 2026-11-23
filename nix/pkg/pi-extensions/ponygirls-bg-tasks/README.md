# ponygirls-bg-tasks

Background shell tasks for Pi 1.0.0 on Linux and macOS: one agent tool, `bg_task`, one
command, `/bg`, and completion notices that wake an idle session. Implements
`bg-tasks-plan.md` (repository root); deviations are listed at the end.

A small Python supervisor (stdlib only) owns each session's tasks: one PTY and
one POSIX process group per task, the durable registry, and the outbox state.
The TypeScript extension owns Pi integration, the tool, the viewer, and
notice delivery. They talk over a private newline-delimited JSON control socket;
the supervisor also supports pipes for its standalone contract tests.

## Scope

- **A task** is one explicitly launched shell command
  (`bash --noprofile --norc -c <command>`, packaged bash) and the process group
  it was started in. Supported commands keep their children in that group.
- **Platform:** The flake check targets `x86_64-linux` and `aarch64-darwin`
  (Apple Silicon). Both use `waitid(WNOWAIT)` and PTYs. Linux also requires
  subreaping, pidfds, and `/proc/<pid>/task/<pid>/children`; macOS requires the
  packaged Darwin group library. Missing process capabilities produce
  `PLATFORM_UNSUPPORTED`.
- **Ownership:** the native Pi session ID. Tasks are shared across branches of
  a session; a fork or a new/other session never sees them or their notices.
- **Viewer:** "view terminals" means a **read-only** line view of the PTY
  transcript and its scrollback. It is not a terminal emulator: no input, no
  resize, and full-screen/alternate-screen programs (vim, top) are not
  rendered faithfully. Control sequences are stripped, carriage-return progress
  lines are collapsed; raw bytes stay in the log.
- **Lifetime:** `/reload` replaces the extension client but preserves the
  supervisor, running tasks, output, and pending notices. Quit, `/new`,
  `/resume`, and `/fork` stop the session's tasks (TERM, then KILL) and retain
  their records and logs. One-shot print runs stop their tasks on exit (JSON
  mode shares the print-mode disposal path but was not tested).
  A reload must reconnect within 30 s; otherwise the supervisor cleans up as
  `dead/owner_lost` (including when the extension was removed or failed to load).
  A handoff with unsettled spawn/terminate requests is refused with
  `SESSION_BUSY`; failed handoffs close the old client and clean up rather than
  leaving tasks owned by an inaccessible client.
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
live output (follow mode). Scrolling pauses at the current log length, even
if the log is empty. ↑/↓ and PgUp/PgDn move within that snapshot; later
output stays hidden, including after the task finishes. `f` or End jumps to
the current tail and resumes following. The next scroll takes a new snapshot.
`t` terminate, `s` signal (selector), `m` mute/unmute, `c` clear (finished
tasks only, with a confirmation naming the ID and bytes). The footer shows
only the keys that apply to the selected task (`t`, `s`, `m` while it runs,
`c` once it has finished); keys that are not shown stay bound, as do `r`
(refresh; the pane refreshes itself) and `q`. A task stopped by terminate, in
the pane or by the tool, is listed as `■ terminated` rather than `✖ failed`,
with its exit evidence unchanged; the collapsed transcript lines (its
completion notice, the tool's terminate result) say the same, and their
expanded forms are unchanged. A signal sent with `s` or the tool's
`signal` is recorded like any other death, so such a task reads `failed`.
A list wider than the pane hides whole columns (log, notice, time, exit, in
that order) and names them; task, label and state stay. The task view's title
likewise keeps only the facts that fit whole. Closing the viewer never
affects a task. The log reader caches at most 128 KiB of source bytes; it
does not copy the log to pause. Records too long for one window are displayed
in bounded fragments. Wrapping and carriage-return overwrites on such a
record need not match rendering the entire record at once.

While any task is unfinished the editor's bottom-left border shows the badge
`🛠️ N`: the glyph, then the number of running tasks in the running colour.
Like other border badges, it has a theme background when it fits at 120
columns or more. It sits next to the goal and subagent badges and disappears
when no running task remains. Clicking the badge opens the `/bg` inspector.
The compact form is `🛠️N`. The badge is styled when it is drawn, so a theme
switch restyles it at once.

When the task supervisor cannot be reached, the badge keeps its last state
and the transcript gets one `bg-task-status` notice for the outage and one
for its recovery: `⚙ background task status unavailable: <reason>`, then
`⚙ background task status is back` (ctrl+o shows the full text with the error
code). The outage notice starts a model turn only if a task was known to be
running, since only then can the model be waiting for one, and the recovery
notice only if the outage notice did; otherwise both are shown and are in
context for the next turn. A session without a file is not an outage: it
says `⚙ background tasks are off: this session is not saved (--no-session)`
once and never starts a turn.

## Outcomes

| state | meaning |
|---|---|
| `running` + phase `starting`/`running`/`closing`/`stopping` | owned and unfinished |
| `completed` | root exit 0, process group settled, output finalized and fsynced |
| `failed` | `exit_nonzero`, `signaled`, `terminated`, `launch_failed`, `descendants_remaining`, `group_liveness_unconfirmed`, `output_failed`, `output_drain_timeout`, or `session_shutdown` |
| `dead` | `owner_lost` (Pi vanished), `supervisor_lost` (found stale on recovery), or `cleanup_unconfirmed` |

`dead` is **not** proof that a process died and never an invented exit code;
exit evidence is kept only when it was observed. Records and logs persist
until an explicit `clear`; reading, notices, restarts, and history size never
remove them.

### Guarantees covered by the test suites below

- Root exit and PTY EOF alone never complete a task. Surviving group members
  get a 1 s grace, then TERM/KILL. A group that needed cleanup for live
  descendants fails with `descendants_remaining`.
- On Linux, the supervisor stops numeric PGID signals after root exit, reaps
  the leader, and requires `waitpid(-pgid)` to report `ECHILD`. It can still
  signal direct or adopted children using validated pidfds.
- On macOS, the supervisor retains the exited task leader as an unreaped
  child so the PGID cannot be reused while it observes or signals the group.
  The Darwin helper uses `libproc` to check for other group members. A failed
  PID lookup is not evidence that a descendant died; settlement requires a
  group snapshot with no other members. If automatic cleanup confirms that the
  group settled but could not establish whether another member was live when
  cleanup started, an otherwise successful task fails with
  `group_liveness_unconfirmed`. Existing failure, explicit termination, and
  shutdown reasons are preserved. A group that cannot be confirmed settled
  is not success.
- If Pi or its whole process group is killed, the isolated supervisor cleans
  up, records `dead/owner_lost`, and releases the lock. Linux watches an owner
  pidfd and uses an abstract Unix socket; macOS checks its direct parent and
  uses a pathname socket in a private, user-owned directory. Both check the
  connecting process's PID and UID. Unannounced control EOF also cleans up;
  only an explicit reload handoff permits reconnection.
- Recovery never signals saved PIDs or PGIDs. A killed supervisor's unfinished
  records become `dead/supervisor_lost` on the next start; during an activation
  the next start is immediate (see below), so their notices need no user action.
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
  marked received only when the session file holds a matching complete entry
  that a successful assistant response descends from (in the entry tree); an
  errored or aborted response does not count.
  One batch (≤ 10 events) is in flight at a time.
- Delivery is **at least once** across crash windows, deduplicated by event ID
  where a receipt is observable; not transactional exactly-once.
- `notify: false` sends no notice and requests no inference; re-enabling an
  undelivered event makes it eligible again.

### Delivery policy details

- A notice that was not delivered or not answered is re-submitted
  automatically, without waiting for input: missing after a successfully
  settled run, an error outcome (e.g. a provider failure after Pi's own
  retries), no classifiable outcome, or no run starting within 3 s. Retries
  back off exponentially (1 s, 2 s, 4 s, ..., capped at 5 min) and do not stop
  while the event is pending and enabled. Every failure except a first quiet
  retry of a dropped follow-up shows `DELIVERY_UNCONFIRMED` with the next
  delay. A re-sent notice whose earlier copy is already in the session says
  so in its header.
- The only hold is a user abort: events whose notice was in flight in an
  aborted run are deferred quietly (no re-wake); independent later
  completions still notify. The next explicit input releases them when that
  input's run settles, after a receipt check (a kept queue item that Pi
  consumed in the meantime, or a persisted notice the input's run answered,
  is reconciled, not resent). Explicit input also releases backing-off
  events early.
- Failing notice reads or acknowledgements are retried with the same backoff.
- A supervisor that exits on its own during an activation is restarted
  immediately (failed starts are reported and retried with the same
  backoff); recovery records its unfinished tasks as `dead/supervisor_lost`
  and their notices go out like any other.
- No idle submission between an accepted explicit input and its run start, or
  during compaction.
- Reload disposes the old sender/UI before disconnecting, then rebuilds them
  against the same supervisor; completions during the handoff remain pending.
  Other session transitions dispose the sender before teardown; a resumed session
  replays its own pending events and re-checks receipts against the file
  (a lost session-file suffix, or a notice that was never answered, restores
  the notice).
- Muting or clearing stops further submissions but cannot recall an item Pi
  already accepted; clearing does not erase an already posted notice.

## Limitations

- Containment covers the original process group. A descendant that calls
  `setsid`/`setpgid`, or whose parent leaves the group while it stays, escapes
  settlement and cleanup. Guaranteed containment would need cgroups.
- If the supervisor itself is SIGKILLed, HUP-immune tasks become orphans that
  nothing signals (closing the PTY master hangs up ordinary ones).
- The registry snapshot is rewritten on each mutation: metadata cost grows with
  retained history; output memory is bounded, disk usage grows until clear.
- A notice can be duplicated after crash windows, or if a task is muted while
  its notice is queued and later re-enabled before Pi consumes it, or when
  a backed-off retry comes due while an active run already holds the notice.
- Retries are unbounded in count: a long provider outage produces one failed
  notification run, and one more notice entry in the session, per backoff
  step (at most one per 5 min once the cap is reached).
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
  (pinned nixpkgs `python3` and `bash`). On Darwin it also sets
  `PI_BG_TASKS_DARWIN_GROUP` to the compiled `.dylib`. Missing runtime
  configuration is reported, not guessed.
- `checks.<system>.ponygirls-bg-tasks` runs `tsc`, the Python suites, and all
  Node suites, including the packaged-binary tests against the wrapped pi.

## Tests

The Linux check runs the real process and packaged Pi suites. Darwin
behavior must be verified on a Mac; Linux results and Nix evaluation do not
exercise the macOS kernel, sockets, or PTYs.

### Headless Apple Silicon Mac

From a checkout of the GitHub repository, after the change is pushed, set
`rev` to the full pushed commit SHA and run on the Mac:

```sh
rev='<full pushed commit SHA>'
git fetch origin
git switch --detach "$rev"
nix build -L --no-link --rebuild --option builders '' \
  "git+file://$PWD?rev=$rev#checks.aarch64-darwin.ponygirls-bg-tasks"
```

This rebuilds the check locally. It needs no GUI, Pi credentials, or remote
model: the RPC, print, and TUI cases use a scripted loopback provider, and the
TUI is driven through a PTY. The check must pass both the Python and Node
suites. Only the Linux pidfd-specific probes are excluded on macOS.

Outside Nix, if Pi reports that `TMPDIR` is too long for a Darwin control
socket, set it to a shorter absolute writable path (for example `/tmp`) before
starting Pi. The socket path must fit in 103 bytes; the session directory isn't
part of the socket path.

### Direct test commands

```sh
# From this directory, with the pinned SDK linked into node_modules (see flake check):
export PI_BG_TASKS_SDK_ROOT=<pi>/lib/node_modules/pi-monorepo PI_BG_TASKS_PYTHON=<python3> PI_BG_TASKS_SHELL=<bash>
export PI_BG_TASKS_PI=<wrapped pi> PI_BG_TASKS_EXTENSION=<extension dir> PI_OFFLINE=1 PI_TELEMETRY=0
# On macOS, also export PI_BG_TASKS_DARWIN_GROUP as the absolute path to the packaged dylib.
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
| `reconnect_test.py` | real socket handoff, task identity/output, peer rejection, owner death, lease expiry, pending-operation guards |
| `backend.test.ts` | the task-service contract on the memory dummy and the real supervisor client |
| `reload.test.ts` | replacement clients retain task identity, controls, output, and notices; rejected handshakes/handoffs close; detached handles permit owner exit |
| `tool.test.ts` | the public tool on both backends: pagination under inserts/clears, budgets, sanitization, errors |
| `pi-runtime-probe.test.mjs` | pinned Pi delivery semantics (scripted provider, `pi.sendMessage()` path) |
| `delivery.test.mjs` | the real extension in a scripted Pi runtime: idle/active/burst/opt-out, aborts, dropped follow-up, no-start retry, provider-error re-send, supervisor-loss restart, mute, crash windows, switch/fork, reload, compaction, provider retry, a session without a file (one notice, no turn) |
| `delivery-unit.test.ts` | deterministic dispatcher guard transitions, retry backoff, answered-receipt scanning |
| `status.test.ts` | border badge: glyph and running count in the shared badge look, full and compact, clear when idle |
| `extension-status.test.ts` | the real extension with a faked host: the badge follows spawn/terminate/clear and a theme switch; status notices and when they ask for a turn |
| `ui.test.ts` | the inspector on a real supervisor: live follow/scroll, escape fixtures, bounded windows, dead/missing labels, actions |
| `ui-render.test.ts` | the inspector and the transcript lines on the memory dummy: exact text and colours, state-dependent hints, every line at 60 to 170 columns |
| `transcript-wiring.test.ts` | the registered renderers and the `/bg` command: collapsed one-liners, expanded text unchanged |
| `packaged.test.mjs` | wrapped pi binary + packaged extension in RPC, print, and TUI (PTY) sessions with a local fake provider, including a `--no-session` start |

## Deviations from the plan (with evidence)

- **Tool schema:** flat top-level primitives (`action` required, other fields
  optional) with the plan's discriminated union enforced at execution. A
  top-level union reaches Anthropic models as an empty object (Pi's adapter
  forwards only top-level `properties`/`required`,
  `pi-ai/dist/api/anthropic-messages.js` `convertTools`), and a nested
  `request` object was sent as a JSON string by `mimo-v2.6-pro` in live use,
  failing every call with `request: must be object`.
- **Explicit-input release timing:** abort-deferred events are released
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
- **Supervisor loss during an activation:** the activation starts a fresh
  supervisor immediately, which recovers the lost records as
  `dead/supervisor_lost`.
- **Naming:** `ponygirls-bg-tasks` (repository convention) instead of the
  plan's tentative `pi-bg-tasks`; runtime names (`bg_task`, `/bg`,
  `bg-task-completion`) are as planned.
