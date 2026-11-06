# Shared-schema intent review — resumable checkpoint

Status: conversational design review, refreshed 2026-11-06 UTC through the user's
qualified agreement on closing work with declared unmet preferences. This is **not
a schema release, implementation, new pilot result or authorization to start any
of those**.

The user explicitly requested a checkpoint to avoid compaction loss. Initial save:
`171ccdc60e3d51ed7e642b1df880862eb85fe31c`, based on research checkout
`e808eb8114e1447e6b20d71eda043362a5d96fff`. Follow-up save starts from
`57ba0ab0048672ec7cacc55a634c078b57e09fec`; intervening unrelated model-transport
work is preserved, not part of this review.

## Resume here

1. Read this checkpoint, then the [shared schema](cq4-node-schema.md) and
   [semantics](cq4-unified-graph-semantics.md). The latter documents still describe
   the earlier working proposal; they have NOT been rewritten to encode every
   refinement discussed below.
2. Continue the requested guided review, **one material question at a time**.
   Explain a concrete distinction, ask a focused question, and advance after the
   answer. Do not stop the walkthrough merely because one point was settled.
3. Do not repeatedly revisit whether ordinary contract-preserving work needs human
   approval: the user explicitly rejected that. Likewise, avoid artificial
   either/or questions when independent typed links can coexist.
4. Already covered since the first save: Question is general with Conflict separate
   and human escalation explicit; work-order completion/fulfillment differs from
   factual preconditions; decomposition should account for parent acceptance;
   pathological cycle rules must be selective; rejected writes are audit-only but
   admitted uncertainty/conflicts remain in the working graph; correction types
   should be explicit. Do not restart those questions as if unanswered.
5. The latest topic was requirements/preferences. A requirement-versus-preference
   tag is tentative, with no final name/encoding. The agent should accommodate
   preferences unless they conflict, and preserve why a preference is unsatisfied.
   The user tentatively agreed that the preference remains wanted within its scope,
   but an accepted delivery can close current work without a standing task or
   monitoring obligation. Do not strengthen this into perpetual autonomous work.
6. Node granularity, practical benefit of explicit justification, exact uncertainty/
   observation/assessment representation and the pathological-pattern catalogue
   still need design or evidence. “Maybe a pilot” was not authorization to launch
   one; identifying sound cycle restrictions is technical follow-up for the agent,
   not a catalogue the human must supply. A possible next review topic is the human
   view of this same graph, rather than further isolated approval questions. That
   continuation is an assistant suggestion, not a new UI requirement.
7. Persistent decision Q22 was freshly read with `decisions get` during this refresh:
   **pending, revision 1, answer null**. The general autonomy boundary was clarified
   in ordinary chat, but the example's malformed-row policy was never selected.
   Only the user can update the decision record; do not mark it answered or infer
   an export policy from these discussions. No pending answer authorizes work.

## Scope and unchanged baseline

The governing task is reviewing whether the schema matches intent, not building an
example application or implementing a service. Production MCP, CQ4 migration,
parked RTS/notes construction, deployments, pushes and additional experiments
remain outside the current work. The permitted work here is preserving the review.

The baseline is **one shared human–agent project graph**, not an agent-only payload.
Definitions, attributed relation revisions, exact contract bindings and binding-local
progress are separate. Outcomes and constraints remain first-class; no compulsory
Goal → Milestone → Task hierarchy is introduced.

The existing definition kinds are outcome, constraint, task, statement, hypothesis,
defect, question, decision, review, source and artifact. New names discussed in this
review are not automatically implemented kinds or approved wire-format enum values.

Base document identities, checked before checkpoint edits:

- `cq4-node-schema.md`: SHA256 `26d8ee7578d4f3e83a6c00edbba43a285fda518b993f3728c91b37eb1c559bee`.
- `cq4-unified-graph-semantics.md`: SHA256 `1d9d341355ffcb8289d0d835bf9745313fe9eeb588049d95ee3fe698dd3e702f`.
- `journal.md` through J33: SHA256 `7bf6aba41009604d09cf7cc0172707b0f923bcb99ededa85c31b77c606a2b62a`.

