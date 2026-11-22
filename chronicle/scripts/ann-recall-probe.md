# ann-recall-probe: read-only recall of Chronicle search's ANN leg

`ann-recall-probe.py` measures how well the product's semantic (HNSW) leg finds the nearest rows. It takes one reader's
visible rows, as they are, and reports **recall@10 and recall@100** of the leg against an exact scan of the same rows,
each with a seeded bootstrap 95 % interval. It is the follow-up of the acceptance run H's open criterion (3).

## Safety
It writes nothing and makes no model call.

**One transaction.** Everything runs in one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction, as the
product's searches do, so the ANN legs and the exact scan see one snapshot. The probe asserts
`transaction_read_only = on`.

**Timeouts.**
- `statement_timeout` (`--statement-seconds`, default 300) and `lock_timeout` (`--lock-seconds`, 5) are set.
- On PostgreSQL ≥ 17, `transaction_timeout` (`--max-seconds`, default 900) is set; the client checks the same budget
  between statements.

**Budgets.** It aborts with nothing reported (exit 2, `ABORTED …`, rolled back) when any of these is exceeded:
- `ch_search_chunks` is estimated (`reltuples`) above `--max-table-rows` (default 20,000,000), checked before any scan;
- the exact pass returns more than `--max-exact-rows` (default 2,000,000);
- more than `--max-short` legs (default 5) return fewer than 100 rows (each would need its own exact scan);
- a timeout fires.

**Vacuum.** The snapshot holds back vacuum for at most `--max-seconds`.

**Connection.** It uses libpq's environment (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, a `.pgpass` or `PGSERVICE`) or
`--dsn`. It never reads or prints a credential. A read-only role that can read the `ch_*` tables suffices.

## What it measures
**Queries.** N stored vectors (`--queries`, default 200, at least 200) of the reader's visible rows. They are the rows
with the smallest `md5(seed || ':' || id)` (`--seed`, default 20261122). No query text, no embedding model.

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

**Exact scan.** The same visible rows, ranked by original-vector cosine distance (the product's `LegPass.Exact` set and
order). It reads the table once:
- One sequential pass serves every query. It keeps, per query, the rows within that query's leg's 100th original-vector
  distance. That distance is an upper bound of the exact 100th distance, because those are visible rows. Each row's
  vector is detoasted once.
- A leg shorter than 100 rows gets a separate exact scan.
- `--verify-exact N` cross-checks the pass against plain exact scans of the first N queries (development).

**recall@k** (k = 10, 100):
- The leg's candidates are taken in the product's order: the product reranks them by original-vector distance.
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
# Baseline: before the L5 deployment (the pre-L5 schema is detected).
PGSERVICE=chronicle-ro python3 chronicle/scripts/ann-recall-probe.py measure --reader <account> --out ann-recall-baseline.json

# After: 24–48 h after the L5 deployment, once its backfill/republication has settled (no indexing job running).
PGSERVICE=chronicle-ro python3 chronicle/scripts/ann-recall-probe.py measure --reader <account> --out ann-recall-after.json

# The comparison (exit 1 on a defect).
python3 chronicle/scripts/ann-recall-probe.py compare ann-recall-baseline.json ann-recall-after.json
```

Run it in a quiet hour. Production is quietest 04:00–09:00Z (`reports/deploy4/PREP.md`).

**Cost.** The ANN legs take N index scans. The exact pass reads every visible row once and computes N distances per row
on one backend. At 20,000 rows it took about 10 s locally. Scale the time budget to the table: ≈ N × rows × 0.5 µs of
CPU, plus one read of the table and its TOAST. If the budget aborts, rerun with a larger `--max-seconds` in a quiet hour
rather than fewer queries.

## The comparison rule (verbatim)
**"a drop of the after-value below the baseline's 95 % interval at either k is a defect to fix"**

`compare` applies it per k = 10 and 100: the after-run's recall below the baseline's lower 95 % bound is a defect.

**Reading it.**
- The interval covers the baseline's query sampling only. A second sample of the same data falls below it at a given k
  about 8 % of the time. In the local trial, seed 7 against seed 20261122 on identical data fell below at k = 10:
  0.6565 against [0.6580, 0.7035]. Keeping the seed keeps most sampled rows between runs; rows republished with new ids
  are resampled.
- Growth of the data between the runs lowers recall by itself. Record the visible row counts of both runs; they are in
  the output.
