# Live ontology freshness and objective re-anchoring

Status: synthesis design with retained earlier pilot contracts and a prospective decision-model-assisted extension. Earlier pilots exercised the live feedback path, not established semantic fidelity or causal benefit. Not a deployed extension, execution controller, established anti-drift technique or Human-benefit result. Sections8–13 retain the earlier experimental contracts; section14 introduces the newly requested CLEF research/pilot scope.

## 1. Purpose: keep the ontology current, then use it

The primary component is a **sidecar maintaining the evolving auto-ontology**:
objectives, interpreted intent, constraints, work, hypotheses, claims, observations,
questions, decisions and their relations. Maintaining current objective/intent
records is part of that job. It is not an archive of original goals with reminders
attached, nor a requirement that the Human manually update goal records.

```text
Authenticated session events + actual work observations
       -> sidecar revises its ontology account and retains history
       -> host selects a current, scoped projection of that live graph
       -> main agent re-anchors its next work to that projection
       -> actions, discoveries, corrections and Human changes feed back
```

Routine updates to the sidecar's own interpretations, classifications and relations
are automatic. A Human requirement revision/cancellation changes its current account;
original messages and the account's earlier versions remain traceable. Source capture,
permission, actual Human acceptance and the operational goal remain independently
owned. Graph publication does not mutate any of them.

The proposed additional benefit is resistance to **context-induced objective drift**:
work departing from current governing intent as context grows, attention shifts,
work is handed off or earlier context is compressed. A maintained external account
plus actual re-delivery could help detect/recover from such drift. This is a testable
hypothesis, not a fail-safe guarantee. A graph can be fresh in coverage and wrong in
meaning; repeating it can amplify an interpretation error.

## 2. Relationship to the existing design and evidence

This synthesizes the [steward](20261107-1817-objective-steward.md),
[data/API candidate](20261102-1947-llm-epistemics/data-api-candidate.md) and
[unified semantics](20261102-1947-llm-epistemics/cq4-unified-graph-semantics.md).
It preserves the three graph operations and their versioned/attributed contract,
not a competing execution-goal service.

The [first longitudinal pilot](20261108-0004-steward-full-session.md) and a later
maximum-context follow-up establish limited maintenance feasibility, not this loop:

- One fictional24-event session,12 successive checkpoints per model. The later Kimi
  and DeepSeek trajectories both published12/12; original controls87/111 and74/111
  are **not semantic accuracy**, independent trials or Human gold.
- Kimi kept distinct causal hypotheses and later test observations, but the governing
  completion gate existed only as a task, not a separate constraint.
- DeepSeek retained that task/constraint distinction but folded later observations
  into other record types and reused a diagnosis node across causal propositions.
- Narrative preservation therefore does not establish typed query completeness.
  A task is not a substitute for its governing completion constraint; a claim that
  mentions a test is not its separately addressable observation.
- The sidecar saw growing source and its own actual graph. No main worker received
  maintained graph context or changed behavior because of it. That feedback step,
  actual re-delivery, context interruption and behavioral drift remain untested.

The maximum-context instrument's content identity is
`4b6fab92ae2f534fd368cc6b4bd833de3f3ffbdc3adfd77fc83d322922a91acd`;
its source and original traces are retained in the user-selected artifact store.
The constrained8k predecessors remain historical evidence, not capability rankings.
No token/spending budget is imposed on this pilot's non-Opus participants. Context,
generation allocation, deadlines, stream bounds and semantic schema are distinct.

## 3. Provenance is attached to contributions, not just entities

Every source, node/relation revision, binding, assessment and projection delivery
has host-sealed provenance. Extend the existing protected receipt with an explicit
capture context; a session ID quoted inside model text is not that context.

```text
CaptureContext
  session_id, root_session_id, parent_session_id (explicit null at root)
  branch_lineage_ref, scope_epoch, input_event_ref

RevisionProvenance
  actual contributor + recorder + immutable input receipt
  capture_context
  exact supporting source/revision refs
  explicit import/derivation/inheritance refs where applicable
```

Keep these distinctions:

1. **Creation/contribution session:** where this revision was recorded.
2. **Evidence/intent basis:** all actual source events supporting its content. A node
   can depend on several sessions; one `session_id` must not erase that lineage.
3. **Current applicability:** which worker/session/branch contract consumes it now.
   Origin in a session does not automatically make it governing in that session,
   every child or every other session in the project.

