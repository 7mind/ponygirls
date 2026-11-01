# Archive source-search latency and deadlines

## Scope and source

Task base: `9f3b6428143190f4ce297d81e71167f9f86c9da6`.
Browser deadline commit: `41c0a4ff` (integrated from a dedicated writer worktree).
Final backend/test changes are validated by the source/artifact bindings below;
the task commits are recorded in Git history.

The reported input was `bullshit observations` on this host's Chronicle. Without
quotes, the expression is Hybrid `bullshit AND observations`: two lexical legs,
two ANN legs, exact authorized-HEAD membership/count, ranking and source witnesses.
The quoted phrase is a different one-operand query; both were checked separately.

## Reproduction and attribution

Observed on 2026-11-01 against PostgreSQL18.6/pgvector0.8.7, with approximately
770 current sources, 2,700 revisions, 3.15 million archive fragments, 2.33 million
messages and 252,000 published search chunks. Data continued to ingest during
these diagnostics; counts are observations, not a fixed benchmark corpus.
No archive text, credentials or tokens were printed or sent to external providers.
Query embeddings for the user-provided terms used the existing loopback provider.
No production schema, index, source or model policy was changed.

- Original full parameterized Hybrid page/count SQL: **11.205s**.
- Original real `sourceSearch`: `deadline` after **5.089s**, reproducing the
  reported SQL cancellation, not a decoder/import/environment failure.
- The `bullshit` leg chose a parameterized primary-key scan for every visible
  HEAD, taking approximately4s. The `observations` leg chose GIN, but its4MiB
  bitmap became lossy: **33,835 lossy heap blocks** and approximately456,000
  additional rechecks. Each ANN leg took approximately0.1s, so ANN was not changed.
- A minimal `observations` membership query took6.662s with the original setting;
  diagnostic transaction-local64MiB reduced it to2.966s with no lossy blocks.
  The final16MiB floor also eliminated lossy blocks in the complete query.

Actual plans, aggregate-only probes, reproduction output and test reports are
retained in the local task evidence directory. These are host/corpus/cache/load
observations, not sustained-load percentiles or a universal latency guarantee.

## Rejected alternatives

A fragment-first `MATERIALIZED DISTINCT(session_id,revision)` query plus16MiB
completed the full source search in4.739s, but forced global work even for very
common or short literals. The original query answered `mode:lexical a` membership
in16ms using per-HEAD early exit; the rewrite planned a parallel scan of the whole
3.15-million-fragment archive. It also risked disproportionate work for tiny
reader ACLs. That rewrite and its unconditional-GIN test were **removed**.

Universally forcing correlated `LIMIT1` probes was also rejected: it helped
`observations`, but took4.73s for an absent literal. The retained query leaves
PostgreSQL free to choose GIN or correlated scans according to the workload.

## Accepted changes

- Preserve the original lexical/ANN SQL, Boolean grammar, exact counts, ACLs,
  Unicode collation/literal escaping, cursor order, candidate limits and pins.
- For Lexical/Hybrid text execution, raise transaction-local `work_mem` to at
  least16MiB, preserving a larger inherited setting. This is a **per-plan-node**
  allowance, not a per-request/process cap; concurrency can multiply consumption.
- Raise source-search SQL statements from5s to**30s**, retaining any stricter
  inherited timeout. This covers page and witness statements, not one whole
  database transaction or a guaranteed backend cancellation at client timeout.
- Give browser `ArchiveSearch` requests**60s** rather than the generic20s;
  leave other reads, mutations, one-shot requests and heartbeats unchanged.
  No automatic retry, legacy Search substitution or fallback was introduced.

The final memory-only SQL was probed with the initial15s candidate deadline:

| Input | SQL plan execution | Complete source search |
|---|---:|---:|
| `bullshit observations` |7.761s|8.191s;10/157 rows|
| `"bullshit observations"` |0.389s|0.624s;10/174 rows|
| `mode:lexical a` |0.049s|0.151s;10/771 rows|
| absent lexical literal |0.135s|0.154s;0 rows|
| lexical observations, nonexistent reader |0.0006s|0.040s;0 rows|

The8.2s loaded full-search measurement invalidated the earlier15s deadline's
headroom assumption; the accepted30s statement budget leaves more margin. The
final native/browser acceptance below verifies the actual30s build. Per-session
fragment scan cost and historical-index volume remain possible optimization
opportunities; this change does not claim every search is subsecond.

## Regression and final verification

The six-second controlled PostgreSQL lock-wait regression failed with `deadline`
before the policy change. Final tests retain that positive wait, an actual30s
expiry, the stricter150ms inherited expiry, transaction-local memory reset and
larger-setting preservation. The test runner allows45s for the30s expiry case;
no database deadline is shortened. Existing ACL/Unicode/count/pin tests remain.

Browser regression tests use the actual client helper, connection manager,
Baboon codecs and a controlled clock: responses after20s succeed, hung search
expires at exactly60s, late replies cannot restore results, normal heartbeats
continue, and all other request policies retain20s. The initial red run had
2 expected failures/6 tests; the complete final run is recorded below.

Required commands (repository root unless stated otherwise):

