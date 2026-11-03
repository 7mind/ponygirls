# Independent immutable Manure correction review

Commit: **d1e064e75a7fe6fd6a18a4406f9d84fbe8d1aa81**.
Final receipt: **v7, completed 2026-11-03 09:58:54 UTC; 2 suites / 10 cases / 0 failures / 0 errors / 0 skips**.

Full `git archive` snapshot: this directory. All **1,987 tracked blobs** independently matched the commit's Git blob IDs and SHA256 hashes after the final run (`production-source-provenance.json`). All application/common-library production source directories were bound to this archive by sbt session settings; no production source patch, extracted-symbol replacement, or older DTO substitution. Host build/launcher inputs were verified identical to the archive. Review additions exist only under this owned ignored target; tracked worktree remained clean.

## Actual results

| Probe | Result |
|---|---|
| Original fe75 FIFO reproduction | PASS: actual `SecretCodec.readHash` → common `BoundedSecretFile` rejected owned FIFO in isolated JVM within 2s. Not a full HTTP timeout test. |
| Original post-open PG connection-death reproduction | PASS: actual native content descriptor acquired before real owned PG backend termination; failed Resource acquisition left no `OpenFileHandles`. Root close reported only the intentionally still-held `OpenRootLeases`, before review cleanup. |
| Additional genuine COMMIT failure | PASS: after descriptor acquisition, callback returned successfully; real DEFERRABLE FK violation surfaced only at runtime-engine COMMIT (`23503`). No descriptor leak before review cleanup. |
| Original equal-timestamp newest-grant reproduction | PASS: exact tied clock/bound=1 with adversarial hash ordering retains new credential; new accepted, old rejected. |
| Original synthetic first-import wrong-root fixture | PASS: refused. Its old incomplete receipt format does not isolate the new physical-identity guard; the actual converter cases below do. |
| Actual converter authorized positive | PASS: original SQLite ArtifactStore acknowledged `good`; actual snapshot/prepare/import/verify produced OWNER/COPY/PAYLOAD/COMPLETE with COMPLETE binding exact PAYLOAD bytes. Actual mark-writable then production `Main.resources` accepted and `Artifacts.openContent` served `good`. |
| Actual converter same-size wrong bytes BEFORE mark | PASS: mark refused; Main refused `migration-required`; no root-owner table/adoption and writes_started stayed false. |
| Actual converter identical-byte replacement inode BEFORE mark | PASS: independent replacement copies the entire inventory unchanged and asserts a different inode; same rejection/no-adoption result. |
| Same-size wrong bytes AFTER mark, BEFORE first Main adoption | PASS: Main refused exactly `migration-required`; root-owner absent, acknowledged writes_started true retained. |
| Identical-byte replacement inode AFTER mark, BEFORE first Main adoption | PASS: Main refused exactly `migration-required`; same no-adoption result. This isolates identity rejection from byte-hash rejection. |

For **all four actual converter negatives**, snapshots before/after the rejected operation assert equality of: application table inventory; every row/all columns in artifacts, receipts, one-time grants, content grants and migration destination; and target-control filesystem entry inventory, dev/inode identities, permissions and SHA256 bytes. Access timestamps are deliberately excluded. Thus the no-mutation claim is stronger than merely observing a failed startup or root_owner flag.

The importer uses the separately owned fixture administrator; per archived `manure/backend/README.md:136–137`, imported table ownership is then transferred to the restricted runtime role, with only SELECT on migration control state. Actual Main runs as that non-superuser, non-CREATEDB/non-CREATEROLE, non-database-owner role, without database-wide CREATE. No administrator-as-runtime fallback.

## Implementation inspected

- `manure/backend/src/main/scala/manure/ImportReceipt.scala`: exact completion/manifest binding, control/payload identities, bounded raw inventory and first-adoption byte hashes.
- `Main.scala:89–131`: read-only import/root observation and validation precede schema work and first root-owner INSERT; both physical claims remain held.
- `Auth.scala:25–35`: exact old token/hash codec delegates actual reads to bounded common I/O.
- `Artifacts.scala` and `Metadata.scala`: failed-acquisition descriptor ownership and explicit newest-grant retention.

## Evidence and reproduction

- `probes-v7.log`, `TEST-manure.{ReviewCriticalSuite,ConverterAdoptionSuite}-v7.xml`.
- `probe-source-v7.sha256`, `production-source-provenance.json`, `final-v7-artifact-sha256.txt`.
- `probes/{ReviewCriticalSuite.scala,ConverterAdoptionSuite.scala,converter_fixture.py}`.
- `converter-evidence/`: preserved actual generated proof bytes for each fixture; `COPY.json`/`PAYLOAD.json` identify the real controlled source, destination and original payload inode.

```bash
cd /home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-retrieval-shared
nix develop .#chronicle --command bash \
  shared/retrieval-postgres/target/review-manure-d1/run-probes.sh FRESH_UNUSED_LABEL
```

Final log SHA256: `40b040d0ed2f3aa90221d9c8ee4b0591c5571932b3788ceebb7d10537c2b93a2`.
Final source-input manifest SHA256: `c541e3ec44937dfb57f05716b487a74bfaefd37bab74102dd5b8e9c6bbd08fc5`.
Full archive provenance SHA256: `5d9a0a8fb83f116ab51ea174e5e1e653e814b8ae3d3ec39f4e2f37731961b613`.

## Preserved history / limitations

Original fe75 red evidence remains untouched in `../review-fe75/`. Exact7f compile failure and three passing **converter-only** premark cases remain separate in `../review-manure-7f/`; no7f runtime probe pass is claimed.

All d1 intermediate receipts are retained: v1's positive fixture lacked documented table-ownership handoff (invalid fixture, not production defect); v2 passed nine cases. v3's extra commit-fault fixture incorrectly requested TEMP privileges (failed callback precondition, not a commit proof); v4 corrected this and passed ten. v5 reran the same ten because a proposed test-edit anchor failed before writing. v6 strengthened mutation snapshots and independent identical-byte inode replacement but had a helper-local undefined-variable error in the two replacement cases; v7 corrects that helper only and passes all ten. Earlier source variants are preserved as `*-v*.txt`; no failed evidence was overwritten.

All work used bounded owned filesystem/PG fixtures, scrubbed service/PG/model/credential environment and no external models/private data/live credentials. Disposable PG was stopped and fixtures cleaned. These are JVM + actual shared-JNI physical-filesystem probes, **not Graal native executable correctness, full HTTP/protocol/browser/dashboard/recovery/relevance validation, or whole-port acceptance**. Check-config CLI and general raw-filename robustness were not separately gated by this review.