A cross-session handoff/import records its exact source binding and applicable scope.
A fork pins its inherited frontier; later parent changes do not silently retarget
historical evidence or become child authorization. Rejoining requires explicit scope
and applicability accounting. Unknown/imported identity remains qualified. No graph
writer can create a protected Human act by choosing a role/session string.

An agent-stated objective is an **agent commitment or interpretation** with its own
source basis, not automatically a Human mandate. Preserve the actual Human request,
the worker's formulation and later sidecar interpretations separately. Re-anchoring
must not harden an early worker assumption into a governing requirement.

For a synthetic pilot, actual provenance names the fixture author/injector and host
capture; `scenario_role=human` is separately marked simulation. Those requests govern
only the owned experiment, not real operator acts, acceptance or production permission.
Replaying a fixture request preserves that qualification. Scenario-role checks do not
validate a production Human-authentication implementation.

## 4. Freshness has a mechanical frontier and a semantic responsibility

For an active scope, the host records the latest eligible source frontier, published
curation coverage, graph revision and failed/unreviewed ranges. The sidecar accounts
for new information by revising meaning, classification, state, applicability and
links—not merely by advancing a timestamp or citing every message somewhere.

A publication receipt binds the exact consumed source prefix and previous graph.
The same scope/frontier and CAS/replay rules apply to source corrections, branch
changes and handoffs. A failed curation leaves the last valid graph with explicit
lag/unreviewed coverage. It is never marked current because a request was enqueued,
a model returned HTTP200 or all new event IDs appear in a citation array.

The sidecar must maintain, at minimum:

- current objectives and their independent constraints, including completion gates;
- revised/superseded requirements and scoped cancellations without resurrection;
- continuing tasks versus evidence about their results;
- competing causal propositions as independently addressable hypotheses, rather than
  repurposing one hypothesis ID as a generic "current explanation" slot;
- worker claims, actual tool observations, predictions, assessments and Human acts;
- missing evidence and unresolved questions without invented completion/acceptance.

Semantic freshness cannot be certified by coverage counters. The host can verify
scope, versions, event consumption and transport; interpretation fidelity needs
independent evidence and behavioral checks. The pilot measures both separately.

The follow-up makes this an operational separation: coverage status, evidence origin,
artifact-version applicability and known typed conflicts are independent fields.
A current coverage frontier never upgrades a curator assertion into a host fact.
Host receipts describe observed bytes/process outcomes under their capture contract,
not arbitrary output truth, complete correctness, Human acceptance or faithful intent.

## 5. A current graph projection, not a second objective registry

A host-built **alignment capsule** is a view of the live graph. It carries:

- governing scope/epoch, graph revision, source frontier and coverage/lag;
- exact current objective/constraint bindings and their source provenance;
- recent requirement replacements, cancellations and unresolved scope conflicts;
- relevant work, competing hypotheses and separately typed claims/observations;
- the current completion boundary and remaining uncertainty;
- source/read references for inspection and an exact projection identity.

The host selects authorized scope/references; it does not silently author a new
intent summary or infer truth from a relation label. Derived current intent remains
labeled as the sidecar's account, with original Human acts inspectable. Normal
reinterpretation within the maintenance delegation does not require ceremonial
per-change approval. Protected actions/permissions still need their actual authority.

A capsule may be bounded and paged, but omissions are explicit and navigable. It must
not silently cut unresolved constraints to make a short reminder. If the required
alignment contract cannot fit the available context, report a capacity/coverage
failure rather than return a falsely complete capsule. No fixed "top goals" heuristic
may demote an inconvenient active constraint or hide a cancellation.

The capsule partitions **Human-governing contract** from **derived interpretations,
technical means and observations**. A governing objective/constraint needs an actual
Human-origin basis (a qualified scenario request in the pilot); tool/file text and
quoted fake approval cannot independently supply it. Human support is necessary, not
semantic proof: attaching an unrelated Human citation does not make the interpretation
faithful. Delegated technical means can remain useful inferred records without being
promoted to Human mandates.

For every change removing, weakening or superseding a governing record, the projection
includes its previous/current exact refs, the sidecar's change rationale, and **verbatim
Human basis inline**, not just a lookup link. A curator correcting its own interpretation
is labeled as such, not as a newly performed Human cancellation. This is automatic
account maintenance, not a request for per-change approval. Missing/ambiguous authority
is exposed instead of silently dropping the old constraint from the alignment window.

