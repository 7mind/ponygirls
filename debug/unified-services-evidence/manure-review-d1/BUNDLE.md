# Curated independent review evidence

Immutable production input: `d1e064e75a7fe6fd6a18a4406f9d84fbe8d1aa81`.

The parent copied 57 review artifacts without modifying their bytes and verified every copied SHA-256 against its source. Raw generated XML retains its original trailing whitespace to preserve those hashes; source/documentation whitespace checks exclude only these XML receipts. `bundle-manifest.json` identifies the exact files. The full Git source archive, compiled shared library, disposable databases and generated credential files are deliberately not included. Production source remains recoverable from the named Git commit.

`REVIEW.md` is the original final report. Final receipt v7 has two suites / ten cases / zero failures, errors or skips. Earlier failures and source variants remain separate and retain the report's explicit invalid-fixture adjudications; they are not silently promoted into production defects or discarded.

The original `run-probes.sh` contains historical absolute worktree paths and is preserved as a command receipt, not advertised as a portable launcher. Reproduction requires a fresh owned fixture, the named immutable source archive, the copied probe sources, the pinned build/PG/JNI toolchain and equivalent explicit sbt source-directory overrides. Never run it against a live database or credential configuration.

Scope: JVM, real PostgreSQL and shared-JNI filesystem handoff/ownership probes. This bundle is not native-AOT, complete HTTP/browser, later-source or whole-port acceptance. It does not authorize production migration, deployment or installation.