## Working requirements and scoped agreements

These are the recorder's summaries of the discussion, not claims that every word
of a new formal schema has been ratified. The source excerpts below preserve the
user's stronger requirements versus tentative suggestions.

### 1. Provenance and interpretation

**User requirement:** distinguish human intent from agent inference; instruct the
planner to supply metadata and have MCP admission refuse nodes without required
metadata [U1].

**Suggested discipline, explicitly an idea rather than an order [U2]:** preserve
human wording separately, mark the agent's interpretation and require a typed link
to the input. Source/interpretation separation already exists in the baseline
proposal; this discussion does not authorize implementing the suggested enforcement.

The assistant distinguished agent-supplied grounds/rationale/scope from service-sealed
contributor/recorder/input receipts. An agent-provided `origin: human` is not trusted
capture. This is an existing design obligation, not an implemented new capture path.
Missing metadata and metadata explicitly preserving an unknown are different cases.
No rule requires fabricating a human source for an independently agent-proposed idea.

In the existing vocabulary, `interprets` is directed source → contributed formulation.
“Interpretation” describes derivation; it need not replace Outcome/Constraint/etc. as
the content kind. Whether a separate marker/kind is needed for enforcement remains
an encoding detail, not a decision settled by this discussion.

### 2. Multiple links, lineage and replacement

**User clarification:** independent differently typed edges can coexist between the
same nodes, avoiding compound relation types [U3]. An interpretation I2 may link
both to human source H and to earlier interpretation I1. Supersession was an example,
not the sole permitted relationship.

```text
H  --interprets--> I1
H  --interprets--> I2
I2 --supersedes, within scope S--> I1
```

Replacement and derivation are distinct claims; an elaboration or alternative need
not supersede its predecessor. The diagram illustrates the existing direction
convention; it does not ratify new relation names or infer authority from edges.

### 3. Changed interpretations and existing work

The user found this proposal reasonable [U4]: **invalidate the affected old contract,
preserve history, and permit explicitly justified reuse** rather than discarding
all downstream work indiscriminately.

- Planned work cannot proceed solely on a superseded governing basis.
- Completed work retains its events/artifacts/evidence; applicability to the new
  contract is reassessed, not silently inherited.
- Independently justified or shared obligations survive; incompatible work is
  cancelled/replaced. Revoked permission to execute a means does not survive merely
  because some outcome remains wanted.
- A new binding can use the same task definition with changed governing context.
  The agent can perform reassessment/replanning within its actual delegation.

### 4. Completion and human alignment review

**User requirement:** there are several meanings of “done”; low-level human approvals
must not be obligatory. The user proposed a separate acceptance discipline for a
chunk of delivered work, possibly using an agent-generated human checklist, but not
exhaustive mechanical QA [U5]. No universal human verification procedure was chosen.
The intended purpose is confirmation of alignment with original intent and/or
correction requests [U6].

Assistant working proposal: keep task completion, evidence-backed assessments and
human alignment judgments separate. A brief should connect original intent to actual
delivery, expose omissions/deviations/material uncertainty, and let the human give
mixed confirmations, corrections or unresolved findings in ordinary language. An
acceptance record should retain the actual reviewed scope/version/presentation and
reply, not imply personal verification of every low-level detail. Those detailed
record fields and the names “human-accepted”/“criteria checked” remain proposals,
not final enums individually approved by the user.

### 5. Propagation without routine human escalation

The user expects typed edges to show how an effect propagates [U7], and explicitly
rejected human intervention when contracts still hold [U8]. The following working
rule was then agreed [U9]:

- Contracts still hold: agent revalidates, records the basis and continues.
- A contract fails: agent repairs/replans within delegation, not automatically asks
  the human.
- Proceeding needs a contract change or an intent decision outside delegation:
  bring that specific issue to the human.

