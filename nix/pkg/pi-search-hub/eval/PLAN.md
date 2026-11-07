# Fusion experiment plan — registered 2026-11-07

Baseline source: `16c65271`. This plan is written before computing candidate
ranking metrics. It is not evidence of an improvement.

## Questions

1. Does the implementation obey document identity and one-vote-per-engine
   invariants? Reproduce defects separately from relevance experiments.
2. Is RRF(k=60) appropriate for shallow, heterogeneous result lists?
3. How sensitive is it to result depth, repeated/correlated sources, and the
   order of native citations (which is not necessarily a relevance ranking)?

## Public relevance benchmark

Use frozen public RanxHub MSMARCO passage runs for BM25 Pyserini, ANCE,
DistilBERT KD TAS-B, DistilSPLADE Max, TCT-ColBERT v2 HN+, and uniCOIL.
Use independently judged TREC DL 2019 as development and TREC DL 2020 as held-out.
Record download URLs, content hashes, model identities, query counts, missing
runs and judgment coverage. Do not synthesize relevance labels from agreement.

Compare fixed rank-only candidates on identical pools: RRF k=0,10,20,60,100;
rank-biased centroids p=0.5,0.8,0.9,0.95; and a linear rank/Borda baseline.
Study per-engine depths 4 (current targeted-main default at output10),10,20,100.
Use depth10 for development selection; other depths are sensitivity studies.
The first six runs are equally weighted. No quality weights are learned from
result counts or latencies.

Primary metric: macro nDCG@10, linear graded gains (TREC convention), unjudged
items counted as zero with judged coverage reported explicitly. Secondary:
MRR@10 and Recall@10 at relevance grade>=2, paired query wins/ties/losses,
bootstrap 95% intervals with fixed seed. Verify the metric implementation
against the published BM25 nDCG@10 before trusting comparisons.

Select the best rank-only candidate on development, then evaluate that fixed
choice against RRF60 on held-out. A production parameter change needs positive
held-out evidence, including a positive lower paired-bootstrap confidence bound
for nDCG@10 and no Recall@10 loss exceeding0.01. A benchmark win alone does not
establish that the same method improves live web metasearch. Do not choose a
second candidate based on held-out outcomes. Full held-out sensitivity tables,
if produced, are exploratory and do not authorize retuning.

### Data-access amendment (before candidate metrics)

The selected RanxHub S3 artifacts returned HTTP403, so the six-system experiment
cannot currently be executed from that source. Instead use the public
`GioiaZheng/msmarco-genqa` release `v2.1-trec-dl-baselines`, archive SHA256
`e7001a943beb1b1a220ef4a58fae445569725682dc0dbbcb0d9300473a360aa3`.
It contains BM25 and BM25+cross-encoder ranked outputs for the same 43/54 judged
TREC DL topics. Retrieve official qrels through the documented ir_datasets
content-addressed mirror and validate their published MD5 plus recorded SHA256.
The two systems are correlated (the cross-encoder reranks BM25's top100), so this
is a narrow rank-fusion test, not a substitute for a diverse six-engine web
benchmark. Published individual-system calibration metrics are already present
in the release manifest; candidate fusion metrics have not been computed.
Keep the same candidate grid, development/held-out split and metrics. Include
individual-system controls. Do not claim that this narrow benchmark establishes
a production parameter improvement, even if the earlier numeric threshold passes.

## Live public web diagnostic

Capture identical raw ranked lists once per engine/query, with query text,
requested/returned count, source identity, start/end times and errors, then
replay all algorithms without new network calls. Use only public queries;
never send private repository/session content. Preserve engine failures and
separate retrieval coverage from reranking. Include native-provider results
where configured/usable and document unsupported/auth failures.

Freeze query text and target predicates before capture. Use a small diverse
set of public documentation tasks with known authoritative target pages.
Measure target-page reciprocal rank/coverage, URL overlap, duplicate frequency,
source-order sensitivity and duration. These target checks are navigational
smoke evidence, not exhaustive human relevance judgments or semantic-quality
acceptance. Do not label all non-target results irrelevant.

## Decision and reporting

Keep correctness corrections distinct from quality changes. Report regressions,
uncertainty, incomplete judgments, corpus differences, unavailable engines and
latency. No deployment/activation is part of this experiment. Retain a reproducible
harness, frozen normalized inputs/manifests and a report; download caches and
raw generated logs are local-only unless explicitly selected for publication.
