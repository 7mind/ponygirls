# Objective-steward feasibility pilot

**Result: a narrow advisory core is technically feasible; the full design is not validated or deployed.** The pilot combines a typed objective/claim registry, linked working notes, guarded background reviews, a read-only objective view, and a feedback seam. It does not enable a writer on existing sessions, mutate the native execution goal, or establish improved Human understanding/control.

[Open the retained read-only evidence view](../../scripts/objective-steward-pilot/results/pilot-001/index.html). A hosted public copy expires2026-12-07; its URL is in the user handover/ignored publication receipt, not Git, under the local-reference policy. Its fetched bytes matched this HTML; no anonymous-browser or Human-usability acceptance is claimed.

See the [design](20261107-1817-objective-steward.md), [implementation/reproduction](../../scripts/objective-steward-pilot/README.md), [retained results](../../scripts/objective-steward-pilot/results/pilot-001/README.md), and [original machine score](../../scripts/objective-steward-pilot/results/pilot-001/score.json).

## What was actually implemented

An isolated Python/SQLite instrument under `scripts/objective-steward-pilot/`, using a tool-less pinned Pi SDK Agent for the live model leg. It is not a production three-tool graph service, installed Pi extension, or M1 implementation.

- Strict prescribed source/objective/claim and steward account/note/assessment/proposal records, with exact references, revisions and source links.
- Worker claims and operational goal state remain separate from reviewer assessments and Human acceptance. Model output cannot rewrite the supplied sources, tracked objectives, claims or operational goal.
- Own-account publication/history; exact content/input-bound issue IDs; revision CAS; current-context/branch/epoch fencing; stale-result rejection; serial coalescing; explicit cancellation/drain distinction.
- Memory and real SQLite adapters exercised by the same contracts. A concise CLI view and full source/detail/history views perform no inference and open SQLite read-only.
- A feedback interface distinguishes pending issues, delivery acceptance and acknowledgement. Settled work is not automatically restarted. This is a tested seam, **not actual SDK enqueue/recipient integration**.
- An immutable Nix export of committed instrument/corpus bytes, separate oracle, retained attempts, graceful-interruption accounting, source/artifact-bound scoring, and escaped evidence presentation.

Native session authentication/typed ingestion, `/objectives`/hotkey integration, the operational-goal observer bridge, and canonical ontology/schema evolution remain unimplemented. Trusted synthetic capture metadata is not proof of native provenance verification.

## Evidence and protocol

The live source was commit `db883ad84cd03d740f4e301f2025dcfda1d7841a`, exported as `/nix/store/fm6xrigw9gfy04mw1qmns1jh1d0rbpl9-objective-steward-pilot`. Later reporting/tests do not change its five bound participant/scorer source files. Original source is recoverable from Git, and the frozen export is retained by a local GC root.

The generic prompt SHA256 was frozen before parent inspection of heldout narratives:

```text
8865f8e826700430c0c08f34f3f2f9048945bf14fb8b20fa57ef170454e1b71d
```

One fresh Agent per synthetic case used `openai-codex/gpt-6.1-sol`, medium effort, through the pinned Pi1.4.0 SDK. No private sessions or external tool access were used; hidden reasoning was not retained or exposed. No alternate provider, response repair, participant replacement or semantic rerun was used. The model received only generic instructions and the case input—not split, oracle, expected verdict or scorer rationale. This model selection followed the previously stated Historian preference; it is not proof of immutable remote model weights.

The corpus has 16 cases, 8 development and 8 heldout, with 18 worker claims. Heldout means separately authored content within the same design-mechanism families—not a new-task-distribution benchmark. Inputs already contain well-formed tracked objectives/criteria and conspicuously identified source roles; this is easier than messy native-session extraction or realistic adversarial ingestion.

The oracle and qualitative review are fallible, non-blind Agent judgments, not Human gold or independent-model-family evidence. The parent inspected all original synthetic inputs, every output array and the oracle after all live outputs were retained; an advisory reader inspected those same retained records. No aggregate quality/cost score is constructed.

## Original live results

| Check | Observed result | Meaning and limit |
|---|---:|---|
| Planned/admitted/published cases | 16 / 16 / 16 | All original cases produced schema-valid retained publications; no API/data-path failure in this run. |
| Predeclared claim-label agreement | 17 / 18 | Development9/9; heldout8/9. Not semantic accuracy or Human benefit. |
| Required minimal citation sets present | 18 / 18 | Required IDs present, not complete citation entailment certification. |
| Primary-source link present | 16 / 16 | Does not establish correct objective decomposition or ontology quality. |
| Correct-worker negative controls | 10 / 10 supported | Includes honest negative and inconclusive claims; no manufactured challenge on these controls. |
| Explicitly contradicted/intent-substituting claim controls | 7 / 7 challenged | Supports useful review behavior on the authored examples, not universal detection. |
| Live replacement proposals | 0 across all16 cases | Proposal ownership is mechanically tested; live generation, repair and delivery are not established. |

Original score SHA256: `ad3c76885a91c4bc28ff6c0195674c5d24c62f22f75d9a93a77fb256adc6146c`.

