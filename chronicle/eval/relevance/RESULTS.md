# Real semantic search evaluation: first held-out cohort

Measured 2026-10-29. These are retained first-attempt results, not an accepted
answer-quality release or a population-accuracy estimate.

## Controlled inputs

- One immutable publication: 25 synthetic source sessions, 24 real Problem
  chunks. Reader sees 22 chunks; a separate restricted principal sees two.
  Runtime-only Context remains archived and readable, but unembedded.
- Twelve held-out questions: nine positive and three negative; three modes per
  question, with fresh isolated tools-only conversations.
- Configured answer model: `deepseek-ai/DeepSeek-V4.1-Flash-1017`, with the exact
  deployment revision bound in local run artifacts; requested reasoning `max`,
  `max_tokens=65536`, 900-second deadline.
- Real `google/embeddinggemma-2`, revision
  `914f7f89142e33e77833254d9c9b90c3cef7303b`, verified local weight files,
  `vllm-0.32.0:bf16:text-only:8192:mean:768`. Query prefix:
  `task: search result | query: `; document prefix: `title: none | text: `.
- Identical literal fixed queries, publication, profiles, authorization rules
  and scoring across modes. No scripted-provider or constant-vector quality
  evidence is included.

Publication SHA-256:
`9bb42c3332f675089949e0020ae88183e10823c1425191eb09618861f4de9734`.
Fixture SHA-256:
`c79739ea73edc3c01af9afb6e1678feb53fdefe1a355ceab669191f3339af306`.
Proposition rubric SHA-256:
`b64ef539a6983ce6ad76e6de4c406e9bb287baf1cb93909acc7072ef82b9cc9d`.

The C5 uniform strategy and additive proposition-support-v2 answer criterion
were frozen before held-out calls. Original strict scores remain available;
no alias or relevance judgment was expanded after evaluation. V2 still requires
ordered literal-alias matching after case folding/whitespace normalization.
A correct paraphrase can therefore fail despite valid JSON and grounded facts;
that mismatch is not a parsing error or necessarily a false factual claim.
This proxy alone cannot rank factual correctness across paraphrasing styles.

## Results

| Measure | Lexical | Semantic | Hybrid |
|---|---:|---:|---:|
| Fixed query finds every required source within five, positives | 1/9 | 9/9 | 9/9 |
| Native Complete | 11/12 | 11/12 | 11/12 |
| Original strict positive answer success | 6/9 | 6/9 | 5/9 |
| Frozen V2 positive answer success | 8/9 | 6/9 | 7/9 |
| Completed correct negative abstentions | 2/3 | 3/3 | 2/3 |
| Post-hoc substantive positive correctness | 9/9 | 8/9 | 9/9 |

The last row is independent review of answer meaning, **not** a replacement
acceptance criterion. All 26 completed positive answers were judged
substantively correct. The missing Semantic q07 answer remains a failure.

**Frozen Hybrid acceptance was not met:** 7/9 positive supported answers is
below 8/9; 2/3 negative abstentions is below all three; critical q09 fails frozen
value matching. Retrieval and authorized-private-positive targets passed.
There is no demonstrated Hybrid answer-quality superiority.

### Distinct failure mechanisms

- **Semantic q07:** local `mcp-context-limit`, after 33 tool calls. Both facts
  appeared in the first search and were confirmed in original messages by
  call three. The run continued searching and produced no final answer.
- **Hybrid q15:** local `mcp-context-limit`, after 60 calls, with no supporting
  source for the requested absent fact.
- **Lexical q15:** `model-output/truncated`, after 41 calls, with no final answer.
- **q06, all modes:** correct explanatory sentences are outside frozen concise
  aliases. Each also cites an actually observed rejected-proposal passage from
  d10, outside frozen relevant=[d09]; citationValidity is 0.5. This is not
  alias-only, fabricated text or an authorization leak.
- **q09, Semantic/Hybrid:** true explanatory sentences are outside frozen value
  aliases, although the required propositions are supported.

Saved tool-message/call components alone consume 500,995 and 502,002 bytes in
these two context failures, near the 524,288-byte complete-request guard. Those
are partial reconstructions, not full request measurements. The retained
failure category covers bytes, depth and element count; the exact violated
counter is unknown. This does not establish provider context-window exhaustion
or which response portion used the truncated output allowance. Hidden reasoning
and raw provider bodies were not inspected or stripped.

## What reranking does