A current graph is the source of this projection. A frozen initial objective set,
a curator's prose recap detached from graph bindings, or a timestamp-only heartbeat
is not an implementation of this design.

## 6. Actual re-delivery and rechecking

Proposed delivery points are worker attach/resume, handoff/fork, after a context
reduction, changed governing source/bindings, and a declared periodic policy at
settled reasoning/action boundaries. Cadence is an experimental policy, not an
already established optimal constant. Graph access alone is not proof of consumption.

At a delivery boundary:

1. Capture the active source/scope frontier and obtain a graph view covering it.
2. Build the capsule from exact current bindings, including replacements/withdrawals.
3. Fence publication/delivery against changed scope or newly arrived governing input;
   do not deliver an obsolete view as current after a race.
4. Insert it as **attributed derived context/data**, not a replacement system policy
   or a purported Human command. Source quotations remain data; graph text cannot
   confer execution permission or higher instruction priority.
5. Record the exact actual model payload/delivery identity and covered frontier.
6. Ask the main agent to relate its next meaningful work to current objectives and
   constraints, identify conflicts/uncertainty and consult original sources when
   the account appears inconsistent. Judge subsequent behavior, not its recital.

If the sidecar lags, rejects a return or cannot resolve scope, expose that condition.
The pilot predeclares **degraded continuation**: the worker still receives newly
captured scenario requests and raw-source access, while A2/A3 graph reads/deliveries
report their actual lag/unavailability. No old graph is stamped fresh and no failed
window is retried or repaired. A later new eligible source frontier may receive its
own curation using the last valid graph and full prefix; that is logged recovery,
not replacement inference for the failed frontier. Degraded intervals stay in the
results. A worker/infrastructure failure ends that original trial as failed/unavailable;
no restart/resume/fresh replacement is allowed within the frozen pilot.

High-impact execution remains subject to the existing execution layer, not an
ontology-generated permission bit. The pilot uses settled barriers rather than
claiming to validate unimplemented asynchronous native races.

Events caused by capsule delivery/rechecking are marked host-derived or worker acts.
They are not fresh Human intent and must not recursively create self-confirming
objectives, re-anchor loops or a second execution-goal owner. The sidecar does not
wake a paused worker or create an operational goal as a side effect.

## 7. What this may protect against—and what it cannot guarantee

Expected benefit: make current intent recoverable after distraction/context loss,
show changes since the worker's earlier plan, and support correction before more
irrelevant work or unwarranted completion. Source/session links provide diagnosis:
what was requested, how it was interpreted, what changed and what was actually
injected into the worker's context.

It does not mechanically prove that a proposed action advances an objective. A
worker can parrot a capsule and still violate it; worker and sidecar can make correlated
errors; malicious source data can attack either model. A mistaken live graph can be
more persuasive than a forgotten original. These are reasons to test semantic
freshness and behavior—not to replace automatic maintenance with manual updates.

## 8. Pilot question and declared scope

**Feasibility question:** can the instrument carry an actual live-maintenance and
re-delivery feedback loop, and what predeclared maintenance/delivery/behavioral
observations occur through revisions, cancellation, distraction and context interruption?
The pilot is not sized to estimate a causal average benefit or rank model capability.

Use a new independently authored fictional coding task with real isolated files and
executable checks. A real worker model chooses and performs task-tool actions;
a separate real sidecar incrementally curates the evolving ontology from actual
Human/worker/tool events. Worker outputs feed the sidecar; projections feed the
worker. Precomputed graph snapshots or a scripted worker do not establish this loop.

Proposed participants: DeepSeek worker and Kimi sidecar, with maximum supported
reasoning/context/generation through the validated provider path; reviewers are not
pilot participants. Exact identities/wire settings are frozen before calls. Opus is
used for one focused design review only; Astra provides a separate design review.
No Opus pilot budget or unasked financial gate is introduced.

Use **two independently authored held-out episodes across four arms**: eight original
worker trajectories, not independent statistical samples or a model ranking. Each
matched episode uses the same exogenous event script and workspace seed; each arm
keeps its actual endogenous worker/sidecar history. No shared mutable graph, random-state
cache or participant rescue across arms. Differences remain descriptive even with
two episodes; do not pool them into a semantic-accuracy or causal-benefit percentage.

