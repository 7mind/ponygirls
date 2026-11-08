# Cuckoo per-session answer history

Request: let the user see answer history, persisted per session.

Implementation: `/cuckoo history` projects all `cuckoo.report` entries in the
current session log, newest first, with timestamps, request/entry IDs and
current/other-branch labels. Existing status, badge and report controls retain
branch-local semantics. History is read-only, works while scheduling is off,
and uses the existing durable session metadata rather than a global file.
New sessions are empty; forks expose only entries copied by Pi.

Base: `afbe3d047fe81bac0cda33f0838b2cf79f5a6023`.
Owned task branch: `feature/cuckoo-history`.

## Validation

- Added command reproduction before implementation. The Nix check failed with
  33/34 passing: `history` was rejected with the policy usage error instead of
  showing the expected empty history. A later test setup correction added an
  actual root entry before branch navigation (`branch(null)` is not supported).
- Final application check:
  `nix build .#checks.x86_64-linux.ponygirls-cuckoo .#checks.x86_64-linux.subagents-policy-shape --no-link -L`.
  Cuckoo typecheck and all 35 cases passed; 0 failures, cancellations, skips or
  todos. Policy check succeeded (cached unchanged inputs).
  Cuckoo derivation: `/nix/store/8rg8iwpkfhx7157pfpz8dlmwx76s2lkx-ponygirls-cuckoo-test.drv`.
- Added tests cover empty history, cross-branch answers, interrupted raw output,
  newest-first order, completion, no state mutation, no extra inference,
  extension reload, disk reopen and independent empty sessions.
- Real PTY: Pi 1.4.0, tmux 3.8; built extension package
  `/nix/store/z4p9n98qcz33g7w6yyfsp6hwxqp34fjl-ponygirls-pi-extensions`.
  Isolated allowlisted environment and synthetic provider, no credentials or
  external inference. Opened a seeded persisted session, ran `/cuckoo history`
  while off, observed both branch labels and both answers at 120x40, resized to
  60x24 and observed wrapping without lost content, closed with `q`, exited with
  Ctrl+D (status 0). Private terminal server stopped and unreachable afterward.
  Local captures/log: `.local/cuckoo-history/` in the main checkout.
- `git diff --check` passed. Chronicle code/packaging was not changed; Chronicle
  suites are not acceptance evidence for this extension.

Read-only subagent review of implementation, documentation and tests found no
substantive defects (tests inspected, not independently executed). Its skill
assessment found no novel reusable candidate beyond the installed testing and
UI-verification skills; no draft was manufactured.

Codegraph was attempted on the main checkout but refused access because daemon
ownership belongs to a foreign/unknown PID namespace. Used direct source
inspection instead; did not initialize a task-worktree index. Pending Q37
concerns a different, retained pilot tree, which this task does not modify.