Typed edges propagate **reassessment obligations, not automatic approval requests**.
The assistant qualified that impact follows relevant edge semantics and declared
scope, not arbitrary reachability. Missing dependencies remain possible; a recorded
path is not proof of complete real-world impact discovery.

### 6. Explicit justification and granularity

**Tentative preference:** the user leans toward explicit justification but says it
needs a test [U10]. The baseline represents joint premises in one `infers` record
and independent alternative routes in separate records. No benefit of requiring
this structure during genuine planning was established by this conversation.

**Open:** when a choice/assumption needs its own node versus remaining in task prose.
The user did not select a universal granularity rule and suggested a pilot might be
needed [U12]. The assistant's criterion—separate records for independently relied-on,
reassessed or acceptance-relevant material—is a proposal, not a settled requirement.

### 7. Uncertainty is essential

**Explicit user requirement:** uncertainty must be preserved or the process would
fool itself and the user [U11]. The user suggested an uncertainty metadata dimension
and evidence links, and asked whether an Evidence node type was needed [U12].

Assistant working consequences: unknown is not false or satisfied; repeated claims
and summaries must not silently promote assumptions to established facts. Assessments
retain subject, conditions, basis and limitations. Exploration and conditional plans
remain possible; human acceptance does not erase technical uncertainty.

### 8. Evidence, observations and assessments

The user found the following separation reasonable [U13]: the observation/test
material and the agent's assessment of its significance should be **separately
inspectable**. Assessment uncertainty is scoped to an exact claim/interpretation
and conditions, rather than only an intrinsic global confidence number.

Illustrative example, not an executed test:

- Claim: cache survives process restarts.
- Observation/material: a particular run, its conditions/results and retained logs.
- Assessment: supported for build/configuration X; forced termination untested.

Existing Source/Artifact and Review/Statement kinds already cover parts of these
roles. Exact structured uncertainty fields and whether Observation, Evidence or
Assessment deserves a dedicated kind remain open. The user did not approve a
particular new enum set, numeric confidence scale, test protocol or universal
Evidence wrapper. The assistant's `uses` edge label was illustrative, not canonical.

### 9. Conflicts, Questions and escalation

The user agreed consequential disagreements should be explicitly tracked but
questioned using Question for a conflict and whether Question meant human escalation
[U14]. The assistant explained that the written proposal used Question for any
unresolved matter, not only a human-facing request.

**Latest working naming agreement [U15]:** keep Question general, represent Conflict
separately, and mark human escalation explicitly rather than deriving it from kind.
Conflict is a proposed addition, not an existing implemented twelfth kind.

Assistant proposal: a conflict links competing claims/assessments, grounds and affected
scope; agent investigation/review can resolve it, including by finding differing
conditions rather than choosing a winner. Human escalation follows the agreed
contract/delegation rule. Exact conflict/resolution lifecycle and fields have not yet
been specified or tested.

### 10. Completion/fulfillment gates versus factual conditions

**Scoped agreement [U16]:** a work-order gate may require completion without requiring
success; a factual condition is separate. Reporting findings can proceed after an
investigation finishes with a negative result, while implementation requiring the
failed condition cannot. The existing `depends_on` completion/fulfillment policies
and `requires` distinction match this intended separation; cancellation is not
completion and no factual truth follows from work merely finishing.

### 11. Decomposition and parent acceptance

**Tentative agreement [U17]:** decomposition should account for how the parts cover
the parent's acceptance, not just enumerate subtasks. All children completing does
not by itself establish that the parent contract is fulfilled. Applicable child
results can provide the assessment basis; this need not add human approval or a
redundant independent test. Exact coverage encoding, granularity and practical
bookkeeping cost have not been validated by this assent.

### 12. Selective pathological-pattern restrictions

The user agreed that calling the whole graph a DAG was premature and wants specific
pathological cycles identified and disabled [U18]. This is not a blanket cycle ban.
The user later indicated the agent may need to identify the concrete patterns [U20].

