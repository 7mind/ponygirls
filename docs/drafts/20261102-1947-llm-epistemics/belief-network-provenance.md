# Specification provenance and justification — provisional extension

Status: user-requested research extension, 2026-11-04. Pilot P completed 24 agent-only
sessions; bounded findings are below and in J28. Extends the
[methodology](belief-network-methodology.md), not an installed skill, trusted authority
mechanism or completed RTS acceptance experiment.

## 1. The question

The human states intent; the agent interprets it and refines it into a specification.
Can each consequential specification assertion retain enough provenance to distinguish
an actual requirement, a conditional inference, an engineering choice and an unsupported
claim about the implementation?

The useful question is not only **where did this sentence come from?** It is also
**why should this commitment hold, under which premises, and who may change it?**
A source link establishes neither semantic entailment nor permission. Requiring every
row to have a link can incentivize plausible post-hoc justifications instead of fidelity.

## 2. Orthogonal dimensions, not one provenance enum

| Dimension | Record | Do not infer |
|---|---|---|
| Statement role | Intended outcome, supporting obligation, assumption, selected means, descriptive implementation claim | All specification sentences are human requirements |
| Source lineage | Exact input/presentation, actor, source revision, attributed interpretation | A paraphrase is a new human act; authenticated origin proves intended scope |
| Justification | Premises, applicability, relationship, declared warrant and alternatives | A trace link or a `derived` label proves the conclusion |
| Normative standing | Scoped adoption, delegated choice, proposal, dispute, supersession | Agent origin means unauthorized; later adoption means originally human-authored |
| Factual warrant | Observed/reported/planned/unchecked evidence and its actual subject/conditions | Agreement that something is wanted establishes that it exists or works |

These axes can coexist on one item. An agent can formulate a proposal that the human
subsequently adopts for a limited scope. Preserve both events. If the source says
“store locally because users are offline,” separate the obligation from the factual
premise without requiring the human to review every internal representation detail.

“Agent belief about what it builds” has two operational meanings: a proposal about
what should be built, and a claim about what an artifact already does. The latter
requires evidence, not ratification. A recorded rationale is an attributed account,
not access to the model's actual internal causal process.

## 3. Relations and conditional necessity

Distinguish at least:

- **Interprets/rephrases:** an attributed reading of source content, possibly disputed.
- **Conditional consequence:** follows under listed premises and applicability.
- **Selected means:** one proposed way to satisfy an outcome, not necessarily required.
- **Defeasible default:** a policy or convention selected where intent is underspecified;
  state its source and authorized envelope rather than treating silence as acceptance.
- **Observational support:** evidence for a descriptive claim, bound to actual scope.

“Helps achieve G” does not mean “every implementation satisfying G must do this.”
Challenge claimed necessity with a conforming alternative that lacks the proposed
requirement. A platform limitation can invalidate a selected means; it does not by
itself authorize weakening the human's outcome. Investigate alternatives first.

Hypothetical example (not a newly agreed RTS contract):

1. Human requests save/resume.
2. Agent interprets that as including closing and reopening the browser.
3. Under that interpretation, required state must survive restart.
4. IndexedDB is selected as one means, not deduced as a human technology mandate.
5. “Restore works in the delivered artifact” remains a separate empirical claim.

In the actual RTS log, C7's same normal economic rules for a human **using its faction**
do not entail identical prices across factions. A conforming alternative has distinct
faction prices with no AI-only bonus. C8's adopted presentation bundle also remains
agent-formulated in origin. These are source-relative examples, not inferred private
acceptance cases or proof that the generated topology exhausts intended outcomes.

## 4. Revision is typed, not a universal invalidation cascade

Record each justification's joint premises. A claim can have multiple alternative
grounding sets: (A and B) or D. Withdrawing A defeats one route, not necessarily D.
Do not replace alternative grounds with an untyped ancestor list.

On a change, distinguish:

- a source/human revision that deliberately supersedes a scoped obligation;
- a withdrawn interpretation or assumption requiring reconsideration;
- failed means that should be replaced while retaining the goal;
- new evidence or a need for factual investigation;
- an unrelated edit that should leave an obligation alone.

Loss of justification is not proof of falsity. Unsupported circular citations cannot
bootstrap authority, but cycles in other relations are not universally forbidden.
An independently supported obligation survives discovery of a separate circular route.
A later approval attaches to what was actually presented, not silently to the latest
living document. The actual Q20 old-context conflict remains unresolved; no pilot
response is a substitute for the human's clarification.

