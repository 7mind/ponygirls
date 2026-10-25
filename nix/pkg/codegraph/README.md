# Namespace-safe Linux ownership

The pinned upstream uses numeric PID liveness for shared-checkout ownership.
A PID from the host is not meaningful inside yolo's PID namespace (and can
identify an unrelated process). This package patches ownership, not isolation.

## Protocol

On Linux, permanent `*.flock` sidecars hold genuine OS `flock(2)` locks.
The absolute util-linux `flock` executable locks inherited FD 3; the Node
parent retains the shared open-file-description until it closes its FD or
exits. No native addon, background helper, timeout-based stealing, or PATH
lookup is involved. Missing/broken flock fails closed.

Writer, rebuild, database FileLock, and daemon ownership have separate kernel
fences. Metadata carries `lockProtocol: "flock-v1"` and a boot-ID/PID-namespace
identity. Numeric PID equality does not confer ownership. Recognized crashed
writer/database owners can be recovered under the kernel fence. A recognized
crashed daemon can be elected across namespaces under its daemon fence;
startup must acquire the writer fence before touching sockets/database.
Directory removal also holds all four ownership fences, preserving the stable
sidecar inodes and ownership records. Uninit/reset refuses another live owner.

Only namespace-qualified local daemon records may be PID-probed or signalled.
Foreign/unknown client peers are tracked by socket closure, never PID liveness;
they cannot be swept or declared idle-dead through an unrelated local PID.
Local peers still benefit from PID sweeping. Host PIDs passed through a client
hello are not treated as namespace-qualified Linux identity.

## Required migration / limitations

**Do not mix patched and unpatched clients sharing an index.** Old code ignores
kernel sidecars and may steal even a new-format record. Upgrade **all** clients,
daemons, hooks, and indexing jobs using the checkout before resuming work.

An existing legacy/malformed ownership record fails closed, even if its PID
looks dead. To migrate: stop **all** old and new CodeGraph processes sharing
that checkout, in every namespace; while fully offline, remove **only the exact
legacy record named by the error**, then retry. Possible records are
`.codegraph/{writer.pid,rebuild.pid,daemon.pid,codegraph.lock}` (or the configured
CodeGraph data directory). Repeat only for another explicitly identified legacy
record. Never remove `*.flock` sidecars; do not broadly delete the data directory.
`codegraph unlock` deliberately refuses automatic legacy migration.

A live foreign daemon cannot safely be signalled: stop it from its owning
namespace, then launch/reindex. Linux automatic old-version daemon replacement
is also refused: rewriting JSON cannot transfer an open-file-description lock.
Explicit verified same-namespace stop/rebuild remains supported. A free kernel
fence allows ordinary same-version daemon crash/relaunch across namespaces.
The Linux CLI wrapper defaults `CODEGRAPH_SOCKET_DIR` to
`$HOME/.cache/codegraph/sockets`. Long project paths and filesystems unable to
host Unix sockets use a per-user/canonical-project hashed socket there, instead
of namespace-private `/tmp`. Explicit overrides must be absolute and produce a
socket path of at most 100 UTF-8 bytes; invalid paths fail actionably rather than
silently falling back to private `/tmp`. Bind creates the directory with mode
0700 and refuses a public, foreign-owned, or symlink directory. Pure path
lookup/probing has no mkdir side effect. Direct module users without this env
retain upstream `/tmp` defaults.

The cache **must actually be shared**. Current yolo binds an existing
`$HOME/.cache`; create it on the host before launching yolo on a fresh machine.
An explicit socket-directory override is the caller's responsibility to bind
and pass (for example via yolo `--env`) into every participating namespace.
No PID/mount isolation is weakened.
Darwin retains the upstream non-Linux ownership mechanism; only derivation
evaluation, not Darwin runtime behavior, was tested.

## Tests and evidence

Run against a built package's `lib/codegraph/dist`:

```sh
CODEGRAPH_FLOCK=/absolute/path/to/flock node tests/flock-proof.cjs
node tests/ownership.cjs /absolute/path/to/dist
node tests/daemon-namespace.cjs /absolute/path/to/dist
node tests/socket-paths.cjs /absolute/path/to/dist
```

The Linux Nix `checkPhase` runs these tests after the actual upstream build.
The ownership suite starts independent Node contenders, rather than merely
asserting metadata. It includes retained-inode release, crash recovery,
record-deletion resistance, rebuild exclusion, and online removal refusal.
Daemon tests exercise the compiled modules: peer qualification, no PID probes/
signals/deletion for foreign/legacy records, current-protocol foreign recovery,
and a separate live contender.

Fail-first evidence against the installed unpatched 1.6.2 package: the initial
four ownership regressions all failed as expected: a live writer and FileLock
were stolen after their numeric PID became namespace-invisible; legacy writer
and database records were silently reclaimed instead of refusing migration.
The online removal regression also failed before its deletion fence was added
(`deleted live database`). Crash/relaunch and numeric PID-collision regressions
caught intermediate early-refusal/metadata-shortcut bugs before correction.
Long-path host/yolo MCP failed before shared socket addressing was added; the
three socket tests also failed first (private `/tmp`, no config validation, no
private binding preparation). All ten ownership, seven daemon, and three socket
tests pass in the patched Nix build; the inherited-FD flock proof also passes.

An optional real namespace/MCP integration test is retained (not run inside the
Nix build):

```sh
CODEGRAPH_TEST_ROOT=/absolute/yolo-bound/project \
CODEGRAPH_BIN=/absolute/package/bin/codegraph \
python3 tests/mcp-pid-namespace.py
```

Both short and deep bound project paths are supported by the packaged wrapper.
It creates its own tiny fixture under that bound project, starts a yolo daemon,
crashes the namespace root, relaunches in a fresh namespace, attaches a host MCP
proxy, and performs calls before/after repeated client sweeps. Success requires
no reaping or degraded fallback; failures retain fixture diagnostics. It waits
for all kernel fences to become free after the crash, then verifies a newer
ownership timestamp after relaunch. Namespace inode strings may be recycled
after namespace death; their equality only identifies simultaneously live
namespaces, not historical ownership incarnations. Set
`CODEGRAPH_KEEP_FIXTURE=1` to retain successful diagnostics too. It signals only
its own Popen handles, never recorded foreign daemon PIDs. Successful fixture
removal waits for kernel fences to become free.

Actual host/yolo MCP integration and the 39 Pi-extension regressions were also
verified by the parent task against the built package. No deployment is
performed by this change.
