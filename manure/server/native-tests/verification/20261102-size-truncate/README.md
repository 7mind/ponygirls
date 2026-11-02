# Final primitive-source verification, 2026-11-02

Base commit: `4488a6fb3c4f79f6cbb8dbf1a178b688d80ad4fd` plus size/truncate
extension. `source-sha256.txt` binds every tested production/test/runner input;
those input files were unchanged after these runs. Logs were captured with
`2>&1 | tee` and shell `set -o pipefail`. Completion was observed at
2026-11-02T23:02:19Z. These are fresh runs, not reused base evidence.

Working directory:
`/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-posix-c`.

```sh
export JAVA_HOME=/nix/store/6pfiwq699rwsdl6scfvjqdzzg5hsmx43-graalvm-ce-25.4.4.1.1
export CC=/nix/store/z4c6k0mrlkwl3s4w9ysxc8vq1wylm3ms-gcc-wrapper-15.3.0/bin/gcc
manure/server/native-tests/run.sh
SANITIZE=address,undefined manure/server/native-tests/run.sh
"$CC" -std=c11 -Wall -Wextra -Werror -Wconversion -Wsign-conversion \
  -Wshadow -Wformat=2 -Wstrict-prototypes -Wmissing-prototypes \
  -fanalyzer -fsyntax-only -I"$JAVA_HOME/include" -I"$JAVA_HOME/include/linux" \
  manure/server/src/main/c/posix_native.c
```

Results:

- `jvm-strict.log`: exit 0, one selftest, 1,257 assertions, zero failures;
  javac/C strict warnings, generated-header comparison and `-Xcheck:jni` pass.
- `jvm-asan-ubsan.log`: exit 0, same 1,257 assertions, zero failures or sanitizer
  diagnostics. ASan/UBSan enabled on the JNI library; JVM LeakSanitizer disabled.
- `analyzer.log`: exit 0, GCC strict static analysis without diagnostics.
- Both behavioral runs explicitly skip the supplemental privileged owned-device
  node check because `mknod` is unavailable. This is not evidence about the
  independently owned Scala device-contract fixture or native executable.

New assertions cover size on empty, read-only, writable, sparse and unlinked
regular fds; truncate zero/grow/shrink/regrow, sparse lengths beyond 32 bits,
zero-filled holes/tails, negative values, RO denial without size mutation,
directory rejection and negative/closed fd rejection. Primitive tests do not
establish recovery-state-machine behavior, power-loss durability or actual
static-musl runtime execution.

All initial setup failures are retained separately in `../setup-failures.md`
and clearly labeled as unsuccessful setup, not passing sanitizer evidence.
There were no final-source setup failures.
