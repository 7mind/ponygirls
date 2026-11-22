# ann-recall-probe: read-only recall of Chronicle search's ANN leg

`ann-recall-probe.py` measures how well the product's semantic (HNSW) leg finds the nearest rows. It takes one reader's
visible rows, as they are, and reports **recall@10 and recall@100** of the leg against an exact scan of the same rows,
each with a seeded bootstrap 95 % interval. It is the follow-up of the acceptance run H's open criterion (3).

## Safety
It writes nothing and makes no model call.

**One transaction.** Everything runs in one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction, as the
product's searches do, so the ANN legs and the exact scan see one snapshot. The probe asserts
`transaction_read_only = on`.

**Timeouts: a bounded lifetime on every PostgreSQL version.** The time budget is `--max-seconds` (default 900).
- Every statement inside the transaction runs with `statement_timeout` = min(`--statement-seconds` (default 300), the
  budget left). None starts once the budget is gone.
- `idle_in_transaction_session_timeout` (`--idle-seconds`, default 60) is set as a backstop against a stalled client.
- `lock_timeout` (`--lock-seconds`, 5) is set.
- On PostgreSQL ≥ 17, `transaction_timeout` = the budget is set as well.
- The values in force are recorded in the output (`limits`).

**Budgets.** It aborts with nothing reported (exit 2, `ABORTED …`, rolled back) when any of these is exceeded:
- `ch_search_chunks` is estimated (`reltuples`) above `--max-table-rows` (default 20,000,000), checked before any scan;
- the exact pass returns more than `--max-exact-rows` (default 2,000,000);
- more than `--max-short` legs (default 5) return fewer than 100 rows (each would need its own exact scan);
- a timeout fires.

**Vacuum.** The snapshot holds back vacuum for at most `--max-seconds`.

**Connection.** It uses libpq's environment (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, a `.pgpass` or `PGSERVICE`) or
`--dsn`. It never reads or prints a credential. A read-only role that can read the `ch_*` tables suffices.

## What it measures
**Queries.** The **baseline** run samples N stored vectors (`--queries`, default 200, at least 200) of the reader's
visible rows: the rows with the smallest `md5(seed || ':' || id)` (`--seed`, default 20261122). No query text, no
embedding model.
- The baseline **saves the vectors** (with their source row ids, for the record) in its `--out` file.
- The **after** run **reuses exactly those vectors** (`--queries-from BASELINE.json`) and records their digest.
- Why: a fixed seed over mutable, retiring row ids would resample after growth or after rows are replaced, and so confound a change
  of the index with a change of the queries.
- The baseline also saves its exact top-100 neighbours per query (row id, session, distance), for the after run's
  turnover diagnostic.