The sidecar runs in shadow in A0/A1, at the same eligibility/scheduling rule as A2/A3,
but exposes no graph to those workers. At each eligible boundary it receives its own
full eligible raw prefix and actual last committed graph. It has no hidden oracle or
future intervention access. Sidecar capacity failure is explicit/degraded, not silent
summarization or source truncation. Kimi's previously observed task-versus-completion-
constraint omission is a predeclared maintenance risk, not to be recoded as transport
failure or excused after outcomes.

## 9. Counterfactuals and negative controls

Freeze these arms after review, before outcomes:

| Arm | Worker context beyond its ordinary event/history stream |
|---|---|
| A0 | Reflection-only checkpoint, no auxiliary memory content |
| A1 | Same checkpoint plus host replay of active-branch scenario requests in order, with simulation provenance and no model rewriting/graph compilation |
| A2 | Same checkpoint plus live ontology available on request, without automatic capsule delivery |
| A3 | Same checkpoint plus automatic current scoped capsule and the same graph lookup access as A2 |

**All arms** have the same raw-source/transcript read tool and ordinary workspace/test
tools. A2/A3 additionally expose graph lookup. All get the **same fixed rechecking
instruction**, at the same rule-defined settled pre-inference/phase boundaries;
A1/A3 delivery timing and wrapper are matched. The rule, not necessarily the number
of boundaries or payload bytes, is equal because genuine histories differ. Log the
actual delivered content, eligible boundary and projection/source identity each time.
No extra A3-only "check your objective" prompt is introduced after seeing behavior.

A1 controls for reminders with the same reflection/timing treatment. A2/A3 compare
on-demand access with automatic delivery under a matched rechecking instruction.
These remain workflow/content interventions, not identical-compute or serialization-
only comparisons. A3 outperforming A0 alone would not establish graph-specific benefit;
A3/A1 differences are descriptive content/access-package observations, not causal proof.

Run deterministic contract controls for stale coverage, changed scope between build
and delivery, lag/failed curation, wrong-session/branch imports, duplicate delivery,
quoted fake Human approval, prompt injection, privacy and paused-worker behavior.
A frozen-objective negative control must be identified as stale/rejected—not silently
substituted into A3 or relabeled fresh. This checks the **coverage/frontier fence only**:
a semantically obsolete graph with a falsely current coverage claim is not mechanically
detectable by a watermark. Separate semantic negative controls expose that limitation.
Injection/fake-approval controls pass mechanically only when tool/file or quoted text
cannot manufacture a protected source actor or qualify alone as governing Human basis.
Semantic recognition and resistance to malicious text are separately judged, not
certified by the attribution check. Live failures remain failures/unavailable; no
retries, repaired JSON, model/effort fallback or post-outcome oracle changes.

Episodes include actual requirement replacement/cancellation and a workspace-seeded
counterexample that a plausible implementation must handle. Scripted requests must
make sense whether a worker chose the tempting means or not; never narrate a worker
failure that did not happen. Freeze phase/tool ordering and probe eligibility before
runs. Every probe is reported exercised/not exercised/not observable; an untriggered
contradiction, unstarted side task or already-finished work is **uninformative**, not
successful drift recovery. Score actions against the contract current when they
occurred. Cancellation is prospective stop-work; existing side artifacts are removed
only if the scenario explicitly requests it. Preserve its exact scripted semantics.

At a predeclared phase boundary, apply a **common deterministic context-retention rule**
to each worker's own history, not identical fabricated history bytes: retain the generic
SYSTEM, initial scenario brief, newest scenario request, latest visible worker final
and latest visible test-result source as attributed data; deduplicate coincident refs.
Preserve the full raw log for the common read tool. Record actual retained/removed refs
and payload hashes. A0 therefore retains initial/newest requests and can inspect prior
sources; it is not an oracle-stripped worker with no recovery path. Sidecar state/logs
are not reset, so this tests worker interruption with ongoing external maintenance,
not sidecar context-loss robustness. The later protocol must specify valid API-role
encoding without fabricating assistant tool calls or Human authorship.

Do not call this induced reset native compaction or claim a full1M-context stress test
from a compact workload. Distractions are versioned scenario source, not secret evaluator
instructions, and future interventions remain inaccessible until their scheduled ingress.

## 10. What is measured

