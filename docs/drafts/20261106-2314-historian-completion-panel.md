# Historian completion and panel acceptance

Source: base `d1edcf9b`; implementation/tests/README staged tree
`cbdd428b02fe11777762da3aa80e8cc2aa5dbcee` (before this evidence note).

## Reproduction

A registration-level regression exercised the actual extension factory and
asserted `typeof command.getArgumentCompletions === 'function'`. Before the
correction it failed with actual `undefined`, expected `function`. Missing
argument-completion registration was the reproduced failure, not a loader error.

## Automated checks

Installed pinned Pi 1.4.0 / Node 24.21.0 and repository shared libraries; no npm
installation or lockfile changes. Compiler:
`/nix/store/mfrbqj78li0mmzi32xlbisgc6lr8qhnr-typescript-7.0.2/bin/tsc`.

- `tsc -p nix/pkg/pi-extensions/ponygirls-pi-ui/tsconfig.build.json`: passed.
- `tsc -p nix/pkg/pi-extensions/ponygirls-historian/tsconfig.json`: passed.
- `node --test nix/pkg/pi-extensions/ponygirls-historian/tests/*.test.mjs`:
  68 passed, 0 failed/cancelled/skipped.
- `node --test nix/pkg/pi-extensions/ponygirls-pi-ui/tests/*.test.ts`:
  final run 32 passed, 0 failed/cancelled/skipped.
- `nix build --no-link .#checks.x86_64-linux.ponygirls-historian`:
  passed; 68 source tests plus 3 packaged real-Pi host tests, no failures/skips.
  Check derivation: `6dvz75a8cc06xkcwsvij1km5cbwxv26c-ponygirls-historian-test`.
- `git diff --cached --check`: passed.

## Interactive acceptance

Real Pi 1.4.0 through a private `tui-tmux` server (tmux 3.8), initially 120x40,
then resized to 60x18. Launched the pinned SDK `dist/cli.js` with `env -i`,
disposable HOME/agent/project directories, `--offline --no-session
--no-extensions --no-skills --no-context-files --no-prompt-templates --no-mcp
--no-tools --no-approve`, and explicit Historian plus its existing scripted
`tui-provider.ts` fixture. Only synthetic evidence was submitted; no real
credentials or external inference.

Fullscreen/dark:
- `/historian ` displayed verb descriptions; `jo` + Tab produced exactly
  `/historian journal` and opened the journal on submission.
- Model completion retained `/historian model historian-fixture `, completed
  `journal`, then offered/completed thinking `off`.
- Explicit synthetic opt-in and `UI_EXPERIMENT` produced a journal revision.
- Status showed grouped configuration/activity/attempts/errors/coverage.
- Journal showed the reported basis, source session/entry and full SHA-256.
- End at 60x18 reached the status disclaimer with close hints and badge visible.
- Escape and `q` restored the editor. Growing back to 120x40 retained readable
  journal layout.

Regular/light:
- Reopened the same synthetic journal; headings, evidence and coverage remained
  distinct. At 60x18, End reached the complete final evidence digest and close
  hints. Escape restored the editor.

Styled screen captures contained 13 distinct ANSI styles in fullscreen status
and journal, and 10 in regular/light journal. This verifies terminal-cell styling,
not font/pixel contrast in the user's emulator. Both Pi processes exited normally
with status 0; private tmux server was stopped and its socket no longer accepted
control commands. Temporary evidence: `/tmp/histui.qaRlGz` (not durable).

## Review and remaining operational boundary

Read-only subagent review found no actionable defects; its suggested missing
callback-invalidation test was subsequently added and passed. Skill assessment:
no new candidate warranted; existing `tui-testing` and shared `completeArgument`
contracts cover the reusable procedures.

Codegraph queries failed their foreign/unknown-PID-namespace ownership check.
Its automatic discovery nevertheless created an index in the new task worktree.
No daemon/lock bypass or indexed-tree removal was attempted. Q30 requests that
the coordinated maintenance barrier cover this tree before cleanup. Q28/Q29's
older trees remain untouched. No Home Manager activation/deployment was performed.
