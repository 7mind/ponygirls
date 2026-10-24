# Pi Codegraph preparation

This extension prepares **one checkout-local `.codegraph` index per Git working
tree**, in the background from `session_start`. The factory registers hooks and
commands only; startup never awaits indexing. It registers **no tools or MCP
servers**. Existing Home Manager `codegraph --mcp` configuration, tool names
(`mcp__codegraph__…`), and watcher remain authoritative.

## Behavior

- Resolve the Git checkout root, including linked worktrees; non-Git folders skip.
  Never initialize arbitrary working directories or borrow an ancestor index.
- Missing local database: `codegraph init ROOT --yes`, then full JSON status.
- Existing index: inspect full `status ROOT --json`; rebuild incomplete, stale,
  or empty indexes with `index ROOT --quiet`, otherwise `sync ROOT`.
- Verify status after every mutation. Ready requires local project/index paths,
  complete state, no reindex recommendation, nonzero files and symbols, no pending
  changes/references, missing symbols, or recorded parse errors. Empty/no-symbol
  repositories therefore remain visibly **not ready**, even if indexing succeeded.
- `/cg-status` checks health and shows bounded diagnostics; it does not bootstrap.
  `/cg-sync` prepares or synchronizes; `/cg-reindex` explicitly runs idempotent init,
  a full rebuild, and verification. This can recover a schemaless SQLite database
  after interrupted initialization without requiring status to work first.
  Foreign/non-SQLite database files are refused, never deleted or replaced.
- One operation per extension session. Commands report busy rather than queue
  another write. `/cg-cancel` stops only extension-owned work, **not** the MCP
  watcher. Shutdown/reload cancels processes and invalidates UI publication.
- Codegraph tool calls wait for owned preparation (not session startup). Failed or
  cancelled preparation blocks those calls with recovery instructions; unrelated
  tools remain usable. After verified preparation, an omitted `projectPath` on the
  existing `mcp__codegraph__codegraph_explore` call becomes the current session's
  working directory. Explicit paths are preserved, but still wait for and depend
  on local preparation: readiness is session-local, not tracked per requested
  project. Skipped/disabled preparation does not gate the MCP server or inject paths.

The bottom-left editor-border badge shows extension-owned setup/sync and Pi
Codegraph query activity, including parallel queries. `ready` means **the last
completed local index check**, not continuous freshness or MCP connectivity. The
independent MCP watcher is not monitored. `wait/run` includes time waiting for
another session's writer lock; there is no lock-wait timeout, and `/cg-cancel`
remains available. UI updates use no polling timers.

## Configuration and side effects

- `PONYGIRLS_CODEGRAPH_BIN`: executable path; default `codegraph`.
- `PONYGIRLS_CODEGRAPH_FLOCK_BIN`: executable path; default `flock`. The deployment
  pins the cross-platform `pkgs.flock` executable. Git and Node must be available.
- `SMIND_CODEGRAPH_DISABLED=1`: skip **automatic** preparation entirely, including
  Git/CLI probes. Explicit `/cg-*` commands still work.
- Custom nonempty `CODEGRAPH_DIR` values other than `.codegraph` are rejected before
  mutation so the extension cannot silently disagree with the MCP environment.
  Symlink index directories/databases are refused. Native Windows is unsupported;
  process-group cleanup and `flock` require a POSIX environment.

The extension itself does not edit ignore rules or Git hooks. Pinned Codegraph
**1.6.2** creates/upgrades its own `.codegraph/.gitignore`; even `status` may repair
that file and database indexes/WAL. The checkout root `.gitignore` remains untouched.
To hide the entire directory, add `.codegraph/` to your own ignore rules; the
extension does not do this automatically.

In 1.6.2, `init --yes` always indexes and normally auto-installs Git sync hooks if
watching is disabled. To prevent this unwanted side effect, **only the init child**
runs with `CODEGRAPH_NO_WATCH=0` and `CODEGRAPH_FORCE_WATCH=1`. Init itself does not
start a watcher; this suppresses its fallback-hook offer. It does not change the
independent MCP server's watcher policy. All extension CLI children disable
telemetry. These behaviors are version-specific and covered by local CLI tests.

