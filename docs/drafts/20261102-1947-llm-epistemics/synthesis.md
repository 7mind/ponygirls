# Synthesis — an epistemic framework for LLM-accelerated development

Status: J29 conceptual synthesis with a bounded Pilot T postscript, J34,2026-11-06.
This combines conceptual proposals, agent-side feasibility studies, a cooperative
software prototype, one bounded human co-framing case and finite artifact-delivery
observations. **It is not an end-to-end validated development method.**
The [brief](brief.md) is the short entry point; the [journal](journal.md) preserves
chronology and corrections, and the [hypotheses register](hypotheses.md) preserves
individual verdicts. Reference IDs below resolve in [references.md](references.md).
No new experiment or application construction is authorized by this synthesis.

## 1. The problem is justified delegation, not insufficient code generation

The motivating problem is that an agent can produce far more implementation detail
than the delegating engineer can inspect. The engineer still needs enough justified
understanding to recognize consequential mismatches, distinguish evidence from
assertion, and decide what to accept, repair or deliberately change.

A short prompt does not settle every behavior. The model fills gaps with conventions,
interpretations and engineering choices. Some choices are legitimately delegated;
others change an outcome the human cares about. Fluency, comprehensive-looking
specifications and passing generated tests do not distinguish the two.

The proposed response is a **belief-level interface**: jointly maintain a compact
account of intended outcomes, conditions, consequential choices and their grounds;
let the agent own detailed refinement and implementation inside that envelope;
challenge both the refinement and the evidence. The network is an acceptance aid,
not a requirement that the human memorize the implementation or approve every
engineering decision [J21–J22; R43, R51–R53, R62–R63].

Compression, cybernetics and theory-building supply useful framing, not a theorem
that this interface reduces overload. Sources entered the project through different
levels of inspection; abstract/excerpt reading and background-memory citations must
not become claims to have checked whole papers [J4–J6; references provenance].

## 2. Preserve the governing task before modeling its subject

The bounded human case exposed a distinction that authorization disclaimers alone
did not settle. The participant confirmed the example's framing, then explicitly
restated that the goal was to test the framework—not build the example [J29; L14].
No app was built, and no-build limits were present. The observation is a task-purpose
reanchoring, not evidence that unauthorized construction was imminent.

The proposed anchor separates:

| Question | What it preserves |
| --- | --- |
| What is the user trying to accomplish now? | Governing purpose, not just the requirements of an object discussed along the way. |
| What role does this artifact play? | Fixture/example, reference, experimental instrument, prototype or actual deliverable. |
| What operations and phase are authorized? | Framing, investigation, implementation and their side effects are not interchangeable. |
| What ends this piece of work? | A qualitative observable exit criterion, with deliberately untested legs named. |

These are distinctions to reuse when consequential, not four mandatory questions
for every task. A bounded evaluation can finish with an inspectable representation
and an evidence-bounded analysis. It need not grow into product delivery to count
as finished. Conversely, when construction is the actual task, this distinction
must not be used to evade its obligations.

## 3. What a belief network must distinguish

The latest conceptual model is a **typed network**, not a universal acyclic graph
with one confidence or authority score. The earlier [DAG design](belief-dag-design.md)
contains historical proposals; its caps, global propagation rules and support
badges are not implemented guarantees.

Five dimensions must remain separate [J27; provenance extension]:

| Dimension | Content | Invalid shortcut |
| --- | --- | --- |
| Statement role | Outcome, supporting obligation, assumption, selected means, descriptive claim. | Treat every specification sentence as a human requirement. |
| Source lineage | Exact input and presentation, author, revision and attributed interpretation. | Treat a paraphrase or source link as a new human act. |
| Justification | Joint premises, applicability, conditional consequence and alternative grounds. | Treat a trace path or a plausible rationale as entailment. |
| Normative standing | Adoption, delegated choice, proposal, dispute and supersession. | Treat agent origin as necessarily unauthorized, or later adoption as original human authorship. |
| Factual warrant | Observed, reported, planned, unchecked or contradicted evidence for an actual subject. | Treat a wanted guarantee or accepted assumption as an observed fact. |

Normative and descriptive statements have different directions of fit. Existing
behavior and tests help establish what the artifact does; they do not alone decide
what it ought to do. A human can require an outcome or accept a risk, but agreement
cannot make a filesystem premise true. Conversely, an applicable contract or an
explicit delegation can ground a choice without making the human author its wording.
Same-generator tests can remain useful regression and consistency checks; the limit
is that they cannot alone confer normative authority or validate unexpressed intent.

