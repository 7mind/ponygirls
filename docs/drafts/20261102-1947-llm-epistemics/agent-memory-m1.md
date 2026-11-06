# Agent memory M1 — content and use contracts

Status: **version M1, design candidate, 2026-11-06 UTC**; agent-authored, not human
ratification, implementation, ontology adoption or production-migration authority.
Keep this candidate separate from Pilot U: neither its participant instructions nor
its measured conditions acquire these proposals. Accepted baseline documents,
[experimental T1](experimental-contract-t1.md) and earlier evidence stay unchanged.
Persistent Q22's export product-choice remains unanswered; M1 neither selects a
policy nor reopens it. No new blocking user decision is requested here.

## 1. Extend the existing graph, not a parallel memory ontology

The [shared schema](cq4-node-schema.md) and [semantics](cq4-unified-graph-semantics.md)
already map memories to source-bound Statements with applicability and history.
M1 proposes discriminated **content/use profiles**, not new canonical memory nodes,
truth flags, a universal Evidence wrapper or a second retrieval architecture.
The [review checkpoint](schema-intent-review.md), especially §§7–9 and 12–17, requires
uncertainty and separately inspectable material/assessment but leaves their encoding
open. The following defaults are proposals at that boundary, not settled enums.

| Remembered content | Existing representation and proposed minimum recoverable account |
|---|---|
| Observation / occurrence report | Statement: exact subject, reported result, method/capture account, conditions, occurrence/observation time, material references and limitations. Source/Artifact preserves material; protected capture distinguishes host observation from agent report. |
| Domain event | Occurrence report such as “deployment happened”; uncertainty and source remain explicit. It is **not** a binding-local `StateEvent`, and does not complete a Task. |
| Claim / “fact” | Statement with proposition, modality, scope and assessments. “Fact” is at most a context-qualified presentation of warrant under a named use policy, never intrinsic `isFact` or universal verified status. |
| Assessment | Review/Statement with exact `assesses` subjects, evidence, conditions and remaining uncertainty; inspectable separately from observation material. |
| Experience / episode | Source-bound account linking actions, exact task bindings, observations and assessments. Preserve failures and inconclusive attempts, not only success exemplars. |

Source capture establishes what was received, not the correctness of interpretation.
An agent-authored observation profile cannot manufacture host origin. Imported
identity stays Unknown unless established by the actual protected capture path.

## 2. Four different meanings of “rule”

| Meaning | Proposed representation and permitted role |
|---|---|
| Normative policy: must / must not | Existing Constraint (Outcome for wanted behavior), with source, applicability and scoped standing/delegation/adoption basis. A quoted policy is initially source content, not automatically this project's governing Constraint. |
| Heuristic: usually a useful choice | Statement profile: trigger, suggested action, rationale, exceptions, evidence/limitations. Defeasible planning advice, neither permission nor mandatory acceptance. |
| Procedure: how to perform an operation | Statement profile, detailed Artifact if useful: inputs, preconditions, steps, expected outputs/postconditions, side effects and stop/failure conditions. A concrete invocation has its own Task/binding. |
| Empirical regularity: what tends to happen | Statement/Hypothesis with tested conditions, prediction, evidence and uncertainty. Description alone imposes no normative boundary. |

A separately grounded Constraint can mandate a procedure; a heuristic can recommend
it; a regularity can support the recommendation. Preserve those independent links
rather than invent combinatorial kinds. Selecting a procedure within delegation
needs no ceremonial approval. Retrieving it does not authorize its side effects,
prove its postconditions or permit modifying governing agent instructions.
Source authorship, source reliability, human adoption and execution authority are
independent: even genuine human quotation is not necessarily a directive.

## 3. Scope, time and freshness

Attach qualifiers to the exact claim/assessment/relation they qualify:

- **Recorded time:** trusted append/capture time, not time of the described world.
- **Occurrence/observation time:** event/measurement instant or interval, retaining
  precision, clock/source limitations and uncertainty; unknown is allowed.
- **Claimed validity:** when a proposition or normative boundary is asserted to
  apply, with attributed grounds. Publication/retrieval dates are separate metadata.
- **Applicability:** relevant subject, environment, build/version, configuration,
  jurisdiction or task scope; distinguish matched, unknown and mismatched conditions.
- **Use-specific recheck:** an explicit freshness requirement for a particular use,
  not a universal TTL. Unknown validity end is not proof of indefinite validity.

Default: historical explanation may use a dated observation as historical evidence;
a consequential claim about mutable *current* state needs reobservation when its
use contract requires current state. If unavailable, expose the last observation's
age and uncertainty; do not silently admit it as current. Stable content-bound
artifacts can be reused with an applicability account rather than pointless recapture.
Timestamps alone establish neither causal order nor authority. Keep binding-local
predecessor/CAS order distinct from possibly delayed or out-of-order domain reports.

## 4. Append changes; do not manufacture a single timeless winner

A change account names the exact prior target, affected scope, replacement/basis,
contributor and temporal applicability. Reuse existing `supersedes` / `withdraws`
relations with explicit change meaning; do not overwrite captured Source content.