Independent evaluation uses raw sources, actual tool traces, artifact bytes and
executed checks—not the sidecar's tags as ground truth. Before runs, the independent
author freezes per-phase scenario-intent keys: current/replaced/cancelled requirements,
completion gate, allowed side artifacts, intervention order/eligibility and objective
query expectations. Worker-dependent hypotheses/opportunities are assessed afterwards
against actual traces and labeled as such; they are not invented scripted events.

The worker/sidecar access boundary excludes future events, private oracle/keys and
independent scoring checks. Workers can read only current public workspace material,
write allowlisted owned artifact paths and invoke scoped isolated checks. Development
tests may be visible; the pilot makes them read-only so they cannot become forged
acceptance evidence. Independent checks remain evaluator-owned/immutable, run against
exact artifact snapshots, and their results do **not** feed participants in this pilot.
Host public test output alone is not independent acceptance. Record all input/access
and check-source hashes. A hold-out designation requires this enforced boundary.
Final artifact checks receive opaque arm-independent IDs; arm mappings are opened
only after those results are fixed. Full-trajectory/model-assisted interpretation is
necessarily non-blind and is disclosed separately.

- **Maintenance:** current intent/constraint completeness, distinct hypotheses and
  observations, change/cancellation applicability, provenance and coverage accuracy.
- **Delivery:** the correct projection actually entered the selected worker payload;
  source/revision/branch races reject or expose lag rather than fabricate freshness.
- **Behavior:** actions and final artifacts respect current requirements, do not
  revive the cancelled side task, and do not claim untested fulfillment/acceptance.
- **Recovery:** after interruption, does the worker resume relevant authorized work
  under the revised contract rather than merely recite a correct objective?
- **Human oversight:** not established by this initial pilot. A later study must
  measure Human understanding, error discovery and repair burden independently.

A cancelled legitimate task is not drift before cancellation; a newly authorized
revision is not drift from an immutable initial goal. Correct refusal/clarification
is not failure when requirements genuinely conflict. A green implementation test,
valid graph schema, source hash, perfect recital or reviewer agreement alone does
not establish objective fulfillment or Human control.

Persist full qualitative trajectory judgments before resource reduction. Report all
failures, missingness, control limitations and the exact source/protocol identity.
Counter counts are not semantic accuracy; one episode's observations do not establish
causal generality. Preserve null when terminal metadata/usage is unavailable.

## 11. Capacity, safety and artifact discipline

No total-token/spending caps are imposed on non-Opus pilot participants. Verify actual
maximum provider-supported allocation through the measured loader/wire path, accounting
for the full input and any shared reasoning/output allowance. Do not use an omitted
8192 default or a client-catalogue32768 default as a provider maximum. A literal canary
checks transport/selection, not representative workload capacity; declare any separate
representative-shaped preflight and its limits before measured calls.

Use finite generous operation/deadline and memory/output guards solely as observable
runaway/safety controls. Do not use low call/graph-cardinality/context caps to manufacture
cheap successful trials, silently truncate source/intent, or discard a failed response.
Avoid importing the earlier64node/96edge experimental capacity as a semantic requirement
of this new synthesis. Bounded tool pages and projections expose continuation/omission.

Retain protected sources, exact input/capsule/output bindings, provider finish enum,
SDK-normalized reason, numeric usage and authorized visible outputs including failures.
No hidden reasoning, credentials, headers or arbitrary private error bodies are
exported. Real code executes only in an owned isolated workspace with scoped tools,
no host credentials/network access and observable test results. No production mutation,
private transcript ingestion, native extension activation or operational-goal writer.

Freeze and preserve the source/protocol before measured calls. If repository policy
prevents committing experiment code, retain an honest content-hashed immutable source
artifact with commitnull; never bypass the policy or attribute uncommitted files to a
Git commit. Preserve original failures and publish qualified artifacts through the
user-selected store. Keep deterministic instrument tests distinct from live behavioral
acceptance and both distinct from semantic/Human outcomes.

## 12. Review and implementation order

1. The initial19899byte synthesis was independently reviewed by Opus and Astra.
   The preserved candidate SHA is
   `4c85172be6c9b905e937f21e504088f9fb77f457fca1004a40c8debba5ae971e`.
   Opus read the synthesis only; Astra also read the supporting designs. Neither
   independently recomputed that supplied hash or ran behavior. Their reviews are
   Agent design critiques, not Human approval. Both identified pre-pilot arm/control,
   intervention/history or authority/information-boundary gaps; this revision makes
   their dispositions explicit above. Opus is not a repeated pilot/review worker.
