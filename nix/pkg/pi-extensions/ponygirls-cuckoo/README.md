# Cuckoo

Opt-in objective/progress checkpoints from the **main conversation model**. Uses
`@ponygirls/pi-settings` and `@ponygirls/pi-ui`, like the other extensions.

## Controls

- `/cuckoo` or `/cuckoo status`: view saved reports and effective settings.
- **Ctrl+Alt+C**: toggle the report view without submitting or losing the editor draft.
- Click the **Cuckoo N** border badge to toggle reports (fullscreen, or regular
  mode with Pi's `regularMouse` enabled). Escape or `q` closes the view.
- `/cuckoo on|off|inherit`: session override, or inherit the global default.
- `/cuckoo default on|off`: global default for sessions without an override.
- `/cuckoo threshold 15`: session relative-growth threshold in percent.
- `/cuckoo threshold inherit`: inherit the global threshold independently of enablement.
- `/cuckoo default threshold 15`: change the global threshold.

Defaults: **OFF**, **15% relative token growth**. Global preferences are mutable
`<agentDir>/cuckoo.json`; session settings persist in session entries and span
branches, but do not configure a different fork/session ID. Home Manager loads
the extension without managing or overwriting that preferences file. Reports
follow the active branch and remain readable when automatic inquiries are OFF.

## Cadence and output

At completed model-turn boundaries, Cuckoo observes Pi's context token usage
(including cached tokens), not a percentage of context-window capacity. The
first eligible observation establishes a baseline. A baseline of **20,000**
tokens triggers at **23,000** with a 15% threshold. Subsequent baselines are the
usage observed when an inquiry is issued. There is no timer or idle wakeup.
Thresholds are finite numbers greater than zero and at most 100.

Unknown usage defers scheduling. A context decrease or model/capacity change
establishes a fresh baseline. Pending compaction/context edits, other extensions'
model-facing drafts, and queued user input defer scheduling. Inquiry and resume
responses cannot themselves trigger another inquiry at that same boundary.

The main model receives “Restate me your objectives and brief me on your
progress” with a JSON-only schema:

```json
{"objectives":[{"objective":"Current objective","progress":"Brief factual progress"}]}
```

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
`off` means automatic scheduling is disabled. The read-only view shows report
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
