# Controlled retrieval extraction validation

Implementation: `842fd997` (final lifecycle edge hardening), based on `739f97da` (includes cancellation repair `48a43a38`, Chronicle extraction `d3de9f96`, initial libraries `2bff6b47`/`2f4cabaa`, runtime prerequisite `68dc671b`). No live deployment, production data or provider model call was used. Synthetic vectors do **not** establish provider quality.

## Fresh shared-library gate

```
nix develop .#chronicle --command bash shared/retrieval-postgres/scripts/test-postgres.sh
```

Receipt (retained worktree):
`shared/retrieval-postgres/target/validation-runs/20261103T011854Z.YPreFy/`
completed 2026-11-03 01:20:36 UTC, owned PostgreSQL18.6 + pgvector0.8.7. All discovered suites executed serially with fresh XML/inventory directories; previous reports preserved. Required real PG leg cannot skip.

| Project | Suites | Cases | Failures/errors/skips |
|---|---:|---:|---:|
| retrievalCore | 1 | 5 | 0/0/0 |
| modelHttp | 2 | 21 | 0/0/0 |
| retrievalPostgres | 5 | 29 | 0/0/0 |

Exact input manifest (verified against committed bytes after commit):
[validation/20261103-lifecycle-final/source.sha256](validation/20261103-lifecycle-final/source.sha256), SHA256 `9ad94e8f6ed13a83b73b934ecc4aa52c101f545bd9c1b0e102ae1c5549a257ce`.
[Summary](validation/20261103-lifecycle-final/summary.json).

Coverage: pure space identities/vector/RRF contracts; same blackbox source/visibility/publication contracts against handwritten memory and real PG adapters; NUL IDs/versions/attributes/text, submicrosecond exact expiry, prelimit SQL ACL/filter/counts, namespaces, missing model/not-ready, corpus-policy identity, source/run/fence checks, accepted batch reuse, same-version restore, stale/reclaimed/delete/expiry handling, complete generation publication, savepoint rollback when lease expires during insertion even if caller catches error and commits. Worker tests cover cancellation/retry/accepted reuse, model IO outside transactions and a4s controlled model with3s lease/heartbeat. Real loopback HTTP covers payload prefixes/model/dimensions options, response order/cardinality/malformed shapes/float bounds, body bounds/deadline, admission/queued+running cancellation, explicit managed credential files/empty auth/actual byte bounds/FIFO/strict UTF8, and safe transport diagnostics.

## Fail-first corrections and residual ANN limitation

[Retained failure excerpts](validation/20261103-controlled/fail-first.txt) preserve actual failing assertions, not hypothesized bugs:

- FIFO reported size0, then old `Files.readString` admitted20KB. Before:1fail/1pass. Shared `BoundedSecretFile.read` now enforces actual read bound, regular resolved leaf/NOFOLLOW, strict UTF8; model boundary preserves empty auth and trailing stripping. Trusted operator references may use agenix symlinks; this is not untrusted payload-path confinement.
- Same-version restore after remove produced no job; a new corpus policy with the same vector space served an old-policy snippet. Before PG21cases:2fail. Restore now rebuilds; semantic guards/legs require exact profile **and** space, no implicit policy compatibility.
- Empty complete sources spuriously enqueued a new epoch on identical repeat projection; an expired crashed final-attempt lease remained Running indefinitely. [Additional fail-first excerpts](validation/20261103-lifecycle-final/fail-first.txt): PG29cases2fail. Initialization/removal markers now distinguish empty completeness from restore, and expired exhausted leases become Failed with source-before-job locking. No schema or API change.
- Already-expired sources were claimable for new model calls. Before PG27cases:1fail. Claim/current fences now compare exact numeric expiry to newly bound wall time.
- Moving usage capture outside response resource release lost known counters on cancellation (0 vs9). Focused before8cases:1fail. `JsonHttp.postF` restores effectful acceptance inside the uncancelable bounded body section before release. Fresh targeted in-process/loopback accounting+ModelHttp:3suites20cases0fail/error/skip; shared HTTP21 also passed. Intermediate decoder-error relabel failure was retained, then fixed without weakening tests.

The adversarial duplicate-neighbor corpus has1100 denied nearest chunks,1100 authorized-but-filter-rejected nearest chunks and12 authorized farther chunks. The initial test's requirement that ANN yield equal exact yield was **wrong** for the declared finite approximate policy; its real failure is retained, not claimed as a quality pass. Current measured semantic yield is **0/12**, hybrid12/12, lexical12/12. This is an explicit residual retrieval-quality limitation.

[Actual production EXPLAIN ANALYZE/BUFFERS/SETTINGS JSON and effective knobs](validation/20261103-lifecycle-final/authorized-candidate-plan.json), SHA256 `33029fe8f71e05ba4f9a50822741898059899cfa3a98a1f2957011f7c46e7490`: HNSW `pony_retrieval_hnsw_d3`, strict_order, ef200, scan tuples200000, scan memory4, work_mem4MB. Live ACL/attribute predicates are in the index scan filter below LIMIT,0 accepted/denied nearest neighbors filtered. The same production SQL with index scans disabled finds all12 and admits no denied rows. This rules out post-LIMIT authorization placement in this plan; it is consistent with approximate duplicate-neighbor traversal underfill, not proof of a particular low-level graph cause. No knobs, ranking policy or silent exact fallback were changed. Candidate-window count scope explains totals, not quality.

## Chronicle preservation evidence and outstanding final gates

Focused real-PG differential oracle (`e9fda183` algorithms, test-only—not a deployed compatibility API) vs candidate: actual published-passage and Boolean archive paths compare SQL+results on identical controlled corpus, lexical/semantic/hybrid filters, live group revocation, deterministic ties/counts/pages, changed HEAD vs old published history pins and source evidence.2cases passed; together with model/admission/rejection:4suites77cases passed, receipt `target/chronicle-focused-20261103T004428Z.UQ0d4D` (relative to this project).

An unfiltered Chronicle backend attempt at `d3de9f96` used the required `chronicle/scripts/test-postgres.sh` but the foreground tool killed it at600s. It is **not a full-suite pass**. Partial source-bound receipt `target/chronicle-full-20261103T005200Z.mZai6R`:87completed XML suites/790cases/1real cancellation-accounting failure/0skips; that failure was repaired as above. Owned orphan cluster was identified by exact00:52postmaster timestamp and stopped; unrelated clusters were untouched.

Within that incomplete run, the **unchanged** Chronicle IndexedSearchTest passed every selective ACL/filter ANN recall@20 control at1.0, including6/6 and316/321 candidate yield, plus2048d recall1.0; ModelTransportTest4cases passed with actual65s header/body gaps (141s suite). These are scoped observations, not a substitute for final full execution. New runtime/DB adoption invalidates reuse as final integrated evidence.

Relevance Python workflow: `python3 -m unittest discover -s chronicle/eval/relevance/tests -v`,172cases passed; no runner/transport/prompt/corpus change, no live-provider claim.

Parent integration owns the fresh durable unfiltered Chronicle run after runtime+model commits, protocol, complete dashboard/Chromium/collector, native HTTP/JDBC/TLS/WS/recovery and complete service/client/migration gates. Those are not claimed complete here. No empty/filtered inventory is acceptance. Keep all failed/incomplete receipts until final integration evidence is preserved.

Earlier53case receipts remain committed under `validation/20261103-controlled/`; they are historical evidence, not relabelled as the final55case run.
