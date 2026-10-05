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

## Verification log (local + nix, 2026-10-05)

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

## Not executed

- Live-provider delegation/resume/nesting/interruption and gated
  revise→repair→approve (opt-in; no credentials spent here).
- Interactive TUI flows (`/agents` inspector key handling beyond unit
  tests, editor dialogs) — unit-tested model, pi-wired but not
  terminal-driven.
- Abrupt host reboot with kernel-buffer loss (guest/storage harness).
- Independent read-only adversarial implementation review: no running
  subagents were available in this session; structured self-review above
  substituted and is disclosed as such.