In requirements-engineering terms, intended outcomes are R, applicable domain
knowledge/assumptions are W, and the proposed specification is S. The obligation is
to justify that S under W meets R. Writing `S ∧ W ⊢ R` or drawing refinement edges
does not discharge that obligation [R51; J10, J21].

## 4. Joint framing is selective inquiry, not specification review by another name

**Compress implementation, not unresolved intent.** Ask about an alternative when
it changes an intended outcome, applicability, accepted risk or consequential side
effect. Investigate facts the agent can establish; apply already-agreed intent
instead of asking the human to ratify it again.

The operating loop is:

1. Preserve the request, governing purpose, relevant agreements and authorized scope.
2. Propose positive outcomes in the human's vocabulary; expose consequential
   conditions, assumptions and open choices.
3. Challenge the proposal: could it pass its examples while missing the outcome?
   Could two systems it presents as equivalent warrant different judgments?
4. Resolve one consequential difference in ordinary dialogue, with room for an
   unoffered alternative, correction or deferral.
5. Preserve the actual answer/context separately from its attributed interpretation;
   update a compact current view without rewriting the history.
6. Close the authorized phase at its agreed endpoint. Construction is a separate
   operation when applicable, not the default destination of every framing exercise.

This loop does not certify exhaustive elicitation. The agent chooses the questions
and can share the omissions of its own proposed model. Examples discriminate among
interpretations; they do not exhaust a broader goal. A perfectly traced prohibition
can still omit the positive accomplishment—a store that never installs an update
may satisfy a narrow no-mixture property while failing the intended service.

Dialogue can clarify existing intent, form a new preference, correct an interpretation
or deliberately change an outcome. Preserve these possibilities; do not automatically
call every newly specified choice a reversal. Raw short replies, qualifications and
typos remain source data. Later adoption establishes current standing without
rewriting what was originally said or who formulated a proposal [J22–J29].

## 5. Revision must preserve independently grounded outcomes

A changed premise is not a universal invalidation signal. A justification may have
joint premises and alternative routes: `(A and B) or D`. Losing A defeats the first
route, not necessarily D. Loss of a warrant does not prove the conclusion false;
an independently justified obligation can survive an additional circular rationale.
Only relations whose semantics require well-foundedness need corresponding cycle
constraints [provenance extension, §§3–4].

| Finding | Response within the agreed envelope |
| --- | --- |
| Implementation violates an agreed outcome | Reproduce and repair; do not weaken the outcome to make checks pass. |
| An attributed interpretation was wrong | Correct that interpretation and its consequences; retain the original input. |
| A factual premise lacks warrant or fails | Investigate and reconsider the affected support route. |
| A selected means fails | Seek another means preserving the outcome before proposing a trade-off. |
| The human changes a scoped outcome | Record the new act and supersession; retain unaffected obligations. |
| An unrelated artifact changes | Do not invalidate commitments merely because they share a document or ancestor. |

A selected means is not a necessary requirement merely because it is convenient.
A conditional necessity claim should survive a challenge with a conforming
alternative. This is a semantic obligation, not a field the current CLI can verify.

## 6. Validation has three directions and a task-purpose boundary

For an authorized delivery, ask separately:

1. **Intent → network:** what material acceptance distinctions were omitted or
   distorted? Human agreement is important evidence of current adoption, not an
   independent completeness oracle.
2. **Network → artifact:** what behavior and evidence support, contradict or leave
   the outcomes unchecked, for which version and conditions?
3. **Artifact → agreed basis:** what consequential behavior, dependency, side effect
   or shortcut appeared without an agreed or delegated basis?

Also preserve the governing task: an example can satisfy its recorded requirements
without making its construction relevant to the actual assignment. State which
baseline and revisions a delivery is assessed against; meeting deliberately revised
intent is not success against an unchanged initial target.

Evidence must address the outcome, not just the author's mechanism. Nominal save/load
checks do not establish crash atomicity; a test timeout is not a user-approved
latency limit; finite traces do not prove unrestricted eventual progress. A passing
check needs a credible oracle and a negative control that actually violates the
property where that assurance is claimed. Test, artifact, environment and oracle
identity matter. Failed, skipped, unavailable and unchecked cases remain visible.

Different-family review, auditor framing, perturbation, fresh-reader experiments
and human inspection provide different challenges. They are not interchangeable
proofs of statistical independence. Even an advisory reviewer can misstate its
source or overinfer readiness: both occurred in the bounded case's review and were
corrected with an erratum [L14]. Review is attributed evidence, not an authority
upgrade by role label.

The eventual human-side question remains whether the network helps discriminate
matching from violating deliveries with justified confidence and practicable total
participation. Recall, confidence, graph size, green badges, always rejecting and
blanket deferral are not substitutes. No accepted mechanical attention/overload
measure, numerical cap or no-hard-cap agreement exists here; no proxy is introduced.

