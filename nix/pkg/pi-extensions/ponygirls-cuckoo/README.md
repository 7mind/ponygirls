# Cuckoo

Opt-in objective/progress and session-local rule checkpoints from the **main conversation model**. Uses
`@ponygirls/pi-settings` and `@ponygirls/pi-ui`, like the other extensions.

## Controls

- `/cuckoo` or `/cuckoo status`: view current-branch reports and effective settings.
- `/cuckoo history`: view all saved answers in this session, newest first, with
  timestamps, checkpoint/entry IDs and current/other-branch labels. Includes
  invalid or interrupted answers and remains available while Cuckoo is OFF.
- `/cuckoo reports`: view current-branch reports and effective settings.
- `/cuckoo inquire now`: request a checkpoint even while automatic mode is OFF.
  Command completion walks both words, as well as the existing settings grammar.
- Press **`i`** in any Cuckoo panel to close it and request the same inquiry.
- **Ctrl+Alt+C**: toggle the report view without submitting or losing the editor draft.
- Click the **🐦 N** border badge to toggle reports (fullscreen, or regular
  mode with Pi's `regularMouse` enabled). Escape or `q` closes the view.
- `/cuckoo on|off|inherit`: session override, or inherit the global default.
- `/cuckoo default on|off`: global default for sessions without an override.
- `/cuckoo policy relative 15`: grow 15% relative to the checkpoint's token count.
- `/cuckoo policy window 15`: grow by tokens equal to 15% of context-window capacity.
- `/cuckoo policy tokens 10000`: grow by 10,000 tokens.
- `/cuckoo policy inherit`: inherit the global policy independently of enablement.
- `/cuckoo default policy window 15` (or `relative 15`, `tokens 10000`): global policy.

Manual inquiries do not change enablement or policy. When idle, they start a
main-model response immediately; known context usage is required (send a task
first in a fresh session). While busy, one request is queued for the next safe
completed-turn boundary and unfinished work resumes afterward. Repeated requests
are coalesced. Abort, new user input, reload and branch navigation cancel queued
requests. Issuing a manual inquiry resets the cadence baseline just like an
automatic checkpoint.

Policy kind and value are one setting, so changing units cannot inherit a value
from a different mode. Existing `threshold PERCENT`, `threshold inherit`, and
`default threshold PERCENT` commands remain aliases for the relative policy.

Defaults: **OFF**, **growth equal to 15% of context-window capacity** (`window 15`). Global preferences are mutable
`<agentDir>/cuckoo.json` (version 2, `policy: {kind, value}`); existing version-1
percentages and session threshold records retain their relative meaning.
Reading old defaults does not rewrite them; the next explicit global write
stores version 2. Session settings persist in session entries and span branches,
but do not configure a different fork/session ID. Home Manager loads
the extension without managing or overwriting that preferences file. Reports
follow the active branch and remain readable when automatic inquiries are OFF.
The history command reads all branches of the current session's persisted log;
reopening that session restores its history without a separate global history
file. A new session starts with no answers; a fork contains only entries Pi
copies into that new session. Opening history does not request model inference.

## Reading the panel

The terminal panel puts the newest saved checkpoint and numbered objectives
first, with effective settings below the reports. Runtime faults stay at the top.
Checkpoint/objective headings are accented and bold; request IDs, timestamps,
entry/branch attribution and saved-report qualifiers are muted. Session-local
rules have a warning-colored section header, with accent user labels and muted
assistant labels; status/configuration has a muted header. Progress and ETA have
accent labels; obstacles, issues and bottlenecks have warning-colored labels.
These colors identify field categories and provenance, not inferred completion,
severity, independent verification or new authorization.

Each checkpoint shows its session-local rules once, before numbered objectives.
Fields use compact inline labels and hanging indentation, with blank lines only
between sections/objectives/checkpoints. Long values wrap beneath the value;
very narrow terminals put labels above values instead of squeezing the content.
Arrow keys and Home/End scroll the panel; `q` or Escape closes it. In regular
mode PgUp/PgDn also scroll it; Pi reserves those keys for transcript scrolling in
fullscreen mode. The border badge remains available while the panel is open.
Invalid/interrupted checkpoints have explicit error headings and literal raw
output. Theme changes regenerate colors; RPC/plain-text output stays unstyled
and includes the same rule source/scope data.

## Cadence and output

At completed model-turn boundaries, Cuckoo observes Pi's context token usage
(including cached tokens). The first eligible observation establishes a
baseline. All policies measure additional tokens since that baseline:

| Policy | Baseline 20k, context window 200k: next inquiry |
|---|---|
| `relative 15` | 23k (3k additional tokens) |
| `window 15` | 50k (30k additional tokens) |
| `tokens 10000` | 30k (10k additional tokens) |

Subsequent baselines are the usage observed when an inquiry is issued.
Percentage policies accept finite values `0 < value <= 100`, rounding fractional
token increments upward. Token policies require positive safe integers.
Policy changes use the existing baseline. There is no timer or idle wakeup.

Unknown usage defers scheduling; the window policy also requires known positive
context-window capacity (no substitution of a token percentage). A context decrease or model/capacity change
establishes a fresh baseline. Pending compaction/context edits, other extensions'
model-facing drafts, and queued user input defer scheduling. Inquiry and resume
responses cannot themselves trigger another inquiry at that same boundary.

The main model receives “Restate me your objectives and brief me on your
progress, obstacles, issues, bottlenecks, and ETA” with a JSON-only schema:

```json
{"objectives":[{"objective":"Current objective","progress":"Brief factual progress","obstacles":"None known","issues":"None known","bottlenecks":"Serial runtime validation","eta":"Unknown: validation has not started"}],"rules":[{"rule":"Show mockups before implementation","source":"user","scope":"This UI change"}]}
```

All six fields are required nonempty strings (at most 8000 characters each;
100 objectives and 100000 characters total). Obstacles describe impediments or
blocking dependencies, issues describe known defects or risks, and bottlenecks
describe what limits progress or throughput. Use `None known` rather than imply
independent verification. ETA is time to completion with its evidence, assumptions
and uncertainty, or `Unknown` with the reason an estimate is unavailable; the
inquiry explicitly prohibits invented deadlines or estimates.

The `rules` array restates active session-local user instructions and
assistant-adopted working conventions, excluding inherited system/developer,
AGENTS.md and installed-skill rules, superseded instructions and inferred
preferences. Each rule has required `rule` and `scope` nonempty strings (at most
8000 characters each), and `source` exactly `user` or `assistant`. At most 100
rules are allowed, within the existing total response limit. Rules remain separate
from objectives and may apply even when no objectives remain. An empty array
means no session-local rules were reported. Assistant conventions are not user
approval or authorization. This is a recall prompt, not a policy enforcement or
independent provenance-verification mechanism.

New checkpoints use metadata version 3. Version-1 and version-2 saved reports
remain readable: rules show `Session rules not recorded (legacy report)` rather
than implying there were none. Version-1 additional objective fields still show
`Not recorded (legacy report)`, not invented values. Current replies missing
required fields are invalid and retain their raw output.

Only current objectives count; an empty list means zero. Reports are model
self-reports, **not independently verified progress or new authorization**.

The original assistant response remains in the transcript. Cuckoo stores its
entry ID, full content, exact text, parsed report and validation error separately
as session metadata. Invalid JSON, interrupted replies and attempted tool calls
are retained and surfaced, without correction retries. Checkpoint tool calls
are blocked. Unfinished tool-loop work resumes after the checkpoint; an already
finished answer does not require another normal response. A forbidden checkpoint
tool call receives a bounded normal-task follow-up because Pi itself continues
after tool results.

Abort, new delivered user input, reload and branch navigation cancel an
outstanding capture rather than capturing an unrelated future answer. Closed
inquiries are neutralized in future provider context; original session evidence
is retained. There is no automatic retry after cancellation.

The badge shows the latest validated objective count. `?` means no validated
report; `!` means the latest attempt/settings failed (the prior count is stale);
`off` means automatic scheduling is disabled. The report view shows report
history newest first, with raw invalid output and errors. Terminal control bytes
are removed for presentation, not from stored raw output.

## Validation

```bash
nix build .#checks.x86_64-linux.ponygirls-cuckoo --no-link -L
nix build .#checks.x86_64-linux.subagents-policy-shape --no-link -L
```

The extension check typechecks and runs all `tests/*.test.mjs`, including real
Pi loader/model-loop/JSONL tests with a controlled in-process provider. These
establish workflow behavior, not live-model classification or semantic quality.
`tests/fixtures/tui-provider.ts` is an explicitly loaded, network-free provider
for manual PTY validation; it is not loaded by the extension.
