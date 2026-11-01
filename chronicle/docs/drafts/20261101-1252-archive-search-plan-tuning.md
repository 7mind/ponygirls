# Archive search: bounded literal candidates and managed PostgreSQL tuning

## Scope and deployment ownership

The user pushes, updates pins and activates. This follow-up did not activate a
package, restart a production service, change production SQL/settings or remove
the existing temporary service override. Request deadlines are unchanged.

Unicode literal behavior, Boolean membership, current-HEAD matching, historical
reads, ACLs, exact counts, pagination, ANN bounds and original-byte evidence are
preserved. These are query/access-path changes, not a lexical/model version bump.

## Controlled performance evidence

An earlier live authenticated browser query took 7.865s: lexical legs approximately
4.530s/3.014s versus ANN109ms/93ms. This is historical deployment evidence, not a
measurement of the new package. The host has128 logical CPUs and1.5TiB RAM;
PostgreSQL had128MiB buffers and a4GiB cache estimate.

The follow-up uses a protected full logical copy:3,172,439 fragments, lexical
version1, `pg_unicode_fast`, zero byte differences from each fragment's lowercase
value. No model/index workers modified the copied application database. A restore
rebuilds indexes and refreshes statistics: its old-expression GIN was2331MiB
versus approximately3552MiB in the earlier live observation. Do not attribute
compaction/statistics improvements solely to the new query.

The benchmark runs the actual parameterized SQL and `sourceSearch`, fixed vectors,
natural executed JSON plans and exact ordered kernel/full-result fingerprints.
Fifteen cases include Hybrid/lexical reported query, phrase, semantic-only,
rare/frequent/common/short/missing literals, three held-out terms, dotted-I/sigma
and an unauthorized reader. Timings exclude embedding HTTP and browser rendering.

| Fixed-copy stage | Reported SQL | Reported source search |
| --- | ---: | ---: |
| Fresh restore, original query,128MiB buffers |1394ms initial |1692ms |
| Original query,16GiB buffers |1159ms median | separately recorded |
| Earlier stored-value-only prototype |718ms median | kernel only; not an end-to-end result |
| Replayed stored-value-only migration plus fresh ANALYZE |2471ms median |2781ms; rejected |
| Selected migration017, final compiled query, sole partial GIN |606ms median |934ms median |
| Verified prepared-generic SQL control |851ms median |889ms median |
| First SQL after owned PostgreSQL restart |748ms |933ms, already warmed by the preceding SQL |

The selected final normal run has45 measurements. Together with two45-case
plan-setting control runs and a15-case restart sequence, all150 kernel and
complete source fingerprints/counts match the restored baseline. Each full source
measurement follows its SQL/kernel probes and is consequently warmed by them;
only the first SQL after restart has cold PostgreSQL buffers. OS caches were not
dropped; subsequent cases are not independently cold. Common/short/missing literals
were approximately56/42/15ms SQL; rare/frequent approximately82/340ms. Unicode
controls remain slower (approximately3s for dotted-I and1.5s for sigma); this is
not a universal subsecond claim. The new index is414MiB on this copy.

A `force_generic_plan` GUC alone did not make the EXPLAIN utility's inner plan
generic. Those original control results are retained but are not generic-plan
proof. The corrected probe uses PREPARE/EXPLAIN ANALYZE EXECUTE and verifies both
parameter references and `generic_plans=1, custom_plans=0` for all45 executed
SQL plans. This proves generic coverage of the compiled SQL, not that every
internal source-search materialization is generic. Prepared-generic short/common
SQL was approximately5.31s/1.58s, versus normal42ms/56ms; Unicode prepared SQL was
approximately6.6s. Normal source Unicode controls remained approximately3.1s.
These controls do not establish uniformly fast generic plans.

## Accepted implementation

- Whole fields are already lowercased before fragmentation. The exact predicate
  is now `fragment.value LIKE lower(escaped_pattern)`; it does not refold each
  candidate or substitute raw `ILIKE`.
