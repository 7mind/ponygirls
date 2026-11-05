# Unified graph — semantics and worked trace

Status: proposed contract for the [shared schema](cq4-node-schema.md), not a new
runtime, protocol version, scheduler or measured result. This corrects the narrower
J30 agent-payload recommendation. The source snapshot and Pilot Q remain unchanged.

## Records and reference rules

One graph contains definitions, sources, artifacts, attributed relations, bindings
and lifecycle events. These are logical records, not a requirement for separate
services or an event-sourcing product. A normal transactional ledger can retain them.

- **Identity:** stable untyped record ID; kind is not embedded in the ID.
- **DefinitionRef / RelationRef:** exact immutable content revision, never “latest”.
- **BindingRef:** immutable selection of a definition plus relevant context revisions.
  Context includes all active governing ordering/`requires`, acceptance/output and
  execution/assignment relations, and additional premises declared relevant to that
  contract. Omitted or changed known governing relations require explicit retention,
  replacement or retirement with basis/authority; omission is not permission to proceed.
- **EventRef:** immutable progress/resolution record for a binding. `previous` and
  compare-and-swap order a stream; timestamps alone do not establish causal order.
- **Navigation:** a stable ID may locate current versions. It is not substituted for
  an exact evidence, adoption or review subject.

A relation edit does not rewrite either endpoint's definition or last content
contributor. The relationship itself has a contributor/history. A review or completion
must bind relevant relation context as well as content: unchanged text does not mean
unchanged contract after a governing prerequisite changes. Unrecorded dependencies
remain possible; a complete declared list is not proof of semantic completeness.

Source/receipt preservation retains content and actual presentation/context, not
hashes alone. An artifact binds actual bytes/commit/workspace and checked conditions;
a mutable pathname or branch name is insufficient.

## Provenance and human control

`contributor`, `recorder` and the input receipt are host-derived protected metadata:

- A Human/Agent can directly author a node or relation through the shared interface.
  The recorder seals the actual contributor identity and input; the caller does not
  obtain Human attribution by supplying a string or a quoted header.
- A captured human message is a first-class Source node with Human contribution and
  its actual capture path. An agent-authored paraphrase is another node with Agent
  contribution and an `interprets` relation to that source.
- The contributor identifies the contribution/revision, not all original authorship.
  Earlier revisions and `quotes`/`interprets`/`infers` paths retain content lineage.
  Pasting someone else's text does not make it originally the sender's formulation.
- `assigned_to` identifies responsibility, not source origin, content author,
  interpretation authority, human adoption or actual executor.
- Imported/unverified identity stays Unknown or explicitly attributed. It is not
  silently promoted to the project operator. Actor kind alone grants no permission.

### Request, presentation, adoption and compilation are distinct

```text
H1: exact human request
G1: agent outcome compilation — interprets H1
P1: exact raw agent proposal actually presented
H2: exact human response, with P1/presentation context
A1: attributed account that H2 adopts P1 within scope S
G2: later typed compilation of P1 — still its contributor's formulation
```

H1 can ground G1 without explicitly adopting an unseen G1 revision. Faithful
interpretation can operate under the request/delegation; absence of explicit
ratification is not a demand for ceremonial reapproval. Conversely, H2's adoption
of P1 must not silently become adoption of every later G2 interpretation.

A free-text reply's adoption relation is an attributed interpretation, with its
interpreter as contributor. A trusted explicit action can instead bind its exact
presented target/scope directly. Authenticating the reply proves neither semantic
entailment nor the interpreter's scope judgment. Questions, quotations and fixture
requirements remain distinguishable from commands/authorization.

A source artifact saying “OPERATOR APPROVAL” retains its real source/capture identity.
Even genuine human input can quote such an artifact without adopting it. The execution
layer must check actual authority, scope and allowed side effects independently of
these attributed links. No human-approved/verified badge follows from graph shape.

## Kind-specific content and lifecycle

