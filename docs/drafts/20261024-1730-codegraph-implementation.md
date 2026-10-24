# Codegraph workspace implementation ledger

## Scope and acceptance

- Preserve existing MCP/tool names and the padded themed CG badge.
- Add bounded discovery, canonical per-project readiness, ambiguity-safe routing,
  explicit workspace-wide opt-in, targeted/batch commands and byte totals.
- Separate worktree indexes; no seed copying, global recursive scan, or cross-repo
  graph merging. These are not needed for the requested workflow.
- Erase must refuse if writer/reader exclusion cannot be established; audit pinned
  upstream coordination before choosing implementation. No blind deletion.

## Completed

- [x] Catalog and filesystem sizes (`projects.ts`): isolated writer agent, reviewed
  and copied to main. Redundant writer worktree removed after integration.
- [x] Per-project coordinator and command parser.
- [x] Pi hooks, bounded agent inventory context, CLI aliases.
- [x] Workspace-safe CLI locking and explicit persistent opt-in.
- [x] Erasure/lifecycle audit: read-only agent verified upstream has no complete
  reader-admission/drain protocol. Online erase is deliberately refused, with exact
  offline SQLite-file cleanup instructions. No destructive wrapper was shipped.
- [x] Failing reproductions/contract tests, actual MCP routing, CLI regressions.
- [x] README and read-only review. Review findings were reproduced before fixing:
  pending cancellation, recoverable activation, busy-batch continuation, stale
  identity/inventory, and cancellation during removal/draining of an old entry.

## Verification

Baseline: commit 3815557, initially clean tree; prior 12 tests passed. Final direct
suite against pinned Pi 1.4.0 SDK, Codegraph 1.6.2, Node 24.20.0 and configured flock:
**39 passed, 0 failed, 0 skipped**. Strict TypeScript 7.0.2 checking and
`git diff --check` passed. Full Nix flake build was not rerun; extension check steps
were executed directly with the installed pinned dependencies.

The actual parent-MCP regression first failed because ambiguous omitted paths were
forwarded rather than blocked. New features also cover separate sentinel symbols,
concurrent non-Git workspace creation, child data-directory exclusion, dirty
linked-worktree source isolation, targeted cancellation during path resolution,
startup project A not gating B, partial size evidence and JSON/RPC stdout safety.

Real PTY: private tmux 3.7c, Pi 1.4.0, actual extension/CLI, credential-free explicit
environment, MCP/tools disabled, no model calls. Observed status totals, project
selection, sync completion, workspace-wide opt-in and erase refusal; 120x40 and
80x24 screens; dark-theme badge background serialized as a 256-color background.
Both Pi exits were 0 and the private tmux server was stopped. Ignored diagnostic
captures: `debug/20261024-codegraph-ui/`. UI testing does not establish MCP routing;
that is covered by the actual stdio tests.

No new skill draft was warranted by the delegated pattern/overlap assessment:
existing dual-adapter/testing skills cover the procedure. Broader seed copying,
recursive discovery and safe online erasure require separate work; they are not
silently approximated here. Implementation complete; see Git history for the commit.
