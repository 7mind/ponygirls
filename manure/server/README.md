# Manure filesystem feasibility seam

**Not a server or durable artifact store. Do not activate storage with this module.**
This bounded slice evaluates the containment/durability requirements in
`manure/CONTRACT.md` §§6.2–6.3/6.6 and the current Python `storage.py` implementation.
It implements neither PostgreSQL metadata nor the publish/recovery state machine.

## Result

| Requirement | Result |
|---|---|
| Descriptor-relative no-follow root/child traversal | Implemented with `SecureDirectoryStream` (SDS); no pathname-prefix fallback. |
| New regular-file IO and file force | `CREATE_NEW`, `NOFOLLOW_LINKS`, mode 0600, retained `FileChannel`; offset reads/writes and `force(true)`. |
| Directory descriptor fsync | **Observed on pinned JVM:** SDS opens internal `.` with READ + NOFOLLOW; its `FileChannel.force(true)` produces successful `fsync` syscalls. No absolute-path reopen. This is provider-specific evidence, not a universal JDK/platform or power-loss guarantee. |
| Atomic rename | SDS `move`; observed `renameat`. Does not imply durable rename, no-replace semantics, or publication commit. |
| Delete/cleanup | Descriptor-relative unlink/rmdir; symlink entries unlinked, never traversed. Caller supplies positive entry/depth bounds, both inclusive (root counts as one). Failure may leave partial cleanup. |
| Root identity | Provider `fileKey` read from open descriptor; every new directory operation reopens each root component no-follow and compares before effects, then uses the original pinned descriptor. |
| Exclusive physical-root ownership | **Unsupported.** Pinning is not locking. Two handles can open the same physical root. No replaceable lockfile or in-process registry pretends to supply the existing kernel-lifetime `(dev, ino)` claim. |
| Descriptor-relative directory creation | **Unsupported:** no public SDS `mkdirat` operation. No check-then-`Files.createDirectory(path)` substitute. |
| Safe existing-file read/write open | **Unsupported:** no public channel `fstat` for atomic regular-file verification. A path stat before/after open would race; opening a substituted FIFO/device could block or cause side effects. Only newly created pinned handles expose IO. |
| Pinned static-musl native runtime | **Rejected before payload effects:** actual native executable returns `sun.nio.fs.UnixDirectoryStream`, not SDS. No native IO/rename/directory-force acceptance claimed. |

`requireDurableStore()` always throws `MissingPrimitive` listing mkdirat,
physical-root claim and existing-file type verification. Independently,
`checkProvider(anchor)` performs a read-only descriptor/fileKey preflight on that
filesystem's root; it does not create a payload root. The native probe stops here,
before even making synthetic test directories. Unsupported operations never fall
back to normalized paths, reflection, `/proc` aliases, JNI, or another backend.
The native-provider rejection is separate from the public-JDK API gaps above.

## Exact scope/invariants

- `RelativeName` admits nonempty literal components, rejecting empty names, dots,
  dot-dot, separators/backslashes and NUL. It does **not** decode URLs, normalize
  Unicode, or implement manifest/reserved-name policy. Root dot components are
  rejected without first normalizing them away. All root symlink ancestors are
  rejected, deliberately stricter than Python's startup canonicalization.
- Directory authority is the opened inode, not a revocable lexical subtree.
  Replacing the configured root cannot redirect a new operation to the replacement.
  A replacement *after* identity validation still cannot redirect the retained SDS.
  Existing file handles remain usable after unlink, renaming ancestors/root, or
  closing the directory handle; the caller must close them independently.
- This is not a sandbox against a same-UID actor moving authorized inodes elsewhere,
  making hardlinks, or mutating entries concurrently. Structural races can fail
  operations and leave partial effects, but symlinks are not followed. No exclusive
  ownership, crash-recovery semantics or transactional publication is claimed.
- `move` moves the entry itself, including a symlink; symlink rejection as publish
  policy belongs above this low-level operation. Destination replacement behavior is
  provider-specific. There is no racy existence check claiming no-replace behavior.
- Cleanup has finite explicit bounds, no retries through pathnames, no follow-links
  walk, and no durability ACK. Normal traversal closes intermediate SDS handles;
  files/channels are explicitly owned and closed. A provider returning a non-file
  channel after creation is rejected; the created entry is not unsafely unlinked
  by name during error handling.
- File force alone cannot acknowledge a chunk. Even successful directory force and
  rename cannot acknowledge publish: the metadata transaction, full-tree ordering,
  source/destination fsync and recovery/crash windows remain unimplemented.

## Tests and probe

`ConfinedDirectorySuite` contains 17 active behavioral tests. These are controlled
real-filesystem **Blackbox/Effectual × Good-Communication** cases (specified-origin),
not fake race simulations. They cover Unicode, positional IO/EOF, file/directory
force, symlink root/ancestors/leaves, root/ancestor replacement, pinned file lifetime,
rename, cleanup/link cycles, exact and exceeded cleanup bounds, closed handles,
preflight without writes, and explicit capability refusal. Pure path vectors are BA.
There is no business-logic consumer to dual-test here; an in-memory dummy would not
establish descriptor, race or durability semantics. Add dual tests when a storage
repository/application seam exists, not a simulated operating system.

