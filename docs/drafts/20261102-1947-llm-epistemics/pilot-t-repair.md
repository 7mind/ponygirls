# Pilot T repair and failure-mode proposals

2026-11-06; postdata continuation of [Pilot T](workflow-benefit-pilot.md), not a
replacement experiment or an amendment of its verdicts. The user requested:

> I think, you should fix the pilot implementation, then analyze the failure modes
> of the previous sessions - and attempt to formulate improvement proposals.

“Previous sessions” is operationalized here as all16 retained T originals for public
tool accounting, with focused semantic/recovery inspection. Earlier P/Q/S findings
remain available in their own reports; this is not a new exhaustive recoding of them.

## Implementation correction

The separately versioned `runner/ledger_t_002.py` in local
`~/work/epistemics-pilots` now checks a progress target's binding, definition kind and
matching content **before** accessing Task-only acceptance fields. Unsupported
Constraint progress returns an auditable domain rejection rather than an uncaught
`KeyError: 'acceptance'`. A same-batch Task revision using another kind's content
was also reproduced and covered. Outcome possession of an acceptance field does not
make it a Task.

Fail-before:15 test methods,1 failure/10 errors; memory/file and real copied backend
all reach the expected KeyError. The initial15 pass after correction. Expanded
controls cover11 non-Task kinds ×5 phases ×2 adapters, valid Tasks, rejected-batch
rollback and request-ID reuse, inherited17 contract bodies, exact copy recipes,
pinned SDK→actual extension→copied backend, recovery, and real infrastructure
failure preservation. A malformed Source digest in the new test fixture caused two
setup errors in a37-method run; correction was to the fixture, not the validator.
The later38-method run passes. Both failed receipts are retained.

`runner/instrument_t_002.py` prepares a new directory containing the corrected
ledger under the backend's expected import path, stamps an explicit revision and
verifies its recipe. This is a working successor boundary, not just an unused
helper. Historical `pilot_t.py`, `audit_t.py`, registration, originals and publication
still reference the frozen implementation. New preparation is not an authorization
or readiness claim for another measured pilot; a later separately registered
controller/auditor and native canaries would be needed.

**Not fixed:** native/provider WebSocket/upstream failures or their recovery policy.
The retained metadata does not establish their root cause. The old blanket
context-edit gate stays unchanged; its invalid original is not rescued.

## What the retained sessions show

A new source-bound inventory exports public tool requests/results only—not private
thinking—and reconciles all16 originals. Among graph-assigned originals:

-237 native tool calls;233 audited calls;
-91 graph_apply attempts:41 successful batches,47 domain rejections,3 backend exceptions;
-20 graph reads and1 find, all successful;
-51 error results =47 domain+3 infrastructure+1 workspace-interface rejection.

Domain rejections:23 shape,10 context,9 reference,5 acceptance. Two DeepSeek r1
originals account for36/47. These are dependent attempts within sessions, not47
independent failures or51 defects in the graph implementation. Notes have151 calls
and no error results. Graph is used in6/8 assigned originals; both DeepSeek r2
originals qualify without graph calls. Service capture records are not participant
uptake. All8 graph-assigned originals attempted14 stages altogether, not14 stages
of graph use.

### Mechanisms, not a single failure category

| Mechanism | Observed evidence | Boundary on the conclusion |
|---|---|---|
| Validation order | Three backend exceptions in two dispatch-Sol originals, now reproduced at memory/file/copied-backend boundaries | Invalid request plus an instrument defect; not permission for non-Task progress |
| Unlocalized repair feedback | Ten “governing context omitted or stale” responses across all six graph users; repeated context changes in planner-deepseek-r1 | Repair friction observed; causal token/time cost not estimated |
| Schema/validator mismatch | Four single-target and one single-source rejection despite broader schema arrays | Align interface with enforced cardinality; do not relax legitimate invariants |
| Kind/reference confusion | Task definition used as state subject; prose/Source used as Question; assessment/adoption endpoint confusion | Instructions already described distinctions; more prose is not demonstrated sufficient |
| Unsupported evidence promotion | V010 accepted review claims all contract behaviors executed from four actual runs | Material method overclaim, despite correct finite artifacts; admitted structure is not truth |
| Bounded inspection/reuse | V013 executed table matches eight commands; empty-loop/unchanged expansion grounds support additional compatibility claims | Missing rerun is not proof of no inspection; retain parent adequacy and B disagreement |
| Recovery-policy mismatch | V006 removes two failed assistant generations after connection errors; target metadata is private-only/empty | No successful public-evidence deletion established; no safe-side-effect or graph-causality inference |
| Non-use | Two qualifying graph-assigned originals use only workspace tools | Do not infer motive, exclude them postdata or equate availability with use |