## 7. What the evidence currently supports

| Evidence | What can be said | What cannot be said |
| --- | --- | --- |
| Field instance and agent-side fixtures, J8–J19 | Existing artifacts were sometimes used as intended-design authority; provenance gating, varied perturbation and audit exposed particular problems in particular studies. | A universal failure rate, model-family superiority or a solved oversight workflow. Sol's field failure was not reproduced by the small fixture studies. |
| Rationale/rules studies, J15/J19 | The tested rationale and direction-of-fit additions did not establish the hypothesized effects at the declared small n. | The field failure was explained by those rules, or the general hypotheses were definitively refuted. |
| Pilot P, J27–J28 [L13] | 24 attempts; 22 strict-valid answers and two retained prompt/scorer citation ambiguities. Revision actions and supplied-root controls were at ceiling in every arm. | Stable added-rationale efficacy, a typed-over-prose advantage, equivalence, annotation-generation fidelity or independent dependency discovery. |
| Bounded human case, J29 [L14] | One participant explicitly confirmed a consolidated framing; sources and later adoption remained inspectable; the governing purpose was explicitly reanchored. | Comparative fidelity/effort benefits, complete latent intent or a genuine scenario-revision result. Revision was declined; delivery was outside scope. |
| Cooperative CLI [L11, L14] | Its 36-method public software suite passed; the bounded case's record, projection and history checks passed. | Authenticated human authority, semantic approval, inferred support, human efficacy or application security. |
| Pilot T, J34 [L19] |16 originals;13 process-valid, all passing336 finite independent functional inputs;12 meet all primary criteria after separate source-based semantics. Strong notes meet the configured criteria; no graph advantage demonstrated. | Three graph process-invalids are not three incorrect artifacts. Ceiling effects, varied graph uptake, differential instrument failure and four post-treatment qualified pairs do not establish pure-schema effects, general equivalence/efficiency or Human benefit. |

The [T delivery/revision comparison](workflow-benefit-pilot.md) preserves the distinction
between artifact correctness and faithful evidence/completion reports: one graph
original passes functional checks but materially promotes finite tests to full-contract
execution coverage. Applicable inspection can nevertheless support a bounded reuse
claim without fabricated reruns or mandatory exhaustive testing. No new regression was
observed under the frozen pre/post correspondence; unchanged expected values do not
prove unaffected dependency scope. This extends the evidence beyond recording-only
fixtures, not to Human acceptance or sustained workflow efficacy.

Historical agent-pilot interpretations retain an isolation qualification: the older
all-`/nix` wrapper exposed a reproduced store-copy channel. Pilot P's restricted
runtime closure corrected the tested channel prospectively. This does not establish
that earlier subjects actually accessed keys, or restore universal historical
oracle-isolation assurance. Original data, invalid outputs, codings and later
adjudications remain distinct [J27–J28].

## 8. Implemented, proposed and untested are different inventories

The portable v1 bundle implements explicit-input `snapshot/check/render/diff` over
cooperative declarations: source/context records, attributed interpretations,
claim revisions and declared external dependency/evidence bindings. It checks
specified structure, fingerprints and preservation. It does not authenticate human
input, read evidence artifacts to establish their truth, parse semantic approval,
or implement typed claim-to-claim justification and alternative-support propagation.

Pilot P's richer grounds records are an experimental representation, not a quiet
upgrade of that CLI. The saved `joint-belief-framing` r2 amendment is inert text;
it was not installed or applied to the original portable bundle. The governing-
purpose refinement remains a procedural proposal, not an implemented hierarchy.

The original RTS case remains unfinished and its old-context scope conflict
unresolved. It is not silently resumed. The notes example is a closed research
fixture, not a delivery backlog. Neither case establishes end-to-end human acceptance.

## 9. Research conclusion and next boundary

The strongest current synthesis is a **framework of distinctions and accountable
transitions**, with limited feasibility evidence for some supporting techniques.
It is not yet evidence that maintaining the network improves software delivery or
reduces overload.

The main unresolved problem is selecting and maintaining consequential grounds
without inheriting the generator's omissions or recreating specification overload.
Before another experiment, state the capability being tested, the result that would
change a framework decision, an independent basis for judging that result, and the
qualitative exit criterion. A bounded test of faithful grounding/impact discovery
must not supply all the roots and then count their retention as discovery. A
synthetic revision can test a mechanism, but is not a genuine human intent change.

These are candidate research directions, not new run instructions. Comparative
acceptance quality, continuing usability and human effort require their own
prospective design and authorization; product construction is not automatically
the next step after confirming a framing example.
