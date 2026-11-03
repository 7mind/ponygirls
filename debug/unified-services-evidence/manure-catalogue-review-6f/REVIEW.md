# Independent unchanged-contract fix verification — Manure6f

Immutable commit **6f6369b082df84f9f5ce261d2f7bfc3a368b1771**.
Receipt **v1**, completed **2026-11-03 10:34:35 UTC**: **4 suites / 17 cases / 0 failures / 0 errors / 0 skips**.

This is the planned fix rerun of the red160 contract, not a new suite or whole-port acceptance. All four probe/helper files and the frozen actual-old-SQLite oracle are **byte-identical** to `../review-manure-160/`; comparison hashes are recorded in `production-source-provenance.json`. Only the owned runner's archive/PG-temp paths changed. Inherited test names/log labels still say `160`; **actual production inputs are6f**, bound by MANURE_SOURCE_ROOT and sbt session overrides.

## Results

All six previous failures now pass (three regressions in each actual Memory/PG adapter):

- `strasse` finds `STRASSE` and `Straße`; `σ` finds `ΟΣ`, `ος`, `οσ`, matching the frozen acknowledged legacy names/IDs.
- Each adapter's own current-version `cat` cursor continues with `CAT` and returns the expected next page. No legacy cursor is supplied.
- A 1,025-character literal query is admitted and returns the expected empty page.

The same controls remain green:

- 18 complete nine-sort/direction keyset traversals and four expiry/filter traversals **per adapter**, compared with actual old SQLite ID sequences; NUL/astral ordering, null-last expiry both ways, adjacent binary64 dates and counts beyond 2^53 included.
- Eight expected bad-envelope cursor-option/type controls per adapter.
- Actual PG materialized narrow ID/sort-key CTE, LIMIT2 and exactly two hydrated rows despite an unrelated invalid-UTF8 manifest. Actual EXPLAIN ANALYZE retained in `catalogue-plan-v1.json`; this is not a constant-time/no-heap-scan claim.
- Same Main admission middleware with actual Http content body: first held response200, second503/Retry-After5/Connection-close/body untouched, partial-body finalization releases the slot and next request200 reads `good`. In-process middleware/adapter proof, not an Ember socket stress test.
- All five actual converter→PG→Main cases: authorized original positive; wrong same-size bytes versus identical-byte replacement inode, both before mark and after mark/before first adoption. Four negatives require exact migration-required, absent adoption, unchanged authorization and unchanged target/control FS entries/identities/modes/bytes plus authoritative PG rows/table inventory. First-adoption validation still precedes migration3/backfill/recovery for these cases.

## Coherence and provenance

Full archive: **2,000 tracked blobs** verified against immutable Git blob IDs and SHA256 after execution. App, generated contracts, storage/JNI and every Manure common-library dependency were bound to this archive; host build/launcher inputs matched. No older DTO, production patch, assertion change, regenerated/randomized oracle or model call. Low-CPU2/serial tests and a bounded owned PG fixture; PG stopped **10:34:35.975 UTC**. Tracked worktree clean; old160 red report/logs unchanged.

Key SHA256:

| Artifact | SHA256 |
|---|---|
| `probes-v1.log` | `26dbfeb3bd7397336338ab9bb48433a7d9183c0b01b7c78b23f9665cfee1a748` |
| `probe-source-v1.sha256` | `bd20358826cab22fb99b8bbb3b7a0e8592754bc655609f1b2b2747d72d1f4a25` |
| `production-source-provenance.json` | `408b010d563e9ad1aa1e810834207df74345699daf45b0954d89e1032ef0e358` |
| Unchanged `probes/IndependentCatalogueSuite.scala` | `1b22e00c225138d39b4e895e9d0ccbfcee5117be6620773452839bafa1750729` |
| Unchanged `legacy-oracle-v1.json` | `89c7d0f5729db8d559d755895cda44f60c1c566b201efb1fa9bdd9ca8f82bc19` |

Four fresh `TEST-manure.*-v1.xml` files show5+5+2+5 cases, all zero failures/errors/skips. Reproduce only with a fresh unused receipt label:

```bash
cd /home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-retrieval-shared
nix develop .#chronicle --command bash \
  shared/retrieval-postgres/target/review-manure-6f/run-probes.sh FRESH_UNUSED_LABEL
```

## Canonical source identity and separate helper-path defect

Parent clarified that **107** belonged to Haystack, not Manure. No extra Manure files were invented.

Independently applying the archived `manure/scripts/artifact-source.py` file-selection rules **relative to this archive root** produces **103 entries** in `artifact-source-relative-v1.sha256`, SHA256:

`47254639baf0cb31a8e412ad64fcdf4c2ca1ff22fd0eadaeb395e50183675e97`.

The unchanged script itself incorrectly tests excluded components against absolute `p.parts`. Because this review archive has an ancestor named `target`, it emits only four top-level entries. Its actual output is preserved as `artifact-source-raw-ancestor-target-v1.sha256`. Independent read-only `artifact-source-path-review/test_path_selection.py` fails first (1 test/1 assertion failure/0 errors) comparing the actual four-entry output with the expected root-relative103 selection; log retained alongside it. Proposed owner fix: inspect `p.relative_to(root).parts` for both target and .git exclusions. **No production script was patched here.**

This is a path-dependent helper defect, **not evidence that the actual Nix-built Manure manifest is invalid**: the parent reports that filtered build source has no target ancestor. The root-relative fingerprint is a source-selection identity, not an attestation of an uninspected packaged JVM/native artifact. Method and clarification are explicit in `artifact-source-generation.json`.

## Scope limits

No native AOT, whole-service/browser/recovery release acceptance, exhaustive Unicode-table verification, heartbeat, new publish-lastActivity fix, or post-write restart gate is claimed. The parent separately reported a real last-row sweeper/orphan-stage restart defect in6f; this unchanged17-case result does **not** cover or override that failure. Any later guard correction requires its own coherent source/provenance and focused verification. No new sweep cases or altered assertions were added to this rerun.