```bash
nix develop .#chronicle --command bash chronicle/scripts/test-postgres.sh
# From chronicle, in the same pinned shell:
TSC="$PWD/web/node_modules/.bin/tsc" ./scripts/test-codecs.sh
# From chronicle/web, in the pinned shell:
npm run typecheck && npm test && npm run test:browser
# From chronicle/collector, in the pinned shell:
npm run typecheck && npm test
python3 -m unittest discover -s chronicle/eval/relevance/tests -v
```

An intermediate full backend run and a package built with the earlier15s budget
are not final-source acceptance evidence. Their logs are retained separately.
The final unfiltered run uses a fresh XML reporting directory; protocol checks
run serially after the backend reports are preserved. Full-client runs and the
host-pinned native build are independently recorded, not inferred from fast Nix
checks. A read-only reviewer found no result-semantic/ACL broadening. Skill
analysis found no new draft warranted beyond existing exact-index/ANN acceptance
procedures and these task-specific diagnostics.

Completed final-source client verification:

- Dashboard typecheck and Node suite:139/139 passed,0 failures/skips.
- Complete `npm run test:browser`: passed;286 reported PASS lines, including44
  search-SERP groups. PASS lines are reported checks/groups, not a standardized
  count of all browser assertions.
- Collector typecheck and Node suite:125/125 passed,0 failures/skips.
- Relevance workflow Python suite:172/172 passed. Its runner/transport and prompts
  are unchanged, so no new controlled-provider or semantic-quality claim is made.

Host-pinned candidate built through Paddock with an explicit local Ponygirls input
and `--no-write-lock-file`; Paddock's repository/pins were not edited. The candidate
package is `/nix/store/9ygvchnkjkidd5g0107c7mrw94816hhb-chronicle-0.1.0`, native
SHA256 `517d0e4783792d76f98ac8243ba7ab567c1c379c37cb689a873489ff0007cc35`.
Its scoped Nix receipt reports131 fast backend tests and16 protocol fixture groups,
not the full suites. Receipt-bound runtime source matches the task's backend
files byte-for-byte and contains the30s timeout; comparing the installed old and
candidate runtime source trees finds exactly `ArchiveIndex.scala` and
`ArchiveSearch.scala` changed, no added/removed runtime files. The packaged web
source also matches all three intended client source files. The generated unit
retains the exact original configuration path.

Final unfiltered backend/protocol verification completed2026-11-01:

- Backend:936/936 tests across all108 discovered suites;0 failures,0 errors,
  **0 skips**. Fresh XML suite names exactly equal the preserved inventory,
  with no missing or unexpected suites. PostgreSQL cases executed.
- Serial protocol verification:17/17 Scala cases plus all current TypeScript
  fixture groups; removed/future-version rejection retained. Exit0.
- No application source changed after these final runs. Only this validation
  record was completed afterward.

## Scoped activation and actual native acceptance

Q4 revision2 explicitly authorized build, verification and activation while
preserving configuration/data. Q1 retains publication/pin control with the user;
no push or downstream pin edit was performed.

A full Home Manager switch would also restart the database/GPU dependency chain
because their restart-trigger paths depend on the rebuilt setup unit. Instead,
activation installed a scoped **runtime** systemd ExecStart override:

- `/run/user/1001/systemd/user/ivm-chronicle.service.d/90-archive-search-latency.conf`
- package GC root: `/run/user/1001/chronicle-archive-search-package`

Only Chronicle was explicitly restarted; its PartOf collector restarted with it.
The service's existing immutable configuration remained
`/nix/store/7h4prirs0hbjivqnnc49si1qwbvab8qr-chronicle-server.json`.
PostgreSQL PID146731 and embedding PID1425269 were unchanged. The new server's
`/proc/<pid>/exe` digest exactly matched the candidate receipt's native digest.
No schema/index/source/model policy or protected credentials directory was
modified by this task. The normal service startup reconciliation still ran.

The runtime override lasts until reboot and overrides subsequent Home Manager
unit changes while present. After publishing/pinning this fix (or a newer
corrected version), remove the exact runtime override and its package GC root,
reload systemd and restart Chronicle from the persistent managed unit. Do not
leave this temporary override masking later managed-package updates.

A fresh actual Chromium context signed in normally to the running native
service, used the real Search dashboard and signed out its own session. Secrets
remained in process memory; no screenshots, transcript excerpts, cookies or
passwords were recorded. Observed results:

| Submitted expression | Browser elapsed | Total | Shown |
|---|---:|---:|---:|
| `bullshit observations` |7.865s|157|10|
| `"bullshit observations"` |1.323s|175|10|
| `mode:lexical a` |1.321s|771|10|
| absent lexical literal |1.307s|0|0|

Each submission sent exactly one `ArchiveSearch` and zero legacy `Search`
operations; no deadline alert, substitution, retry or fallback occurred. These
are native/dashboard behavioral observations, not inferred from JVM tests or an
ELF digest alone. They do not establish sustained-load performance percentiles.

Local reproduction/probe logs and fresh reports are preserved outside the task
worktree before its removal. No full backend/browser pass is inferred merely
from the package's fast validation receipt.
