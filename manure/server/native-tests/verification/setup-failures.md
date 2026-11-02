# Retained initial setup failures (not behavioral failures)

These are transcripts/excerpts preserved from the original tool responses,
not newly executed runs. They occurred while preparing base implementation
`4488a6fb3c4f79f6cbb8dbf1a178b688d80ad4fd` on 2026-11-02. Exact per-command
wall-clock times were not captured. Every attempt below exited unsuccessfully;
none is counted as passing tests or as evidence that sanitizer checks executed.
Final-source commands and logs are in `20261102-size-truncate/`.

## Initial strict Java compile — source-warning setup failure, exit 1

Command used pinned Graal JDK below with `javac -Xlint:all -Werror`.

```text
manure/server/src/main/java/manure/storage/PosixNative.java:26: warning: [restricted] System.load(String) is a restricted method.
        System.load(absoluteLibraryPath);
              ^
  (Restricted methods are unsafe and, if used incorrectly, might crash the Java runtime or corrupt memory)
error: warnings found and -Werror specified
1 error
1 warning
```

Resolution: narrowly annotate the explicit shared factory with
`@SuppressWarnings("restricted")`; tests explicitly enable native access.

## Initial strict C compile — header-order setup failure, exit 1

The initial command forced the generated JNI header using compiler `-include`,
which runs before source `_GNU_SOURCE`/`_FILE_OFFSET_BITS` definitions. The tool
response truncated the compiler diagnostics. Representative retained lines:

```text
manure/server/src/main/c/posix_native.c:97:19: error: implicit declaration of function ‘openat’; did you mean ‘open’? [-Werror=implicit-function-declaration]
manure/server/src/main/c/posix_native.c:97:47: error: ‘O_DIRECTORY’ undeclared (first use in this function)
manure/server/src/main/c/posix_native.c:97:61: error: ‘O_NOFOLLOW’ undeclared (first use in this function)
manure/server/src/main/c/posix_native.c:97:74: error: ‘O_CLOEXEC’ undeclared (first use in this function); did you mean ‘FD_CLOEXEC’?
manure/server/src/main/c/posix_native.c:143:27: error: ‘AT_FDCWD’ undeclared (first use in this function)
```

Resolution: include checked-in generated JNI header in the source after feature
macros, not with compiler `-include`.

## Sanitizer attempt 1 — INVALID PREREQUISITE: runtime lookup, exit 1

`JAVA_HOME` was the pinned Graal JDK below, `CC=cc` (host compiler),
`SANITIZE=address,undefined`. The test failed at shared-library loading, before
behavioral assertions:

```text
Exception in thread "main" java.lang.UnsatisfiedLinkError: /tmp/manure-native-test.VPHb7nFH/libmanure_posix.so: libubsan.so.1: cannot open shared object file: No such file or directory
	at java.base/jdk.internal.loader.NativeLibraries.load(Native Method)
	at java.base/jdk.internal.loader.NativeLibraries$NativeLibraryImpl.open(NativeLibraries.java:321)
	at java.base/jdk.internal.loader.NativeLibraries.loadLibrary(NativeLibraries.java:187)
	at java.base/jdk.internal.loader.NativeLibraries.loadLibrary(NativeLibraries.java:129)
	at java.base/java.lang.ClassLoader.loadLibrary(ClassLoader.java:2245)
	at java.base/java.lang.Runtime.load0(Runtime.java:767)
	at java.base/java.lang.System.load(System.java:1647)
	at manure.storage.PosixNative.shared(PosixNative.java:27)
	at manure.storage.NativeSelfTest.load(NativeSelfTest.java:35)
	at manure.storage.NativeSelfTest.main(NativeSelfTest.java:49)
```

## Sanitizer attempt 2 — INVALID PREREQUISITE: mixed libc, exit 127

An attempted `LD_LIBRARY_PATH` adjustment polluted the Nix shell's host-runtime
lookup. Captured output:

```text
/nix/store/nnm9gdr70ihc6zc9298mzz8jpcgaciql-bash-5.3p20/bin/bash: symbol lookup error: /usr/lib/x86_64-linux-gnu/libc.so.6: undefined symbol: __nptl_change_stack_perm, version GLIBC_PRIVATE
```

Resolution: remove this environment adjustment; scope runtime search to the
shared artifact via rpath.

