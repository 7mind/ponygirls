# Joint construction: compress implementation, not unresolved intent

Status: conceptual proposal extending [the validation frame](belief-network-validation.md)
and the earlier [dialogue draft](belief-dag-design.md#5-dialogue-protocol-from-a-prompt-to-a-ratified-belief-set).
No procedure here has been tried with a human. The examples are conditional
paper walkthroughs, not transcripts, user decisions, implementations or runs.

## 1. What the joint dialogue must preserve

The network is an **acceptance boundary**: it exposes the outcomes and conditions
needed for later human judgment, while hiding implementation refinements that
make no material difference to that judgment. “Material” is relative to the
agreed task, not synonymous with large code changes or model uncertainty.

A hidden choice is a candidate for joint discussion if plausible alternatives
would change an intended outcome, the applicability of a guarantee, an accepted
risk, or a consequential side effect. If existing agreed intent already decides
it, the agent should apply that intent rather than ask again. Neither a lack of
tests nor disagreement between implementations establishes that intent is unclear.

The proposed human-facing boundary preserves:

- **What and for whom:** the outcome, affected observers, and important negative
  expectations—not only a technical label such as “atomic.”
- **When it applies:** relevant failures, environmental conditions and explicit
  exclusions. An unstated condition is not an agreed exclusion.
- **Why it is credible:** consequential assumptions, their warrant or missing
  warrant, obstacles, and how their resolution supports the outcome.
- **Where a choice remains:** material alternatives, accepted risks and deferred
  scope. These cannot silently disappear into an implementation default.
- **What would count against it:** observable violations and distinguishing
  scenarios, with the broader goal retained above the examples.
- **Who agreed what:** the original prompt, explicit clarifications/revisions,
  and the later evidence's scope and delivered-version binding.

Include the positive accomplishment as well as prohibited outcomes. A store
that never installs an update can satisfy an isolated “never mix versions”
condition; successful completion and visibility may need separate goals.
A promise about successful returns still permits rejecting every request or
never returning. Whether valid work must succeed under agreed normal conditions
is another question; do not infer availability or a deadline from “atomic.”

This is not a claim that all consequential distinctions can be enumerated.
It is a criterion for challenging a proposed compression. Two implementations
need not be identical; they must not be presented as interchangeable when the
clarified intent would require different acceptance judgments.

The structure has prior art. Potts, Takahashi and Antón's Inquiry Cycle connects
proposed requirements, questions, answers, justifications and approved changes
[R63]. Obstacle analysis addresses exceptional behavior at the goal level,
before committing to a particular implementation [R52]. The proposal here is
to use those ideas selectively for a compact human acceptance artifact; the
sources do not establish that agents make this selective process reliable.

## 2. A consequence-driven loop, not an eight-stage questionnaire

| Move | Agent work, mostly hidden | Human-facing output |
|---|---|---|
| Anchor | Preserve the prompt and relevant agreed context; separate intended outcomes from factual claims and unknowns. | A small candidate goal set, in the human's vocabulary, with scope departures made explicit. |
| Challenge | Construct plausible interpretations and ask how a plan could pass the examples yet violate a goal; inspect applicable obstacle categories and known constraints. | A consequential contrast, not an inventory of internal design options. |
| Resolve | Determine what follows from existing intent or factual evidence; try refinements that preserve the goals before presenting a trade-off. Investigate a suspected incompatibility rather than declaring it established. Otherwise ask about differing outcomes. | A focused question with consequences, a proposed option labelled as such, and room for “neither” or “not yet decided.” |
| Connect | Record the answer and its reason; propagate it to affected goals, assumptions, obstacles and scenarios. | Only the consequential delta and any newly exposed conflict, not the regenerated specification. |
| Close the current scope | Check for known unresolved material choices, unsupported assumptions, contradictions and missing validation routes. | A candidate baseline plus explicit open/deferred items; the human decides what is agreed. |

Each question should name a possible acceptance difference: “If A rather than B
happens, would that meet your intent?” A pure choice of library, lock or function
signature remains below this boundary unless its consequences cross it—for
example, an externally consumed interface change or a new operating dependency.

Questions about facts the agent can establish should be investigated rather
than handed to the human. Current code/tests establish current behavior, not
intended behavior; a documented deployment assumption may still need warrant
for the actual target environment. The agent must not turn “this mechanism is
convenient” into “this limitation is required.”

A contrast is a probe, not a forced menu. Both proposed alternatives may be
wrong. A second family, obstacle catalogue or fresh reader can supply additional
challenges, but agreement is not a completeness certificate (J18, Pilots 3–5).

## 3. Readiness and bounded attention

Proposed readiness for autonomous work means an identifiable baseline for the
active scope, not a declaration that all intent has been captured. In particular:

- Known material ambiguities/conflicts are resolved or the affected scope is
  explicitly deferred; silence does not authorize the proposed default.
- Assumptions needed for the promised outcomes have stated warrant or visible
  uncertainty. Human agreement cannot make an environmental claim true.
- A validation route is identified, with limitations. If no practical check is
  known, that gap is visible; it does not redefine the requested goal as whatever
  is easy to test. Whether that gap is acceptable is a human judgment.
- Residual implementation choices remain within the agreed outcomes and
  delegated scope; they need not all become ratification items.

The old numerical caps are unvalidated design proposals, not established human
limits. A cap must never turn a **known material obstacle** into an anonymous
“and 12 more” count. Group shared consequences where the grouping preserves their
meaning; otherwise expose the overflow and propose a scope split. Preserve
cross-scope obligations: splitting an atomic multi-file update into separate
per-file tasks does not establish whole-update atomicity. If no safe split fits
the available attention, the task is not ready at that size. Many small batches
can still exceed the total attention budget.

Unknown omissions remain possible. The result is therefore a baseline with
recorded scope and known limitations, not a proof of semantic completeness.
Discovery during autonomous work may reopen part of it; the execution policy
for interruption versus deferral remains a separate, unratified choice.

## 4. Paper walkthrough A: “An update should be atomic”

**Anchor:** retain the broad statement. Do not replace it immediately with a
mechanism such as “write temporary files and rename them.”

**Contrasts for joint clarification, not answers supplied by this note:**

1. Under normal operation with no competing writer, the store reports success
   but the next reader still sees the old value. What must successful completion
   establish? And must a valid update actually finish successfully under those
   conditions, rather than always being refused or waiting forever? Old-or-new
   crash scenarios alone do not answer either question.
2. A restart sees a whole old or new configuration, but a reader running during
   the update can see a mixture. Is that acceptable, or are both observers covered?
3. A process crash preserves a whole version, but a power loss need not. Which
   failures must the guarantee cover? If power loss is undecided, record the gap
   rather than silently making it an exclusion.
4. Two writers publish whole versions without mixtures, but one overwrites the
   other's read-modify-write result. Is preventing that lost update also required?
   Atomic publication alone does not establish that separate concurrency property.

These questions concern observable guarantees. A directory scheme, transaction
API or lock is an agent-layer choice unless its consequences need another human
decision. The agent should investigate the operating environment rather than ask
the human to choose an implementation primitive.

**Conditional baseline:** if the human requires successful updates to become
visible, and whole-version visibility during reads and after process crashes,
retain the success obligation separately from the no-mixture goals, with their
observers and failures. If valid updates must complete successfully under agreed
normal conditions, retain that progress obligation too; the successful-return
condition alone does not establish it. No availability or deadline is inferred
from atomicity. Power-loss and concurrent-writer requirements remain expressly
unresolved unless answered; neither is treated as accepted risk. Any autonomy
must be scoped accordingly. A reader protocol or filesystem premise needed by
the refinement must be surfaced at the level of its consequence and warranted,
not hidden behind the word “atomic.”

**Delivery reasoning against that conditional baseline:**

| Delivery condition | Judgment supported by the condition |
|---|---|
| The store reports success but never installs new configurations. | This contradicts the conditional successful-return obligation, even if every old-or-new crash scenario passes. |
| Valid updates are always refused, or an established non-progress condition prevents completion. | This defeats a completion obligation if one was agreed; a finite wait alone does not prove failure of unbounded eventual completion. |
| Only ordinary save/load was checked. | The crash/overlap guarantees remain unsupported, even if the suite is green. |
| A reader demonstrably observes mixed versions during an update. | The agreed reader goal is contradicted. |
| Cleanup removes a version while a slow reader still needs it, producing an incomplete read. | The broad reader goal is contradicted; lack of a slow-reader example does not authorize this exception. |
| Checks kill the writer at selected boundaries, but never exercise recovery followed by another crash. | Report the checked domain; do not infer all crash sequences were covered. This is a candidate challenge, not an observation of a new defect. |
| Every agreed atomicity check passes, but the implementation adds external configuration uploads. | Conformance to those goals does not authorize the new data exposure; reverse coverage raises it as a material choice. |

The human can judge these differences without selecting the locking algorithm.
Whether the dialogue and evidence actually let a human do that efficiently is
still untested.

## 5. Paper walkthrough B: “Completion must not wait for user input”

**Anchor:** a selected background-task completion notice must be processed without
requiring the user to type. This is the J10 example's intended property, not an
inference from existing tests asserting delivery on the next input.

**Contrasts for joint clarification:**

- A notice arriving during a running turn waits until that turn finishes, but
  needs no user input afterward. Is that scheduling delay acceptable?
- A queued notice is delivered only on a later user turn. That differs from
  waiting for a temporary busy period; an existing no-input goal already rejects
  this interpretation, so the agent need not reopen it as an undecided preference.
- If the harness is permanently unavailable or an active turn never finishes,
  what recovery behavior is required? Do not silently assume eventual readiness
  when that is precisely what might fail.
- Waking the harness and consuming an unsent user draft are different actions.
  The wake-up goal does not itself authorize using unfinished input. Apply any
  existing prohibition; otherwise surface a proposed change in control of input
  rather than treating it as an implementation detail.

**Conditional baseline:** if temporary deferral until the harness can run is
accepted, preserve both the no-input goal and the dependency on regained
readiness. An enumeration such as idle/busy/compaction illustrates the goal;
it does not limit the goal to those states. A failed delivery attempt remains
subject to the broader requirement, not automatically outside it because it
was absent from the examples.

If bounded latency is required, its meaning must be clarified. A test timeout
is an observation window, not a human-approved maximum delay. A deadline-bearing
goal and an unbounded “eventually” goal need different evidence; finite successful
runs alone do not establish general liveness. No duration is selected here.

**Delivery reasoning:** an established dependency on subsequent user input
contradicts the no-input goal, even if a test calls it “deliberate.” A finite
trace in which input precedes delivery does not alone establish that input was
necessary: another wake-up might have occurred later. Without a demonstrated
input dependency or violation of an agreed deadline, report the observed delay
and checked domain rather than a proved failure of unbounded eventual delivery.
Passing checks for the named states supports only what those checks exercise.
A discovered unnamed state prompts further conformance investigation; it does
not, by itself, require the human to ratify the same broad goal again.
An actual inability to achieve that goal is reported as a limitation with
alternatives, not solved by narrowing the recorded intent.

## 6. What the paper challenges add—and do not establish

They expose defects in several tempting simplifications:

- **Ask about implementation disagreement only:** shared conventions can hide a
  material interpretation; disagreement can also be irrelevant to acceptance.
- **Approve a few examples, then treat them as exhaustive:** this can preserve
  every example while weakening the governing goal.
- **Make every assumption a user question:** this recreates specification
  overload and asks the human to decide facts rather than intended outcomes.
- **Count the overflow or split until it fits:** this can hide a known obstacle,
  a cross-scope obligation, or unbounded cumulative effort.
- **Choose only properties with easy tests:** this exchanges validation
  convenience for intent fidelity without an explicit decision.

These are logical counterexamples, not measured failures of a new protocol.
The resulting hypothesis is that **consequence-driven questioning can preserve
acceptance distinctions while keeping implementation refinement out of the
human dialogue**. The unresolved difficulty is selecting the consequential
contrasts without sharing the generator's omissions. Existing pilots provide
candidate challenge channels, not proof that selection is complete or that the
whole workflow reduces overload.
