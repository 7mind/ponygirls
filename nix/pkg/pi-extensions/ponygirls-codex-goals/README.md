# ponygirls-codex-goals

Codex-style goals for Pi (`v1.0.0` verified), with one deliberate change:
**every model-facing goal instruction is a visible, persisted message in the
same Pi session** (`customType: codex-goal-context`, `display: true`, full
text in `content`). Continuations and ordinary assistant answers stay in that
session's normal transcript — inspectable in raw JSONL, interactive history,
and HTML export.

## Install

In this repository the extension is wired via `nix/hm/pi.nix`
(`programs.pi.settings.extensions` includes
`nix/pkg/pi-extensions/ponygirls-codex-goals`). For manual use:

```bash
pi --extension /path/to/ponygirls-codex-goals
```

Requires a **saved Pi session**. In-memory/ephemeral (`--no-session`)
sessions are rejected with an actionable message; no silent fallback store.

## Commands

One command, `goal`:

| Invocation | Behavior |
|---|---|
| `/goal` | Show current state and usage (no model call). |
| `/goal <objective>` | Create an active goal. Replacing an unfinished goal asks for confirmation in the TUI; headless use must `/goal clear` first. |
| `/goal --tokens 40000 -- <objective>` | Create with a token spending cap. |
| `/goal edit` | Edit the objective in an editor dialog (TUI). Preserves goal ID, status, budget, usage. |
| `/goal edit <objective>` | Apply an explicit objective edit. |
| `/goal edit -- <reserved>` | Edit to an objective beginning with a reserved word. |
| `/goal pause` | Pause the active goal, cancel admission. |
| `/goal resume` | Reactivate a paused/blocked/usage-limited goal, or recover an interrupted active dispatch. |
| `/goal resume --tokens 80000` | Raise the cap and resume (usage retained). |
| `/goal clear` | Clear state (tombstone). Transcript entries are retained. |

Starting or resuming via slash command records the objective as a normal
user prompt (`sendUserMessage`, no template expansion) and attaches the
visible kickoff instruction via `before_agent_start`. Automatic
continuations use visible custom messages instead. In print/json modes
(single-turn) the command persists state and the next run picks it up;
no second turn is queued there.

## Model tools

Exactly three, with Codex-compatible authority boundaries:

- `create_goal({ objective, token_budget? })` — only after an explicit
  request; replaces only a `complete` goal, refuses every unfinished state.
- `get_goal({})` — state observation; cannot declare completion.
- `update_goal({ status: complete | blocked | paused })` — complete only
  when fully achieved and verified; block only after the same genuine
  blocker recurs across three consecutive executions; pause only at the
  user's explicit request. Resume/clear/edits/budget transitions are not
  in the model schema.

Mutating tools run sequentially. Completion never returns `terminate:
true`: the normal assistant follow-up reports the result and final usage.

## Budget semantics

Token count is uncached input plus output (`input + cacheWrite + output`
where Pi reports disjoint fields). `cacheRead` is never subtracted;
`reasoning` (a subset of `output`) is never added twice. Reaching the cap
persists `budget_limited`, emits one visible wrap-up instruction (not
completion), and stops autonomous work; overshoot is reported. A
`budget_limited` goal resumes only with a raised cap. Verified completion remains possible after exhaustion, and retains final-report
usage. Missing usage that would prevent enforcing a cap stops admission explicitly.
Accounting excludes pre-goal history and unrelated runs while the goal is paused.
Elapsed time uses monotonic active-run spans, including checkpoints at goal tools.

## Same-session execution

An active goal admits at most one continuation at a time after the
preceding run and Pi's own automatic work settle (`agent_settled` +
admitted visible custom message). User input wins over un-delivered
admission; stale dispatches are preserved in the log with a visible
cancellation and cannot do work. Completion, blocked, paused,
budget-limited, and usage-limited states stop continuation. A restart
with an unresolved dispatch requires `/goal resume` (no blind replay).

## Visibility