## Sanitizer attempt 3 — INVALID PREREQUISITE: runtime lookup, exit 1

Host compiler with shared-artifact rpath still lacked transitive C++ runtime
lookup. The failure was at shared-library loading:

```text
Exception in thread "main" java.lang.UnsatisfiedLinkError: /tmp/manure-native-test.IMQa9uBu/libmanure_posix.so: libstdc++.so.6: cannot open shared object file: No such file or directory
	at java.base/jdk.internal.loader.NativeLibraries.load(Native Method)
	at java.base/jdk.internal.loader.NativeLibraries$NativeLibraryImpl.open(NativeLibraries.java:321)
	at java.base/jdk.internal.loader.NativeLibraries.loadLibrary(NativeLibraries.java:187)
	at java.base/jdk.internal.loader.NativeLibraries.loadLibrary(NativeLibraries.java:129)
	at java.base/java.lang.ClassLoader.loadLibrary(ClassLoader.java:2245)
	at java.base/java.lang.Runtime.load0(Runtime.java:767)
	at java.base/java.lang.System.load(System.java:1647)
	at manure.storage.PosixNative.shared(PosixNative.java:27)
	at manure.storage.NativeSelfTest.load(NativeSelfTest.java:35)
	at manure.storage.NativeSelfTest.main(NativeSelfTest.java:49)
```

Resolution: use the pinned Nix GCC wrapper, not the incompatible host compiler
sanitizer runtimes.

## Sanitizer attempt 4 — INVALID PREREQUISITE: preload scope, exit 1

Using the pinned GCC wrapper but globally exporting `LD_PRELOAD` injected Nix
sanitizer dependencies into host `timeout`/`rm`. Captured output:

```text
timeout: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_ABI_DT_X86_64_PLT' not found (required by /nix/store/lm3pknxi0ipypy3lxh1wmm8wvvavdwrn-glibc-2.42-84/lib/libdl.so.2)
timeout: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_ABI_DT_X86_64_PLT' not found (required by /nix/store/lm3pknxi0ipypy3lxh1wmm8wvvavdwrn-glibc-2.42-84/lib/librt.so.1)
timeout: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_ABI_DT_X86_64_PLT' not found (required by /nix/store/lm3pknxi0ipypy3lxh1wmm8wvvavdwrn-glibc-2.42-84/lib/libpthread.so.0)
timeout: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_ABI_DT_X86_64_PLT' not found (required by /nix/store/lm3pknxi0ipypy3lxh1wmm8wvvavdwrn-glibc-2.42-84/lib/libm.so.6)
rm: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_ABI_DT_X86_64_PLT' not found (required by /nix/store/lm3pknxi0ipypy3lxh1wmm8wvvavdwrn-glibc-2.42-84/lib/libdl.so.2)
rm: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_ABI_DT_X86_64_PLT' not found (required by /nix/store/lm3pknxi0ipypy3lxh1wmm8wvvavdwrn-glibc-2.42-84/lib/librt.so.1)
rm: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_ABI_DT_X86_64_PLT' not found (required by /nix/store/lm3pknxi0ipypy3lxh1wmm8wvvavdwrn-glibc-2.42-84/lib/libpthread.so.0)
rm: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_ABI_DT_X86_64_PLT' not found (required by /nix/store/lm3pknxi0ipypy3lxh1wmm8wvvavdwrn-glibc-2.42-84/lib/libm.so.6)
```

Resolution: preload only into the JNI JVM, not timeout/cleanup, and remove it
from host-tool subprocess environments. The finalized runner does this.

## Successful initial sanitizer command (historical, 1,207 assertions)

```sh
JAVA_HOME=/nix/store/6pfiwq699rwsdl6scfvjqdzzg5hsmx43-graalvm-ce-25.4.4.1.1 \
CC=/nix/store/z4c6k0mrlkwl3s4w9ysxc8vq1wylm3ms-gcc-wrapper-15.3.0/bin/gcc \
SANITIZE=address,undefined manure/server/native-tests/run.sh
```

```text
SKIP owned device node: mknod privilege unavailable
PASS NativeSelfTest assertions=1207
```

The privileged owned-device check is supplemental. This transcript does not
assert whether the separately owned Scala device-contract fixture executed.