Semantic selects up to 1,000 authorized compatible chunks using normalized
halfvec candidates, then reranks those candidates by full-vector cosine.
Hybrid unions up to 1,000 vector and 1,000 lexical candidates, recomputes both
ranks over that union, and scores each candidate as:

```text
1 / (60 + vectorRankInUnion)
+ (lexicalScore > 0 ? 1 / (60 + lexicalRankInUnion) : 0)
```

Lexical-only candidates also receive a vector term. The best chunk represents
each session. There is no learned/cross-encoder reranker, and this score is not
an answer-confidence probability. See [SQL diagnostics](SEARCH-DIAGNOSTICS.md).

The held-out SQL loss ladder captured 24 Semantic/Hybrid cases with fresh real
query vectors. Exhaustive full cosine, exact chunk budget, normalized-halfvec
selection/full rerank, and actual production candidate rerank all find every
required positive source within five. Alternative membership RRF does not
improve these outcomes. No measured traversal, precision, candidate-budget or
fusion relevance loss justifies changing production ranking here.

This corpus fits below the candidate budget. These results do **not** establish
production HNSW index use, ANN scaling, corpus-wide recall or generalization.
Document vectors embed piece text; FTS additionally uses final summaries/tags.
The SQL query vectors are fresh pinned-model outputs, not captured native HTTP
query responses.

## Separate development policy experiment

After opening the first held-out results, a new development-only experiment
compared requested function reasoning `high` with `max`. Annotation policy,
model/revision, 65536 output-token allowance, 900-second deadline, all guards,
C5 prompt, corpus, gold and V2 criterion remained unchanged. Two four-question,
three-mode replicates per arm ran serially HIGH–MAX–MAX–HIGH: 48 fresh genuine
conversations on the same publication. Publisher and executor artifacts were
bound separately; all actual catalog policies/revisions/limits were checked.

| Development measure | HIGH | MAX |
|---|---:|---:|
| Native Complete | 24/24 | 24/24 |
| Context-limit/output-truncation failures | 0 | 0 |
| Frozen V2 positive successes | 11/18 | 12/18 |
| Frozen V2 negative successes | 6/6 | 5/6 |
| Frozen V2 total | 17/24 | 17/24 |
| Observed authorization leaks | 0 | 0 |
| Comparison-condition violations | 0 | 5 |
| Tool calls, descriptive only | 175 | 217 |

MAX's five condition violations occur in one negative Lexical cell: five
queries omit the required project filter. They keep Lexical mode and return
zero hits, but invalidate that cell's comparison condition. Native Complete is
not an answer-success or protocol-compliance judgment.

**HIGH was not adopted.** The prospective rule required fewer resource failures
than MAX, among other conditions; zero versus zero cannot satisfy it. Lower
call counts, aggregate score parity or post-hoc interpretation do not replace
that rule. The repository's existing MAX function policy is retained; no deployment or
service activation was performed for this local candidate experiment.

The full candidate backend suite passed 771 tests in 96 suites, with no
failures/errors/skips; that establishes code regression checks, not model-policy
quality. Requested catalog metadata does not prove provider enforcement of an
effort parameter. One implementation branch covers the GlmMaxReasoning family,
but only the pinned DeepSeek configuration was exercised remotely. ABBA order
balances simple position effects, not provider randomness, nonlinear load or
caching. These are repeated development questions, not a new untouched holdout.

All 48 original outcomes and per-case diagnostics remain available, including
individual score regressions hidden by aggregate parity. Assessment-code
identity, original failures/answers, fresh conversation identities and unchanged
publication/executor bindings were checked. The original held-out failures and
gates above remain unchanged.

## Integrity and reproducibility

All observed forbidden-identity/content checks and comparison-condition checks
passed. The controlled owner-separated fixture does not establish general
sharing/revocation security. Semantic negatives may legitimately return
unrelated authorized neighbors.

Original attempts, answers, exact source/view citations, native failures,
publication fingerprints and cleanup outcomes were retained. Both owned jobs
cleaned up without errors; external embedding/model services were not managed.
Parent regenerated the SQL report and confirmed every task field of the
portable assessment against the frozen original operator across all 36 cells.

Use [the workflow](README.md), [captured-batch assessment](BATCH_ASSESSMENT.md)
and [the proposition policy](PROPOSITION_SUPPORT.md) to reproduce checks.
A subsequent policy experiment is separate diagnostic/regression evidence:
it cannot make this cohort untouched again or retroactively pass these gates.
