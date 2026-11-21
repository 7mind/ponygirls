# Does literal search improve reversible context archival?

**Decision: keep literal `find` for evidence that is already archived. Do not lower the archive thresholds or enable archiving by default.** In two live runs all three arms answered every question correctly. Compared with the pointer-only archive, find returned **80.4% less recall text in the first run and 69.6% less in the confirmation**. Uncached tokens went in opposite directions; total tokens rose in both. Keeping the originals in context was fastest in both runs on this deliberately fitting workload.

## First comparison — 21 November 2026

Totals for the same six scenario/model combinations in each arm. Each of the 18 sessions had a real acknowledgement followed by four questions; 18 of the 24 questions per arm referred to archived evidence, and six were self-contained controls. Genuine tool use was optional. Every call used the expected model route and returned usage. No model substitution, retries, missing rows or tool errors. All six matched triples had identical seeded histories and byte-identical stock/find v1 manifestations and stubs.

| Metric | Archive off | Stock pointer | Pointer + find |
|---|---:|---:|---:|
| Exact answers | 24/24 | 24/24 | 24/24 |
| Complete recall-result characters returned | 0 | 149,160 | 29,174 |
| Of those results, evidence text characters only | 0 | 139,338 | 14,201 |
| Recall-result characters **replayed** after first delivery | 0 | 357,110 | 116,597 |
| Provider uncached input tokens | 143,928 | 299,627 | 263,814 |
| Provider cache-read tokens | 559,808 | 685,952 | 830,912 |
| Total tokens incl. cache and output | 707,431 | 992,276 | 1,099,579 |
| Provider requests / recall tool calls | 30 / 0 | 45 / 26 | 57 / 30 |
| Summed session seconds | 46.7 | 82.6 | 81.1 |

`resultChars` counts the *complete serialized model-facing recall response* in UTF-16 units (including headers, addresses, JSON escaping, lists and empty results). It excludes the original history, which is why the off arm shows zero. Each first delivery and subsequent replay was verified against the actual provider request body. Replays are additional copies on the wire, **not** necessarily cache misses. Model tokens also include the rest of the conversation. Cost estimates at this run's configured rates were approximately $0.25 / $0.50 / $0.42 respectively; these are not invoices.

| Model (two sessions per arm) | Uncached input: stock → find | Returned characters: stock → find | Seconds: stock → find |
|---|---:|---:|---:|
| Token Factory DeepSeek V4.1 Flash 1017 | 98,431 → 88,655 | 49,173 → 14,610 | 22.5 → 30.2 |
| Token Factory Kimi K3.1 Pro | 101,511 → 87,772 | 49,818 → 7,282 | 26.5 → 22.5 |
| Codex GPT-6.2 Sol | 99,685 → 87,387 | 50,169 → 7,282 | 33.6 → 28.4 |

**When it helped.** On the first historical question (resolve a duplicate identifier), all six answers stayed correct. Returned characters fell **134,457 → 12,185**, uncached input **47,844 → 6,892**, and summed time **36.3 → 18.5 s**. Models could fetch the few alternatives rather than page through whole volumes.

**When it didn’t.** Those broad early reads remained in the stock arm’s history. On the final missing-record question the stock models made **zero** further recall calls; the find models made **nine**, including eight literal searches. On revision questions some searches required a second page; DeepSeek also tried broader terms. Overall find cut subsequent replayed recall text by **67.4%**, yet total tokens **increased 10.8%** because more provider calls processed the rest of the context. Wall time improved by only **1.8%** overall and regressed on DeepSeek. The result meets the predeclared gate through uncached input (**−12.0%**), not through a credible speedup.

**Why the off control matters.** At the first self-contained question, none of the arms called a tool. Across the six sessions, uncached input was **879** tokens with raw history and **101,500 / 102,226** after stock/find replaced the old tool results. This is consistent with losing reuse of a previously cached prefix. The study deliberately triggered archival far below the normal watermark; it does not test running out of context. Next research should compare *when* to archive under sustained pressure on new traces, rather than adding a semantic index or generating summaries for exact lookups.

## Confirmation on the integrated runtime

Post-pilot review identified two edge cases. In-memory tools can implement `toJSON()` so that what `read` actually returns differs from the object's transient text/order; the wrong coordinate space can produce a miss or an invalid excerpt. Also, Pi normally coerces tool arguments before execution (`null` can become the literal `"null"`, a fractional cursor can become an integer). Both failures were reproduced in tests. The final runtime `285583de` searches the verified serialized representation, verifies the exact bytes it serves on `read`, rejects malformed raw `find` parameters before coercion, and clarifies that an empty **first** page indicates absence. Existing list/read input handling is unchanged.

We repeated the full experiment on that packaged runtime with **the same frozen corpus, runner, scorer, models, schedule and stock baseline**. This checks the delivered code and illustrates rerun variance, not generalization to new data. All comparisons passed their source/schema checks; zero retries or errors. The table contains only the second run, not pooled measurements.

| Metric (confirmation) | Archive off | Stock pointer | Pointer + find |
|---|---:|---:|---:|
| Exact answers | 24/24 | 24/24 | 24/24 |
| Complete recall-result characters returned | 0 | 148,662 | 45,218 |
| Recall-result characters replayed | 0 | 305,830 | 141,529 |
| Provider uncached input tokens | 49,827 | 137,500 | 268,498 |
| Total tokens incl. cache and output | 707,065 | 924,353 | 967,998 |
| Provider requests / recall tool calls | 30 / 0 | 42 / 24 | 49 / 24 |
| Summed session seconds | 43.3 | 75.6 | 72.3 |