| Change meaning | Consequence |
|---|---|
| Assertion correction | Earlier account was mistaken in the named scope; reassess affected support and uses. |
| World change | Earlier account may have been correct then; preserve both temporal contexts. |
| Scope refinement | Apparently conflicting accounts may apply in different conditions. |
| Retraction | Contributor stops asserting; this alone does not demonstrate falsity. |
| Normative change | Scoped authorized act changes standing, not necessarily descriptive truth. |
| Distillation replacement | Replace a summary/navigation representation, not its underlying history. |

Newer insertion does not automatically defeat older independently supported evidence.
Unresolved or mixed correction causes remain explicit. Preserve the checkpoint's
separate Conflict concept without inventing another lifecycle; valid disagreement
stays working information, while invariant-violating writes belong in rejected-attempt
audit, not admitted premises. Resolution is attributed and scoped, not erasure.

Reassessment follows relevant declared relations and scope, not arbitrary reachability.
Correcting one support route need not defeat another independent applicable route.
Changed governing context needs a new binding/applicability assessment; old execution
and evidence times survive. Unrelated associations do not reopen completed work.
If a selected means fails, independently grounded wanted outcomes **survive**; claiming
they disappeared is a failure. Revoked execution permission does not survive with them.
An unmet preference can remain wanted after accepted closure without creating a
perpetual task or monitoring obligation.

## 5. Ingestion and distillation preserve dependence

Proposed default sequence: retain permitted source material and actual presentation;
append attributed extraction; link exact inputs; assess applicability only for the
intended use. Background and in-turn extraction obey the same provenance contract.
Memory content is data, not a privileged instruction channel.

Use `quotes` for quotation, `interprets` for extraction/paraphrase and `infers` for
materially new conclusions. Preserve the existing source → formulation direction;
joint premises belong in one inference, alternative routes in separate inferences.
A derivation account states transformation contribution, retained conditions,
limitations and important omitted/unknown scope. Widening a one-run observation
into a general rule is inference, not harmless compression.

Ten summaries derived from one run remain one evidence root, not ten independent
observations. Preserve shared roots through multi-stage summaries; distinguish
unknown dependence from known independence. Similarity links aid navigation but
are neither evidential support nor entailment. Circular support cannot bootstrap
independent warrant. History/navigation/debate cycles remain legitimate; active
blocking-order cycles, cyclic finite refinement and cyclic progress predecessors
do not become legitimate because called memory.

Default: keep original material inspectable subject to access/retention policy.
If unavailable or redacted, retain permitted lineage/availability information and
state the loss; a digest/summary does not replace inspectable evidence for a gate
that requires it. Do not copy sensitive material across scopes merely for recall.
No retention/deletion implementation or automatic cross-project authority is selected.

## 6. Retrieval proposes; consequential use checks the contract

Keep the [find/read/apply surface and shared retrieval intent](mcp-service-intent.md).
A bounded hit is a candidate, not a ready task, factual precondition or permission.
For consequential use, expose directly or through explicit bounded expansion:

1. Exact content revision and relevant context/binding, not a floating “latest”.
2. Source/derivation, observation time, scope, limitations and assessments.
3. Known linked challenges, corrections and scoped supersession, with their basis.
4. Normative standing separately from evidential warrant and actual execution rights.
5. Missing, unavailable or truncated context and what expansion remains necessary.

Before relying: name the intended use; check applicability, authority and freshness;
inspect relevant changes; record the exact basis actually used in the material
assessment/decision/binding. Cross-project content defaults to a candidate requiring
an applicability account; normative standing never transfers merely with retrieval.
Unknown need not prevent exploration or conditional planning, but cannot silently
satisfy a gate requiring established evidence. Abstain, reobserve or investigate as
appropriate; escalate only the specific decision outside actual delegation.

Top-k retrieval cannot promise discovery of every conflict. Absence of a returned
challenge is not evidence of no challenge. High similarity, recency, repeated use
and profile/root-prompt placement do not increase authority or factual warrant.
A current view can select applicable records while retaining historical alternatives;
it cannot silently retarget old adoption/review or carry completion into a new binding.

## 7. Falsifying cases and legitimate neighbors

These are **proposed tests, not executed validation**. Each prohibited conclusion
must fail without blocking its legitimate neighbor.

