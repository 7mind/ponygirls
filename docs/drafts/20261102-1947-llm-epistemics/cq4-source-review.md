# CQ4 ledger review — source findings

Review snapshot: **`4d9b44aec6f7360abd448bb3412733449386c5e1`** from
<https://github.com/pshirshov/cq4>. Remote main and the cloned HEAD matched when
observed on 2026-11-04 at 23:04:29 UTC. This is a pinned source review, not a claim
that the remote remains unchanged. No CQ4 build, service, database, native gate,
consumer evaluation, migration or deployment was run for this review.

The [node proposal](cq4-node-schema.md) is a redesign candidate, not a report that
CQ4 has already been replaced or that its existing tests fail.

## 1. What is worth retaining

CQ4's valuable unit is not just a list of work items. It has a versioned, typed,
transactional record of work, evidence and decisions, plus mechanisms that keep a
model's declaration from impersonating a host or operator event.

| Mechanism | Observed source | Meaning and limit |
| --- | --- | --- |
| Typed content/taxonomy | [model][model], `Ledger`, `Content` | Fourteen closed content branches, each with its own status vocabulary. Useful semantic distinctions are mixed with workflow organization. |
| Stable identity and revisions | `ItemId`, `Item`, `ReviewedItem`, `HistoryEntry`; [mutation engine][mutation] | IDs currently include ledger kind; an item's ledger cannot change. History retains full content/reference views. A new model can decouple kind from stable ID without rewriting old revisions. |
| Mutation provenance | `Provenance`; `LedgerMutation.execute/revise` | Actor/session/request/receipt time identify the authenticated write. A relationship-only edit also replaces last-write provenance; this is not original wording authorship or semantic adoption. |
| Protected evidence origin | [policy][policy], `provenance` | Ordinary writes may introduce ModelDeclared evidence; HumanReported introduction needs Human authority; HostObserved introduction is not allowed through ordinary replacement. Identical existing privileged evidence can be preserved. |
| Actual authority boundary | [authorization][authorization], `authenticate/grant/Authority.scope`; `LedgerAccess.write` | HMAC-verified scoped credentials, expiry/project checks, and restricted service roles. These are real source-level protections, not merely a role string supplied in a mutation body. Runtime/security acceptance was not executed here. |
| Host integration evidence | [integration policy][integration], `completion`; [integration service][service], `reserve/observe`; `LedgerMutation.integrate` | Collector/session checks, admitted worker/review artifacts, exact candidate/member coverage and validation-artifact checks precede host-produced completion evidence. This authenticates a defined publication path; it does not prove every semantic acceptance claim. |
| Concurrency and replay | `LedgerAccess.fenced`; `LedgerMutation.execute`; `LedgerRepository.transact` | Claims are **leases**, not epistemic propositions. Expected revisions, fences, request fingerprints and transactional publication are distinct from node meaning and should survive a simpler agent-facing schema. |
| Scoped review applicability | `ReviewedItem`; `IntegrationServiceImpl.reserve`, `RevisionEquivalence.unchanged` | Exact historical drafts can be compared with current drafts, so reference-only revision churn need not automatically discard a review. Merely having a review still does not establish its semantic correctness. |

Do not replace these mechanisms with agent-editable `approved`, `verified` or
`origin=human` flags. Simplifying a record or its mutation API is not authorization
to simplify away its trust boundary.

## 2. Actual taxonomy

All branches share title, Markdown body, labels, archive flag, citations and the
revision/provenance envelope. Domain fields are additional to the branch's status:

| Kind | Domain content |
| --- | --- |
| Milestone | objective |
| Idea | outcome, motivation |
| Defect | severity, observed, expected, reproduction, optional cause, resolution evidence |
| Goal | outcome, acceptance, scope |
| Task | acceptance, optional result, validation, optional model-tier recommendation |
| Research | question, findings, optional conclusion/recommendation |
| Hypothesis | claim, rationale, evidence, optional adjudication |
| Question | prompt, context, alternatives, optional recommendation/answer |
| Decision | choice, rationale, alternatives |
| Review | exact reviewed revisions, optional candidate commit, findings, optional summary |
| Handoff | outcome, remaining work, blockers |
| OperatorAction | action, expected evidence, optional confirmation, observed evidence |
| Memory | knowledge, applicability, evidence |
| Upstream | component, version, reproduction, optional report/outcome |

These are not fourteen different degrees of truth. `LedgerPolicy.outcome` derives
nominal terminal/dependency classifications from kind and status. A Refuted
Hypothesis satisfies a work prerequisite because its investigation has resolved;
that cannot mean its proposition became true. Adopted Decisions and Current Memories
have a useful *settled reference* classification separate from open work.

Likewise, operator confirmation and observed completion are separate today.
Collapsing OperatorAction into Task shape would require preserving that distinction
in the authority/execution layer, not merely renaming it Decision.

## 3. Where the hierarchy really costs structure

The source supports removing mandatory organization as a **design choice**, not a
logical consequence of adding epistemic metadata:

- `LedgerPolicy.endpoints` reserves PartOf/Contains for milestone organization and
  excludes Milestones, Ideas, Defects and Goals as PartOf members. A Goal is therefore
  not simply another milestone container. There is no required Goal→Milestone edge.
- `ProposalPolicy.prepare` forbids directly proposed Task creation: a Task must be
  produced from an assigned producer and assigned to an Open milestone. It also
  requires a model-tier recommendation on produced Task drafts.
- `MilestonePolicy.refusal` refuses Task implementation/conflict-resolution work
  without an Open milestone. Bare ledger `Create` is less restrictive: it can store
  a Task with no milestone. Storage validity and execution admission are different.
- `MilestonePolicy.closes` and `LedgerMutation` gate closure over nonterminal Tasks,
  including relevant restoration/termination cases. Reopening has separate behavior.
- `LedgerMutation.edgeChange` applies one 200-incident-reference bound to all relation
  kinds. Mandatory grouping creates hubs sharing this bound even with finished or
  archived members. This is a source-level capacity implication, not a fresh load test.
- `WorksetTraversal.collect` follows Produces and Contains to select descendants;
  other incident neighbors are context. Removing Milestones alone does not remove
  production-graph selection or cancellation semantics.

The general relation graph **permits cycles**; visited-set traversal handles them.
It is not a DAG merely because a common creation path produces descendants.

## 4. Where agent mutation burden comes from

`Mutation.Replace` supplies a complete ItemDraft, including unchanged content and
collections. `Reference` supplies revisions of both endpoints, and a real membership
change revises both. A batch normally cannot change an existing item twice; new
allocated item IDs usually need a later round before additional references can be
made. `Produce` has a special existing/earlier-created milestone reference form.

These constraints have transactional/authority purposes, but expose more coordination
than a compact node editor necessarily needs. A testable simplification is **one
uniform draft plus explicit changed-field amendment**, with exact revision checks,
immutable source/history and server-owned provenance retained. It is not a claim
that generic JSON Patch or unrestricted upsert would be safe or efficient.

## 5. What epistemic metadata is actually missing

CQ4 already has evidence origin, claim/rationale/adjudication in Hypothesis, explicit
decisions and typed support/contradiction links. What is not uniformly represented is:

- original wording versus an attributed interpretation;
- later scoped adoption versus formulation origin;
- delegated means versus a required or logically necessary outcome;
- joint premises versus alternative support routes;
- the warrant/applicability of a link, including unsupported or defeated rationales;
- governing purpose/artifact role/authorized phase versus requirements of an example.

Current Supports/Contradicts labels do not encode those warrants or establish their
validity. Workset readiness checks direct BlockedBy prerequisites using nominal outcome
policy; it is not epistemic truth maintenance. A citation can be well formed without
its content being read or its semantic relevance established.

Eliminating compulsory organization must not eliminate what is wanted. J30 proposed
flat statements with grounds; the [J31 shared schema](cq4-node-schema.md) now retains
explicit Outcome/Constraint kinds and typed planning/source records. This is a design
revision after human correction, not a new source finding. Optional, disposable
grouping/query views remain compatible with removing required milestone ownership.

## 6. Review limitations and source caution

The new pilot compares proposed representations, **not literal CQ4 versus a complete
replacement**, and cannot establish safe migration of every ledger, operational role,
query, dispatch or termination rule. Text templates can reduce wire shapes while moving
obligations into semantic interpretation; lower field count is not evidence of lower
reasoning burden. Typed query/index benefits are also distinct from mutation efficiency.

Documentation is not automatically the executable contract. For example, the ledger
page's general nonempty-acceptance wording is not a safe Goal invariant: the inspected
validator explicitly requires nonempty Task acceptance, while Goal acceptance uses the
bounded-list check without that requirement. No correction was shipped on this basis.

A DeepSeek source advisory review was retained by task IDs in controller notes. Its
first output had incorrect provenance generalizations and unverified line citations;
its erratum corrected some but still called cyclic production descent a DAG in practice.
Those claims are not adopted here. Source-symbol checks by the parent, not reviewer
agreement alone, support the observations above.

[model]: https://github.com/pshirshov/cq4/blob/4d9b44aec6f7360abd448bb3412733449386c5e1/models/cq-api.baboon
[policy]: https://github.com/pshirshov/cq4/blob/4d9b44aec6f7360abd448bb3412733449386c5e1/core/src/main/scala/cq/core/LedgerPolicy.scala
[mutation]: https://github.com/pshirshov/cq4/blob/4d9b44aec6f7360abd448bb3412733449386c5e1/core/src/main/scala/cq/core/LedgerMutation.scala
[authorization]: https://github.com/pshirshov/cq4/blob/4d9b44aec6f7360abd448bb3412733449386c5e1/server/src/main/scala/cq/server/Authorization.scala
[integration]: https://github.com/pshirshov/cq4/blob/4d9b44aec6f7360abd448bb3412733449386c5e1/core/src/main/scala/cq/core/IntegrationPolicy.scala
[service]: https://github.com/pshirshov/cq4/blob/4d9b44aec6f7360abd448bb3412733449386c5e1/server/src/main/scala/cq/server/IntegrationServiceImpl.scala