An additional admitted `quotes` edge Task→Source opposes the supplied
Source→formulation direction. It illustrates the gap between structural admission
and intended semantics; it is not a new primary verdict or a fully specified fix for
every possible quotation. Correct gates also prevented invalid non-Task completion,
stale pinned-Question acceptance and erroneous assessment targets. Removing those
gates to reduce errors would change the meaning rather than repair the interface.

## Prioritized proposals

1. **Delivered:** validation-before-consumption and an explicit successor copy recipe.
   Keep malformed-request matrix, valid controls, rollback, actual tool-boundary and
   infrastructure-error tests. Ordinary baseline suites had missed the defect.
2. **Localize rejection diagnostics:** operation index/alias, field path, actual and
   expected kind, offending ref, missing/stale governing refs. A retained failing batch
   must identify the actual offending operation; correcting that issue must expose any
   remaining issue without mutation. No auto-acceptance or hidden repair.
3. **Align schema/examples with static invariants:** exact relation cardinality and
   reference format, Task-binding-only progress, acceptance clauses versus an actual
   Question. Test invalid multi-target `interprets` while preserving joint-premise
   inference. Use small executable examples rather than an ever-longer policy.
4. **Read-only binding preview:** compute required governing context with reasons and
   snapshot identity. Preview must not choose authority or inherit done; changed
   governing state invalidates it. Commit/selection remains explicit.
5. **Design recovery prospectively:** retain append-only original events/costs and a
   separate effective-context projection. Permit only proven failed nonpublic
   generations with null removal, exact same-stage target and no dispatched or
   uncertain effects. Reject public-text/tool-result deletion, spoofed errors, unknown
   ancestry, missing counters/logs and arbitrary summaries. Empty final content does
   not prove no streamed call occurred. Reconcile durable request IDs before retrying
   possibly committed writes. This remains a proposal, not a WebSocket correction.
6. **Evidence-method reporting in both conditions:** distinguish executed, inspected,
   reused and untested with exact scope/version. V010's universal execution claim must
   fail while bounded four-case and V013 applicability reports can pass. Do not require
   exhaustive retesting or graph vocabulary. An empty kit newly sealed for courier
   pickup is a proposed negative control for careless historical reuse.
7. **Focused retrieval and honest uptake measurement:** show required context, expose
   full history on demand, and verify no governing record is omitted. Resource benefit
   needs later measurement. Specify optional versus required graph use before another
   study; keep assignment primary and uptake separate. More calls/nodes is not quality.

These changes are hypotheses, not demonstrated agent-behavior improvements. Repair
first removes a known confound; it does not make the current study evidence for graph
benefit. The strong notes baseline, small/near-ceiling tasks, asymmetrical attrition,
variable uptake and quality-selected resource pairs remain.

## Evidence and scope

Detailed report, source-bound inventory, exact advisory returns/receipts, fail-before
and pass-after logs live under local `epistemics-pilots/results/pilot-t-repair/` [L20].
Two read-only advisors reviewed interaction traces and recovery/evidence distinctions;
a later code review found no blocking scoped repair defect. Parent verified decisive
calls, inventory counts, source mechanisms and tests. This is not Human gold or a
second exhaustive semantic adjudication. Reviewers' earlier expanded-test caveats are
superseded by later passing receipts, not rewritten.

Final fresh software validation: **331 tests passed**, zero failures/errors/skips:
S136/374.816s, Q85/0.757s, T72/24.207s and successor38/5.838s. The128 enumerated
Python/TypeScript/MJS source hashes match before/after;984 registered inputs and2031
historical publication-bound files remain unchanged. The full launcher first failed
before test execution because its repository-root calculation was one level too high;
original controller/error retained, corrected run uses a fresh output directory.
Receipt SHA256 `e0109d526e1975ad16758a777b078970bd40f45be21677a9e7eaabab81cac8eb`.
Pilot repair/analysis commit `69f42b77cef8db75ec6070653233b5e98d02cd21` is integrated
into pilot main. Fresh integrated Q85/0.782s, T72/24.730s and successor38/6.953s pass
with zero failures/errors/skips; inventory and2031-file publication check match.
S136 is explicitly reused on matching128-source binding, unchanged registered inputs
and no historical source/fixture/protocol/Nix-input changes—not called a fresh
integrated S execution. The unchanged cooperative prototype also passes36 methods/6.177s. Structural docs
checks cover19 documents/88 local links/J1–J35/88 references; not semantic approval.

The shared schema, T1 contract, J1–J34 and P/Q/S/T originals are preserved. Q22 remains
pending and independent. No new measured subjects, deployment, production/UI/CQ4 work,
push or skill installation follows. A delegated overlap review found no useful
nonredundant skill addition: test-taxonomy/dual-tests and inert
`agent-behaviour-pilot` r6 already cover the procedure; unimplemented recovery is not
a validated reusable skill. No Haystack write was made.
