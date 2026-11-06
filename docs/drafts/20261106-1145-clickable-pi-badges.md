# Clickable Pi editor-border badges

Implementation source: `9b9b2b74` (Pi 1.4.0, existing pinned dependencies).

## Behavior

All seven badge owners toggle their corresponding custom view: agents, goals,
background tasks, decisions, Tokemon, Codegraph and context archive. Commands
retain their existing behavior; Codegraph/archive badge views read snapshots
without activating routing or changing archive state. Keyboard dismissal remains
available. Mouse interaction requires Pi's fullscreen mode.

The opt-in `ctx.ui.custom(..., { retainEditorBorders: true })` keeps independently
rendered border rows around inline custom views, without focusing the hidden
editor. Permission/input dialogs are unchanged. Revision and dialog-ownership
guards reject removed or detached targets. Interactive badge spans own the whole
mouse gesture: allowing press events to fall through to text selection suppressed
every third rapid click.

`CustomViewToggle` owns each session's pending/open interaction and revokes stale
callbacks on shutdown. `PanelLayout` keeps title/help/input rows outside the
scrolling body, uses allocated height, and separates intrinsic measurement from
navigation state. The fullscreen footer also retains its measured height.

## Validation

Final built artifacts (not activated/deployed):

- Pi: `/nix/store/6ah99dii1kwj9bfi4cpx23rh2m698nzd-pi-coding-agent-1.4.0`
- Extensions: `/nix/store/xbfwcm63q5p73i1iyp0mvkwx13zakhfg-ponygirls-pi-extensions`

Core TypeScript/package build passed. Broad targeted core run: **104 tests in
15 files**, no failures/skips. The package's Nix check runs **67 tests in 5 files**,
not the complete upstream Pi suite. Commands from the patched upstream tree:

```bash
npm run build --workspace=packages/coding-agent
./node_modules/.bin/vitest run \
  packages/coding-agent/test/interactive-mode*.test.ts \
  packages/coding-agent/test/custom-editor*.test.ts \
  packages/coding-agent/test/chat-viewport.test.ts
```

All eight final Nix extension checks passed, including their typechecks:

| Check | Passing tests |
| --- | ---: |
| Shared Pi UI | 31 |
| Goals | 109 + 17 host |
| Decisions | 114 |
| Background tasks | 131 Node + 87 Python |
| Subagents | 763 |
| Codegraph | 60 |
| Context archive | 79 |
| Tokemon | 91 |

Total: **1,482 extension tests**, zero failures/cancellations/skips. The optional
Tokemon cross-language case executed in Nix (it had been skipped only in an
earlier local developer run). Command from repository root:

```bash
nix build --no-link .#pi-coding-agent .#ponygirls-pi-extensions \
  .#checks.x86_64-linux.ponygirls-pi-ui \
  .#checks.x86_64-linux.ponygirls-codex-goals \
  .#checks.x86_64-linux.ponygirls-decisions \
  .#checks.x86_64-linux.ponygirls-bg-tasks \
  .#checks.x86_64-linux.ponygirls-subagents \
  .#checks.x86_64-linux.ponygirls-codegraph \
  .#checks.x86_64-linux.ponygirls-context-archive \
  .#checks.x86_64-linux.ponygirls-tokemon
```

Fail-first reproductions covered missing toggle callbacks, discarded async-view
cleanup, forwarded mouse targets, stale/detached border rows, clipped badges and
footer/help rows, resize/measurement navigation corruption, and rapid-click
text-selection interference.

Real PTY acceptance uses isolated `env -i` configurations, synthetic state and
intercepted quota responses; no live model calls or real credentials. Cases cover
first/second click, Escape and reopen, command-to-badge closure where commands
open views, compact badges, unsent drafts, rapid repeated clicks, narrow resize,
long quota/archive content, agent transcript input and return to the root draft.
Final-artifact PTY runs cover 120×32/100×30, 48×18 and 48×12 layouts. An earlier
80×24 regular-mode check passed command/keyboard access; it was not rerun after
the final mouse-press correction and is retained as historical evidence with
verified unchanged extension/layout source, not as a fresh final-artifact run.
Normal process exit
and private terminal-server cleanup are checked. These are UI
acceptance tests, not provider/service operational acceptance.

Detailed logs, fixture drivers and captures are retained locally under
`debug/clickable-badges-20261106/` after worktree integration. Nix extension-suite
results and final PTY artifact bindings are recorded there.
