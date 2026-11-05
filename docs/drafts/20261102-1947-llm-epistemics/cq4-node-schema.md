# Unified project graph — schema proposal

Status: **design revision after human review**, not an implemented CQ4 API. The
previous five-field agent payload under-specified planning and hid origin outside
its visible schema. This proposal replaces it as the project model; it does not
rewrite Pilot Q or claim that experiment validated the additions.

**One graph for human intent, agent refinement, planning and evidence.** Humans and
agents can contribute the same record kinds. Human-facing outcome/change views and
agent-facing work queues are projections, not separate authorities.

## 1. Common records, visible provenance

Design pseudocode; opaque references and kind-specific content are defined in the
[semantics and worked trace](cq4-unified-graph-semantics.md).

```typescript
type ActorRef = { id: ActorId; kind: "human" | "agent" | "service" | "unknown" };
type Provenance = {
  contributor: ActorRef;
  recorder: ActorRef;
  input: InputRef;
};
type Node<K extends Kind> = {
  ref: DefinitionRef;
  kind: K;
  content: Content<K>;
  scope: string;
  provenance: Provenance;
};
type Relation<R extends RelationKind> = {
  ref: RelationRef;
  kind: R;
  from: Ref[];
  to: Ref[];
  detail: RelationDetail<R>;
  why: string;
  scope: string;
  provenance: Provenance;
};
type Binding = {
  ref: BindingRef;
  definition: DefinitionRef;
  context: Ref[];
  provenance: Provenance;
};
type StateEvent = {
  ref: EventRef;
  subject: BindingRef;
  previous: EventRef | null;
  change: LifecycleChange;
  provenance: Provenance;
};
```

IDs, revisions, input receipts and provenance are **system-sealed, visible metadata**,
not arbitrary fields an agent may supply. `contributor` identifies the actual input /
revision contributor; `recorder` identifies its capture path. Neither alone identifies
all original formulation or gives a statement normative force. Source/interpretation
relations preserve that lineage explicitly. Changing an agent interpretation cannot
rewrite the original human input.

| Record | Visible attribution and meaning |
|---|---|
| Human request S1 | Human contributor, capture service recorder, exact input/context |
| Agent interpretation G1 | Agent contributor; `interprets(S1,G1)` retains human source |
| Agent-selected means D1 | Agent contributor; choice and delegated scope remain inspectable |
| Later human input S2 | Human contributor; actual presented proposal/context retained |
| Interpreted adoption relation | Its interpreting contributor is still Agent, even when S2 is Human |
| Host observation | Restricted service/capture origin, actual subject and artifacts; not an agent report |

A quotation of “operator approval” is not an operator act. A human's question,
quotation or fictional example is not automatically an instruction. Human adoption
of agent wording does not make it originally human-authored. Task assignee is another
relation, not any of these authorship/origin fields.

## 2. Semantic kinds, not compulsory containers

- **outcome / constraint:** wanted behavior / required or prohibited boundaries;
  independently grounded, first-class, not lost in prose or compulsory containers.
- **task:** work, acceptance and execution requirements (`delegated` or `human_required`).
- **statement / hypothesis / defect:** descriptive claim, testable explanation or
  observed/expected discrepancy, with applicability and source/evidence paths.
- **question / decision / review:** unresolved matter, proposed/selected choice, or
  assessment of exact subjects and evidence. Review activity can itself be a Task.
- **source / artifact:** immutable captured input/context or content-bound material.

Task acceptance must be specified or explicitly unresolved; unresolved acceptance
blocks execution, not recording a backlog item. Sources/artifacts have protected
capture/binding fields, not merely a title and mutable file path.

No mandatory milestone ownership, single parent, or Goal→Milestone→Task path.
Optional decomposition/grouping does not confer authority or automatically complete
its members. Handoffs and upstream/research work retain their obligations through
Tasks, findings and exact references; [mapping and limits](cq4-unified-graph-semantics.md#cq4-coverage).

## 3. Relations cover both planning and epistemology

| Family | Initial vocabulary | Meaning that must not be lost |
|---|---|---|
| Lineage | quotes, interprets | Original input versus contributed formulation |
| Justification | infers, assumes, supports, challenges | Joint premises, alternative routes and scoped warrant |
| Authority/change | adopts, delegates, chooses, supersedes, withdraws | Scoped acts/interpretations, not factual proof |
| Planning | contributes_to, depends_on, requires, decomposes, assigned_to | Means, work order, conditions, organization and responsibility differ |
| Results/review | planned_output, produced, answers, assesses | Expected deliverable versus actual artifact; exact answer/review subjects |

`contributes_to` does not mean necessary or sufficient. `depends_on` must name a
completion or fulfillment gate; neither is a factual proof. `requires` states a
condition for the named task/selected plan, not an unconditional law about every
possible solution. Evidence/adoption/review references bind exact content and relevant
context; no floating branch or “latest” reference is an acceptance basis.

## 4. Work lifecycle is not epistemic truth

Task phases: **planned, active, blocked, completed, cancelled**. Completion carries
`fulfilled`, `not_fulfilled` or `inconclusive`, a resolution and evidence/remaining
uncertainty. Fulfillment refers to the task's own acceptance, not its linked outcome.
A completed investigation may refute its hypothesis; the human outcome can remain
unachieved. Cancellation is not completion or withdrawal of intent.

Intent standing follows scoped requests/adoption/withdrawal, not task phase. Outcome
satisfaction and factual warrant have scoped assessments; neither is a green lifecycle
label. Questions/reviews have open/resolved work state plus their answer/findings;
a resolved review need not approve, and a concluded investigation need not support
its hypothesis. Reported work state is not independently observed work. A ready view
requires an admitted current binding and the applicable prerequisite/performer/authority
checks; it is not another self-assigned truth badge.

**Definitions, contract bindings and progress are separate.** A binding pins a node's
content and its relevant relation/context revisions. Starting/completing T1 appends
progress for that binding; it does not change the definition or pin a dependency
forever to `planned`. Changed action/acceptance/scope or a governing prerequisite
requires a new binding. Old execution history survives, but completion/adoption/evidence
does not silently establish satisfaction of the new binding. An unrelated association
need not reopen work; declared-context completeness remains a semantic responsibility.

## 5. Limits and next boundary

One typed graph need not be globally acyclic. Active work-order cycles are invalid;
cycles in unrelated associations/history are not automatically defects. Inference and
refinement still need semantic scrutiny; exact references are not a proof of entailment.

Keep CQ4's real authentication, protected evidence/confirmation paths, exact review
applicability, atomicity, concurrency and replay guarantees. [Pinned source review](cq4-source-review.md).
The schema does not implement a scheduler, trusted language interpreter, truth-maintenance
engine or lossless migration. Pilot Q found no empirical schema winner and did not test
this unified planning/provenance model. No new measured pilot or application build is
part of this revision.
