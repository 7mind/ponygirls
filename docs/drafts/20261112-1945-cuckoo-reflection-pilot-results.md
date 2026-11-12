# Cuckoo reflective-memory pilot — results

2026-11-12 · source `6dcdf022` · protocol `f65b7faba8cea98f78c26180aff801d983dd6f4424e82f976f5dcfaca5ce0ced`

## Decision

**Do not promote the experimental delta prompt or search tool on this evidence.** Neither showed a reliable correctness advantage. This does not show that reflective memory is useless: the strongest subject reconstructed answers directly from source records, and optional search was rarely used.

The next useful experiment is **evidence-linked, task-scoped memory with explicit verification**, not more confident self-description.

## Design and evidence

The frozen experiment compared two writing strategies (current Cuckoo versus a generic delta/correction focus) crossed with two retrieval interfaces (existing list/read versus list/read plus lexical search).

- Three requested model configurations: GPT-6.1 Sol/high; DeepSeek V4 Pro 0813/high; Qwen3 30B A3B Instruct 2507/off.
- Four held-out synthetic domains: meeting scheduling, consent/identity reconciliation, payment reconciliation, and sensor alerts. Two repetitions per domain: **8 final artifacts per model/condition cell**.
- **48 live prefixes and 96 final continuations.** Each prefix generated four genuine Cuckoo rounds. The two retrieval siblings inherited the same native prefix and report inventory; writing strategies had separate generated trajectories.
- Native context reduction removed earlier conversational copies. All original, amended and historical source records remained accessible through the same read-only task tools in every arm. Reflection use was optional.
- Four manual inquiry boundaries, not a test of default token-growth cadence. No filesystem/shell tools, ambient instructions, MCP, skills or private task data were exposed to subjects.
- Node 24.22.2 and Pi 1.5.2; four concurrent subject workers. Runtime, request and response bounds were execution safeguards, not spending caps.

All **48 jobs and 96 continuations completed**, with zero integrity faults. Of 192 checkpoint answers, **191 were schema-valid**; the invalid answer was retained, not repaired or excluded. Schema validity does not establish factual accuracy.

The parent verified native session hashes, supervisor result receipts, paired report inventories and 144 neutral model-facing cwd sections. Two blinded read-only reviewers collectively inspected all 96 public final artifacts, 48 each. The parent compared their combined 20 non-perfect labels with the frozen grader and found exact agreement. Private thinking was not used as testimony.

## Primary results

A pass requires the exact requested JSON artifact, correct values/scope/order and valid source citations. Markdown-wrapped JSON fails the explicit machine-readable output contract.

| Model | Current + list/read | Current + search available | Delta + list/read | Delta + search available |
|---|---:|---:|---:|---:|
| GPT-6.1 Sol | 8/8 | 8/8 | 8/8 | 8/8 |
| DeepSeek V4 Pro 0813 | 8/8 | 8/8 | 6/8 | 8/8 |
| Qwen3 30B A3B Instruct 2507 | 3/8 | 3/8 | 4/8 | 4/8 |

Overall descriptive total: **76/96 strict passes**. Do not treat the 96 outputs as independent replications or pool model configurations into a general effect estimate.

- GPT passed **32/32** and never called a reflection-history tool in the final stage. This is a ceiling, not evidence that memory helped.
- DeepSeek passed **30/32**. Its two failures contained otherwise correct answers inside Markdown fences. They are format-only failures, not incorrect domain conclusions. The two extra passes in the delta/search-available cell cannot demonstrate a search algorithm benefit: that cell never invoked search.
- Qwen passed **14/32**: meeting 6/8, consent 0/8, payments 8/8, sensors 0/8. The delta advantage is one meeting case/repetition, repeated across its two retrieval siblings—not two independent gains or a reliable cross-domain improvement.

Component predicates are schema-gated projections, not independent causal diagnoses. For example, an extra redacted row can fail the expected owner-sequence comparison without leaking an owner's identity. Human error classification below does not mistake those flags for privacy failures.

## Was memory actually used?

| Model | Any history-tool use | History read action | Search invoked / search available |
|---|---:|---:|---:|
| GPT-6.1 Sol | 0/32 | 0/32 | 0/16 |
| DeepSeek V4 Pro 0813 | 32/32 | 30/32 | 1/16 |
| Qwen3 30B A3B Instruct 2507 | 16/32 | 16/32 | 4/16 |

Only **5 of 48** search-enabled continuations invoked search. This tests the effect of making search available under the registered guidance, not the quality of search when deliberately used. A read call also does not prove that every page was consumed or that the model attended to its contents.

## What the failures reveal

### 1. Restating facts is not checking the decision

Qwen's sensor drafts already violated eligibility before context reduction. Reflection `824fa942` correctly states that s1 converts to 0 C and the threshold is 28 C, but then claims s1 meets the criteria. Later artifacts continue to include the below-threshold reading.

The independent sensor audit found eight substantive failures and one format-only failure across all subjects. The recurring defect was a wrong selected set, often with a correctly calculated mean over that wrong set—not a general inability to perform arithmetic. All 24 payment artifacts were correct.