- Migration017 creates `head_candidate BOOLEAN NOT NULL`. Initial seeding selects
  current revisions, then DEFAULT TRUE covers every subsequent ordinary insert,
  including old ingestion and late historical backfills. The mask is a complete
  candidate superset, not authoritative HEAD identity.
- A source revision trigger repairs the selected revision and prunes obsolete
  candidates using row-locked CTIDs with SKIP LOCKED. Locked historical rows may
  remain TRUE; required current-revision repair does not skip locks. Every query
  still joins authorized source/current revision, so extras cannot leak history.
- Literals containing at least two distinct known ASCII-alphanumeric trigrams
  use an explicitly materialized exact-match candidate relation. Other literals
  retain per-source early-exit EXISTS. This controls access policy, not matching
  semantics; it is neither a keyword exception nor a selectivity guarantee.
- Initialization runs existing migrations and normalization backfill before017,
  under the same advisory-lock protocol in a second transaction. Migration017
  drops the obsolete canonical GIN before seeding, builds the partial raw-value
  GIN, analyzes and records17 atomically. A failed transaction rolls back mask,
  index and marker. Replay repairs a missing index and optionally prunes extras.
- Migration006 no longer builds an intermediate historical GIN. Provisional016
  is superseded; databases with an existing16 marker can advance through17.
  Native resources include017. Historical content and lexical version1 remain.
- Completeness assumes supported writers omit the new column or preserve TRUE
  and enabled triggers. Arbitrary imports explicitly writing FALSE or disabling
  maintenance are outside that protocol and require reconciliation.
- Paddock persists16GiB shared buffers,128GiB effective cache,1GiB maintenance
  memory and I/O timing. Loopback/socket protections, I/O costs, durability,
  per-query memory, parallelism and JIT behavior are otherwise unchanged. Cache
  size is an estimate, not allocated memory; maintenance budgets multiply.

## Rejected designs and migration cost

Stored-value-only access regressed after actual migration/ANALYZE replay despite
its promising prototype. Statistics1000 made the reported query4814ms; it was
reset to the default and is not shipped. Array-key and bounded concatenation
candidates also regressed. Whole-revision concatenation lacks a safe full-domain
bound under PostgreSQL's1GiB datum limit. No auxiliary projection/extension ships.

A composite GiST rejected a valid4096-byte high-entropy fragment with `index row
requires11888 bytes, maximum size is8191`. Composite GIN admitted it but did not
produce sufficiently robust plans. This is why input-domain admission is tested,
not merely representative-corpus build success.

The actual017 rehearsal took65.410s for the migration block,1.461s for replay
cleanup and123ms commit on the copy, with zero omitted current fragments. This
is an outage estimate, not a production promise. Initial flagging with obsolete
experimental GINs still present was cancelled after319s; the selected migration
removes the obsolete canonical index before flagging. Historical data is retained.

## Correctness and validation

Fail-first tests cover the old expression index, populated legacy upgrade,
missing-index/marker recovery, candidate schema and global access policy. The
final focused run passed28 cases, including:

-237 Unicode differential cases,260 sliced fixed points and1,112,063 permitted
 scalar fixed points under the pinned engine; finite samples alone are not a
 universal string proof;
- valid maximum-width entropy ingestion and unchanged historical message/raw
 reads; populated column-less/prior16 upgrades and non-superuser migration DDL;
- late marker failure rolling back real mask changes, index and ledger together;
 normalization failure deferring017 and successful retry;
- actual REPEATABLE READ overlap and real backfill DELETE/reinsert paused at an
 observed advisory-lock barrier while same-source ingestion advances HEAD;
 SKIP LOCKED pruning, DEFAULT TRUE late extras, ACL/Boolean/current-HEAD joins.