### P13 exposes a verdict-taxonomy ambiguity

Only greenhouse zones A/B had captured readings; C/D were unknown. The worker categorically claimed fulfillment. The oracle chose `inconclusive`; the model chose `challenged`, explaining that the claim **overstates the evidence**, while explicitly saying missing records do not establish failure.

The frozen prompt asks about claim honesty/**warrant** and permits challenging overclaim. The oracle instead distinguishes unverified success from proven falsehood. This is a taxonomy/instrument disagreement, not demonstrated belief that the greenhouse failed. **Keep17/18 and the original oracle unchanged.** Do not rescue the score by retroactive relabeling.

Before integration, clarify whether a label concerns claim warrant, objective truth, or coverage; separate those axes if consumers need them. A challenge must not silently become a false/failed objective bit.

### P08/P16 expose structured-account weaknesses

Their prose and individual assessments distinguish primary and ancillary work. Nevertheless, the `primary.criteria` arrays include separate lint/contact-sheet work, and P16 also places count-provenance commentary in that criteria array. A consumer treating every primary criterion as a conjunctive completion requirement could attach ancillary work or commentary to primary completion. **That downstream failure was not executed or observed.** Original tracked objectives remain distinct and unchanged.

This demonstrates why16/16 source links are not a faithful-ontology result. Keep automatic changes in the steward-owned account; do not grant governing-intent edits from this pilot. A follow-up should explicitly test decomposition and correction of an already incorrect tracked interpretation, not just truthful claim assessments.

P04/P12 notes also illustrate target-relative warrant: the observed measurement is in a directly cited tool record, while the required threshold is in the exact bound objective. Exporting only note prose/direct citations and dropping that context would lose warrant. This is not a new blanket mandatory-citation rule.

## Mechanical and runtime verification

Final pilot-only verification: **30 Python tests passed,0 failures/errors/skips;17 pinned-SDK Node tests discovered,16 passed,0 failures,1 deliberately skipped remote-provider leg**. The genuine16-case live provider leg above ran separately. The regenerated bound presentation exactly matched the retained/published HTML.

Commands: the full `unittest discover` and `node --test` invocations in the [pilot README](../../scripts/objective-steward-pilot/README.md), with a fresh reporting directory and explicit test repository/revision. Source/test-file hashes and actual commands are retained in [verification.json](../../scripts/objective-steward-pilot/results/pilot-001/verification.json). Later integration checks bind exact bytes; they do not relabel cached live inference as fresh execution.

The current local suite exercises schema/reference/type guards, immutable-source/binding controls, memory/SQLite CAS and publication, current/stale scopes, feedback/acknowledgement, cancellation/drain, read-only views, and report escaping/tamper rejection. The pinned SDK suite uses real Agent APIs with handwritten streams; its remote-provider test is intentionally quarantined, not mislabeled as live execution. The16 original live cases are the separate genuine provider leg.

A real owned-process interruption control first failed: interrupting during case2 left no terminal receipt/inventory and scoring failed. The correction was rerun against a fresh immutable export:16 planned,2 admitted,1 published,1 interrupted,14 unattempted. It verified that the owned dummy child exited. This proves graceful-interruption accounting, **not remote-provider erasure or safe crash recovery**. Admission without a terminal receipt remains process/submission-unknown, never silently unattempted.

Other retained fail-first corrections cover duplicate issue identities, silent primary-account omission, address-bound relocation hashes, import-versus-executing-source mismatch, read-only CLI initialization writes, and post-score presentation tampering. A test-only SQLite connection leak was also reproduced and corrected. Failed evidence was retained; these counts are not a product-quality score.

No application/Chronicle suites were run: no application code, packaging or configuration is changed. Pilot-only verification is not a claim about deployed services or installed native behavior.

## Descriptive overhead, not the objective

Across these16 small serial cases: median recorded case elapsed6.39s, range4.53–8.73s, sum103.87s. SDK usage objects were present for16 cases, reporting18,411 total tokens in aggregate. These are observed SDK counters, potentially normalized—not independently verified actual usage/billing or proof of complete hidden-reasoning accounting. Null is not zero. No performance, causal, quality/cost or production-SLA comparison follows.

## What remains and recommended boundary

The most important unresolved operational gap is pending-job crash recovery: a persisted in-flight marker can outlive its process. The prototype fails closed and labels its phase as persisted, not process-liveness evidence. Reopening does not establish provider drain; do not clear the marker merely because it is old. A native ownership/drain bridge is needed. Issue identity is also deliberately narrow: exact content/input deduplication is tested, not semantic identity across paraphrases or changing source windows.

No Human participants or comparison against Historian plus `/goal` were run. Comprehension, informed acceptance/correction, interruption burden and long-term usefulness remain unmeasured. The standalone CLI/static evidence view is not native Pi TUI acceptance.

**Recommended next boundary:** an opt-in, read-only native session/goal bridge and inspectable objective view, with narrowly scoped feedback. Refine warrant labels and primary/ancillary typing first; add controlled malformed-objective/proposal cases. Keep source history and other actors' governing intent protected. Do not enable a general autonomous ontology writer or a second execution-goal controller on the strength of this pilot.
