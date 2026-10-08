# Haystack — query performance notes (measured, Step 4)

No latency promises: these are single-machine observations (disposable PG
18.6, loopback socket, 5,000 synthetic docs), not delivery gates. Performance
targets, if wanted, are agreed separately (plan Step 11).

Method: `server/perf-measure.mjs` (disposable, not CI) loads 5,000 docs and
runs `EXPLAIN (ANALYZE, BUFFERS)` probes. Results 2026-10-08:

| Probe | Plan | Time |
|---|---|---|
| Selective id lookup | Index Scan `items_pkey` | 0.09 ms |
| Text `words @> '{needle}'` (1k candidates) | Nested Loop over GIN `item_search_words_idx` | 5.37 ms |
| Broad negation `NOT type=todo` (4.5k rows) | Seq Scan | 1.48 ms |
| JSON numeric `fields.n > 4000` (999 rows) | Seq Scan | 15.00 ms |
| Reverse link lookup | Index Scan `item_links_target_idx` | ~0 ms |

Disclosed scan cases (by design, not defects):

- Arbitrary JSON paths cannot all be indexed (`#> ` + generic GIN does not
  accelerate every path comparison). Pure-JSON predicates without a
  selective text/metadata/link clause scan current items. Mitigation path
  if measured workloads demand it: per-workload expression indexes.
- Broad negations (`NOT x`, `!=` over common values) scan; GIN/metadata
  indexes serve the selective conjuncts around them.
- Phrase checks filter GIN-narrowed candidates via segment streams
  (native `tsvector` was rejected for its positional/repetition limits).

Correctness is independent of these plans: the dummy and PG legs return
identical result sets (shared suite), whatever the access path.

Write contention (same host, `haystack_test`, 2026-10-08): 100 sequential
creates 183 ms (~1.8 ms/op); 100 concurrent distinct-key creates 80 ms;
single CAS update 5 ms. Racing same-key/replay outcomes are asserted for
correctness in the PG suite, not timed here.
