# Experimental contract T1 — unified workflow pilot

Status: **draft experimental candidate, 2026-11-06 UTC**. Not a schema release,
production API, migration or evidence of benefit. The user confirmed the next
primary question: whether graph assistance improves faithful artifact delivery and
selective revision over ordinary chat/notes. This document consolidates the
[baseline schema](cq4-node-schema.md), [semantics](cq4-unified-graph-semantics.md)
and [guided review](schema-intent-review.md) for an instrument to test that question.
Exact wire fields and the runnable instrument must be bound by registration before
measured sessions; unresolved design choices below are experimental choices, not
retroactively ratified user requirements.

## Scope and priority

Automated native-agent pilots precede the UI and production service. Participants
may construct only the controlled experimental artifacts, not the parked RTS/notes
applications or production services. Earlier P/Q/S originals and analysis remain
frozen. The paused JSON/plaintext MCP comparison is not this experiment.

The later first human client may be a Pi extension talking directly to the same
server API rather than adding UI operations to the model-facing MCP surface. The
user accepted the provisional view: wanted behavior, actual delivery, unmet/uncertain
aspects and specific questions needing judgment, with task/reason/evidence drilldown.
Viewing, answering questions, scoped acceptance and corrections suffice initially;
a graph-editing workbench is not required. These are future-client directions, not
implementation authorization. Pi's extension process is not itself a trusted Human
identity/capture boundary.

The intended eventual Scala/distage/izumi/BIO/logstage/PostgreSQL/shared retrieval
stack remains unchanged. A temporary Python/file/native-extension instrument is
not that service, and JSON reads do not decide RDF storage or database architecture.

## Shared semantic contract

1. **One graph, distinct roles.** Preserve wanted outcomes and constraints, work,
   sources, reasoning and evidence together. No compulsory Goal/Milestone/Task tree.
   Definitions, attributed relation revisions, exact bindings and binding-local
   progress remain separate. Task assignment is not execution permission.
2. **Protected attribution.** Contributor, recorder and input receipt are established
   by the adapter/capture path, not caller-writable origin fields. Original sources,
   agent formulations and later adoption remain distinguishable. Source and artifact
   content identity is immutable. A digest alone neither authenticates a Human nor
   proves that a described capability was implemented.
3. **Exact context.** A binding pins its definition and governing context, not only
   unchanged task text. Changing governing acceptance/conditions/order requires
   explicit applicability reassessment and a new binding where appropriate. Existing
   completed work survives historically; it is not silently completed under a new
   contract. Reuse is explicit and scoped, without a fabricated rerun.
4. **Work is not truth.** Completion carries fulfilled/not_fulfilled/inconclusive
   against the work's own acceptance, with resolution, evidence and uncertainty.
   Completion-order gates may pass after negative results; fulfillment gates and
   factual `requires` conditions are distinct. Cancellation is not completion.
   Unknown acceptance blocks execution of that task, not recording it or executing
   a separately specified investigation.
5. **Relations are attributed accounts.** Lineage, inference, alternatives, adoption,
   delegation, replacement and work order are independently typed. `interprets` is
   source to formulation. Joint premises inhabit one inference; separate inference
   resources can be alternatives. Contribution is neither necessity nor sufficiency.
   Decomposition records coverage/combination but does not automatically fulfill the
   parent's acceptance.
6. **Autonomy.** Revalidate and continue when contracts hold; repair/replan within
   actual delegation when they fail. Escalate the specific intent/contract decision
   outside delegation, not each low-level task. Reachability is not proof that all
   actual dependencies were discovered. Shared obligations survive scoped withdrawal,
   but revoked execution permission does not.
7. **Uncertainty and assessments.** Separate observable material from an attributed
   assessment of its significance. Retain exact subject, conditions, evidence and
   limitations; unknown is neither false nor satisfied. Summaries and acceptance must
   not promote bounded observations to universal capability or technique proof.
8. **Questions and conflicts.** Question remains general; human escalation is explicit
   rather than inferred from kind. Conflict is represented separately. A conflict
   can resolve through different applicability conditions, not necessarily a winner.
9. **Corrections.** Distinguish implementation defect, interpretation defect and
   changed intent, with mixed/unresolved attribution allowed. Do not silently blame
   every correction on the Human changing requirements or rewrite original input.
10. **Intent force and satisfaction.** Required/preferred/unresolved is a scoped
    experimental classification, separate from provenance, epistemic uncertainty and
    delivery satisfaction. Exact labels/encoding remain candidate choices. Accommodate
    preferences unless they conflict, preserving the actual basis when unmet. A
    limitation of one chosen method is not itself proof of incompatibility.
