# Codegraph workspaces: proposed design

Status: design only; no runtime changes. “Global” below means a workspace-wide
index, not a machine-wide or home-directory index.

## Observed baseline

- `ponygirls-codegraph` prepares one Git checkout and gates all Codegraph calls
  against that checkout's readiness, including explicit calls to other projects.
  Non-Git launch directories skip preparation. Commands ignore arguments.
- Pinned Codegraph 1.6.2 already resolves explicit `projectPath` to the nearest
  `.codegraph`, caches by canonical index root, and supports multiple projects.
  It does not require one MCP server per repository.
- Its ancestor-index lookup can cross Git boundaries. Our existing local-index
  verification and explicit default-path injection protect the prepared checkout.
- Extension cancellation does not stop the independently managed MCP watcher.
- `codegraph uninit` closes its own connection, deletes `.codegraph`, and removes
  installed Git sync hooks. This is not a safe cache-only erase primitive while
  other processes may still own the index.

Evidence: local `index.ts`, `runtime.ts`, README; installed 1.6.2
`dist/mcp/tools.js:getCodeGraph/openProjectRoot`, `dist/bin/codegraph.js:uninit`,
and `dist/index.js:uninitialize`. Multi-project behavior is source-inspected here,
not newly verified end to end.

## Recommendation

Keep the existing MCP server and tool names. Add a workspace coordinator over
per-canonical-checkout sessions. Discovery, preparation, query selection, and
index deletion must remain separate operations.

### Discovery and selection

- In a Git checkout, preserve the current local-checkout default.
- Outside Git, discover immediate child working trees by default, recognizing
  both `.git` directories and linked-worktree `.git` files. Do not follow symlink
  directories or recursively scan arbitrary trees. Permit explicit deeper paths.
- Discovery must not initialize every discovered repository. Prepare selected
  projects on demand; provide an explicit batch operation for all discovered roots.
- Explicit tool `projectPath` selects that project's readiness state. Resolve
  relative paths consistently against the session cwd and inject the verified
  canonical root before forwarding. A failure in repository A must not gate B.
- An omitted path uses an explicitly selected default, or the sole discovered
  checkout. Multiple candidates produce an actionable ambiguity error listing
  roots; never guess from symbol names or silently merge answers.
- Publish the project inventory/default to the agent as well as the user. A user
  command alone does not make project selection discoverable to the model.
- Cross-project querying remains explicit. Fan-out search and cross-repository
  dependency edges are separate features and are not proposed here.

### Proposed command surface

Prefer one `/cg` dispatcher, retaining existing `/cg-*` commands as aliases.

| Command | Meaning |
| --- | --- |
| `/cg status [PATH\|--all]` | Roots, selection, health, last check, sizes, totals |
| `/cg discover [PATH]` | Refresh bounded inventory without creating indexes |
| `/cg use PATH` | Select the default query project; does not mean globally ready |
| `/cg sync [PATH\|--all]` | Prepare/sync selected project(s), then verify each |
| `/cg reindex [PATH]` | Explicit full rebuild and verification |
| `/cg cancel [PATH\|--all]` | Cancel extension-owned work only |
| `/cg init --workspace PATH` | Explicit opt-in to a non-Git workspace-wide index |
| `/cg erase PATH` | Confirm exact target and size; require safe writer shutdown |

`status --all` should list missing indexes without creating them. Report per-index
logical file bytes, including SQLite WAL/SHM, separately from database bytes and
aggregate totals; do not call these allocated disk usage. Do not follow symlinks
or double-count canonical roots. Show last-checked health separately from current
operation state. Do not equate last verification with a live watcher guarantee.
The upstream status command itself can write repair metadata.

Workspace-wide indexing is an alternative scope, not a fallback after repository
preparation fails. Never automatically create an ancestor index alongside child
indexes. Inventory both scopes if already present; route to an explicitly chosen
scope and expose overlap. Validate supported upstream non-Git indexing and
exclusion behavior before implementing this mode. It also needs non-Git locking.

### Worktrees

- Keep one local database per working tree, not per Git common directory or branch.
  Dirty files differ even when HEAD matches. Readiness, locks and sizes are per tree.
- Group related trees using Git common-directory identity for display. Use each
  tree's absolute Git directory for existing initialization locks.
- Do not automatically initialize every entry in `git worktree list`.
- Do not share databases using symlinks. Seed copying is an optional later
  optimization, contingent on compatible config/version, a consistent SQLite
  snapshot, synchronization to the target tree, and target readiness verification.
- Do not couple index erasure to `git worktree prune/remove`. Never delete a
  worktree as cache cleanup. Stale inventory removal should initially remove only
  registrations, not data. Erasure should suppress automatic recreation until an
  explicit sync/init; its persistence scope needs a defined configuration policy.

### Safe erasure boundary

Do not implement erase as recursive removal or a blind `uninit --force` wrapper.
Resolve and display the exact local root; refuse symlink/ancestor targets. Drain
owned operations and establish that the MCP watcher and other index owners have
released it. A checkout flock alone cannot establish that. If the integration
cannot coordinate all writers/readers, fail with shutdown instructions. Preserve
project configuration and Git hooks unless uninstall was separately requested.
Do not erase another session's locks. A concurrent-new-owner race must be covered
before claiming in-session deletion is safe.

## Prior art

https://pi.dev/packages/@henryqw/pi-codegraph?name=codegraph (read 2026-10-24)
describes v0.7.3: per-worktree databases, repository consent, compatible seed
selection, locked copy then sync, shared watcher lifecycle, and visible setup
state. It does not describe multi-repository parent routing. Its own MCP/tool
registration differs from ours; do not install it alongside ours or duplicate its
server ownership. Review its source before adopting seed-copy implementation;
the package page is descriptive evidence, not proof of implementation behavior.

## Suggested implementation sequence and acceptance checks

1. Per-project coordination and bounded discovery: two independent repositories,
   non-Git parent, relative/absolute/nested paths, linked worktrees, canonical
   deduplication, ambiguity, and A-fails/B-succeeds routing.
2. Status and commands: missing/partial indexes, WAL-inclusive byte accounting,
   targeted cancellation, and batch per-project results. Run actual MCP before
   child initialization and prove query isolation using distinct sentinel symbols.
3. Workspace opt-in: prove no startup mutation in a non-Git parent; explicit
   creation works and scope cannot silently switch to an ancestor or child index.
4. Erase only after lifecycle coordination: live watcher, another session,
   concurrent queries/reinitialization, symlink refusal, configuration preservation,
   and no automatic recreation. If this cannot be proven, ship refusal rather than
   an unsafe destructive command.

Before implementation, read the pinned Pi extension/MCP documentation. Existing
CLI/MCP behavioral tests should remain regression coverage; new behavior needs
both deterministic boundary scenarios and actual stdio MCP checks.
