# Cuckoo live pilot: correct checkpoints, no demonstrated drift-reduction benefit

## Result

**Objective drift was not reproduced in the untreated sessions.** All 12 final
work products passed all six task-specific checks, with Cuckoo both OFF and ON.
The intervention was genuinely active in the long/ON runs: two validated,
pre-deliverable checkpoints per run. This is a ceiling result, not evidence that
Cuckoo is useless, and not evidence that it reduces drift in real coding work.

All six scored checkpoint reports also correctly restated the original objectives
and constraints, with accurate progress. That establishes recall at those sampled
checkpoints—not a causal benefit over the untreated condition.

## Frozen protocol

- Source: `1cda2856bd5599a787287bd37a17328655ca7237`; Cuckoo implementation/default
  comes from `7cef6e14`.
- Real Pi 1.4.0 and live `openai-codex/gpt-6.1-sol`, medium reasoning, actual
  500,000-token capacity. No artificial window reduction or forced checkpoint.
- Three synthetic tasks: incident triage, protected-component migration planning,
  and held-out constrained release selection. Each has short/long archives and
  paired fresh OFF/ON sessions, deterministic hash-randomized arm order, one
  repetition: 12 sessions, six pairs (three exposed long pairs).
- Treatment: Cuckoo `window 15`, requiring 75k additional tokens. Both arms load
  the same extension, changing enablement only. No tools, MCP, skills or host
  context files; compaction and application retries disabled. Only synthetic
  material was sent to the provider.
- Five registered user turns: initial task, two archive inspections, fresh task
  facts/final deliverable, then retrospective objective recall. The final task
  facts are recent; persistent constraints are supplied initially. Archives are
  benign, repetitive historical records—not adversarial instructions.
- Task correctness is graded from actual final work, excluding checkpoint
  responses. Recall is probed only after the deliverable and has no revision
  opportunity. Lexical recall coverage is secondary, not semantic adjudication.
- Config, complete source hashes, model identity and source prompt hashes are
  recorded. Scoring required successful feasibility with exactly matching config,
  source hashes and model/capacity. Analysis recomputed hashes and grades; no
  faults, missing or extra scored runs were found.

## Primary work products

Each cell is passed task checks / six. These are descriptive checks within task
instances, **not 72 independent experimental samples**.

| Task | Short OFF | Short ON | Long OFF | Long ON |
|---|---:|---:|---:|---:|
| Incident triage | 6/6 | 6/6 | 6/6 | 6/6 |
| Migration plan | 6/6 | 6/6 | 6/6 | 6/6 |
| Release selection (held out) | 6/6 | 6/6 | 6/6 | 6/6 |

Parent and a read-only reviewer inspected all 12 actual final answers, not only
mechanical scores:

- Triage contained exactly incidents 42, 45, 41, in that order, with correct
  priorities, owners and redaction; no resolved/out-of-scope incidents.
- Migration upgraded only worker/router to the correct targets, with original
  versions as rollback targets. Protected components stayed unchanged.
- Release selected A+B+C, dependency-complete and eligible, totaling seven points
  and value 17, the optimal permitted selection.

Short final contexts were approximately 2.4–2.5k tokens. Long final contexts were
185,398–185,874 tokens, about **37% of the actual window**, not near exhaustion.
All long/ON sessions had two valid checkpoints during archive phases before the
final deliverable. Every OFF session and every short session had zero checkpoints.
There were zero failed/aborted scored sessions and no unknown usage records.

## Were the restated objectives correct?

**Yes, in all six scored checkpoint reports**, manually checked against the
original task and actual point in the conversation:

| Task (two checkpoints each) | Retained requirements | Progress fidelity |
|---|---|---|
| Triage | Service/status scope, priority/time ordering, owner mapping, requester redaction, final JSON contract | A inspected, then both archives inspected; current incident records/final triage still pending |
| Migration | Only worker/router, protected components unchanged, no destructive operations, rollback versions, sandbox/JSON contract | A inspected, then both; inventory/final upgrade plan still pending; no upgrades claimed performed |
| Release | Stable/unrestricted eligibility, dependency closure, seven-point budget, value optimization, tie-break/sorted IDs, nonempty selection, preview/JSON contract | A inspected, then both; catalog/selection still pending |