## 5. Agent-maintained detail, consequential human review

Annotate consequential spec assertions, not every variable or implementation line.
The human-facing projection should expose material assumptions, unsupported mandates,
changed bases, accepted-risk changes and departures from agreed outcomes. Routine
engineering choices remain agent-owned within the delegated envelope. Missing lineage
is a question to investigate, not automatic proof that every choice needs approval.

Do not use a fixed row count, provenance percentage or confidence score as evidence
of understanding or reduced overload. Preserve positive outcomes above examples and
prohibitions; a perfectly traced negative constraint can still omit the intended result.

## 6. Fit with the current prototype

Format v1 in `scripts/belief-workflow/` preserves source snapshots, interpretation
references, claim revisions and declared external dependency/evidence bindings. Its
claims are goal/assumption records; `basis` points to interpretations, while dependencies
are artifact/check/environment/oracle references. It does **not** implement typed
claim-to-claim inference, semantic support propagation or justification alternatives.

Pilot P uses lightweight external experiment records to test consumption before any
format change. No new fields have silently been added to version 1. The same editable-
file assurance boundary remains: tags and graphs can be false but internally consistent.
Mechanical validation must not mint a semantic-supported or human-approved badge.

## 7. Empirical screen — Pilot P

Pilot P in the separate `epistemics-pilots` repository has two independent analysis
problems: authority/origin/warrant auditing at the C8 historical cutoff; and selective
revision under explicitly stipulated changes. Sources are exact selected RTS question/
answer pairs, with a separately identified later Q20 snapshot for qualitative review.
Private cases, tool traces, thinking and unrelated conversation are excluded.

Compare source-linked statements (S), richer declared reasoning in prose (P), and the
same reasoning in typed records (G). P−S includes more explanation; only G−P isolates
representation approximately. Keep false labels and legitimate-choice controls, scope
and origins, alternative support, failed means, actual hypothetical human revision,
circular justification and unrelated changes. Freeze references before subjects run.

Separate process/schema completion, decision coding, citation-ID coverage and semantic
rationale validity. Match IDs alone is not entailment. Review all responses, including
errors and null effects; do not rank model families or treat within-session items as
independent subjects. The protocol uses two configured subjects and two fresh replicates
per task/condition: 24 measured sessions, feasibility only.

This tests consumption of experimenter-authored annotations on an already selected
record. It does not test whether agents faithfully create/maintain provenance during
construction, discover missing intentions, improve a delivered product or reduce human
burden. Those require separate stages. Uniformly correct baselines would show no
incremental semantic benefit here, even if the representation is convenient bookkeeping.

## 8. Observed screen results and remaining gap

All 24 sessions completed with matching full prompt profiles; 22 met the frozen
strict schema. Two source-only DeepSeek audit answers had empty citations for a
provisional price choice. The scorer forbids empty arrays without that rule being
explicit in the prompt. Preserve both invalid scores; do not interpret them as two
semantic failures or force routine choices to acquire spurious human authority.
The second answer correctly calls the price a choice despite its empty list.

Sol's audit baseline already has 20/20 status/origin decisions per arm. DeepSeek's
prose/typed audits also have 20/20; its source-only strict results remain unscored,
not zero correct. Separate masked agent coding flags two explanations in one
source-only session (price proposal treated as historical implementation; an extra
mis-scoped fog confirmation), neither repeated in its second baseline. One typed
answer omits a structured assumption pointer while explicitly naming it in sound
conditional reasoning. These tiny, clustered results do not establish a stable
added-rationale benefit or a typed-over-prose advantage.

Every subject/arm has 14/14 revision actions and supplied-root controls. This is a
baseline ceiling, not evidence that metadata discovers dependencies or improves
revision. The qualitative Q20 challenge still produces unsupported chronology and
intent reconstructions, including with both richer formats. Keep the stored
presentation, update timestamp, actual display history and intended revision
separate; labels cannot settle their conflict. Original semantic ratings were saved
before identity inspection, but are disjoint same-model agent judgments, not human
quality scores or inter-rater reliability [L13].

The next evidential gap is faithful generation/maintenance on unseen consequential
choices, followed by an authorized real delivery and human acceptance—not merely
more perfect decoding of supplied annotations. No such result, private-case access
or reduced-human-burden claim follows. Format v1 remains unchanged.