2. Preserve the reviews and resolve material findings before freezing the pilot
   protocol, workload/oracle, prompts, model selections and instrument.
3. Reproduce suspected instrument defects before correction; run complete deterministic
   scope/provenance/CAS/delivery/privacy tests and real selected-path canaries.
4. Run the declared genuine worker/sidecar arms once each, retaining actual failures.
   Review full trajectories before telemetry and report the resulting bounded evidence.

This changes the design direction and authorizes the requested research pilot. It does
not declare production readiness, replace the planned graph service stack or transfer
execution authority to the sidecar.

## 13. Evidence-authority follow-up after the first live pilot

### 13.1 Observed motivation and retained limits

The first eight originals exercised actual automatic maintenance and worker delivery.
Five completed all four native phases, one completed three, and two failed before
phase completion. Native phase completion is not unwaived full-scenario fulfillment.
Current structurally admitted accounts sometimes asserted false file identities or
falsely described an edit as already meeting its requested shape. Stable relation-ID
violations were rejected; later original maintenance recovered. None of this proves
that full-graph generation caused the violations, that ontology caused worker recovery,
or that successful delivery improved Human understanding/control.

The all-eight bound-current-capture accounting recorded418 proven outbound requests
and22,628,611 raw tokens, including failed/partial originals and shadow curation.
Historical full consumption and native end-to-end wall time were unavailable. This
motivates testing a smaller incremental representation, not an arbitrary spending,
generation, graph-cardinality or call cap. Preserve the original source, judgments,
failures and reporting-contract discrepancies; do not rescore or rerun them as new
controls. New controls require new episodes and new original identities.

### 13.2 Protected observation facts and attributed assertions

The host owns an append-only observation store outside the curator-writable graph.
A fact has an immutable host ID, capture scope/event, observation kind and exact
artifact/execution binding. The curator may reference it but cannot mint its actor,
replace its captured values or turn its own text into a host observation.

For files, record a version identity containing scope, safe logical path, monotonically
increasing write generation, content length and digest. A read records the actual
version observed. A successful owned write advances generation even when bytes are
identical; failed writes do not manufacture success or a new complete observation.
For executions, bind the exact action/argv, checker identity, contract revision,
artifact-version inventory, process outcome and observed public result. Missing,
partial or interrupted observations remain qualified. Tool stdout is captured output,
not automatically a true assertion about the world.

Curator prose, causal explanations, completion accounts and interpreted requirements
remain attributed model assertions, even when they cite real facts. A reference proves
which evidence was cited, not that the prose is entailed by it. Typed assertions about
host-observable values may be compared deterministically; an unequal digest/length
can produce an explicit conflict. Do not claim this verifies arbitrary prose or the
semantic correctness of interpreted intent. Contradictions not mechanically decidable
remain unresolved assertions for source inspection and independent evaluation.

### 13.3 Projection qualifications and invalidation

Project separate dimensions, not a single confidence/currentness badge:

- coverage: active scope, source frontier and current versus lag/unreviewed ranges;
- origin: host observation versus worker/curator assertion, with exact source basis;
- applicability: exact current artifact version, historical version or unbound claim;
- conflicts: explicit typed disagreements and unresolved semantic qualifications.

Show applicable host facts beside relevant model accounts without silently replacing
or deleting those accounts. False or unresolved interpretations must not displace
verbatim governing intent merely to produce a clean capsule. A known bad assertion
cannot be presented as verified because its source watermark is current. Host fact
projection is not a second objective registry or new execution-goal owner.

A write makes earlier version-bound evidence historical for current-version claims.
Retain its historical validity. Distinguish reusable evidence about identical content
from a contract requiring an execution AFTER the latest write: identical bytes can
preserve a content property, but do not establish the required later action/order.
The completion contract declares which rule applies. No automatic rerun, deletion,
Human act or completion mutation follows from invalidation alone.

### 13.4 Identity-preserving atomic revisions and incremental input

The candidate curator proposes deltas against an exact prior graph revision/source
frontier, not a freshly regenerated graph that may omit stable IDs. Operations upsert
nodes/relations and explicitly change standing; removal is not supported. Preserve
all prior IDs and history. A relation's kind/endpoints identify its proposition;
correcting that proposition supersedes the old relation and introduces an explicitly
related new one rather than silently repurposing its ID. Node reclassification may
correct the same account with an explicit reason; semantic identity is not certified
by a string-ID check.