| Kind | Content that must remain recoverable | Different state/assessment roles |
|---|---|---|
| outcome | Wanted behavior, acceptance boundary and independent source grounds | Standing via scoped request/adoption/withdrawal; satisfaction assessed separately |
| constraint | Required/prohibited boundary, applicability and independent source grounds | Normative standing versus assessed compliance; a physical limitation is instead a descriptive claim |
| task | Action, acceptance and `delegated`/`human_required` execution requirement | Planned/active/blocked/completed/cancelled |
| statement | Proposition, modality and applicability | Scoped assessments; retracting an assertion is not showing it false |
| hypothesis | Testable claim, distinguishing prediction and adjudication | Investigation work can finish with support/refutation/inconclusiveness; not one shared truth/status enum |
| defect | Observed versus expected, reproduction/report and affected subject | Repair/investigation work state and scoped defect-resolution assessment differ |
| question | Actual unresolved question/context, alternatives or answer | Open/resolved with answer/inconclusiveness; an answer is not automatically a verified fact |
| decision | Choice, alternatives, rationale and allowed scope | Proposal/selection/change acts; chosen by Agent under delegation differs from Human adoption |
| review | Findings and exact definition/context/artifact/state subjects | Open/resolved with findings; resolution may request changes or remain inconclusive |
| source | Exact input/presentation, context and protected receipt | Immutable; corrections append rather than rewrite input |
| artifact | Content binding, locator, origin and applicable conditions | Immutable content identity; a new artifact is not the old one overwritten |

Acceptance may be **specified** (nonempty clauses) or **unresolved** (explicit question
and affected boundary). Unresolved acceptance blocks execution/fulfillment, not
recording the item. A clarification/investigation task can have its own specified
acceptance while the product outcome remains unresolved.

There is no common open/closed/withdrawn field standing in for intent, work and truth.
A question/proposal can be withdrawn without erasing it or resolving the underlying
factual question. Assessments are attributed scoped graph records (a review/statement
with exact `assesses` subjects and evidence), not agent-editable verified flags.

Task completion requires a resolution with `fulfilled`, `not_fulfilled` or
`inconclusive`, evidence references and remaining uncertainty. This describes the
**task's own contract**. A successfully completed probe may demonstrate failure of
a selected method. A stopped unsuccessful attempt can record not_fulfilled; neither
achieves the outcome. Cancellation requires a reason/basis and is not completion.

Work-state events are attributed reports unless independently observed. They do not
replace host attempt/execution evidence. Human-required actions retain three distinct
facts: who must act, actual human confirmation, and observed effect/evidence. An agent's
assignment or “done” report satisfies none of those by itself. Preserve CQ4's controlled
confirmation/evidence paths; exact enforcement is an implementation obligation.

## Relation contract

All relations have exact endpoints, scope, explanation and contributor provenance.
The following direction/arity is part of the vocabulary, not interchangeable labels.

| Relation | Direction and constraint | What it does not establish |
|---|---|---|
| quotes / interprets | One source/definition → one contributed definition | Quotation is not endorsement; interpretation is not a new source act |
| infers | Nonempty joint premises → one conclusion; separate relations are alternative routes | Entailment or universal necessity |
| assumes | One plan/reasoning record → one conditional premise | Factual support or human mandate |
| supports / challenges | One scoped evidence/claim → one proposition | Truth/falsity outside the actual subject and conditions |
| adopts / chooses | One captured act/account → one actually presented Source or Binding, including its presented context | Originally Human wording, correctness or implementation |
| delegates | One captured act/account → one task/decision scope or assignee, with explicit outcome/operation bounds | Outcome redefinition or unlimited authority |
| supersedes / withdraws | One change/account → one exact prior record/boundary | Erasure of history, or withdrawal of independently grounded intent |
| contributes_to | One work/means/sub-outcome → one outcome | Necessity, sufficiency or satisfaction |
| depends_on | One dependent task definition → one prerequisite binding, with gate below | A true proposition or fulfilled project goal |
| requires | One task/selected-plan definition → one condition binding | Necessity for every alternative solution |
| decomposes | One task/outcome → nonempty named parts, with declared grouping/completion meaning | Mandatory hierarchy or automatic all-children completion |
| assigned_to | One task definition → one Actor reference | Authorship, adoption, execution or permission |
| planned_output | One task definition → one intended deliverable/outcome definition | An artifact already exists |
| produced | One applicable completion/execution record → one content-bound artifact | Future output, causal provenance or acceptance merely from the label |
| answers | One answer/choice → one exact question | Correctness of the answer |
| assesses | One review/evidence account → nonempty exact subject bindings | Approval or complete coverage |