The repeated gate passed via elapsed time (−4.4%), **not** uncached input (+95.3%). Cache state was visibly asymmetric *before the first archive edit*: the acknowledgement alone reported 46,268 fresh input tokens for stub versus 141,744 for find. The baseline prompts were reused across runs; the candidate's tool description changed after review. Cache reuse is a plausible explanation, not a controlled causal attribution. At configured rates the second run was $0.31 for stock and $0.42 for find, reversing the first run’s cost direction. The strongest reproducible result is **less evidence to return and replay at equal observed correctness**, not a general cost or speed win. The first historical lookup also remained faster (36.7 → 18.4 s summed); on repeated lookups, carrying a previously fetched full volume sometimes saved a subsequent tool turn.

## Comparison protocol (set before scoring)

The existing extension replaces cold tool data with pointers. An exact read can recover the entire original by entry ID, digest and offset, but a model that knows the identifier of a fact may not know which entry or page to read. The candidate adds case-sensitive literal `find` across just the archived fields, with a short excerpt and a verifiable original-message JSON address for each match. It changes neither the selection policy nor the pointer text. It makes no summary/model calls and keeps no second index. The separate model-summary experiment is not a dependency.

Three arms run on the same synthetic evidence: archive **off** (full context), stock enabled **stub** (list/read), and **stub + find** (list/read/find). Off is a contextual control, not the comparator for promoting find. Fresh, independent sessions for each arm, scenario and model; four consecutive questions per session, so previous tool results and answers can remain in context across revisits. The first question does not require old data; subsequent questions test duplicate identifiers, superseded values and an absent record. A correct answer need not involve a tool call. Absence is only about these archived sources. The tasks and strict structured answer keys are frozen before live scoring; the models get no answer keys. Only synthetic evidence goes to providers; no tools that can read live files or access the network are exposed to the agent.

**Decision rule:** for the matched stub/find questions, lose no answer the stock stub got right; return fewer recall-result characters (measure the complete tool response, not just excerpts); and reduce either total provider-reported uncached input or summed elapsed time over the sessions. Track actual tool usage, prior recall-result characters replayed on later requests, total input including cache, and output separately. Treat operational errors, missing usage, a missing treatment or a mismatched seed as incomplete rather than a win. Compare behavior with the off arm and after zero, one and several revisits; do not treat a smaller model-visible archive as proof it cost less. Tiny live pilot, not a statistical claim. No changes to live preferences or to the previous fold branch.

## Reproduction, safeguards and limits

- Baseline: `62714e81`; runtime candidate: `6fd1ae16`. Gate set at `e2435b0b`, then synthetic loomhouse and cinema ledgers and exact JSON scorer frozen (`scripts/experiments/context-archive-find-fixtures.mjs`, SHA-256 `237879bee8c163baf6c244cb4e91f2461fb2bac57b2ba4c2cac1b6b95b1502d7`). Each ledger has three volumes, four occurrences of the duplicate ID, five entries for the revision ID, and zero entries for the missing ID despite similar identifiers. The original JSON of each volume fits a single stock read. The seven ordinary exchanges keep over 16,000 estimated tokens recent. Protocol precedence does not make the sample representative.
- Runner: `scripts/experiments/context-archive-find.mjs` at `cc0a6d3e`, SHA-256 `65612e05612c4c15ee377dc6fe62e6ee3577ab415db0c9d047181b3eab94ef69`. Six arm-order permutations across models/scenarios; compare within matched triples, not across tokenizers. Trigger/release were **0.1% / 0.05%** in all arms' settings, not a reduction in the real model context window; native compaction and automatic retries were disabled. Input/output limits, tool sets, questions, and scoring stayed fixed; stock and find legitimately advertised different tool schemas. Providers and cache warmth remain nondeterministic; order balancing does not eliminate that. One run per model/scenario/arm; questions within one session are dependent. Times are summed per-session wall time, not elapsed time of the three concurrently run cohorts.
- Re-run with Node 24, Pi 1.5.2, and packaged baseline and candidate extension indices. Run `node scripts/experiments/context-archive-find.mjs preflight NEW_DIR STOCK_INDEX CANDIDATE_INDEX deepseek` for auth/catalog, source checks and isolated SDK binding **without inference**. Replace `preflight` with `run` in a new directory for live calls; repeat for `kimi` and `sol`. Its header documents the two package path variables. Only the selected provider registration, synthetic messages and read-only archive tool (or no tool) enter scored sessions. The experiment is not run by CI.
- Validation: `nix build --offline --no-link .#checks.x86_64-linux.ponygirls-context-archive .#ponygirls-pi-extensions`. Both build; **103/103** offline tests passed for the first runtime and **105/105** for the final runtime, no skips. The real SDK exercised find after compaction while OFF and followed its offsets with `read`. Additional local checks verified 960 occurrence-specific address round trips in 160 generated Unicode/escaped JSON envelopes, including duplicate text in metadata. The shared resolver rejects ambiguous duplicated message IDs for manifested originals rather than returning a payload under the wrong hash. No new dependencies, index, persistence format, LLM call, or background job.
- Find still scans and verifies the branch; a bounded response does **not** bound scan work. A local in-memory 8 MiB/128-original fixture (7 timed calls after warm-up) had median times 19.7 ms for list and 16.6–23.6 ms for the three find queries. On the final implementation the corresponding medians were 17.8 ms for list, 16.9 ms for early hits, 39.9 ms for a last-entry hit and 48.3 ms for absence. This isolates the resolver, not the whole SDK, a production latency percentile, or a promise about much larger archives.