Assistant candidate list, **not an exhaustive or tested new policy**: current blocking
work-order cycles, circular decomposition when used as finite refinement, cyclic
same-binding progress predecessor chains, and circular justification being treated
as independent warrant. These have different admission/use boundaries. History,
navigation, debate and alternative accounts can contain cycles without being invalid.
A cycle's presence alone does not show that a factual claim is false.

Technical follow-up: for each proposed prohibition identify the protected invariant,
exact relation/context/current-state conditions, a minimal pathological example and
a nearby legitimate counterexample. Do not infer complete impact discovery or
semantic correctness from structural checks. This follow-up is not an instruction
to change frozen pilots, launch provider experiments or implement the service now.

### 13. Failed-write audit versus admitted uncertainty/conflict

The user suggested separate failure-mode audit preservation [U19], then agreed to
the explicit distinction [U20]:

- An invariant-violating update is rejected from admitted working state. Preserve
  the attempted change, attribution and rejection reason separately for audit.
- Validly recorded but conflicting assessments or uncertain claims remain ordinary
  working-model information with the uncertainty/conflict visible.

Assistant clarification: logical storage/reference separation does not require a
second database/service. A rejected payload's proposed nodes are not admitted
records or prerequisites. A valid Defect/Assessment can reference the audit of a
failed attempt without admitting that attempt's contents as project facts. Exact
schema, logging/privacy/retention rules and audit API are not specified here.

### 14. Distinguishing correction requests

**Tentative preference for explicit representation [U21]:** distinguish an artifact
violating its intended contract, an agent interpretation misrepresenting human
intent, and a deliberate change of human intent. Do not silently turn every
correction into a new requirement or claim that the human changed their mind.

Assistant qualification: a request can mix these causes, or its classification can
remain unresolved. Preserve the source, affected scope and the agent's basis; ask
only when a consequential ambiguity cannot be resolved within delegation. Exact
fields/relations are not yet chosen; these are not three newly approved node kinds.

### 15. Requirement/preference dimension of intent

**Tentative user idea [U22]:** intent might be tagged as contract or preference.
This is not a settled taxonomy or an implemented new field.

Assistant proposal: a scoped dimension orthogonal to kind, provenance and uncertainty;
possibly named requirement/preference/unresolved, with classification grounds.
“Requirement” was suggested to avoid confusion with a whole contract binding.
Neither that name nor the extra unresolved value was individually ratified. A
source-based classification must not become an arbitrary agent-controlled downgrade
of a requirement. Being uncertain how to satisfy it does not itself make it optional.

### 16. Preferences should be accommodated, not silently forgotten

**User's proposed agent instruction [U23]:** accommodate preferences unless they
contradict something; mark the conflicting ones unsatisfied or similar. Softness is
not permission to silently drop the preference.

Assistant working interpretation: keep intent classification separate from the
assessment of a particular delivery/context. Record the conflicting requirement,
constraint or competing preference and the basis for the unsatisfied assessment.
Difficulty with one chosen means is not automatically incompatibility with the
preference itself. This does not require exhaustive search over all possible means
or establish a numeric optimization/priority scheme. An honestly unmet preference
is working-model information, not a rejected-write audit entry.

### 17. Live preferences versus closing authorized work

**Tentative assent to the immediate qualified proposals [U24, U25]:** failure to
accommodate a preference in one delivery does not withdraw it; it remains wanted
within its original scope and available for reassessment. But this is not an
instruction to keep working indefinitely.

The user tentatively agreed that meeting requirements, documenting a conflict that
leaves a preference unmet, and human acceptance of that limitation can close current
work. Preserving the preference does **not** automatically create future tasks or a
standing obligation to monitor its blocker. Desiredness, assessed satisfaction and
currently authorized work remain distinct. This is not permission to revive parked
examples, silently accept unknown defects, or claim all preferences were achieved.

## Selected user source excerpts

