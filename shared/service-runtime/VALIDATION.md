# Runtime validation — 2026-11-03 UTC

Run in explicit `wt-ponygirls-unified-runtime` only. Pinned `nix develop
.#chronicle`, Scala3.9.0/Scala2.13.18, PostgreSQL18.6, JDBC42.7.14,
cats-effect3.7.1, distage1.2.25. No production state or activation.

## Fresh full runtime gate

`nix develop .#chronicle --command bash shared/service-runtime/scripts/test-postgres.sh`

2026-11-03T00:37:13Z receipt:
`shared/service-runtime/target/validation-runs/20261103T003713Z.KhBMw3/`.
Contains source-byte SHA256 manifest (including uncommitted final inputs), git HEAD,
JVM/PostgreSQL versions, log, complete discovery inventory, fresh XML and summary.
Previous reports are preserved separately, never merged or filtered into new XML.
**7 suites / 26 cases / 0 failures / 0 errors / 0 skips**; all discovered suites
matched XML exactly. Owned disposable SCRAM-authenticated PostgreSQL was stopped
and deleted after the command. Receipt/logs retained in this worktree.

Coverage: admission active/queue bounds, cancellation, wait expiry, drain/closed
lifecycle; strict credential bytes and configuration; actual distage tagged graph,
pinned QuasiIO/Async adapters and successful/failed resource cleanup; one abstract
counter contract against manual dummy and real PostgreSQL; transaction commit,
rollback and atomic caller projection; concurrent migration exactly-once, checksum/
name/unknown-history rejection, failed migration rollback; SQL/lock/idle deadlines;
connection/admission ownership during cancellation and shutdown; safe driver and
secondary rollback-failure diagnostics. No fake SQL engine or auto-mocks.

## Reproduce-first boundary findings

- Committed initial e30a1784 read opened a credential before checking its type.
  A regular-file precheck was initially written uncommitted at ~00:32Z; this did
  **not** itself establish the bug. The precheck was then removed to restore the
  e30 behavior and a bounded child-process FIFO fixture actually failed at
  00:34:06Z: read hung for 3 seconds, child forcibly killed, command exit1.
  Original log: `/tmp/unified-runtime-fifo-fail-first.log`. Candidate restored;
  fixture passes without opening FIFO. This is an operator-secret assumption,
  not payload-path containment: the configured/resolved directories are trusted
  and operators must not race a special-file replacement.
- Initial strict leaf NOFOLLOW rejected an operator-managed secret symlink.
  Desired managed-symlink preservation was tested against that policy and failed
  before the change. Final policy resolves the explicitly configured reference
  with `toRealPath` each read, verifies a regular leaf before opening, then opens
  the resolved leaf NOFOLLOW. Both agenix-shaped fixture and explicit credential
  copy pass. No ambient fallback or live rotation performed.
- Actual PostgreSQL `pg_terminate_backend(pg_backend_pid())` fault caused rollback
  to fail. Desired safe secondary evidence failed before the fix (0 suppressed
  errors). Final implementation preserves primary domain/SQL error, adds only
  sanitized rollback/close failures and retains no raw driver cause/SQL diagnostics.
  Both domain and SQL-primary variants pass against the real owned PostgreSQL.
  Combined boundary fail-first full gate: 26 cases,3 failures,0 errors/skips;
  `/tmp/unified-runtime-boundaries-fail-first.log` and its separate validation run
  preserve the rejected results, not included in the fresh passing inventory.

## Build/generation evidence (narrow scope)

- Canonical pinned Baboon `--runtime only` independently regenerates eleven
  byte-identical runtime sources, also equal to Chronicle and Haystack current
  root generated sources, via `shared/baboon-runtime/check-generated.sh`.
- Actual retrieval commits 2bff6b47/2f4cabaa merged (not copies/stubs):
  retrievalCore/Test/compile, modelHttp/Test/compile,
  retrievalPostgres/Test/compile and chronicleServer/compile pass.
- `chronicleServer/verifySingleBaboonRuntime` found 148 runtime classes with
  exactly one compiled owner, canonical Scala2.13 module. New services will run
  the same guard on assembly after their actual contracts/servers arrive.
- Existing dependency lock unchanged: no new artifact/pin required. This is not
  yet final three-service coassembly, file-only offline or native validation,
  nor the full Chronicle/application/browser/retrieval release suite.