Validate the complete proposed delta atomically. Duplicates, unknown references,
invalid identity reuse or stale base reject the whole publication without partial
head changes. The last valid head remains available with honest lag. No repair,
same-frontier retry, manual graph seed or hidden evaluator feedback is introduced.

Supply the prior committed account, protected observation references and all newly
eligible events since the LAST SUCCESSFUL publication. Failed attempts must not
advance the successful source frontier or omit unreviewed events. Earlier immutable
sources remain fully retrievable through the same scoped source interface. Record
which events were inline, available by reference and actually returned. Mechanical
coverage acknowledgement is not a full-read or comprehension attestation. If required
input cannot fit, expose capacity failure; do not truncate unresolved intent.

This changes representation/input policy, not event eligibility or delivery cadence.
Raw-request and legacy full-graph arms retain their declared policies. A candidate
package difference cannot isolate the causal contribution of any individual feature.

### 13.5 One public completion-action contract

For each phase, one immutable public contract identifies the required test tool/action,
actual invocation, checker version and artifact/version binding. Scenario instructions,
dispatch and reporting checks refer to that SAME contract rather than separately
spelling incompatible executable paths. Contract revisions are captured scenario input,
not curator-authored permissions. Other functional/behavioral requirements remain
independently assessable; running the named action or passing finite public tests is
not equivalent to completing the entire scenario or obtaining Human acceptance.

Record actual action execution separately from the worker's completion claim. A later
write can reopen the action requirement under the declared ordering rule. Do not waive
a literal mismatch after seeing the result, silently reinterpret a true completion
flag, or require workers to claim unavailable private evaluator outcomes.

### 13.6 New six-original pilot and acceptance obligations

Use two independently authored NEW fictional coding episodes across three arms:

| Arm | Context and maintenance policy |
|---|---|
| R | Common reflection plus chronological scenario-request replay; legacy curator shadow-hidden |
| G | Common reflection plus legacy automatically delivered full-graph ontology and lookup |
| C | Common reflection plus qualified host-fact/model-assertion projection, stable-ID deltas and incremental curator input with full prior-source retrieval |

All use the same genuine worker selection, common generic system/reflection prompt,
workspace/test/raw-source tools, public observation receipts, completion-action contract,
event eligibility and settled delivery boundaries. Curator identity remains matched;
input/output policy differs as declared. Two endogenous episodes per arm are descriptive
feasibility bundles, not independent statistical samples, compute-matched comparisons,
component ablations, causal model rankings or Human-benefit results.

Freeze the generic worker prompt before new episode authoring and disclose subsequent
protocol/curator amendments. Keep private evaluator content from the runtime author and
all participants. Freeze the final protocol, prompts, code, corpus, checker and runtime
identities before originals. A separate engineering preflight must exercise the real
selected provider/tool/maintenance/delivery path; it is not an original or quality result.

Require actual unfinished side-work evidence before counting cancellation as exercised.
Predeclare whether intervention occurs at a source/tool trigger or after an explicit
partial deliverable with remaining overall work. Do not narrate a failure, interrupt an
already-completed task and call that recovery, or remove old artifacts unless requested.
For interruption, omit an earlier STILL-GOVERNING constraint from retained worker context
under a common rule, preserve common raw-source access and keep sidecar state. Count
recovery only where subsequent actual work needs that constraint; merely retaining an
already-correct artifact or repeating an objective is uninformative. Report actual
exposure to conflicting/quoted approval data; accessible-but-unreturned text is not
resistance evidence. Evaluator output never enters the worker/curator feedback loop.

Before live originals, execute specified positive/negative controls for protected fact
minting, wrong scope/version, same-byte write ordering, partial/missing facts, typed
conflicts, stale test applicability, atomic failed deltas, stable relation IDs,
failed-frontier incremental replay, old-source retrieval, required intent omission,
completion-action agreement and source/runtime isolation. Exercise filesystem/process
adapters as well as in-memory contracts. A green count is not a substitute for mapping
each required trigger to an assertion at the intended boundary.