All goal instructions use `display: true` with the full body in `content`
and typed metadata (schema version, session/goal/revision IDs, purpose,
dispatch ID) in `details`. No goal content travels via `context`,
system-prompt injection, or provider-payload mutation. Lifecycle notices
and commit metadata are custom entries (not model context). Nothing is
deleted on clear/replace/resume/compaction; Pi's normal compaction
manages context size.

While an unfinished goal exists the editor's bottom-left border shows `goal
<status>` (active, paused, blocked, budget_limited, usage_limited) as a
magenta badge, next to the background-tasks badge when both are present;
it clears when the goal completes or is cleared.

## Persistence

Atomic JSON sidecar next to the session file:
`<session-file>.codex-goals.json` (versioned envelope: session ID,
monotonic revision, goal or tombstone, dispatch record, usage
checkpoints). Writes go to a unique temp file (mode `0600`), flush,
atomic rename, directory flush; restrictive permissions. A lock file
(`.lock`) enforces one owning store instance per session, including within a
single Pi process; every commit checks ownership. Stale locks recover only
for a positively absent owner. Malformed state is reported, never treated
as "no goal". Native commit metadata (`codex-goal-commit` entries) is
audit evidence, not a second store.

## Recovery

- Storage failure / indeterminate durability: admission disabled until
  `/goal resume` (or clear) reconciles.
- Transcript failure after a sidecar commit: partial result reported,
  admission disabled, recovery required (the sidecar is never rolled back
  silently).
- Unresolved dispatch after restart: visible recovery instruction, no
  replay until `/goal resume` invalidates it.
- Forks inherit the parent goal into their own sidecar (no live dispatch
  copied). Tree navigation keeps the session goal; obsolete callbacks are
  invalidated, never rolled back from old snapshots.

## Compatibility limitations (Pi 1.0.0 host)

- **Plan mode:** Pi's `ExtensionContext.mode` (`tui`/`rpc`/`json`/`print`)
  is not Codex's Plan/Default collaboration mode. No automatic Plan-mode
  gate is implemented.
- **Usage-limit classification:** Pi exposes no typed quota-exhaustion
  signal. `usage_limited` is implemented but unreachable until the host
  provides one; generic errors (including unclassified HTTP 429) become
  `blocked` after host recovery is exhausted. Error prose is never parsed.
- **Execution-facility failures:** implemented only where Pi exposes the
  distinction; failing shell commands count as activity, not executor
  failures. The semantic three-execution blocker rule stays in the prompt.
- **Child usage:** nested model usage is charged once via finalized
  results when the host reports it; arbitrary independent child sessions
  are not auto-accounted.
- **Print/json modes:** single-turn; slash commands persist state for the
  next run rather than queuing an immediate kickoff turn. Continuations
  are an interactive/RPC behavior.
- **Exactly-once across crashes** is not claimed: at most one admitted
  continuation, stale-dispatch rejection, explicit recovery.
- **Completion is a model claim:** code enforces only the tool schema and
  the active precondition, so a vague objective can complete with no work
  performed. The audit (including asking for acceptance criteria when the
  objective states no verifiable outcome) lives in the instruction text;
  recovery is a new goal with verifiable criteria, which is cheap because
  history is preserved. A token budget bounds the cost of such a failure.
- **Manual compaction mid-run aborts the run:** Pi's `compact()` aborts the
  current agent operation first, even when the session turns out too small
  to compact. An aborted goal run pauses the goal (same as Escape) and no
  resync is emitted for a non-active goal; resume explicitly. Automatic
  threshold compaction fires between runs instead, flows through the normal
  resync path, and never pauses the goal.

## Tests

Deterministic contract suites (shared dummy + file adapter) plus
behavioral scenarios:

```bash
node --test tests/*.test.ts
```

Real-host tests use the pinned Pi SDK, a deterministic local provider, temporary
saved sessions, JSONL/HTML export, and actual interactive message components:

```bash
PI_OFFLINE=1 PI_GOALS_SDK_ROOT=/path/to/pi-monorepo node --test tests/host.test.mjs
```

`nix build .#checks.x86_64-linux.ponygirls-codex-goals` runs strict TypeScript checking and
both suites against the packaged Pi host. No live-model behavior is claimed.
