# Context archive: which approaches earned their keep?

**Decision: keep the existing archive + literal `find`; do not merge log-only previews yet.** Showing the first and last 160 UTF-16 units of an archived CI report cut total model tokens in both runs, with **one additional passing patch** and no paired loss. But a 36% speedup became a 23% slowdown on repeat. That misses the rule fixed before scoring: rescue two distinct defect/model pairs, or save at least 10% work in each round without a >10% regression on the other measure. This is a narrow negative shipping decision, not evidence that a preview can never help.

## Methodology

Three public Python defects: empty-input interposition in `toolz`, equality and hashing of oversized `more-itertools` ranges, and integer-like indexing in `python-semver`. Each upstream parent reproduced the regression. Applying **only the upstream target-module change**, through the same edit mechanism used for model submissions, passed all 55, 36 and 66 designated tests respectively. These were real upstream test subsets plus four independent edge tests per defect, not the full projects' CI.

DeepSeek V4.1 Flash and Kimi K3.1 Pro (Token Factory) and GPT-6.2 Sol (Codex) each attempted all three repairs under RAW, stock FIFO + `find`, and FIFO + log-only preview. Two counterbalanced rounds, new sessions, same buggy sources, failing reports and tools. After seven synthetic intervening exchanges we forced an eligible boundary; this tests **what to show once archived**, not when production should archive. The experimental arm exposed ≤160 verbatim characters per end of the *log*; the other old text stayed a pointer. Models could look up evidence and inspect the pristine target file. We applied submitted edits to fresh parents and ran tests in isolated, no-network Python processes; there was no test feedback or retry. Tokens include the warm request and all model/tool continuations. Times exclude offline grading. Public fixes may be familiar to a model, and three one-module defects are not a general coding benchmark.

## New test: real repairs

All **54/54** sessions completed, produced applicable edits and received a test verdict. Each round had nine matched model/defect combinations per arm. Values below are **round 1 / round 2**; time is summed across sessions, not the elapsed time of concurrent jobs.

| What the model saw | Repairs passing all tests | Total tokens | Time | Reads of the archived test log |
|---|---:|---:|---:|---:|
| RAW: full log and other evidence | 6/9 · 7/9 | 1.220M · 1.272M | 254 s · 185 s | Not archived |
| Stock: FIFO pointers + `find` | 7/9 · 6/9 | 1.372M · 1.288M | 326 s · 191 s | 13 · 11 |
| **New: FIFO + preview on the test-log reader only** | **7/9 · 7/9** | **1.128M · 1.129M** | **208 s · 236 s** | **7 · 9** |

Versus stock, preview tokens fell **17.8% / 12.4%**, while uncached input changed **−4.6% / +4.4%**. Every arm fixed the `toolz` and `more-itertools` cases. The one paired gain was Sol on `python-semver` in round 2. Several unsuccessful patches fixed scalar indices but not integer-like slice bounds: recognizing the exception in a log footer is not the same as fixing the full behavior. No session would have crossed the normal 70% trigger; this was a test of representation under controlled pressure, not evidence for archiving more often.

## Scorecard across studies

The earlier rows below use exact-answer probes or replay, **not** executable repair pass rates.

| Approach | Observed result | Verdict |
|---|---|---|
| Keep full history | Fastest and least expensive in both rounds of the earlier fitting-history comparison. It does not solve overflow. | Prefer while history fits. |
| Oldest-first pointers + exact `read` | Originals remain recoverable. A model sometimes paged through all 23,514 characters for one register entry. | Keep as the archival baseline; don't lower the trigger on this evidence. |
| Add literal `find` | 24/24 answers in each arm in both runs; returned recall text fell 80% and 70% vs pointers alone. Uncached input did not consistently fall. | **Keep** for navigating archived evidence. |
| Separate model writes a digest | Total tokens −8.9%; exact answers 6/6 → 5/6 and summed time 42 → 104 s, counting the extra call. | **Reject** as tested. |
| Working agent writes a decision note | 0/6 candidate sessions attempted to save; all 12 native checkpoints named the original choice. | **Don't ship** an unused tool; not a test of human-requested handoffs. |
| Preview both ends of every eligible single-block result | FIFO edge-question recalls 19 → 10 and 18 → 12. Total tokens fell 16.9% / 6.3%, but time changed −16.8% / +15.9%. | No general preview default; motivated the log-only repair test. |
| **Preview only the test-log reader (new)** | **14/18 verified repairs vs 13/18 stock**; fewer total tokens both rounds, but 23% slower than stock in the repeat. | **Hold; no runtime merge.** |
| Archive later cold entries first | Retained ~24 KB more identical request prefix. Only DeepSeek reported an extra cache hit on the first post-edit request. | Provider-specific; **don't change FIFO**. |
| Defer editing until expected savings cover the prefix break | In the 14-step replay with cheap warm reads, 8 cells improved and 8 tied; with periodic expiry, the same 8 worsened (4 incomplete in either comparison). | Research only; simulated, not a provider bill. |

**Evidence:** the [prespecified protocol and upstream fixes](20261121-1144-log-preview-repair-protocol.md), [case and grading instructions](../../scripts/experiments/log-preview-repair/CASES.md), and [earlier prior-art study](20261121-0230-archive-prior-art.md). Experimental code is retained on `experiment/log-preview-repairs`; the packaged candidate passed 111/111 offline checks. No live settings or deployment changed.
