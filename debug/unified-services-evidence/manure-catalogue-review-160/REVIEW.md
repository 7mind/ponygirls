# Independent immutable Manure catalogue/adoption review

Commit **1604637cf4c6d365f085d3f84866acb696a5b38d**.
Receipt **v1**, completed **2026-11-03 10:23:35 UTC**: **4 suites / 17 cases / 6 regression failures / 11 passing controls / 0 errors / 0 skips**. This is deliberately preserved red evidence, not acceptance.

Full git archive in this owned ignored directory; **1,995 tracked blobs** verified against exact Git blob IDs and SHA256 hashes after execution (`production-source-provenance.json`). All application/generated/runtime/common-library sources were session-bound to this archive. Host build/launcher inputs matched it. No source substitution, older DTO, production edits, commits, or new worktrees. Compilation used two active CPUs, one sbt task CPU and sequential suites to avoid competing heavily with the parent's native build.

## Actual legacy baseline, not new-dummy agreement

Read archived `manure/CONTRACT.md` §7.1, actual `manure/manure/storage.py:872–950`, and `manure/manure/domain.py:585–667`.

`probes/legacy_oracle.py` invoked actual legacy `ArtifactStore.init_artifact`, file chunk writes where applicable, and `publish` for **12 acknowledged names**. It then called actual SQLite-backed `list_artifacts`. Exact IDs, original metadata and manifests were exported in `legacy-oracle-v1.json`. Current MemoryMetadata and real PostgreSQL were seeded with those same acknowledged metadata rows and queried through current `Catalogue → Artifacts.catalogue → MetadataTxn` (not through a reimplemented expected comparator). These are catalogue metadata tests, not claims that new uploads or imported file trees were exercised by the matching cases.

For sorting, the oracle explicitly creates a separate **synthetic metadata variant** of those records, varying dates/counts/owners/visibility/state. It executes actual old SQLite pagination to obtain expected complete ID sequences. This controlled variant is not claimed as an acknowledged, filesystem-consistent lifecycle state.

## Reproduced functional regressions — three changes, both adapters

### 1. P2 — ROOT lower is not full Unicode casefold

`manure/backend/src/main/scala/manure/Domain.scala:31–34`; matching projection in `CatalogueProjection.scala`; selection in `Catalogue.scala`/`Metadata.scala`.

| Query | Actual old SQLite | Actual current Memory **and** PG |
|---|---|---|
| `strasse` | `STRASSE`, `Straße` | `STRASSE` only |
| `σ` | `ΟΣ`, `ος`, `οσ` | `οσ` only |

All five matching queries executed and logged before the aggregate assertion; the first unequal comparison makes each adapter's case fail. `%_`, embedded-NUL `\0needle`, and astral `𐀀` literal-query controls agree with old SQLite.

CONTRACT §7.1 explicitly requires Python Unicode casefold. Per parent's relayed owner answer, there is **no explicit USER approval** for the ROOT-lower replacement; an earlier agent task summary is not authority. The new policy label/comment does not make this an approved semantic change. Future pinned mapping fixes are not verified by this receipt.

### 2. P2 — case-equivalent ASCII query rejects a current-version continuation

`Catalogue.scala:47–48,63`: fingerprint hashes the raw query rather than its effective matching form.

Actual old SQLite: first `q=cat`, name/asc, limit=1 returns `CAT-two`; its own continuation with `q=CAT` succeeds with `Cat-three`.

Actual new Memory and PG: obtain each adapter's **own new current-version cursor** for `cat`, then continue with `CAT`; both return `DomainError` rather than the next page. **No old cursor is passed to new code.** This is not legacy codec/cursor-format compatibility. CONTRACT §7.1 says casefold-equivalent searches are the same effective option.

### 3. P2 — new 1024-character cap rejects previously admitted literal queries

`Catalogue.scala:77` adds `q.query.length <= 1024`.

Actual old SQLite accepts 1,025 ASCII `x` characters and returns an empty page. Both current adapters reject the same query with `DomainError` instead of an empty page. CONTRACT §7.1 expressly disallows an additional search cap beyond the HTTP request-line bound; this ASCII input fits the former transport bound. This probe exercises catalogue-domain admission, **not separately observed HTTP status**. Any explicit approval for this new functional restriction must be supplied separately; none was presented to this review.

## Passing targeted controls

