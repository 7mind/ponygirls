# Rank-fusion investigation — 2026-11-07

## Decision

**Keep RRF(k=60) as the default for now.** It is a defensible baseline, not a
query-aware semantic reranker and not a universal improvement over a strong
individual engine. The primary held-out experiment did not establish that a
parameter change improves quality. Correctness defects were reproduced and
fixed independently of those quality measurements.

The native subscription failures and requested panel separation were also
addressed: see [native/UI acceptance](../VALIDATION.md).

## What the implementation actually does

`extensions/dispatch.ts` sums `1 / (60 + rank)` per distinct document and named
engine, then breaks equal floating-point scores by contributor count and first
encounter. Representative title/snippet selection prefers richer text but does
not change the rank. There is no query/content relevance model in this step.

For short lists this is largely agreement voting. Rank1 contributes1/61,
rank10 contributes1/70: only a1.15× difference. Within a four-hit main list the
first/last ratio is just1.05×. Two rank10 votes therefore beat one rank1 vote.
Different engine IDs do **not** prove independent indexes or factual corroboration.
Longer lists also contribute more total mass; native lists and main/fallback
lists need not have the same depth.

`extensions/scoring.ts` is a separate optional engine-selection heuristic:
50% historical transport success,30% latency,20% returned/requested fraction.
That last term measures **yield**, not relevance. The current sequential
configuration does not use it to assign fusion weights. We did not manufacture
quality weights from latency, result counts or provider branding.

## Prior art and applicability