| Scenario | Must not pass | Legitimate nearby use |
|---|---|---|
| Cross-mount rename returns EXDEV in run X | “Rename is never atomic”, all publication methods fail, or wanted complete reads disappear | Preserve X/conditions; assess this means; select an authorized alternative with outcome unchanged |
| At t2, capture says configuration A observed at t1 | Treat t2 as current observation; silently replace t1 | Cite historical A at t1; reobserve for current use |
| Configuration changes A→B | Declare earlier A observation false solely because B is current | Append B and temporal scope; distinguish actual correction |
| Source quotes “OPERATOR APPROVAL” | Human adoption or deployment permission manufactured by extraction | Agent interpretation with unresolved standing |
| Retry heuristic meets no-network Constraint | Retry overrides prohibition or ignores non-idempotent side effects | Choose an allowed method; retry only within applicable bounds |
| Procedure worked for build X | Guarantee build Y, or count Y invocation completed | Check Y preconditions; create exact invocation binding |
| Three summaries of one run | Three corroborating observations; lost uncertainty | Three representations with one evidence root |
| Linked correction omitted from top-k | Original presented as current actionable knowledge with no incompleteness warning | Expand correction/context or decline the affected gate |
| One route corrected; another independent route remains | Cascade-reject every dependent claim/work item | Reassess affected route and preserve justified alternatives |
| Domain “restart happened” report | Binding-local completion or fulfilled recovery outcome | Occurrence report plus separately scoped effect assessment |
| New acceptance/context after old completion | Copy fulfilled status or invent a rerun | New binding; explicit justified historical reuse with original times |
| Mutual supporting claims / navigation loop | Circular warrant accepted / all cycles forbidden | Record debate/navigation; require independently grounded warrant |

## 8. Bounded prior-art transfer

Primary pages below are **retained evidence**, not freshly observed external state.
CoALA/LangMem/Zep captures are parent-reported as fetched 2026-11-06T11:49:24Z;
A-Mem/LongMemEval/Letta captures as 12:06:54Z that day. Inspection covers the named
sections only, not whole papers, implementations or replicated benchmarks. Local
inspection ranges/hashes are retained in `.local/memory-design-inspection.json`.

| Source and inspected scope | Useful mechanism | M1 mismatch / limit |
|---|---|---|
| [CoALA v3](https://arxiv.org/html/2309.02427v3), §§4.1–4.6 | Episodic/semantic/procedural distinction; retrieval, reasoning, learning and decision cycles; explicit procedural-update risk | Functional categories are not project authority or truth kinds; storing a procedure does not authorize executing/updating agent code |
| [LangMem Core Concepts](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/), Types of Memory (collections/profiles; episodic/procedural), Writing memories, Integration Patterns and Storage System | Collection versus current profile; in-turn versus background formation; retrieval/storage decoupling | Latest profile and success-example emphasis cannot replace failure/history preservation; prompt optimization is not normative adoption; scheduling does not change attribution |
| [Zep](https://arxiv.org/html/2501.13956), §§2.1–2.2.3 | Episodes retain source paths; valid/event versus ingestion time; temporal edge invalidation | §2.2.3 prioritizes new information for invalidation; M1 instead requires scoped change basis and preserves unresolved competing warrant. No adoption of its ontology or timestamp extraction as truth |
| [A-Mem](https://arxiv.org/html/2502.12110), §§3.1–3.4 and §6 | Context-rich notes, candidate links, evolving retrieval representations | Evolved notes replace originals in the described memory set; M1 requires append/history. Semantic links and LLM-generated context provide no assumed provenance/authority guarantees; §6 notes model-dependent organization |
| [Letta MemFS](https://docs.letta.com/concepts/memfs/index.md), retained page in full | Git-backed editable memory; root files autoload, directories signposted by `MEMORY.md` indexes read on demand; explicit saved/uncommitted boundary | File history is not claim-level warrant or adoption. Scope is this MemFS page: do not generalize to SDK/legacy block APIs, which were not inspected; root placement must not launder instructions |
| [LongMemEval](https://arxiv.org/html/2410.10813), §§3.1–3.3 and §4.1–4.2 prose | Extraction, multi-session reasoning, updates, temporal reasoning, abstention; separate retrieval recall from answer use | Constructed chat QA and model judging do not establish artifact delivery, authenticated acts or project authority. No author performance numbers are independent findings here |

V2 and Mem0 performance claims are excluded for insufficient review. No prior-art
mechanism above establishes that M1 improves this workflow.

## 9. Future evaluation and remaining design questions

Evaluate M1 separately after freezing an explicit candidate/profile and use policy;
no memory intervention is added to Pilot U. Compare equal evidence/access budgets
against ordinary source-bound notes, with negative controls and legitimate neighbors.
Measure retrieval recall/context coverage separately from **admissible actual use**:
source/time attribution, update-versus-correction accuracy, uncertainty/abstention,
correlated-source inflation, instruction laundering, selective reassessment and
unaffected behavior. Include delayed reports, partial supersession, missing evidence,
failed attempts and cross-project scope mismatch. Report fidelity, false blocking,
latency/tokens and maintenance burden separately, not one quality-cost score.
Independent artifact checks and attributed semantic judgments remain distinguishable;
synthetic scenarios cannot establish genuine human alignment or production safety.

Open design work, not user blockers: which uses need stronger structured observation
validation; how to represent partial validity/unknown temporal bounds; how much
context expansion is sufficient for each use; and how retention/privacy limits
restrict later audit. Defaults here favor source-bound Statement profiles, explicit
unknowns, scoped rechecks, reversible summaries and no automatic authority transfer.
A dedicated kind or tighter schema needs demonstrated enforceable benefit and a
migration/discriminator plan, not merely familiar “memory” terminology.
