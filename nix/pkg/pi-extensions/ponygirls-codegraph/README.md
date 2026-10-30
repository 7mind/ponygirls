# Pi Codegraph projects

Prepare independent checkout/worktree indexes and route the existing Codegraph
MCP tools by project. The extension registers **no tools or MCP servers**: Home
Manager's `codegraph --mcp` server, `mcp__codegraph__…` names and watcher remain
authoritative. Pinned Codegraph **1.6.2** already supports multiple indexes through
`projectPath`; this extension supplies discovery, selection and per-project gates.

## Startup and query routing

- Inside Git, prepare the containing checkout, including linked worktrees.
- Outside Git, discover immediate child checkouts (`.git` directories or files).
  Do not recurse through arbitrary workspace trees or follow directory symlinks.
  Explicit deeper paths are supported.
- A containing opted-in workspace, or a sole discovered checkout, is the default.
  With several candidates and no selection, do not initialize all of them or guess:
  use `/cg use PATH`, or supply `projectPath` on a tool call.
- A targeted query prepares a missing checkout index on demand. It waits only for
  that project's work, not another checkout's initialization. Failed/cancelled
  preparation blocks that project until explicit sync/reindex; unrelated projects
  remain usable. Query paths are resolved relative to Pi's cwd and forwarded as
  verified canonical roots, preventing accidental ancestor-index queries.
- Explicit cross-project queries do not change the selected default. Both explicit
  and implicit targets are resolved again before reusing readiness. Changed scope
  identities invalidate old readiness; changed busy entries require cancellation.
- Subagent calls (ponygirls-subagents) skip `tool_call`, so they are prepared
  through its delegated-call channel instead, with the same per-project
  preparation and canonical `projectPath`. A subagent's relative `projectPath`
  resolves against its working directory; an omitted one means that directory
  (its own worktree), or the session default when it works in Pi's cwd.
  Preparing a large checkout can take longer than the subagent's 15-minute
  tool wait; a retry joins the preparation still running.
- Before an agent run, an undisplayed context message supplies project inventory,
  selection, and routing instructions. Its size is bounded and omitted projects
  are counted. This is independent graph selection, **not** merged search or
  cross-repository dependency analysis.

Discovery is filesystem/Git inspection only. An unmarked `.codegraph` in a non-Git
parent is not permission for this extension to create/use a workspace-wide index.
The separately configured MCP server can still open its own default; our routed
calls do not silently inherit it. Disabling extension routing also disables that
guard, not the MCP server itself.

## Commands

```text
/cg help
/cg discover [PATH]
/cg use PATH
/cg status [PATH | --all]
/cg sync [PATH | --all]
/cg reindex [PATH]
/cg cancel [PATH | --all]
/cg init --workspace PATH
/cg erase PATH
```

Type `/cg ` to see subcommands with argument syntax and descriptions; type a
prefix (such as `/cg sy`) to filter, then Tab to complete. Flag suggestions include
`--all` where supported and the required `init --workspace` opt-in. `/cg help`
prints the full reference. The former `/cg-*` aliases have been removed; use
`/cg status`, `/cg sync`, `/cg reindex`, and `/cg cancel` instead.

Every path-taking command accepts absolute paths or paths relative
to Pi's cwd: with Pi started in `/work/projects`, `/cg use example-app` and
`/cg use ./example-app` both select `/work/projects/example-app`. `../example-app` and `.`
also work. Selection does not change the base directory for subsequent paths;
bare names are filesystem paths, not global repository-name lookups.
An entire remaining argument is one path, so spaces work literally or within
single/double quotes. Use `-- PATH` for a path beginning with `--`. Unknown options
fail rather than being ignored.

- `discover` replaces the inventory with the containing project or shallow
  candidates at PATH. Removed/changed entries are shut down, not deleted from disk;
  invalid selections are cleared. Explicit queries can add other projects again.
- `use` selects a scope for this session without indexing it. Selection is not
  persisted across sessions; workspace opt-in is persisted separately.
- `status` probes health without bootstrapping. Without a target it checks the
  default, or all candidates when no default exists. Reports include last-attempt
  time/result, current operation, canonical root, Git common directory, database
  bytes and total regular-file bytes under `.codegraph`, including WAL/SHM. These
  are logical file sizes, not allocated blocks. Canonical roots are deduplicated;
  symlinks are not followed and incomplete measurements are explicitly partial.
  A targeted report shows that scope; otherwise the inventory and total are shown.