Retain every failed setup/control/preflight and original without repair/replacement.
Review entire trajectories and exercised opportunities, freeze qualitative judgments,
then aggregate resources with applicable denominators, unknown/N/A distinctions and
actual matching end-to-end timestamps where available. Do not lower effort, substitute
participants, impose financial/token caps or tune solely to development episodes.
If supporting workers or selected participant transport are unavailable, continue only
independent work and disclose the missing prerequisite rather than silently weakening
author independence, holdout or actual-path acceptance.

## 14. Decision-model-assisted classification: prospective CLEF pilot

The next requested experiment asks whether the locally deployed large CLEF can improve
or accelerate bounded ontology decisions, either as additional curator evidence or by
replacing a matched classification stage. See the [research and staged pilot design](20261110-0530-clef-ontology-pilot.md)
for full-text prior-art evidence, ownership, controls, evaluation and execution gates.
This is not authorization to modify the deployment, substitute a hosted/smaller model,
rerun the closed six originals or claim model quality from a transport canary.

The official large model scores supplied options with a joint schema head. It does not
by that interface discover every missing proposition or freely author graph edits.
Separate candidate extraction/pair recall, semantic classification, identity/revision
assembly and atomic admission. Each existing graph node retains one kind; a passage
containing a task and independent constraint needs separately identified propositions
upstream, not an inadmissible multi-kind node. Compare node/proposition type, directed
relation and source-support tasks without collapsing standing, applicability and attribution.
A score, agreement or classifier label remains an attributed model assessment, never a
host observation, Human mandate, permission or semantic truth certificate.

Place a versioned source-bound decision interface before curator/delta admission:

- Advisory arm: deliver classifier scores and explicit uncertainty alongside original
  source to the existing curator; measure actual delivery, use, disagreement and harm.
- Replacement arm: classify already identified units/pairs, with declared abstention
  and LLM deferral; retain source proposal and graph identity owners separately.
- Decomposition-only control: use the same proposal/classification/assembly path with
  the matched LLM classifier. The current combined curator is also a baseline; do not
  count hypothetical per-node LLM calls as actual removed calls.

Classifier outcomes bind source scope/frontier, base graph and candidate revisions,
ordered questions/options, schema and model/serving identities. Changed inputs fence
stale results. Advice is separately stored derived assessment, not a newly eligible
primary event, independent Human basis, host fact or additional curation trigger; its
delivery cannot advance the source frontier or create self-confirming evidence. Host
capture, exact artifact/action applicability, stable relation IDs,
CAS, source availability and qualified projections retain their existing deterministic
owners. A relation label change is a new proposition/replacement, not ID repurposing.
No-relation and insufficient-evidence/abstain are distinct non-edge outcomes, not new
admitted graph kinds or silent deletion of existing unresolved relations.

Use staged evidence: actual deployment/adapter acceptance; independently authored
conditional classification and held-out selective-routing evaluation; frozen-stream
maintenance replay; then new live worker/curator episodes for promising configurations.
Replay is not a closed-loop behavioral benefit result. Keep development/calibration
families disjoint from sealed tests, ground labels in source spans and disclose genuine
ambiguity. Include critical intent/provenance/scope/time/generation negatives, candidate
omissions and correct/incorrect-advice controls. LLM agreement is not the gold label.

Do not assume confidence is calibrated or state is complete. The inspected public encoder
slices state under its token allowance; verify the actual deployed input contract and
reject/expose incomplete inputs instead of silently dropping governing evidence. Pin
local weights/head/tokenizer/quantization/server and actual admission behavior before
measured calls; a catalogue context window does not establish them. Q53 located the
full BF16 SGLang deployment through `../paddock`; live metadata and three synthetic
engineering controls matched the selected native path with8192 effective prompt tokens.
Those controls do not establish ontology quality, ongoing readiness or all weight bytes.
Do not guess another endpoint, import credentials or mutate the deployment.

Freeze quality judgments before resource aggregation. Report per-task precision/recall,
critical regressions, candidate recall, selective risk AND coverage, abstentions and
all-case quality after actual deferral. Zero accepted decisions have undefined selective
risk, not a perfect score. Measure actual call removal and matching-boundary end-to-end
latency, including proposal/queue/serialization/transfer/deferral/failed work, separately
from model-only timing and publisher benchmarks. Advisory may improve quality while
being slower; replacement may save calls while losing critical relations. No arbitrary
financial/token cap, test-set threshold tuning, silent fallback or success-only reporting
is introduced. A useful fit is an observed task-specific trade-off, not general semantic
reliability, Human benefit or production readiness.
