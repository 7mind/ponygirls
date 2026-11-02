# Manure confined filesystem primitives

**Not a server or durable artifact store. Do not activate storage with this module.**
This slice implements Linux descriptor primitives needed by `manure/CONTRACT.md`
§§6.2–6.3/6.6. It implements neither PostgreSQL metadata nor the complete
publish/ordering/recovery state machine. Successful fsync is not a power-loss test.

## Explicit native boundary

Inject `PosixNative` into `ConfinedDirectory.open(existingRoot, bridge)`. Select
`PosixNative.shared(absoluteLibraryPath)` on the JVM or `PosixNative.linked()` for
the statically linked native executable **at the entrypoint**. There is no ambient
library lookup, public-JDK provider gate, shared/static fallback, pathname-prefix
fallback, reflection or global descriptor/claim registry. A missing native runtime
prerequisite is a failure, not a request to use a weaker backend.

| Primitive | Boundary |
|---|---|
| Root and child traversal | Native fd-relative no-follow opens; every root component must be an existing directory, with no symlink aliases. |
| Physical identity | Native `fstat` dev/ino. Every new directory operation reopens the configured root no-follow, compares identity, then operates through the original pinned fd. |
| Root ownership | Automatically acquired on open, before payload effects: Linux abstract AF_UNIX bind, `manure-` + SHA256(`unsigned-dev:unsigned-ino`). Same physical inode after a rename contends, including with Python. **Scoped to the current Linux network namespace**, not cross-namespace exclusivity. No lockfile/unlink/PID fallback. |
| Directory creation | `mkdirat`, mode 0700. Parents must exist. |
| New regular files | Exclusive create, mode 0600, pinned handle with positional read/write, size and exact ftruncate (shrink/extend). |
| Existing regular files | Native O_PATH pin and type check **before any IO open**, then reopen the pinned fd through trusted procfs and verify final identity/type. Scala access is explicit `ExistingFileAccess.ReadOnly` or `ReadWrite` (no default). FIFO/device rejection must not open them for IO. |
| Durability primitives | Native file/directory fsync and entry rename. POSIX replacement semantics, not no-replace or publish commit. Callers still owe complete ordering and metadata transactions. |
| Cleanup | Native raw-byte enumeration, no-follow kind/open and unlink/rmdir; finite explicit inclusive entry/depth budgets, iterative owned-fd traversal and aggregate raw-name reservation against the entry budget. Symlinks are unlinked, never descended. Failures may leave partial cleanup. |
| Errors | Errno maps to stable `IOException` subtypes and fixed labels, never user paths, payload contents or native strerror. Close errors propagate. |

### Runtime/trust assumptions

Linux with the required syscalls, abstract sockets, and a trusted procfs fd-reopen
facility is required. The existing-file bridge deliberately uses procfs only to
reopen an already pinned, verified regular inode; it is not an absolute payload-path
fallback. The mount/process namespace and procfs must not be controlled by an
attacker able to replace that facility. Native code verifies the procfs boundary;
absence or failed validation must fail closed. The adapter is not a sandbox against
a same-UID actor moving authorized inodes elsewhere, making hardlinks or mutating
entries concurrently. Structural races can fail, but cannot redirect an operation
through a symlink. Authority follows the opened inode, not a revocable lexical tree.

`RelativeName` accepts nonempty literal Unicode components, rejecting empty, dot,
dot-dot, slash/backslash, NUL and malformed surrogate sequences. There is no URL
decoding, Unicode normalization or reserved-name/manifest policy. Roots require a UTF-8 filesystem filename charset (`sun.jnu.encoding`), must use
the default filesystem and round-trip exactly through their Unicode representation;
a raw invalid-UTF8 UnixPath must not silently select a U+FFFD-named sibling.
Cleanup, unlike the string API, keeps `readdir` names as raw bytes throughout, so
invalid-UTF8 children can be removed without lossy conversion. Root dot components
are rejected before any normalization.

### Handle lifetime

Root operations are serialized. File operations and close are serialized per file.
File handles remain usable after unlink, name replacement and parent/root rename;
no file operation resolves the payload name again. **Root close throws
`OpenFileHandles` while any child handle remains open**, retaining both the pinned
root fd and kernel claim. Close the files and retry root close. This refusal is not
a closed state. No new root can acquire ownership while writable children remain.