- `sync --all` processes the current inventory sequentially, reports individual
  failures/busy skips, and continues other roots. One operation per project; no
  implicit queue of another write behind an already busy project.
- `sync`, `reindex` and workspace `init` run in the background so cancellation
  remains available. `cancel --all` also invalidates pending discovery/preparation
  and prevents later members of a batch from starting. Cancellation/shutdown stop
  extension-owned process groups, **not** independently managed MCP watchers.
- Errors and non-UI command reports go to stderr, never JSON/RPC protocol stdout.

The padded `CG` badge uses the theme's `selectedBg` background, evaluated during
rendering. It shows setup/sync state and parallel query count. `ready` is the last
completed verification, not continuous freshness or proof of MCP connectivity.
When the border is too narrow, the compact form `cg` shows a state glyph instead:
◇ ready (success colour), ⚙ working or querying, ✖ error, ◇ other idle phases (muted).
The system theme may choose a terminal-default background; colored themes supply
an explicit background. There are no animation/polling timers.

## Workspace-wide opt-in

`/cg init --workspace /absolute/parent` creates a local
`.pi/codegraph-workspace.json` marker containing `{"version":1}`, prepares the
parent's `.codegraph`, and selects it. Ordinary non-Git startup does not create
this marker or index. Filesystem root, home-directory, Git-contained and symlink
metadata targets are refused. Existing malformed marker/config/database data is
not overwritten. Concurrent opt-in publishes a complete marker atomically.

This is an **alternative explicit scope**, not a fallback after repository failure.
It indexes child-repository source, skipping `.git` and `.codegraph` internals;
child indexes are not indexing boundaries. Overlap with separately indexed child
checkouts is therefore possible and visible in inventory. Explicit child paths
still select the child's own index. Git scopes take precedence over ancestor
workspace markers. Without Git, the nearest opted-in workspace marker wins.

Remove the marker while sessions are stopped to revoke persistent workspace
opt-in; that does not delete index files. `SMIND_CODEGRAPH_DISABLED=1` is the
separate switch for disabling automatic extension preparation/routing.

## Worktrees and writer ownership

Each working tree owns `.codegraph/codegraph.db`, readiness and its own extension
lock. Git common-directory identity is reported to show which trees belong to one
repository, **not** used as an index key. Equal HEADs do not imply equal dirty
files. There is no shared/symlinked database, automatic indexing of all entries in
`git worktree list`, seed copying, worktree removal, or pruning.

Each CLI child takes OS `flock` on the absolute Git directory's
`ponygirls-codegraph.lock`; non-Git workspaces use
`.pi/codegraph-workspace.lock`. Locks are outside the index to serialize fresh
schema creation. `pkgs.flock` is pinned cross-platform by the deployment. The CLI
still owns its `codegraph.lock`, MCP `writer.pid`, and rebuild coordination; this
extension never deletes them. Third-party CLI calls do not participate in our
flock. There is no lock-wait timeout; `/cg cancel` remains available. Independent
watchers may contend with commands; failures remain visible, without silent retry.

## Erasure: deliberately offline

`/cg erase PATH` currently **refuses online deletion**, displays the exact canonical
SQLite file paths, and changes nothing. Pinned upstream has no complete reader
admission/drain protocol: other MCP defaults, cached cross-project readers,
workers or CLI jobs can retain/reopen an index even after its daemon stops.
Checking PID files or taking a writer lock cannot establish global quiescence.
`codegraph uninit` is unsuitable: it removes hooks and can resolve an explicitly
requested missing child index to an initialized ancestor.

For index-only cleanup, first stop **all** relevant Pi/MCP clients, including
sessions querying this project from elsewhere, and indexing/sync jobs. Stop
remaining daemons with `codegraph daemon` in an external terminal. Keep clients
stopped while removing only the exact checkout-local `codegraph.db`,
`codegraph.db-wal`, and `codegraph.db-shm` files. Preserve configuration, hooks,
locks and other data; do not use an ancestor-resolving removal command. Automatic
preparation recreates missing indexes on restart, so disable it first when removal
must persist. No deletion or worktree pruning is performed by this extension.