The following are **manual excerpts from this visible conversation**, preserved
verbatim as local review evidence. They are not extracted journal receipts, trusted
MCP Human-capture records or proof of what a user viewed. Excerpt identifiers are
local to this note. Context limits are recorded so a scoped “yes” is not generalized.

### U1 — mandatory provenance/metadata

> The planning agent should be instructed to provide metadata - and our mcp should refuse accepting nodes w/o metadata

### U2 — raw human input and interpretation; explicitly an idea

> an interpretation node must be linked with a human input node through an edge of specific type -- that's an idea, not an order

### U3 — independent typed edges

> we have multiple edges connecting the two nodes so we don't have combinatorial explosion of possible relation types.

### U4 — response to scoped invalidation and justified-reuse proposal

> Ok, proposal sounds reasonable.

This followed the proposal to abandon the old governing basis for affected work,
not automatically all work/products; it was not blanket approval of the schema.

### U5 — expanded message about completion/acceptance

> I see several types of "done" - with, perhaps, different names. The utimate "done" is "human-verified" though that cannot be mechanically requested for every individual item -- low-level human-approvals must not be obligatory. We may need to develop separate acceptance discipline - so, once agent delivers some chunk of work, it could build a checklist for human based on the intents and the work done and ask the human to pass through it - but that must not be an exhaustive mechanical QA

### U6 — purpose of human review, without one universal procedure

> Ideally we want the human to confirm that the outcome is aligned with original intent - and/or produce correction requests

### U7 — impact propagation

> Hm, anything that affects the job done I think?.. The edge types should let us know how the effect propagated

### U8 — contract-preserving changes remain autonomous

> No - if the contracts hold, why invoke human?

### U9 — response to the refined autonomy rule; continue the walkthrough

> Yes. Why did you stop?

This followed the distinction between autonomous revalidation/repair and a need to
change a contract or resolve an intent question outside delegation.

### U10 — explicit justification is provisional and needs testing

> Hard to say without a test. Intuitively I'm inclined to suggest explicit justification

### U11 — preserving uncertainty

> Well, I think that we must preserve uncertainty - that's essential otherwise the process would fool itself and the user

### U12 — granularity unresolved; uncertainty/evidence ideas

> I don't know here (the irony, yes) - maybe a pilot is required. Maybe we need additional metadata dimension encoding uncertainty specifically - and edges linking certainty with supporting evidence? Do we need an evidence node type?

### U13 — response to observation/assessment separation proposal

> Yes, your proposal sounds reasonable.

This followed the explanation of distinct claim/evidence/assessment roles and the
specific question whether the observation and assessment should be separately
inspectable. It does not settle every representation detail proposed in that reply.

### U14 — conflict versus Question

> Yes - but not sure if question is the right category, this sounds more like a "conflict" - if my understanding is correct, Question is something what is supposed to be escalated to the human?..

### U15 — Question/Conflict clarification after the initial checkpoint request

> keep it general—with Conflict separate and human escalation explicitly marked

This is the wording selected in the user's reply to the naming question. The user
introduced it with “we may go your way”; it is a working design agreement, not an
implementation order or an answer to persistent decision Q22.

### U16 — work-order gates versus factual conditions

> yes

This answered the specific question whether the schema should distinguish a
completion/fulfillment work-order gate from a required factual condition, including
allowing completion-gated work after a prerequisite finishes unsuccessfully. It was
not approval to implement or an answer to persistent Q22.

### U17 — decomposition coverage

> I think so

This followed the question whether decomposition should explicitly account for how
parts satisfy parent acceptance. It is a qualified design preference, not evidence
that any decomposition is complete or that this bookkeeping has demonstrated benefit.

### U18 — no global DAG; identify pathological cycles

> Yes, I think it was premature to say "DAG". Though we should figure out which cycles are pathological - and disable them

### U19 — failure audit preservation

> This is a curious question - this sounds like a failure mode audit. Can be preserved - but apparently separately, just for audit purposes?..

### U20 — audit/working-state distinction and technical pattern discovery