1. [Cormack, Clarke & Büttcher, SIGIR2009 — Reciprocal Rank Fusion](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf),
   [DOI10.1145/1571941.1572114](https://doi.org/10.1145/1571941.1572114).
   RRF avoids comparing incompatible retriever score scales. The paper's positive
   experiments and chosen constant do not establish an optimal constant for our
   shallow, unequal-depth web/citation lists.
2. [Bruch, Gai & Ingber — An Analysis of Fusion Functions for Hybrid Retrieval](https://arxiv.org/abs/2210.11934),
   [TOIS DOI10.1145/3596512](https://doi.org/10.1145/3596512).
   Their lexical/semantic experiments find RRF parameter sensitivity and advantages
   for calibrated convex score combination. Our common result contract discards
   original scores, and native citation order is not a verified relevance score,
   so importing that conclusion as a drop-in score-fusion change would be invalid.
3. [Bailey, Moffat, Scholer & Thomas, SIGIR2017 — Retrieval Consistency in the Presence of Query Variations](https://doi.org/10.1145/3077136.3080839),
   [author implementation](https://github.com/mpetri/rank_biased_centroids).
   Rank-biased centroids use geometric attention, proportional to
   `(1-p) p^(rank-1)`. Smaller p emphasizes the head; larger p is flatter.
   This supplies a useful rank-only comparator, not proof that its original
   query-variation setting transfers to our metasearch engines.

## Correctness corrections, not claimed relevance gains

Fail-first tests established that the imported implementation:

- lowercased paths/query values and stripped every trailing slash, merging
  resources that can be distinct;
- counted repeated rows from one backend as additional votes and depressed
  subsequent distinct-document ranks;
- skipped deduplication on the single-list path, allowing duplicate rows to
  consume the cutoff;
- could lose named-backend attribution when selecting richer untagged metadata.

The correction canonicalizes URL authority/default ports and removes page
fragments while preserving path/query case and slash semantics. Each engine
contributes once per distinct document. Single/multiple-list paths now share
that policy; duplicate list identities fail explicitly. It does not infer
redirects, strip arbitrary tracking parameters or claim that every URL alias is
resolved. All22 dedicated regression cases pass. No duplicate rows were observed
in the548 captured live hits; the counterexamples are real implementation
failures, not an estimated defect frequency in live traffic.

## Frozen public relevance benchmark

The [registered plan](PLAN.md) separates development from held-out evaluation.
The initially selected six-model RanxHub artifacts returned HTTP403. Before
computing candidate metrics, the plan was amended to a smaller available
[public BM25/CE release](https://github.com/GioiaZheng/msmarco-genqa/releases/tag/v2.1-trec-dl-baselines).
This contains two correlated systems: the cross-encoder reranks BM25's top100.
It is not a diverse six-engine benchmark, and model training/inference was not
reproduced. Exact ranked outputs, qrels and integrity hashes are pinned in
[data.lock.json](data.lock.json) and the release manifest.

- Development:43 judged TREC DL2019 queries. Held-out:54 TREC DL2020 queries.
- Candidates: RRF k=0,10,20,60,100; RBC p=.5,.8,.9,.95; normalized linear Borda.
- Primary depth10 per engine; predeclared sensitivity depths4,20,100.
- nDCG@10 uses linear graded gains to match the producer; MRR/Recall use grade≥2.
- All original single-system manifest metrics reproduced within1e-12 (in the
  final evaluator, exactly). No queries were filtered. Unjudged hits count as
  zero for nDCG and are separately disclosed; primary held-out top10 judged
  coverage was98.70% for both compared fusion methods.

Development selected **RRF k10**, tied with k20 and resolved by frozen grid order:
0.605180 versus k60's0.605030. Only that fixed choice, k60 and individual-system
controls were evaluated on held-out; there was no second selection on held-out.

| Held-out depth10 | nDCG@10 | MRR@10 | Recall@10 |
|---|---:|---:|---:|
| BM25 | .477316 | .628006 | .239364 |
| BM25+CE | .680057 | .825617 | .345430 |
| RRF60 | .617030 | .772399 | .320555 |
| Fixed RRF10 | .618977 | .781658 | .320555 |

The paired nDCG difference is **+.001947**,95% bootstrap interval
**[−.001176,+.007005]**, with3 query wins,49 ties,2 losses. Recall difference is0.
The interval includes zero and fails the declared primary promotion criterion.
Equal-weight fusion is also substantially worse than the strong CE control in
this particular correlated pair; fusion is not automatically an improvement.

| Held-out per-engine depth | RRF60 nDCG | Fixed RRF10 nDCG | Paired nDCG difference95% interval |
|---:|---:|---:|---|
|4|.509744|.509744|0 [0,0]|
|10|.617030|.618977|+.001947 [−.001176,+.007005]|
|20|.598967|.610833|+.011866 [+.003141,+.023654]|
|100|.598363|.619097|+.020734 [+.006643,+.038647]|

The deeper-pool results are useful predeclared sensitivity evidence: constant
and retrieval depth interact. They do not override the primary shallow-depth
criterion or establish web-search generalization. At depth4 the two-list union
can return fewer than10 documents; that coverage constraint is not a pure
reranking difference. Bootstrap used10,000 paired resamples, seed20260601.

A separate exact-rational reference check for k10/k60 on97 queries×4 depths×2
constants found **0/776 top10 ordering differences** from the measured binary-double
policies. Thus the reported tiny primary difference was not a score-rounding
artifact in these inputs. This does not redefine production numeric semantics.

## Frozen live web diagnostic

[Ten public documentation queries and target predicates](live-queries.json)
were frozen before capture. The actual configured plan used Exa, Brave,
DuckDuckGo, LangSearch, SearXNG, Codex subscription and Anthropic subscription.
All70 calls returned usable results. The
[normalized URL/rank fixture](fixtures/live-public-20261107.json) contains no
credentials or snippets. Actual TypeScript RRF60 and Python replay agree on all
10 full ranked pools.

Main engines requested10 hits for this collection, fallback engines3, native
engines10. Depth4 is a prefix counterfactual on these same pools, not a claim
that a fresh four-result API request would return an identical prefix.
The sampler uses Pi's built-in configured model runtime rather than loading
arbitrary extension packages; this is evidence for the two observed native
providers, not exhaustive plugin/provider availability.

These are **target-page** checks. Other returned pages are unjudged, not
irrelevant; successful target matching does not prove every answer/page correct.
All methods retained a declared target within the first10 for all10 cases.

| Method | Target reciprocal rank, depth4 | Target reciprocal rank, depth10 |
|---|---:|---:|
|RRF60|.7043|.6767|
|Fixed RRF10|.7043|.6933|
|RBC p=.5|.7833|.7750|
|Linear Borda|.7143|.7011|

RBC's stronger head preference is promising for these navigational tasks,
**not** a confirmed general relevance improvement: only10 queries, incomplete
judgments, exploratory live comparisons and unverified native source-rank semantics.
It is not being promoted as the production default.

Additional diagnostics:

- Exa alone matched a target for9/10 queries with target RR.85; RRF60 improved
  target coverage to10/10 but had lower target RR.6767. Coverage and head ordering
  are different obligations.
- Reordering only native citation lists100 times/query changed ordered top10
  about90.3% of the time for RRF60; mean top10-set Jaccard was.9204. Encounter
  order should not be described as a guaranteed relevance ranking.
- Adding an exact clone of the first native list under a new engine ID changed
  top10 ordering on all10 queries without adding URLs; mean set Jaccard was.5734.
  This deliberate stress test is not evidence that the real providers are clones.
- Highest observed mean URL-set overlap was Brave/Anthropic,.3101. Overlap alone
  cannot identify upstream independence or justify an arbitrary family weight.
- Collection median latency after discovery was20.475s, maximum25.204s, dominated by the native
  tier. Per-engine medians: Brave.879s, SearXNG1.137s, Exa1.563s, DuckDuckGo1.722s,
  LangSearch2.175s, Codex9.433s, Anthropic20.473s. These are this small cohort's
  observations, not latency SLOs. The user-requested always-queried policy remains.

## Next useful experiment

Collect blinded, graded relevance judgments for a larger representative web-query
set, preserving raw pools and declaring native rank semantics. Compare head-weighted
fusion, validated engine weighting and a query-aware reranker on a frozen held-out
set. Calibrated score fusion requires meaningful raw scores; content reranking
requires its own provider/runtime evaluation. Do not treat result counts, engine
agreement, subscription authentication or successful source extraction as relevance.

## Reproducibility and limits

See [README.md](README.md) for commands. Development report SHA256:
`9a5b2f1642b7cf958f78ef1e529a958b4cda240b78203f09402ac8b0ad9b9bcb`;
held-out:
`51f98babbc53c01b29b87ea023391372a6a384d76ec70c8d53c429c7e424a1ca`.
The parent independently regenerated both reports byte-for-byte after the worker.
Nix reruns the metric suite, source integrity checks, exact reports and installed
production parity. Controlled fixtures are not semantic quality evidence; the
live target cohort is not full relevance adjudication. No production deployment,
Home Manager activation or universal provider-entitlement claim is made.