## Index verification and configuration

Missing local databases use `init ROOT --yes`; existing indexes receive full JSON
status, then full `index ROOT --quiet` for incomplete/stale/empty graphs or `sync
ROOT` otherwise. Every mutation is followed by verification. Ready requires exact
local project/index paths, complete state, no rebuild recommendation, nonzero files
and symbols, and no pending changes/references or missing symbols. Files with
parse errors are reported as warnings, not a readiness failure.
A checkout with nothing indexable (complete, consistent index with zero files and
symbols) is the non-error state `empty`: queries remain unavailable, the badge shows
`CG: empty`, and one info notice says nothing is indexed yet. Any other unready
result (symbols without files, pending work, incomplete state) remains an error.
Failure notices are one line; the full detail (CLI output, status JSON) is shown by
`/cg status`, which also keeps the last failure until a later check succeeds.
Explicit `reindex` runs
idempotent init and full rebuild without depending on readable pre-rebuild status,
allowing recovery after interrupted schema creation. Foreign database files are
refused, never replaced.

- `PONYGIRLS_CODEGRAPH_BIN`: executable path; default `codegraph`.
- `PONYGIRLS_CODEGRAPH_FLOCK_BIN`: executable path; default `flock`.
- `SMIND_CODEGRAPH_DISABLED=1`: no automatic Git/CLI probes or query routing.
  Explicit `/cg` operations can activate discovery/preparation. Help and cancel
  do not independently bootstrap indexes.
- Custom nonempty `CODEGRAPH_DIR` other than `.codegraph` is refused to prevent
  disagreement with MCP. Symlink index directories/databases are refused.
- CLI children disable telemetry. Native Windows is unsupported; process groups
  and `flock` require POSIX. Output tails are bounded to 32 KiB per stream and
  notices to 16 KiB. No extension log files are kept.

Upstream 1.6.2 may repair index metadata, WAL or `.codegraph/.gitignore` even during
`status`. The extension does not edit root ignore rules or Git hooks. Add
`.codegraph/` to your own ignore rules if desired. For `init` children only,
`CODEGRAPH_NO_WATCH=0` and `CODEGRAPH_FORCE_WATCH=1` suppress upstream's fallback
Git-hook installation; init itself does not start a watcher. MCP watcher policy
is unchanged. Shutdown/reload invalidates UI publication and cancels owned work.

## Prior art and tests

[@henryqw/pi-codegraph](https://pi.dev/packages/@henryqw/pi-codegraph?name=codegraph)
v0.7.3 describes repository consent, independent worktree indexes, compatible
seed copying, visible status and watcher lifecycle. We retain our existing MCP
ownership/tool names and do not duplicate that package's server or adopt its seed
copying. The package page was reviewed; it is not an implementation dependency.

Node 24, pinned SDK and actual CLI/MCP checks (no npm install/network needed):

```bash
PI_CODEGRAPH_SDK_ROOT=/path/to/pi-monorepo \
PONYGIRLS_CODEGRAPH_BIN=/path/to/codegraph \
PONYGIRLS_CODEGRAPH_FLOCK_BIN=/path/to/flock \
node --test nix/pkg/pi-extensions/ponygirls-codegraph/*.test.ts
```

Without those variables, external-adapter checks explicitly skip. Shared behavioral
contracts exercise memory and real CLI/catalog adapters. Additional tests cover
non-Git parent routing and ambiguous defaults through actual stdio MCP started
before initialization, canonical aliases, linked-worktree dirty-source isolation,
concurrent workspace creation, data-directory exclusions, WAL-inclusive sizes,
per-target failure/cancellation, batch continuation, discovery cancellation,
recovery after failed activation, inventory/identity changes, schema recovery,
foreign-data preservation, resistant descendant cleanup, SDK loader lifecycle,
protocol stdout and theme invalidation. Strict `tsc -p` uses local/build-time
`node_modules` links to the pinned SDK and its Node types, as in the flake check.

Real-PTY smoke checks use Pi 1.4.0, private tmux 3.7c, no credentials or model
requests, the actual extension/CLI, and 120x40 plus 80x24 screens: status totals,
selection, sync, workspace opt-in, erase refusal, colored badge and clean exit.
MCP routing is verified separately by the stdio tests, not by that offline UI run.