11. **Closure.** Wantedness, satisfaction and authorized work differ. A preference
    remains wanted within scope after a delivery cannot accommodate it. Requirements
    met plus a documented conflict and scoped human acceptance can close current work
    without withdrawing the preference, creating future tasks or obligating blocker
    monitoring. Automated fixtures cannot establish genuine human acceptance.

## Mechanical boundaries and legitimate nearby cases

The instrument must publish exactly which rules it enforces, rather than imply a
semantic truth/adoption/dependency-discovery engine.

| Invariant / protected use | Reject / deny | Legitimate nearby case |
|---|---|---|
| Capture attribution | Caller-supplied Human/host provenance or protected act | Agent interpretation of an immutable source with Agent attribution |
| Immutable content / exact revisions | Rewriting a Source/artifact, stale revision overwrite | New source/revision with preserved history and explicit relation |
| Binding-local progress | Predecessor from another binding, fork or predecessor cycle | New contract binding with its own stream and scoped historical reuse |
| Current blocking order | A selected current work-order cycle | Historical completion reuse with applicability; unrelated history/navigation cycle |
| Finite refinement use | A cycle used as current finite decomposition | Navigation grouping/debate cycles not asserted to be finite refinement |
| Atomicity / replay | Partial admitted batch, stale CAS, reused request ID with different input | Exact idempotent replay; explicit retry after reread |
| Task execution boundary | Starting/fulfilling unresolved acceptance or known stale binding | Planned unresolved task; separately accepted clarification task |

Circular assertions can be recorded as claims/conflict/debate. Their existence is
not independent factual warrant; semantic coding must not confuse a structural
cycle check with deciding truth. The catalogue is deliberately scoped, not exhaustive.

Structurally rejected updates belong in a logically separate audit stream retaining
attempt, caller and rejection reason. They do not become admitted project records or
prerequisites. Valid uncertainty/conflicts remain in admitted working information.
A valid Defect can reference a failed attempt without admitting its rejected payload.
Logical separation does not select another database or a public audit API.

## Experimental source and execution boundary

Case requests/revisions are **synthetic, service-delivered intent fixtures**, not
real Human utterances, authenticated Human adoption or evidence of user workload.
Native conversation role, fixture requester role and actual source/capture identity
must not be conflated. The two conditions receive equal source content, evidence,
safety/integrity instructions, artifact execution capability and note-taking access.
The graph condition additionally receives the registered graph workflow and tools;
this is a bundled workflow comparison, not an isolated causal effect of one field.

The artifact workspace is distinct from instrument state, credentials and evaluator
oracles. Participant Python execution must expose only its controlled artifact tree
and an enumerated runtime, without network, provider credentials or evaluator sources.
For these stdin/stdout transformation artifacts, execution is read-only: code and notes
are created only through the bounded accessor, not by executing a writer/generator.
There is no writable `/tmp`, root filesystem or `/dev/shm`; this restriction is common
to both conditions and must be disclosed before execution. The prototype's broader
writable executor was narrowed before registration, not silently treated as storage-
quota-safe. Controlled internal writable probes are not a participant capability.
Native Pi may need provider credentials; its artifact execution child must not inherit
that visibility. Concrete hostile-path and source-copy canaries are required before
claiming even this bounded isolation, and accepted record shape is not semantic proof.

Artifact acceptance is checked outside the participant's workspace against frozen
requirements, including held-out inputs and unaffected behavior after the change.
Reported completion and self-authored tests do not establish acceptance. Original
artifacts, public traces, revisions, errors and failed attempts remain preserved;
no replacements or outcome-driven parser/criterion changes rescue an original.

## What remains to freeze and verify

- Exact wire profile, temporary adapter limitations, chosen field encodings and
  serialization; memory/file public contract and real restart/concurrency controls.
- Two independent compact artifact contracts and unannounced scoped changes, without
  supplied affected-node lists; hidden executable acceptance and evaluator negative
  controls including legitimate alternative implementations.
- Matched case/model/replicate roster, randomized order, stage deadlines/output bounds,
  native profiles, canaries, analysis and operational-validity rules.
- Primary delivery/revision predicates; independent artifact checks versus attributed
  semantic judgments; failed/invalid/uncertain originals and coverage.
- All-attempt resources and exact quality-qualified pairs, without pooling or a
  quality/resource composite. No claim about real Human alignment/attention, general
  model superiority, production architecture or general workflow efficacy from this
  bounded exploratory pilot.
