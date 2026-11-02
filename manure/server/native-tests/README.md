# Linux JNI primitive checks

Run from the repository root with the pinned development JDK/compiler:

```sh
JAVA_HOME=/path/to/pinned/jdk CC=/path/to/pinned/gcc \
  manure/server/native-tests/run.sh
JAVA_HOME=/path/to/pinned/jdk CC=/path/to/pinned/gcc \
  SANITIZE=address,undefined manure/server/native-tests/run.sh
```

The runner compiles with strict warnings, checks the checked-in `javac -h`
header, and runs the JVM with `-Xcheck:jni`. It creates and removes only owned
temporary payloads. `mkfifo`, `mknod`, Python 3, and a genuine `/proc` are
required tools/prerequisites; creating an owned device node is explicitly
skipped if the environment denies `mknod`. No existing device is opened.
ASan preloading is scoped to JVM processes. LeakSanitizer is disabled because
of JVM process-lifetime allocations; the test separately checks fd counts
on repeated error paths. Do not mix incompatible host/Nix sanitizer runtimes.

Taxonomy: Behavioral-Active / Blackbox / Good-Communication; specified-origin.
These tests exercise exact Linux/JNI/kernel semantics rather than business
logic, so a simulated kernel would not replace this production-adapter leg.
Higher-level dual tests belong at the Scala filesystem interface.

The tests cover raw invalid-UTF8 and Unicode names, no-follow traversal,
component/NUL/range validation, existing regular-file IO, nonblocking FIFO
rejection, optional owned-device rejection, large positional offsets,
read-only failures, fsync/rename/unlink, pinned inode lifetime, bounded
independent directory enumeration, closed descriptors, cleanup on failure,
per-instance and cross-process claim contention, Python claim-namespace
interoperability, and SIGKILL claim release. They do **not** establish the
publication/recovery state machine, physical power-loss durability, or the
actual Graal static-musl executable. The JVM runner uses `--shared`; static
runtime acceptance is separate.

## Boundary assumptions

- `openFile` first pins with `O_PATH|O_NOFOLLOW`, stats that pin and rejects
  every nonregular inode **before** any IO open. It reopens only the pinned
  inode through `/proc/self/fd`, never the original payload pathname, and
  verifies final regular type and dev/ino. `/proc` and the opened fd directory
  must report `PROC_SUPER_MAGIC`. Missing/untrusted procfs fails explicitly.
  The process must run in a trusted Linux procfs/mount namespace;
  privileged mount manipulation and malicious concurrent closes of its own
  fds are outside this boundary's threat model.
- All fd arguments must be nonnegative (in particular, callers cannot pass
  `AT_FDCWD`). The owning domain must serialize close/use and prevent stale
  integer reuse. Linux close is attempted only once, including on EINTR.
- `entries` opens `.` relative to the directory as a new file description,
  not `dup`, to avoid sharing iteration offsets. Too many entries is
  `EOVERFLOW`, never truncated success. Concurrent mutation is not a snapshot.
- Claims add one leading abstract-namespace NUL to the supplied nonempty
  NUL-free name. Scala computes `manure-` + SHA256 of unsigned decimal
  `dev:ino`, matching Python. Claims are kernel lifetime and network-namespace
  scoped. There is no PID/lock file, unlink, filesystem fallback or registry.
- Native failures contain only errno and a fixed method label. Failed writes
  or other effectful primitives may already have made partial progress.