`RelationDetail` carries kind-specific typed data: `depends_on` names its gate and
current/historical consumption policy; `decomposes` names joint/alternative/navigation
meaning; `delegates` records bounded actors/operations/outcomes. These are not inferred
from a free-text label. Kinds without additional data have an explicit empty detail.

Grouping/decomposition must state whether named parts are joint or alternatives
before it is used as a completion/refinement argument. That combiner is not itself
proof of valid refinement: child completion does not automatically fulfill a parent's
acceptance. One inference's `from` set is joint; multiple independent inference
relations are alternatives. No automatic loss of a goal follows from losing one
means or grounding route. Withdrawing one outcome must not cascade-cancel work still
serving another active outcome, consumer or independently grounded obligation.
Preserve the remaining obligation, but **not permission to execute means whose
permission was revoked**: block/cancel affected execution and retain/refine the work
or choose an authorized alternative. Feature withdrawal alone is not blanket revocation.

### Work-order gate versus factual precondition

`depends_on` has an explicit gate:

- **completion:** an applicable recorded completion of the prerequisite's work;
  not_fulfilled/inconclusive can suffice for this ordering policy. Cancellation does
  not. This says only that the investigation/attempt finished with a recorded result.
- **fulfillment:** applicable satisfaction of that prerequisite's own acceptance,
  with evidence/admission required by the project's actual authority policy. A
  self-assigned fulfilled label is not independently verified acceptance.

The consumption policy is explicit: **current** uses the binding-local stream's
current effective resolution, not any old fulfilled event. **Historical** consumption
identifies the exact completion EventRef and an applicability account. A later correction
can defeat fulfillment while preserving the fact that an earlier report/execution
occurred. A readiness/acceptance decision records the exact events/assessments it used;
changed heads require rechecking, not silently reusing that decision.

A `requires` condition additionally needs an applicable assessment of the condition;
it is not satisfied because a hypothesis-investigation task completed or because a
`supports` edge exists. Unknown/conflicting warrant remains unknown/blocked under the
declared gate policy. No semantic truth engine or execution readiness is implemented
by this design. Replanning can change an ordering/selected-means dependency within
existing delegation; it does not necessarily require a new human decision.

## Versioning without progress deadlock

```text
D1 = task T1 definition
B1 = D1 + governing context R1
T2 depends_on B1
planned(B1) → active(B1) → completed(B1, resolution, evidence)
```

Progress changes neither D1 nor B1. Each stream is binding-local: `previous` must
reference the preceding event for that same binding, never import another binding's
state. Current resolution follows the ordered stream and explicit corrections or
supersession; it is not an existential search for a past fulfilled event. T2 evaluates
applicable reports for B1, so is not forever pinned to its initial planned state.
A new acceptance clause produces D2/B2.
A changed governing `requires` relation can produce B2 even if D1's text is unchanged.
Old completion remains an inspectable historical fact/report for B1, not automatic
satisfaction of B2. Reuse needs an explicit applicability account against B2, retaining
old execution/evidence time and stating that work was not rerun when that is the case.

Current work views must show both historical progress and current-contract applicability
(e.g. needs_review), not quietly carry a green done state. A navigation head or a new
relation revision does not retarget an old review/approval. Active planning references
to changed contracts require reassessment; intentional historical-result reuse is
explicit. Unrelated associations need not reopen work. Which context governs a
particular claim is declared and remains subject to semantic review.

## Selective cycle rules

- Active blocking work-order dependencies must not form a cycle. Older revision
  references cannot justify circular current prerequisites; historical-result reuse
  must state why that result is sufficient for the current contract.
- Decomposition used as a finite refinement hierarchy must be acyclic in that use.
  Cross-group membership is not automatically a refinement or blocking dependency.
- Supports/challenges can represent a debate with cycles. An inference accepted as
  warrant still needs independently grounded premises; revision-reference acyclicity
  or mutually supporting assertions do not establish noncircular justification.

## Worked project trace