A development stock example shows the same limit: the reflection explicitly records free W=1 and C being W-only, yet the work product allocates C=2 at W. That contradiction recurs with full context too. More remembered prose was not sufficient to repair it.

### 2. Summaries lose unchanged premises and completed work

In the development upgrade case, the revised provisional artifact correctly contains exporter rollback 0.9. No saved reflection in the inspected prefixes retains that value. Reduced continuations omit the original inventory record—the only accessible source stating it—and invent other rollback values. Full-context siblings retain the correct answer.

In held-out consent cases, earlier drafts contained the correct c=12 and d=7 data (three fully correct drafts; one used the wrong literal redaction marker). The inspected post-update reflections summarize reconciliation without preserving those amounts. Final continuations omit original records and return wrong values or eligibility.

This motivates testing references to prior work products and their source dependencies. It does not establish that such a design would improve general performance.

### 3. Task scope matters more than archive recency

Two held-out Qwen artifacts answer `{"totalUnits":13}`—the unrelated shipment audit—instead of the requested meeting or consent task. Other artifacts cite unrelated audit records. Those records were real, available task fixtures, not fabricated source IDs.

Some failed development upgrades read an audit reflection rather than a planning reflection. But not all did: a search-using continuation read both pages of the relevant planning report and still failed; the missing rollback value was absent from that report. **Pagination was not the demonstrated cause in that example.**

These observations motivate task-scoped retrieval and explicit provenance. They do not prove that a particular retrieved page caused the mistake.

## Resource observations

Prefix cost is reported once per generated prefix, not duplicated for its two continuations. Counts include provider-reported cache-read tokens; they are not unique context size, physical compute or monetary charges.

| Model | Prefix tokens: current → delta (8 prefixes each) | Final-stage tokens: list/read → search available (16 continuations each) |
|---|---:|---:|
| GPT-6.1 Sol | 323,409 → 340,027 (+5.1%) | 90,525 → 106,479 (+17.6%) |
| DeepSeek V4 Pro 0813 | 672,648 → 675,769 (+0.5%) | 272,281 → 265,396 (−2.5%) |
| Qwen3 30B A3B Instruct 2507 | 439,058 → 439,014 (about unchanged) | 211,919 → 274,078 (+29.3%) |

The scored matrix recorded **735 prefix requests and 450 continuation requests**, accounting for 2,889,925 prefix tokens and 1,220,678 continuation tokens. These totals exclude development, canaries and control/review agents. No response usage was unavailable in the scored matrix.

These are descriptive package costs: tool declarations, optional tool choices and generated trajectories differ. Shared service load, caching and concurrent review activity prevent treating latency differences as a clean performance benchmark.

## Recommended next hypotheses — not implemented

1. **Preserve evidence and work-product references.** A statement that a draft was reconciled is not the draft. Retain task IDs, source revisions and links to important unchanged premises, not just the latest changes.
2. **Record invalidation explicitly.** A correction should identify which prior claims and downstream decisions need rechecking. Historical assertions remain qualified and superseded rather than becoming current authority through repetition.
3. **Ground reflection in checks.** Test invariant/verifier feedback alongside reflection. Repeating “0 C” and “threshold 28 C” did not itself prevent the wrong inclusion decision. Any benefit from external feedback must be distinguished from the memory mechanism.
4. **Test task-scoped retrieval and adoption separately.** Sparse optional search use cannot settle retrieval quality. Do not promote search merely because it is exposed or because a nearby cell scores better.

## Limits and audit trail

- Small, model-authored synthetic corpus; four held-out domains and two repetitions. Held out means not used for outcome-driven prompt/fixture tuning, not independent real-world distribution coverage.
- Retrieval siblings share a prefix. Writing strategies do not share generated trajectories. No significance or broad model-family claims.
- No memory-OFF arm: this study compares variants of current Cuckoo, not Cuckoo versus no checkpointing. No claim of improving human work or general coding ability.
- The sensor values distinguish threshold changes, units and region errors, but do not distinguish strict `>` from required `>=` at equality.
- First development attempt was retained as diagnostic data: model-facing directory labels exposed the condition; one model request also failed. The neutral logical cwd correction was frozen before any held-out scoring. Cases, graders and intervention wording were not tuned from that attempt.
- One preparatory automatic web-search call included the configured Anthropic search backend. This was disclosed and automatic routing stopped. No experimental subject or reviewer used Anthropic.
- Provider endpoint/auth-variable configuration is private and hash-bound; credentials are not copied. Model identifiers and client settings do not attest immutable backend weights. The compatible service did not advertise physical context capacity; configured bounds were not used to force automatic cadence.
- A qualitative reader over-generalized truncated trace views. The parent inspected complete event arrays and obtained an erratum; its retracted universal retrieval and unread-page claims are not used here.

The frozen harness is in `scripts/cuckoo-memory-pilot/`. A companion results JSON preserves the protocol, all 96 primary labels, per-cell metrics, prefix accounting and audit receipts without raw session history or private configuration. Full local evidence is retained under `.local/cuckoo-memory-pilot/`, including both development attempts, failed canaries and native logs. Raw thinking and private connection data are not presentation artifacts.

No experimental change was deployed to production Cuckoo.