- **18 complete sort traversals per adapter**, covering all nine sort fields in both directions, page size 2, exact actual-old-SQL ID sequences. NUL/astral names and owner IDs, requested-direction ID ties, nullable expiry last in both directions, adjacent binary64 timestamps, and counts `2^53`, `2^53+1`, `Long.MaxValue` are included.
- **Four filtered expiry traversals per adapter**, page size 1, compared with old SQL: never, future, past, and exact-now expiry; visibility/state filters run before limits.
- **Eight expected `bad-envelope` negatives per adapter**: four changed effective cursor options and wrong text/count/time/expiry position types. New cursors only; no old wire-format compatibility assertion.
- **Actual PG bounded hydration/plan:** corrupt an unrelated row's manifest bytes to invalid UTF8; current candidate query still returns exactly `limit+1=2` valid rows. Actual `EXPLAIN (ANALYZE, VERBOSE, BUFFERS, FORMAT JSON)` records a materialized ID/sort-key CTE with `Limit`, Actual Rows=2, and no manifest output in that CTE subtree. Plan retained as `catalogue-plan-v1.json`. This establishes bounded result hydration and narrow top-N tuples for this controlled query, **not constant-time queries, universal index coverage, or absence of heap/predicate scans**.
- **Response-body admission:** the exact standard middleware construction used by Main wraps the actual Http adapter. First actual public file response remains unconsumed (200); next request gets 503, Retry-After=5, Connection=close, without consuming its body. Partially consuming/finalizing the first content body releases the slot; the next request succeeds and reads `good`. This is in-process adapter/middleware integration, **not an Ember socket/keep-alive transport stress test**.

## First-adoption ordering remains intact with migration 3/backfill

Reused the **five actual converter handoff cases** from d1, not all ten prior probes:

1. Actual converter snapshot/import/verify → mark-writable → actual production `Main.resources` accepts and reads original `good`.
2. Same-size wrong bytes before mark: converter and Main refuse.
3. Identical complete byte inventory, replacement inode before mark: converter and Main refuse.
4. Same-size wrong bytes after mark, before first Main adoption: Main refuses.
5. Identical-byte replacement inode after mark, before first Main adoption: Main refuses.

All four negatives require exact `migration-required`, no root_owner table/binding, and unchanged write-authorization flag. Before/after snapshots assert unchanged authoritative rows/table inventory and target/control filesystem entries/dev/inode/modes/bytes; read-access timestamps excluded. Thus validation is still ahead of migration 3, catalogue backfill and destructive recovery for these rejected imports. The importer administrator transfers documented table ownership, then actual Main runs under the restricted runtime role; no admin-as-runtime fallback.

## Evidence / reproduction

- `probes-v1.log`, four `TEST-manure.*-v1.xml` files.
- `probes/{legacy_oracle.py,IndependentCatalogueSuite.scala,ConverterAdoptionSuite.scala,converter_fixture.py}`.
- `legacy-oracle-v1.json`, `catalogue-plan-v1.json`, `converter-evidence/`.
- `probe-source-v1.sha256`, `production-source-provenance.json`, `artifacts-v1.sha256`.

```bash
cd /home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-retrieval-shared
nix develop .#chronicle --command bash \
  shared/retrieval-postgres/target/review-manure-160/run-probes.sh FRESH_UNUSED_LABEL
```

Reuses the same frozen oracle/IDs; refuses existing receipt labels. Do not overwrite the red v1 receipt when rechecking a newer commit: archive the new commit in a separate directory and bind its sources explicitly.

SHA256:
- Final log: `f5eb6f1d1c81f73b9e8a779ff8acc30e54b1a877741f4be339b6b731d522dd5d`.
- Source-input manifest: `a3df2ffd97433c4ff1de970663b807ca2f6368563c59a3d8de7bbb4c3f3ac5e5`.
- Legacy oracle: `89c7d0f5729db8d559d755895cda44f60c1c566b201efb1fa9bdd9ca8f82bc19`.
- Probe source: `1b22e00c225138d39b4e895e9d0ccbfcee5117be6620773452839bafa1750729`.
- Full archive provenance: `bd38b41b0f87c47d1696ad5accd5d828010db063964876ae830b7ccab6056ac0`.

Owned PG shut down at **10:23:35.653 UTC**; fixtures cleaned. Service/PG/model/credential environment scrubbed, controlled synthetic data only, no external model calls or live credentials. Earlier fe75/7f/d1 evidence remains separate and untouched. **No native AOT, whole-port, full target/browser/relevance, heartbeat correctness, or post-write restart acceptance is claimed.** The owner's separately reported full Search fixture KeyError was neither rerun nor adjudicated here.