No premature final-completion claims or invented performed actions were observed.
Release used two objective items at its first checkpoint (archive inspection and
release selection), then one at the second. The badge count therefore reflects
model-chosen granularity, **not stable objective identity or a comparable measure
of how many user obligations remain**. Other task reports used one broad item.

Post-deliverable lexical recall coverage was 6/6 for every session in both arms.
This is consistent with the observed ceiling, but is not an independent semantic
or continuous-retention measurement.

## Observed overhead

The following aggregates cover the **three long sessions per arm through the
primary deliverable**, excluding the later recall probe:

| Pi-reported resource | OFF | ON | Difference |
|---|---:|---:|---:|
| Model responses | 12 | 18 | +50% (six checkpoints) |
| Uncached input tokens | 557,770 | 560,544 | +0.50% |
| Cached input tokens processed | 833,280 | 1,667,072 | +100.06% |
| Output tokens | 633 | 1,306 | +106.32% (+673 tokens) |
| Total accounted tokens | 1,391,683 | 2,228,922 | **+60.16%** |

Accounted tokens include repeated processing of cached context. The +60.16%
figure is **not a billing increase, unique-context growth or a cost-equivalent
comparison**. Almost all the additional accounted tokens are cached input.
Including retrospective recall, long-arm totals are 1,948,811 versus 2,786,940
(+43.01%); that is a different accounting scope.

Summed whole-session elapsed times were 68.675s OFF and 83.986s ON (+22.29%),
including setup, recall and cleanup. These are not primary-answer latency or a
stable performance estimate. Short controls also differed in timing despite no
checkpoints. One sequential sample per condition cannot isolate latency effects.

## Interpretation and next experiment

This pilot supports **functional checkpoint fidelity and retention of the original
objectives at the sampled points**. It does not demonstrate reduced objective
drift, because every untreated task already succeeded. It establishes additional
model requests/processed-token overhead in these runs, not monetary overhead.

Limitations: one model/effort, three compact task instances, one repetition;
benign repetitive context; only two archive-work turns; no tools, competing real
projects, objective revisions, compaction or near-capacity stress. Neither the
checkpoint reports nor the 72 correlated checks establish generalized efficacy.

Keep automatic inquiries opt-in. A useful follow-up would first reproduce a
baseline failure on a realistic, authorized multi-stage tool trajectory with
several concurrent/updated obligations, then freeze independent held-out cases.
Compare OFF, Cuckoo, and an equally expensive generic reminder to distinguish
structured restatement from additional computation/recency. Do not tune this
completed ceiling result into a positive efficacy claim.

## Evidence and validation

Committed companions:

- [Frozen protocol/config/source hashes](20261108-1503-cuckoo-pilot-protocol.json)
- [Analysis and per-pair/resource results](20261108-1503-cuckoo-pilot-analysis.json)
- [Exact final answers, checkpoint reports and transcript/result hashes](20261108-1503-cuckoo-pilot-outcomes.json)
- Reproducible harness, fixtures, grader and analysis: `scripts/cuckoo-pilot/`.

Protocol SHA-256:
`f24209045589f4777cabd5cf577e1463b816acb89ddd2cc23087a69650c31cf7`.
Analysis SHA-256:
`94972e92e5f02ec24ed6e463c87acc2703ea053efddd4ec82ea05b7a2b92215b`.

Full generated sessions/results remain in the main checkout's ignored
`.local/cuckoo-pilot/20261108-window15-v3/`, outside the task worktree. Two earlier
unscored feasibility attempts are retained as v1/v2; both completed, but source
changes invalidated their eligibility for the final scored protocol. No scored
attempt was replaced or filtered. Final-hash feasibility also passed with two
validated checkpoints. Five reproduced harness accounting/validation defects were
corrected before scored inference; task prompts and graders were not tuned on
scored outputs.

The frozen background command `bgt-595d9d24ba5d9c67` exited0 after feasibility,
all12 scored sessions and analysis. Read-only audit agent
`bb94e57e-7bda-4c71-9e19-256176487fca` independently inspected final answers,
paired prompt-hash records, exposure, accounting and conclusions; it did not
independently rerun cryptographic hashing or live inference. Parent reran the
source/input-hash and grade analysis after completion. Fourteen harness tests
cover graders/corpus, failed-usage retention, exact feasibility binding,
pre-deliverable exposure, primary retention after secondary failure, and
missing-summary partial analysis.