- **The baseline file holds derived vectors** (embeddings of the reader's content). Keep it on the operator side, with
  the same care as the database; never put it in reports or chat. The probe writes every output as a new mode-600 file renamed
  over the target, so overwriting an existing file never leaves it readable by others. Only the printed
  summary and the counts may be shared.

**ANN leg.** For each query, the product's first semantic pass (`LegPass.Index`), mirrored from `Search.statement`:
- the per-row authorization inside the ordered index scan (`OFFSET 0`), with `Database.visible` for the reader;
- the publication predicate of the deployed version:
  - before L5 (62714e81): a row of the session's published generation;
  - from L5 on (`GenerationRows.publishedInfo`): also a retained row inside the published lineage version's piece
    segments;
- the profile compatible with the embedding space (`IndexProfiles.compatibleSql`);
- `ORDER BY l2_normalize(embedding)::halfvec(d) <=> l2_normalize(q)::halfvec(d)` (`CandidateSql.annDistance`), LIMIT
  1,000.

**GUCs** (`CandidateSql.configureStatements` and the first pass's scan budget):
- `hnsw.iterative_scan = strict_order`;
- `hnsw.ef_search = 200`;
- `hnsw.max_scan_tuples = 200000`;
- `hnsw.scan_mem_multiplier = 4`;
- the service role's `work_mem` (`--work-mem`, default production's `4MB`).

**HNSW confirmation.** HNSW use is confirmed **per query**: the index's own counter in this transaction
(`pg_stat_get_xact_numscans('ch_search_hnsw_d<d>')`) is read before and after each leg, and must grow. Otherwise the
probe fails: it was not the product's plan.

**Schema version.** `--schema auto` (the default) picks `l5` when `ch_lineage_segments` exists, else `pre-l5`.

**Exact scan.** The same visible rows (the product's exact set: `Search.visibleChunks`, and before L5 the rows
`authorized` admits), ranked by original-vector cosine distance. Equal distances are ordered as the product orders them:
- before L5 (4dfd4f48: `rerankCtes` and the exact pass): `distance, id`;
- from L5 on (`SearchPolicy.tieBreak`): `distance, session_id, ordinal, id`.

The leg's candidates are put in the same order before the credit. The scan reads the table once:
- One sequential pass serves every query. It keeps, per query, the rows within that query's leg's 100th original-vector
  distance. That distance is an upper bound of the exact 100th distance, because those are visible rows. Each row's
  vector is detoasted once.
- A leg shorter than 100 rows gets a separate exact scan.
- `--verify-exact N` cross-checks the pass, in the product's order, against plain exact scans ordered by the database
  for the first N queries (development).

**recall@k** (k = 10, 100):
- The leg's candidates are taken in the product's order: the product reranks them by original-vector distance, then
  the tie-break above.
- Each distinct row among the first k counts once if it is in the exact first k, or if its distance equals the exact
  k-th distance (a tie at the cutoff).
- Credits and denominators (k, or fewer when the exact list is shorter) are summed over the queries.
- The 95 % interval is a seeded percentile bootstrap over queries (2,000 resamples).

**Limits.**
- It measures the first pass only. From L5 on, a short first pass triggers the product's second pass; the probe reports
  the number of short legs.
- A query vector is a stored row, so that row itself is normally found by both lists.

**Output.** A summary per k (`credits/of = recall`, 95 % interval), and with `--out` a JSON file with every per-query
credit, the settings read back, the server and pgvector versions and the snapshot time.

## How to run it
Run it from a host with read-only database access to the Chronicle database. Use the account whose sessions are searched
(production: the owner of the sessions), and the same seed every time.

```
# Baseline: before the L5 deployment (the pre-L5 schema is detected). Saves the query vectors: keep the file private.
PGSERVICE=chronicle-ro python3 chronicle/scripts/ann-recall-probe.py measure --reader <account> --out ann-recall-baseline.json

# After: 24–48 h after the L5 deployment, once the indexing backlog is empty (no indexing job queued or running),
# reusing the baseline's query vectors.
PGSERVICE=chronicle-ro python3 chronicle/scripts/ann-recall-probe.py measure --reader <account> \
    --queries-from ann-recall-baseline.json --out ann-recall-after.json

# The comparison: exit 0 no defect, 1 a defect, 3 refused (incompatible runs).
python3 chronicle/scripts/ann-recall-probe.py compare ann-recall-baseline.json ann-recall-after.json
```

Run it in a quiet hour. Production is quietest 04:00–09:00Z (`reports/deploy4/PREP.md`).

**Cost.** The ANN legs take N index scans. The exact pass reads every visible row once and computes N distances per row
on one backend. At 16,000–20,500 visible rows it took 13–15 s locally. Scale the time budget to the table: ≈ N × rows × 0.5 µs of
CPU, plus one read of the table and its TOAST. If the budget aborts, rerun with a larger `--max-seconds` in a quiet hour
rather than fewer queries.

## The comparison rule (verbatim)
**"a drop of the after-value below the baseline's 95 % interval at either k is a defect to fix"**

`compare` applies it per k = 10 and 100: the after run's recall below the baseline's lower 95 % bound is a defect.

**Refusals.** `compare` first refuses incompatible runs (exit 3) and says why. Both runs must have:
- probe version 3;
- at least 200 queries, and neither a `--trial`;
- the same reader, owner-target profile, embedding space, dimensions, HNSW index, ANN GUCs including `work_mem`,
  candidate limit, k set, seed and N.

The schema variants must be the same, or pre-L5 → L5 (the deployment). The after run must have reused the baseline's
query vectors: its `queriesFrom` and query digest must equal the baseline's digest.

**Known false-alarm property.** The interval covers the baseline's query sampling only. With a fresh query sample, a
second measurement of unchanged data falls below it at a given k about 8 % of the time. An earlier version of this probe
did resample, and its trial showed such an alarm on identical data. With the queries reused, as the gate requires,
unchanged data and index give exactly the baseline's values (see the trial), so the remaining false-alarm risk is the
bootstrap interval's own.

**Growth.** Data growth between the runs lowers recall by itself: in the local trials, +28 % and +16 % visible rows of
uniform synthetic vectors, with an unchanged index configuration, fell below the interval. Both runs record their
visible row counts, `compare` prints them, and the diagnostics below separate new rows from the rest.

## Diagnosing a "defect" verdict (not part of the rule)
Both runs print two diagnostics, and `compare` repeats the after run's. They are reported with counts, never as a
verdict.
- **Recall by neighbour cohort.** recall@k split by the generation that wrote each neighbour, with the credit rule
  above:
  - *root*: a generation without a lineage version, or version 0;
  - *lineage versions*: version ≥ 1, the rows of incremental publications;
  - the denominators are the cohort's exact neighbours.
- **Exact top-k turnover against the baseline** (after runs only). The same query vectors are used, and neighbours are
  matched by content (session and distance), so a row republished under a new id counts as the same neighbour.
  - Entrants are either **new rows** (nearer than the baseline's 100th neighbour yet absent from its top 100: not
    visible then) or **promoted** (already visible below the baseline's top k: nearer rows left).
  - Exits are either **displaced** (still visible) or **gone** (no longer visible).
  - Together these show how much of the answer change is new rows rather than the index.

**A "defect" verdict must be diagnosed with these before it is attributed to L5.**
- Growth alone can trigger it: in the local trial, about +16 % visible rows (a new lineage version, some rows deleted)
  fell below the interval at both k. 16 % of the exact top 10 were new entrants, of which 301 of 314 were new rows.
- Neither diagnostic isolates incremental publication causally. Both cohorts share one HNSW graph, so a cohort
  difference can come from insertion order, age or content rather than from the publication path. A same-corpus
  counterfactual, the same rows published both ways, needs an offline control: H's comparison of an incremental head with
  forced-full roots.