Once an actual close starts, the descriptor is consumed exactly once even if Linux
reports a close error: never retry a potentially reused fd. File ownership is released
only after that close attempt completes; root close attempts both its descriptors,
propagates errors (including suppressed errors), and cannot subsequently use them.
Repeated successful/consumed closes are idempotent. Open failures and intermediate
traversal close failures clean up owned descriptors without unsafe unlink-by-name.

## Identical JVM/native behavior contracts

`FilesystemBehavior` is a plain Scala **test-scope** scenario registry with no MUnit
calls. `ConfinedDirectorySuite` registers those scenarios with MUnit on the JVM;
`FilesystemCapabilityProbe` executes the exact same scenarios in a standalone JVM
or actual static native process. The probe exits **0** only after every scenario
passes; there is no old `REFUSED`/exit-2 gate. It exposes no server routes and uses
synthetic temporary storage (plus read-only `/dev/null` type rejection).

The 26 active, specified/regression-origin scenarios cover literal Unicode and
malformed-input policy, IO/EOF/ranges/size/truncate, fsync/mkdir/rename, safe existing read/write
and readonly handles, symlink roots/ancestors/parents/leaves, root replacement,
pinned file lifetime, no release on failed root close, raw invalid-UTF8 cleanup and
root rejection, exact/exceeded cleanup bounds and a 1500-level tree, close idempotence, sanitized errors,
actual FIFO/device rejection, cross-process contention and forced-death release,
and two-direction Python-stdlib claim interoperability through inode rename.
Special-file tests execute in killable children with 15-second deadlines; readiness
output and process waits are bounded. These are controlled real-OS
**Behavioral-Active × Blackbox/Effectual × Good-Communication** contracts, not fake
OS race simulations, exhaustive concurrent-race tests or complete storage recovery
tests. Pure name vectors are BA. No business-logic consumer exists to dual-test;
add a hand-written dummy and shared repository tests when that application seam exists.

Run inside the pinned backend shell, with Python 3, coreutils `mkfifo`, trusted
procfs and `/dev/null` available. MUnit requires exactly one explicit environment
boundary: `MANURE_POSIX_LIBRARY=/absolute/path/libmanure_posix.so`. The standalone
probe requires loader arguments (never environment precedence):

```sh
# CP is the exported manureStorage/Test/fullClasspath, including Java + test classes.
MANURE_POSIX_LIBRARY=/absolute/libmanure_posix.so \
  java --enable-native-access=ALL-UNNAMED -cp "$CP" \
  org.junit.runner.JUnitCore manure.storage.ConfinedDirectorySuite
java --enable-native-access=ALL-UNNAMED -cp "$CP" \
  manure.storage.FilesystemCapabilityProbe --shared /absolute/libmanure_posix.so
/path/to/actual-static-manure-filesystem-probe --linked
```

Internal `--try-root`, `--hold-root` and `--reject-existing` suffixes are only
subprocess controls for parent-owned test fixtures. Shared JVM children use the
current Java home/classpath and explicit shared library; native children execute
the same actual executable with `--linked`. The Python leg uses only stdlib kernel
claims, not the existing application's metadata or recovery machinery.

## Local execution receipt

On 2026-11-02, the dedicated Scala worktree compiled the real sibling Java ABI plus
these Scala sources, including iterative cleanup and size/truncate inside `nix develop .#chronicle` with cached pinned Scala 3.9.0,
MUnit 1.3.6 and Graal JDK 25.0.4.1.1. Against a strict-built shared library compiled from the C writer's actual sources, **26/26 MUnit cases and the identical 26 standalone JVM scenarios passed**,
zero failures/skips; standalone exit 0. The raw invalid-UTF8 root regression was
first reproduced as **23 cases / 1 failure**, then fixed with the pre-open exact
Path roundtrip check. The 1500-level cleanup regression was first reproduced as
**25 cases / 1 StackOverflowError**, then passed with iterative fd ownership;
there is no recursion or catch-and-ignore workaround. An earlier child-readiness assertion failed on JVM warning
output; readiness now scans bounded output for its exact marker. Neither failure
was skipped or weakened.

Ignored `manure/server/target/posix-scala/` retains compiler/classpath, commands,
JVM logs and the fail-first log. These local JVM observations do **not** establish
static-native acceptance, integrated Nix packaging, power-cut consistency or live
deployment. The integration worktree owns the actual native/linkage receipt and
artifact/source binding. Previous public-JDK static SDS refusal is historical
baseline evidence, not a blocker imposed on this explicit POSIX implementation.