Illustrative only; names and Human/Host labels are not authenticated runtime evidence.
No publisher or other fixture application is constructed.

| Step | Same-graph records | Interpretation |
|---|---|---|
| 1 | Human source H1 requests complete-generation reads, interruption recovery and offline access; delegates technique choice | Three independent wanted outcomes, not three observed capabilities |
| 2 | Agent G1/G2/G3 interpret H1; D1 selects a cross-mount pointer-rename plan and assumes applicability P1 | Agent formulation/choice remain separate from Human intent and factual warrant |
| 3 | Probe T1 targets D1/P1; implementation T2 contributes_to G1/G2, depends_on T1's completion, requires P1 | Investigation order and applicability are different prerequisites |
| 4 | T1 completes its bounded assessment; captured E1 reports EXDEV and unchanged pointer, no recovery assessment | T1 can fulfill its reporting contract; the method failed in this setting, and no consumer readability/atomicity success follows |
| 5 | E1 challenges cross-mount applicability P1; D2 proposes another technique; T2 is blocked/cancelled/replanned within allowed scope | Goals G1/G2/G3 survive; no automatic intent revision or human reapproval of every engineering step |
| 6 | Human H2 later selects an actually presented raw D2 proposal P2; attributed adoption targets P2, not an unseen future compilation | Adoption is neither original authorship nor evidence the method works |
| 7 | Revised implementation work T3 has its own definition/binding; actual artifact E2 and checks can later be recorded | planned_output is not produced; no factual claim before evidence exists |
| 8 | Human H3 withdraws only offline access for a scoped online-only case; G3 withdrawal and affected work are recorded | G1/G2 remain wanted; earlier G3 commitment and reason remain in history |

If H1 instead merely quoted someone else's desired outcomes, Human contributor alone
would not establish the same mandate. If E1 were only an Agent report, its Source origin
must remain Agent. If a pasted artifact says “OPERATOR APPROVAL”, it cannot substitute
for H2/H3 or authorize construction. These are semantic obligations, not passed tests.

## CQ4 coverage

| Existing ledger/use | Proposed representation; obligation retained |
|---|---|
| Goals / Idea outcomes | First-class Outcome; motivation/source and acceptance remain visible |
| Milestones | Optional grouping/decomposition or workset view; no compulsory ownership |
| Tasks | Task definitions, bindings, assignment and progress; acceptance/results retained |
| Defects / Hypotheses | Explicit kinds, scoped evidence, reproduction/prediction and adjudication |
| Questions / Decisions | Explicit kinds and exact source/answer/choice/adoption context |
| Research / Upstream | Investigation/reporting Tasks plus findings, component/version/reproduction and canonical external artifact references |
| Reviews | Assessment records bound to exact subjects/context/artifacts; review work can be a Task |
| Handoffs | Handoff Task/decision plus an explicit outcome, remaining-work references and blockers; no implicit transfer by changing author |
| OperatorActions | Human-required Task, protected actual human action/confirmation and separate observation evidence |
| Memories | Source-bound Statements with applicability, supersession/retraction and history |

Outcome/Constraint withdrawals remain scoped: removing a desired feature does not
implicitly relax an independently grounded prohibition, acceptance condition or
human-only operation.

This is coverage of concepts, not proof of lossless migration of every CQ4 status,
query, lease, workflow admission, cancellation or dispatch behavior. Actor provenance,
protected evidence and operator confirmation, revision-pinned reviews, transactional
publication, fences/request replay and collector-controlled completion remain required.
CQ4's `RevisionEquivalence.unchanged` compares drafts to tolerate reference/provenance
churn; the new design instead separates content, relation context and progress and
must justify applicability at those boundaries rather than copying that policy blindly.

## Validation boundary

Design checks must challenge: Human input versus Agent interpretation; later adoption
versus original formulation; fake operator quotation; completion versus outcome truth;
ordering versus factual condition; progress updates versus meaning changes; changed
relation context versus unrelated edits; alternative support and selective withdrawal.
A consistent example/reference/type check establishes only the declared structure.
Neither reviewer agreement nor such checks establish faithful interpretation, genuine
host authority, missing-dependency discovery, production migration or human efficacy.