> Yes, Perhaps you'll have to find the specific pathological patterns to prohibit

This followed the distinction between rejected invariant-violating changes in an
audit stream and admitted uncertainty/conflicts in the working model. It does not
settle an exhaustive pattern list or authorize new experiments/deployment.

### U21 — correction classification

> I think explicit

This followed the proposal to distinguish implementation defect, interpretation
defect and changed intent rather than collapsing all corrections into a new task
or changed human requirement. It did not ratify exact categories as wire enums.

### U22 — tentative intent classification

> Hm. Maybe - e.g. intent may be tagged as contract or preference?..

U22 is a local source-excerpt identifier, not persistent decision Q22.

### U23 — proposed preference-accommodation instruction

> Well, I think that the agent should be instructed like this: accomodate preferences unless they contradict something. If they do - they can be marked as unsatisfied or so.

### U24 — unmet preference remains live within scope

> It should I think?

This followed the question whether the preference should remain live in its original
scope, available for reassessment when blockers change, rather than retired merely
because one delivery did not accommodate it.

### U25 — accepted delivery may close work without a standing obligation

> I think we can

This followed the qualified scenario: requirements met, one preference unsatisfied
because of a documented conflict, and human acceptance of that limitation. The
question was whether current work could close while retaining the preference for
future consideration, without automatically creating work or blocker monitoring.

## Completed-pilot context — do not repeat or overclaim

The earlier [brief](brief.md), [RDF evaluation](rdf-graph-evaluation.md) and J33 retain
full evidence boundaries. Pilot Q found no empirical schema winner and did not test
the revised unified model. Pilot S compared JSON-reference/Turtle reads with identical
JSON writes: 16 originals/64 stages, JSON 7/8 versus Turtle 5/8 fully primary-adequate;
five exact quality-qualified pairs were descriptive, not overall efficiency. RDF
representation worked for the supported profile; JSON-reference is the provisional
agent-read default. Human workflow benefit, RDF-native authoring and storage/retrieval
performance remain unestablished. Pilot P did not establish typed-over-prose benefit;
the single human framing case did not validate delivery or genuine selective revision.

Completed pilot main: `/home/pavel/work/epistemics-pilots` at
`1dd7583ea6a6206b5493cd2db41519c401595647`. Frozen inputs/originals/adjudications must
not be edited to fit these new ideas. Integrated 136 S, 85 Q and 36 prototype methods
passed; later offline replay/projections matched, and the old RDF task worktrees
were removed. Those are historical checks, not validation of this review's additions.

Existing inert joint-belief-framing r2 and agent-behaviour-pilot r5 drafts are not
installed, are not schema authority, and must not be silently amended by this review.

## Initial checkpoint verification (2026-11-05)

A read-only model review of the initial checkpoint identified one overstatement:
U2's explicit idea had been grouped under U1's requirement. That was corrected before
commit `171ccdc6`. The advisory found no other material defect in that initial save;
it was not independent Human gold or review of this later extension. Its best-effort
reuse analysis found the procedure already covered by existing framing and
state-accounting disciplines; no new skill draft/amendment or installation was
justified. Exact advisory/receipt and structural checks were retained in the initial
local controller archive, not presented as semantic ratification of this schema.

## Follow-up checkpoint review (2026-11-06)

A separate read-only model advisory reviewed the refreshed Resume section, sections
10-17 and U16-U25 against the supplied conversation context and reported no material
defect. Its exact return and targeted capture receipt are preserved locally. This
is not independent Human gold, authenticated source capture or proof of complete
schema fidelity. The advisor did not recompute hashes or verify Git unchangedness;
those checks belong to the controller receipts.

Its best-effort pattern/overlap review recommended no new skill candidate or draft
amendment: existing framing/state-accounting and rejected-attempt evidence disciplines
already cover the procedure. It read the supplied full draft bodies; remote revision
status was parent-observed at 2026-11-06 approximately00:15Z, not child-observed. No
skill was installed or changed, no shared-memory write was made, and no pilot was run.