| Required layer | Result |
| --- | --- |
| Final full unfiltered PostgreSQL backend, fresh inventory/XML |952 tests /110 suites; zero failures, errors or skips; source90f66e19 |
| Protocol |17 Scala tests /16 TypeScript fixture groups; API1.9.0 only |
| Dashboard |Typecheck,147 Node tests, complete browser command |
| Collector |Typecheck /125 tests |
| Relevance workflow |172 Python tests; no ranking/prompt changes |
| Paddock |71 assertions;29 native check evaluations;4 outputs realized; corporate17 suites/6 homes |
| Actual final native ELF |110/110 checks;66 ArchiveSearch responses /60 API cases;3 boots; verified cleanup |
| Native harness self-tests |20/20; new catalog assertions failed first against the old harness |

Protocol, dashboard, collector and relevance results reuse the earlier complete
runs, not fresh executions. Root verified no tracked differences between their
input anchorfec66e05 and final90f66e19 across the pinned shell/lock, build,
protocol/generated, client, scripts and relevance input trees.

The first collector run inherited diagnostic umask077 and invalidated its
intentional0644 fixture. The preserved failure was followed by an unfiltered022
rerun; no assertion was weakened.

Paddock's all-systems evaluation still encounters the pinned Ponygirls missing
`packages.aarch64-linux.durka` at flake.nix:83. The same failure was reproduced on
unchanged basef9ff6f65; native-host checks pass. This unrelated limitation was not
patched as part of search tuning.

The native run executes the ELF directly, not the package wrapper. It uses a
fresh synthetic database, actual HTTP ingestion/authenticated WS ArchiveSearch,
Unicode byte spans, ACL/history/cursor negatives, migration17/catalog/idempotence
and fresh database/process absence proofs plus error-checked credential unlink.
Credential unlink did not have a separately recorded absence observation. It is not ANN quality,
private-corpus native performance, OS confinement or deployment evidence.

Artifact binding: package `/nix/store/1wy40nnllvaglw033hs8kfgwq4ady0rq-chronicle-0.1.0`,
ELF SHA256 `7d4ddde25db1eb7a210eaa7c1856a83b2bc265634e97b50a6b16f11daaf44a79`,
runtime source `/nix/store/bbxnrsqy5w1sxdc37akz52bm7rl0lxrq-chronicle-server-source`,
harness SHA256 `82b1227deab04c6a37a31f30bed16c575d7c638cdc1eeb94de552cca9281728a`.
Its package receipt covers131 cases/13 selected suites, not the full backend.
The immutable native manifest binds77 runtime files to8451cb52. The later
90f66e19 adds only the real-backfill test; Root independently byte-compared all77
runtime files against that final full-suite source. A registered indirect GC root
outside the task worktree retains the tested package. Full-suite XML/inventory,
source-equivalence and native execution records remain separate evidence.

## Operator activation

Publish the Ponygirls commits and update the Paddock pin. Review other pending
Home Manager changes. From Paddock, build the intended profile without activation:

```bash
nix build '.#homeConfigurations."pavel@computeinstance-e00cd1eayd00hs9qas-x86_64".activationPackage' \
  --out-link .local/chronicle-search-home
```

The old runtime override would mask managed ExecStart. Remove only its unchanged
task-owned file immediately before your activation:

```bash
override="${XDG_RUNTIME_DIR:?}/systemd/user/ivm-chronicle.service.d/90-archive-search-latency.conf"
if test -e "$override"; then
  printf '%s  %s\n' \
    a366b0811d6d92256e597b1cef317bf14df3e92a6f9acca35bebd9c4319438d7 \
    "$override" | sha256sum --check --status || exit 1
  rm -- "$override"
fi
.local/chronicle-search-home/activate
```

Do not use `systemctl revert` or default `./setup` (which can autosave/fetch/push
and affect multiple users). Plan interruption through the setup→PostgreSQL/
embedding→Chronicle/collector dependency graph. Migration017 is transactional,
not an online index migration; completed17 is not rebuilt on ordinary restart.

After activation, verify the managed executable, absence of the obsolete drop-in,
actual PostgreSQL settings and the reported query through the reconnected,
authenticated dashboard. Systemd `active` or static HTML200 is not API readiness.
Remove `/run/user/1001/chronicle-archive-search-package` only after managed-target
verification and only if it still points to the old9ygvchnk package. No new live
speedup is claimed before that check.
