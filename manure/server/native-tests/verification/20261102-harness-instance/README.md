# Harness-only final-source verification, 2026-11-02

Base commit: `87f80bedf9ebb61800e19de8d0b9581c8da48256` plus the harness-only
refinement. Production C, generated JNI header and Java API are byte-identical
to that base (verified with `git diff --exit-code BASE -- manure/server/src/main/c
manure/server/src/main/java`). `source-sha256.txt` binds the production and
harness/runner inputs; these files were unchanged after the recorded runs.

Completion observed: 2026-11-02T23:15:45Z. These are fresh runs, not reused
historical harness receipts. Logs use `2>&1 | tee` with `set -o pipefail`.

Working directory:
`/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-posix-c`.

```sh
export JAVA_HOME=/nix/store/6pfiwq699rwsdl6scfvjqdzzg5hsmx43-graalvm-ce-25.4.4.1.1
export CC=/nix/store/z4c6k0mrlkwl3s4w9ysxc8vq1wylm3ms-gcc-wrapper-15.3.0/bin/gcc
manure/server/native-tests/run.sh
SANITIZE=address,undefined manure/server/native-tests/run.sh
```

Both commands exit 0, each running one selftest with **1,257 assertions and
zero failures**. Strict javac/C warnings, generated-header comparison and
`-Xcheck:jni` pass. The sanitized run has no ASan/UBSan diagnostics; JVM
LeakSanitizer remains disabled. No final-source setup failures occurred.

Fixture stderr is retained in each log. The optional owned-device fixture
reports the observed `mknod` exit status 1 rather than guessing the cause;
its stderr reports `Operation not permitted`. All mandatory cases execute.
The supplemental unavailable node fixture is not a skip of the separately
owned Scala device-contract acceptance fixture, whose execution this receipt
does not independently attest.

The assertion counter is per-run instance state, including child-process
contention checks. No production implementation or ABI changed, and all
payloads remain owned temporary fixtures. Historical receipts and their
original source bindings are retained unchanged in `../20261102-size-truncate/`
and explicitly classified in `../README.md`. Static-runtime, state-machine
and physical durability acceptance remain outside this local JNI receipt.