The standalone **test-scope** `manure.storage.FilesystemCapabilityProbe` has no MUnit
calls or server routes. It uses the actual production seam and synthetic temporary
storage only, rejects all arguments, and cleans up without following links.

- JVM: `PASS` marker followed by `REFUSED` and exit **2** = demonstrated IO, full
  durable activation intentionally blocked.
- Current native: exception `MissingPrimitive: SecureDirectoryStream (provider
  returned sun.nio.fs.UnixDirectoryStream)`, exit **1**, before synthetic mkdir.
  This is a reproducible failing capability test, **not native acceptance**.
- An unexpected assertion/exception is not a successful refusal: inspect markers
  and the exact failure, not merely a nonzero exit status.

### Integrated reproduction

From the integrated root build, inside `nix develop .#chronicle`, compile/run all cases
and export the actual test classpath (the independent worktree does not own that build):

```sh
java $SBT_JAVA_OPTS -jar "$SBT_LAUNCH_JAR" \
  'manureStorage/test' 'export manureStorage/Test/fullClasspath'
# Set CP to the colon-separated line emitted by export, including test classes.
java -cp "$CP" manure.storage.FilesystemCapabilityProbe # expected 2 + PASS/REFUSED
mkdir -p manure/server/target/probe
native-image $CHRONICLE_NATIVE_IMAGE_FLAGS --no-fallback --parallelism=2 \
  -J-Xmx2g -O1 -cp "$CP" manure.storage.FilesystemCapabilityProbe \
  manure/server/target/probe/manure-filesystem-probe
manure/server/target/probe/manure-filesystem-probe # currently expected 1, SDS absent
```

Use the selected toolchain, not `/usr/bin/java`; Linux flags are
`--static --libc=musl`. To inspect actual boundaries, prefix each execution with
`strace -f -yy -e trace=openat,fsync,renameat,unlinkat,mkdir -o <log>`.
Successful syscalls are not power-cut/crash consistency tests.

## Source-bound execution receipt — 2026-11-02

Final run started **20:27:25Z**, Linux x86_64, baseline
`0ebe81ad49a4a0583216ecf1fdeb7f0bbbf95382`, Scala **3.9.0**, MUnit **1.3.6**.
Pinned shell selected
`/nix/store/6pfiwq699rwsdl6scfvjqdzzg5hsmx43-graalvm-ce-25.4.4.1.1`,
JDK **25.0.4.1.1**, static-musl flags above. No deployment/live-storage access.

Because the common build was not in this worktree, the run used
`dotty.tools.dotc.Main` against cached pinned jars, then
`org.junit.runner.JUnitCore manure.storage.ConfinedDirectorySuite`:
**17 cases passed, 0 failed/skipped**. Both probe invocations used the same compiled
Scala sources/classpath. JVM exited 2 with PASS/REFUSED. Native-image built a real
statically linked stripped x86_64 ELF; running it exited 1 with the SDS rejection.
Native trace contains no synthetic payload-directory access. JVM trace records
`openat(directory-fd, ".", O_RDONLY|O_NOFOLLOW)` → `fsync(fd) = 0`,
`renameat(staging-id-fd, "tree", live-fd, "id") = 0`, and successful source-parent,
live and root directory fsyncs. These are provider-call observations, not complete
publish/crash evidence. Scala's deprecated Unsafe warning was emitted; no tests skipped.

Final binary SHA256:
`e2ef154c0cd240a9004350fb0223456648a0752b53f0f8d5291a6bfb66c8df0d`.
An earlier pre-preflight binary reproduced the same missing SDS at first open:
`bc4a46bb8573b259e4791d7906041bf04c94f624f2ffc433d66d46e3ae1400f1`.

Final source SHA256s (paths relative to this module):

```text
7b7a499880bc6909a7e8473e054eaca4969b7a1ba374b83924b0b0b133533fda  src/main/scala/manure/storage/ConfinedDirectory.scala
53378603654e377afd66fbfd2be7471e27d9904dd0c4c418825a75884e0a60f1  src/test/scala/manure/storage/ConfinedDirectorySuite.scala
9fe89b5398c0ca8df83ad5b6f7593cbdfcb371f144a1e6a52e9f5a800809b004  src/test/scala/manure/storage/FilesystemCapabilityProbe.scala
```

Ignored evidence retained for parent copying **before worktree cleanup**:
`manure/server/target/evidence/final/` contains the ELF, source/classpath/toolchain
receipt, compile/test logs, JVM/native logs/statuses/traces and native build log;
`manure/server/target/evidence/initial-native/` preserves the initial failure/binary.
Only sources and this sanitized receipt belong in Git; do not commit caches/ELFs.

## Next feasibility decision

Do not begin the full port based on these tests. A separately approved, audited
POSIX capability adapter (or separately proven native provider/toolchain change) is
needed. It must preserve descriptor-relative open/no-follow traversal, safe existing
regular-file open/type checks without FIFO blocking, mkdirat, rename/unlink/rmdir,
file/directory fsync and a kernel-lifetime physical-root ownership claim. It needs
actual native tests plus failure/crash-window evidence before becoming storage.
No speculative bridge dependency or guessed Graal configuration is included here.
