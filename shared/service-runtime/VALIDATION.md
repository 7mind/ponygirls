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

## Three-domain and file-only followup

At ~00:41Z, clean git-archive input **54eb0274227293d217170ba8b553a094c15298d0**
was compiled from scratch in a disposable copy retained at
`shared/service-runtime/target/validation-runs/20261103-offline.Kb2g7B/`.
Fresh empty HOME/SBT boot, `COURSIER_MODE=offline`, only
`file:///nix/store/nbir0l4pyslr5x1b85nafpgyi14zwywi-coursier-cache/https/repo.maven.apache.org/maven2/`
as repository, pinned development-shell toolchain. Existing deps.lock.json used
unchanged; no artifact/pin regeneration needed. Compiled canonical11, current
Chronicle112/Haystack31/Manure39 domain sources, service runtime+tests and actual
retrieval modules. Chronicle assembly verified 148 runtime classes with exactly
one classpath owner. Jar SHA256:
`78c1751c1f949d4f41fd49eaabd0d31b83a3eb15dc26b7e371d20fd47bbb408d`.
No network repository fallback was configured; this is file-only dependency
resolution, not a claim of a network-namespace sandbox test.

At ~00:42Z `contractCoassembly` passed with **1435 total classes**, all three
current domains present and **148 Baboon runtime classes from exactly one compiled
canonical owner**. The task rejects any duplicate class, uses deterministic zip
timestamps, and creates `target/contracts-coassembly.jar` (a contract bundle, not a
service stub). The independent pinned runtime-only generation check also passed
for all three actual domain root runtime sets. Logs:
`/tmp/unified-runtime-domain-check.log`, `/tmp/unified-runtime-coassembly.log`.

Haystack server assembly on earlier committed f5f27da5 input could not yet finish
because Config imported an uncommitted service-owned ProjectionPolicy; this was a
source-commit availability boundary, not a build error to fix with stubs. Manure
server code was not yet committed at this observation. Final three executable
assemblies and service/native acceptance still await their actual source commits.

At ~00:45Z the reproducible `shared/baboon-runtime/test-build-guards.sh` passed:
(1) isolated full-runtime fixture with one changed byte was rejected by the actual
`verifyBaboonRuntime` task; (2) temporary in-process SBT settings deliberately
compiled duplicate Chronicle root runtime classes, and the real app classpath guard
rejected them (rather than relying on assembly dedup); (3) normal source settings
were restored and single-owner verification + three-domain coassembly passed.
Receipt: `target/baboon-validation/20261103T004545Z.Ij124i/`.
The initial guard-script fixture attempt incorrectly placed inputs outside its
`scala/` directory and was rejected for missing domain sources; its separate
failed receipt is preserved, and is not counted as the intended mismatch proof.

Actual Haystack source31102256 was subsequently merged without edits and both
Haystack + Chronicle assemblies passed at ~00:44Z on integrated tree
`4e3e2055af5414f359e8b8f5bb5ecd7c19d06f82`. Both ZIPs contain exactly148
runtime classes without duplicate entries; Haystack contains all4 authoritative
SQL resources. SHA256: Haystack
`0354e3d4cf41af937190e024bc5088161c7487ec44f058694c78160b229d5868`,
Chronicle `4a0a4584c26adbe0a53dea54dbbfd4c5c7dd97c9eab643d8f152f760f4da00fb`.
This is JVM assembly evidence, not JVM/native service behavior acceptance.

## Actual three-server file-only assembly and final runtime gate

Fresh clean git-archive input **1e245cce123e963a34c7b0d35cdb42c19de469cd**
includes actual Haystack31102256 and Manure57493cfc servers, shared retrieval2f4,
and the current shared runtime/build. Receipt retained at
`shared/service-runtime/target/validation-runs/20261103-offline-three.l1gmkv/`:
`source-commit`, `offline.log`, `runtime-pg.log`, `jar-verification.json`, exit0,
and nested fresh runtime inventory/XML/log/source hashes.

At ~00:48Z, with fresh empty HOME/SBT boot and the same locked **file-only** cache/
offline mode described above, the following all passed from scratch:

- `contractCoassembly` (1435 classes, three current domains, one148-class runtime).
- Test/compile for serviceRuntime, haystackServer, manureServer, retrievalCore,
  modelHttp and retrievalPostgres. This is compile evidence, not invented test
  coverage for modules without suites yet.
- `haystackServer/assembly`, `manureServer/assembly`, `chronicleServer/assembly`.
  Each app verified exactly one compiled148-class canonical runtime owner before
  assembly. ZIP inspection checked no duplicate runtime entries and **byte-identical
  complete runtime class maps across all three jars**; service SQL resources present.
- Fresh full owned SCRAM PostgreSQL runtime gate: **7 suites /26 cases /0 failures /
  0 errors /0 skips**, exact discovered inventory/XML match. Cluster cleaned up.

JAR SHA256s bound to that archived input and retained binaries:

| Application | SHA256 |
|---|---|
| Chronicle | `3c969a6d4d3004a35d4a24b7b4007c45c12fb7b33e459b672b17e74436004966` |
| Haystack | `e1b6157b2fbac834d21ede5cf5c545e35b5fbe51839ab4b717023c142b4a31d0` |
| Manure | `f69f483668f539dc15fff62c4e38f32bd611b3ea3365beee190c6c4d5f3108a3` |

The immutable locked artifact closure covered the complete graph without new
artifacts/pins, so deps.lock.json was intentionally **not** regenerated. Native
service behavior, complete application/client/browser/migration/recovery gates
and Nix source-filter/package acceptance remain other work, not implied by these
JVM/runtime receipts. New relevant inputs invalidate affected artifact evidence.

## Incomplete additional Chronicle backend attempt (not a pass)

Full unfiltered `nix develop .#chronicle --command bash chronicle/scripts/test-postgres.sh`
was also attempted on source1e245cce at ~00:49Z. The foreground harness600s maximum
reported timeout/SIGKILL before the command returned; no test-command exit status
was obtained. Fresh receipt
`shared/service-runtime/target/validation-runs/20261103-chronicle-backend.ehq2jz/`
preserves log, all partial XML, inventory, termination note, owned PG log and
`partial-summary.json`. **110 discovered suites;86 finished /788 cases /0 failures /
0 errors /0 skips;24 missing suites**. This incomplete run is not release success
and was not merged with any other XML. Own orphan fixture cluster
`/tmp/nix-shell.IzSLuC/chronicle-pg.x6C33I` was identified from the command/log and
explicitly stopped ~01:00Z; unrelated PostgreSQL processes were not touched. A
separate retrieval-worker full run was observed and left alone, avoiding duplicate
reruns. No tests, filters or real deadline/concurrency assertions were weakened.
