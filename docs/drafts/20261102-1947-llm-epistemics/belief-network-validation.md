# Belief network as a pre-agreed validation frame

Status: conceptual proposal following Q17 and the user's clarification in
[journal J21](journal.md#j21--2026-11-03--the-belief-network-as-a-validation-frame).
No new pilot, instrument, tooling or acceptance threshold is specified or
validated here. The workflow direction is the user's; the criteria below are
agent-written proposals, not ratified requirements. The later
[methodology v0.1](belief-network-methodology.md) draws on partial framing
observations (J24), not completed implementation or human acceptance evidence.

## 1. The object we are trying to preserve

The human writes a prompt. The agent plans work and, together with the human,
builds a belief network for the human's later use. The agent then works
autonomously. At delivery, the network is used to validate the code against
the initial intent.

The primary outcome is therefore an informed acceptance judgment using the
network and evidence, not recall of the network or unaided reconstruction of
the implementation. This narrows the earlier discussion of human capabilities:
the human must be able to recognize a mismatch, identify an unresolved question,
and decide whether to accept, request a correction, or deliberately revise the
intent. Which of these the workflow actually enables remains untested.

External representations are part of the task, not necessarily a crutch to be
removed during evaluation: Hutchins analyzes cognition at the level of people
and artifacts together [R62]. This does not establish that an LLM-maintained
network is a reliable artifact. Nor does assisted task success establish that
the human can continue when the original agent is unavailable.

## 2. Three stages, with different obligations

| Stage | Work | What must not be conflated |
|---|---|---|
| Joint framing, before autonomous work | Preserve the prompt; clarify goals, scope, assumptions, material choices and distinguishing scenarios; the human agrees a baseline network. Detailed implementation planning may remain in the agent layer. | A plausible plan is not evidence that the network faithfully captures the human's intent. |
| Autonomous construction | Refine the baseline into specification, code and checks; collect evidence and disclose consequential choices or conflicts discovered along the way. | Agent discoveries may propose a revision; they do not retroactively make it human-approved. |
| Post-delivery validation | Use the baseline, its explicit revisions, the delivered artifact and evidence to assess matches, violations, unsupported claims and uncovered consequences. | A report of passing checks is not itself validation of the initial intent. |

Autonomy need not mean permission to settle every new question. An unresolved
material choice must remain visible, rather than silently becoming intent.
Whether to pause affected work, defer that scope, or ask during execution is an
open execution-policy choice; unaffected work need not stop.

## 3. There are two gaps, not one

**Intent → network: faithfulness.** Joint construction must expose materially
different interpretations before choosing among them. The human's agreement
establishes authority over intended behavior; it does not prove that every
tacit intention was elicited. No amount of testing the eventual code repairs
an unnoticed omission in this first step.

**Network → code: conformance.** Evidence must address the agreed properties,
under stated assumptions and within the domain actually checked. A faithful
network with unfaithful tests is still insufficient. Trace links establish
where a claim is addressed, not that the refinement is semantically correct
(design §6; Pilots 1, 5 and 6, as reported in J18).

The original prompt is an anchor, not an exhaustive formal specification.
Dialogue can legitimately discover or change intent. Preserve the distinction
between a clarification and an explicit change, including what it supersedes.
Validation should state whether the delivered code matches the original
baseline or a deliberately revised one, rather than calling both “initial.”

Normative and descriptive nodes must also remain distinct. The human can decide
that a guarantee is required, but cannot make a filesystem assumption true by
ratifying it. If an assumption fails, the claimed guarantee becomes unsupported
or violated; this is not automatic permission to weaken the goal.

## 4. What makes this a useful network rather than a long checklist?

Proposed minimum human-facing content, reusing the existing design's vocabulary:

- **Goals and exclusions:** the observable outcomes that matter, and what is
  deliberately outside this task.
- **Assumptions:** conditions on which those outcomes depend, with a way to
  notice a relevant violation where practicable; otherwise explicitly unmonitored.
- **Material decisions and their reasons:** the alternatives that would change
  an outcome the human cares about, not every implementation default.
- **Obstacles and resolutions:** what can defeat a goal, and whether it is
  handled, excluded, accepted as risk, or still open.
- **Distinguishing scenarios:** concrete outcomes that separate plausible
  interpretations; examples constrain a belief but do not exhaust its scope.
- **Validation links:** what evidence would address the belief, later bound to
  the actual delivered version; untested parts remain visible.

The edges explain why a claim holds and what would invalidate it. A human
should not have to traverse every refinement leaf to answer an acceptance
question. Conversely, a compact display that removes a consequential condition
has not achieved useful compression.

A proposed adequacy test for the representation: **if two plausible systems
shown as equivalent by the network warrant different acceptance judgments under
the clarified intent, a material distinction is missing.** This is a way to
construct counterexamples, not a decidable completeness test or a guarantee
that all such pairs can be found. Adequacy is relative to a task and its scope;
a future change can make a previously hidden distinction consequential.

## 5. Validation must look in both directions

1. **From beliefs to code:** for each relevant belief, what supports it, what
   contradicts it, and what remains unknown? Evidence should survive challenges
   phrased in the belief's terms, not only the author's implementation terms.
2. **From the delivered system back to intent:** what consequential behavior,
   dependency, side effect or design choice was introduced that the baseline
   does not address? Meeting every listed goal does not authorize unrelated
   behavior. Not every line or default requires a new human-facing node.

The second direction is an omission check, not a claim that agents can enumerate
all omissions. Independent audits and varied perturbations are candidate ways
to challenge the account; the pilots do not establish exhaustive coverage.
Different model family, auditor framing and mechanical execution are different
sources of challenge, not interchangeable proofs of statistical independence.

The human-facing delivery should let the human locate the baseline used,
understand material departures, distinguish support from testimony, and ask for
a targeted missing check. “Unsupported” must not be rendered as either “passed”
or “failed” without a reason. An honest unknown can prevent an unwarranted
acceptance; a workflow that always defers everything has not demonstrated useful
validation either.

This is compatible with meaningful-human-control work's distinction between
systems responding to human reasons and meaningful human involvement [R61].
Its philosophical tracking/tracing conditions are not the same as our graph
trace links, and do not validate this workflow.

## 6. Success criteria, not yet a measurement instrument

| Criterion | Observable evidence to seek later | What would not establish it |
|---|---|---|
| Intent fidelity | Material interpretations are surfaced and resolved or explicitly deferred; omissions discovered later are traced back to the framing step. | The human approves polished wording; code passes checks for that wording. |
| Discrimination | With the network available, the human rejects consequential mismatches and accepts matching artifacts on independently grounded cases, including cases not rehearsed in the dialogue. | Recall, confidence, keyword overlap, or rejection of everything. |
| Epistemic boundaries | The human distinguishes a warranted guarantee from an unchecked case, and can request the specific missing evidence. | A generic disclaimer or saying “unknown” to every question. |
| Authority and binding | Baseline changes are explicit; evidence identifies the code version and checked scope; failures cannot be removed by silently rewriting the goal. | A current green status with no source or version binding. |
| Human tractability | The judgments remain useful at bounded total human effort across framing, clarification, delivery review, investigation, revision and later resumption. | Shorter final reports, fewer graph nodes, or lower review time alone. |
| Continuing usability | Later, the human can use the recorded network and inspectable evidence without depending exclusively on the original agent's narrative. | A fresh agent reconstructs the theory; the human merely repeats a summary. |

These criteria are a profile, not a scalar score. Saving attention cannot
compensate for losing a necessary acceptance distinction. Conversely, an
unbounded review that detects everything would miss the user's tractability
objective. Any comparison needs a declared task/risk scope, treatment of
incorrect acceptance and incorrect rejection, and accounting for unfinished or
deferred work; no numerical trade-off or threshold is chosen here.

The old prediction and explain-back measures may be useful diagnostics. They
are not the primary outcome and cannot substitute for artifact-supported
acceptance judgments. One short successful session would establish, at most,
instrument feasibility, not sustained understanding, reduced overload or less
burnout. Bainbridge's discussion of lost practice and difficult recovery [R20]
is a reason to examine continuity over time, not evidence of an effect here.

## 7. A small thought experiment

Prompt: “Updates should be atomic.” Before autonomous work, dialogue clarifies
observers, failure conditions and whether concurrent writers are in scope. A
baseline might require that readers see a whole old or new configuration after
a process crash, with concurrent writers explicitly unresolved and not yet
licensed. The network makes that unresolved boundary visible; it does not
quietly convert it into a permanent single-writer intention.

At delivery:

- Passing only a nominal save/load test leaves crash atomicity unsupported.
  Demonstrating mixed versions after a crash instead contradicts the goal.
- The code might meet the crash goal but silently depend on an undisclosed
  single-reader condition: the network or refinement is incomplete.
- The code might meet every recorded atomicity claim but send configurations
  to an external service: goal coverage alone does not authorize that side effect.
- The agent might rewrite “atomic” to “atomic for one file” after implementing:
  this is a proposed intent change, not successful validation.

These are logical counterexamples, not new experimental observations. They
illustrate why the network must preserve both expectations and their boundaries.
The next conceptual question is **what distinctions must reach the human before
work, and what can safely remain in the hidden refinement until challenged?**
The [joint-construction proposal](belief-network-construction.md) develops that
question with conditional paper walkthroughs, not a tested protocol. Storage
syntax and graph rendering do not settle it.