Each CLI command is wrapped in a checkout-specific OS `flock` in
`git rev-parse --absolute-git-dir`/`ponygirls-codegraph.lock`. This closes the fresh
init schema-creation race between extension sessions, without stale-PID lock
recovery. Linked worktrees have separate Git directories and locks. The CLI still
owns its `codegraph.lock`, MCP `writer.pid`, and rebuild coordination; this extension
never deletes those locks. Uncoordinated third-party `init` invocations do not
participate in the extension lock. An independent watcher may change files or
contend with a command; failures and failed verification are visible, not retried
silently. Each child is a process-group leader; cancellation sends TERM followed
by KILL after 700 ms, including resistant descendants. Output tails are bounded
to 32 KiB per stream, with UI diagnostics bounded to 4 KiB; no log files are kept.

## MCP started before initialization

Actual 1.6.2 stdio JSON-RPC reproduction established two cases:

- A fresh sibling linked worktree exposes `codegraph_explore` before local init,
  then discovers its newly initialized index on a later call without restarting.
  Its default query finds worktree-only code and does not find main-checkout-only
  code. This matches `dist/mcp/engine.js`'s deferred/retry initialization.
- A nested independent Git checkout can inherit an already-open ancestor default.
  Local initialization does **not** replace that default. The ancestor watcher
  may index the child too, masking this: implicit child queries returned paths
  relative to the ancestor, and implicit queries returned ancestor-only symbols.

The extension therefore supplies `ctx.cwd` for omitted explore `projectPath`
**after its own successful verification**. The existing MCP server resolves that
path to the correct local index; explicit cross-project paths remain unchanged.
No reconnect, replacement server, or tool renaming is needed. The automated
stdio regression starts MCP before nested-checkout bootstrap and verifies local
implicit queries and preserved explicit ancestor queries through actual Pi hooks.
Rebuilds retain the CLI's existing MCP daemon/rebuild coordination.

## Tests

From the repository root (Node 24; no Bun/npm install/network required):

```bash
PI_CODEGRAPH_SDK_ROOT=/path/to/pi-monorepo \
PONYGIRLS_CODEGRAPH_BIN=/path/to/codegraph \
PONYGIRLS_CODEGRAPH_FLOCK_BIN=/path/to/flock \
node --experimental-strip-types --test nix/pkg/pi-extensions/ponygirls-codegraph/*.test.ts
```

Without these variables, deterministic dummy tests and process/Git tests still
run; SDK and real CLI cases explicitly skip. Shared public behavioral scenarios
run against a hand-written in-memory boundary and the actual local CLI adapter
(Behavioral-Active / Blackbox-Atomic and Blackbox-GoodCommunication). Additional
checks cover status health, failed commands, cancellation, resistant descendant
cleanup, stale-runtime publication, non-Git directories, worktrees, symlinks,
custom index rejection, concurrent fresh sessions, interrupted schema recovery,
root-ignore/hook preservation, and actual Pi-loader hook/command registration.
The loader fixture confirms startup returns while the CLI is still running,
disabled automatic mode performs no CLI work, manual commands remain usable,
query gating, parallel query accounting, and shutdown cleanup.

The ancestor-default regression first failed in both fixtures before the fix:
Pi's hook left `projectPath` undefined, and actual MCP returned
`nested-child/example.ts` rather than checkout-local `example.ts`. The fix pins
only omitted explore paths after readiness, addressing the observed resolution
error rather than changing MCP registration.

Strict type checking uses `tsc -p nix/pkg/pi-extensions/ponygirls-codegraph` with
`node_modules/@earendil-works/pi-coding-agent` pointing to the pinned SDK and
`node_modules/@types/node` to that SDK's Node types. These are local/build-time
symlinks, not committed dependencies. The implementation imports the SDK only as
types. The initial specified test failed before implementation with the expected
missing `runtime.ts` module; the explicit-reindex recovery regression test first
failed because pre-rebuild status was unreadable, then passed after removing that
precondition.
