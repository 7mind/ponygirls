# Brief — epistemics of LLM-accelerated development

Status: through J30, 2026-11-05. CQ4 source review and the registered Pilot Q matrix
are complete; **no example application or CQ4 replacement was built**. Read the
[compact node recommendation](cq4-node-schema.md), [source review](cq4-source-review.md),
[synthesis](synthesis.md) and [journal](journal.md) for evidence and limits.

## Problem and proposed response

Agents expand a small statement of intent into more implementation detail than a
human can routinely inspect. The problem is preserving justified control over
consequential outcomes—not merely producing code or a longer specification.

**Proposal:** human and agent jointly maintain a compact belief network of intended
outcomes, conditions, material decisions and their grounds. The agent owns detailed
refinement and checks inside the authorized envelope. The human uses the network
and inspectable evidence for informed acceptance, correction or deliberate revision.
**Compress implementation, not unresolved intent.**

The representation must distinguish statement role, source lineage, justification,
normative standing and factual warrant. An agent proposal may become adopted
without becoming originally human-authored. A chosen means is not automatically
necessary. Agreement can require a guarantee; it cannot make a factual premise true.
Trace links and passing checks do not themselves prove semantic support.

## Current CQ4 recommendation

Use one agent-authored `kind/text/scope/state/grounds` record, with system-owned
identity, revisions, source provenance and audit. Retain Task/Defect/Hypothesis and
other useful semantic uses; no mandatory Goal/Milestone organization or epistemic
roll-up arrays. Positive intended outcomes remain grounded statements. Permit
revision-checked changed-field amendment; it is not uniformly cheaper.

CQ4's epistemic support is incomplete, not absent. Keep its real authentication,
protected evidence origins, exact review applicability and transactional guarantees.
The candidate guarantees at most a revision-reference DAG, not sound inference or
logical noncircularity. Pilot Q did not establish a semantic winner, equivalence,
global efficiency or human efficacy [J30; R65; L15].

## What the preceding human case added

One participant confirmed the consolidated notes-example framing: **“Intent
captured correctly.”** They then declined a scenario revision and explicitly
reanchored the task as a bounded test of the framework, not app construction.

This motivates separating **governing purpose, artifact role, authorized phase and
qualitative exit criterion**. Confirmation of an example's requirements does not
settle what we are trying to accomplish with the example. Existing no-build limits
were present; no app was constructed. The finding is a scope-salience observation,
not proof of imminent unauthorized construction or a validated intervention.

The case is closed: framing was participant-confirmed; scenario revision is
**untested**; delivery/security acceptance is **outside scope**, not deferred work.

## Evidence: what is established and what is not

- Earlier agent-side studies provide study-specific feasibility signals for
  provenance gating, varied perturbation, cross-family challenges and fresh-reader
  audits. Shared conventions and faulty oracles remain important limitations.
  No model-family superiority or general oversight efficacy follows.
- Pilot P completed 24 attempts, 22 strict-valid and two retained citation-contract
  ambiguities. Added-rationale efficacy is inconclusive; **no typed-over-prose
  advantage was established**. Revision actions and supplied-root controls were at
  ceiling; supplied roots are not dependency discovery [J28; L13].
- The bounded human case demonstrates an inspectable dialogue leading to current
  participant confirmation. It has no comparison arm, independent completeness
  oracle, genuine scenario revision or human-effort result [J29; L14].
- Pilot Q completed 24 original attempts: 19 valid, five operationally invalid and
  unscored, no replacements. Original reader disagreements and later parent
  adjudication are preserved. Unsupported scope/causal/implementation inferences
  occurred with every arm; three adequate amendment comparisons had mixed resources.
  The smaller mandatory surface is a design preference, not an empirical winner
  [J30; L15].
- The cooperative v1 CLI has 36 passing software test methods. Case checks verified
  record/projection/history integrity, not semantic approval or application security.

Historical all-`/nix` oracle-isolation assurances remain qualified by a reproduced
store-copy exposure channel. Pilot P corrected the tested channel prospectively;
actual earlier key access was not established. Preserve original data, invalidity,
codings and later adjudications rather than rewriting them into one favorable score.

## Framework obligations

For an authorized delivery, distinguish **intent → network faithfulness**,
**network → artifact conformance**, and **artifact → agreed-basis accountability**.
Keep positive outcomes above examples and prohibitions. Bind evidence to actual
versions and conditions; distinguish contradicted, unchecked and supported scope.

On change, distinguish a revised human outcome, corrected interpretation, failed
assumption, failed means and new evidence. Preserve independently grounded outcomes;
losing one support route need not defeat an alternative. The current CLI does not
perform this semantic reasoning automatically.

The primary eventual human-side outcome is an informed acceptance judgment with
the representation available—not unaided recall, confidence or graph size. No
accepted mechanical attention/overload measure or numeric/no-hard-cap agreement
exists here. Do not revive NASA-TLX or substitute time/question counts as a proxy.

## Handover and next boundary

- Read: this brief → [node recommendation](cq4-node-schema.md) → J30/source review →
  [synthesis](synthesis.md) → J29/J28 →
  [provenance extension](belief-network-provenance.md) →
  [methodology](belief-network-methodology.md) and
  [validation frame](belief-network-validation.md). Detailed historical hypotheses
  and source provenance remain in their registers.
- Research artifacts: local `~/work/epistemics-pilots`; Pilot Q report in
  `results/pilot-q/report.md`, original readers frozen at `62a5aa5`, later parent
  adjudication at `12108e0`, both before identity reduction. Earlier human-case commit
  `5f186605d51693d237185cca05ee62fedb6cd8b3`; human case in
  `results/pilot-human-notes/report.md`, immutable baseline binding and closing
  record 017. Pilot P bindings are in J28. Do not alter frozen sources.
- Implemented: `scripts/belief-workflow/` portable playbook and explicit-input
  `snapshot/check/render/diff`. Assurance is cooperative record integrity, not a
  trusted authority service, semantic approval parser or typed justification engine.
- Saved during the human case: inert `joint-belief-framing` draft r2, get-verified;
  the portable bundle was not changed or installed. The separate agent-behaviour
  pilot draft is now r4, saved/get-verified during Q's instrument work, not installed
  and not a human-workflow result.
- The RTS case remains unfinished with its old-context Q20/C2/C5 scope conflict
  unresolved. Do not resume game work or transfer consent between examples.
- Field replay and further agent/human experiments are parked, not implied by
  this documentation request. Before any new test, name the capability, the
  framework decision its result could change, its independent assessment basis
  and its exit criterion. Faithful grounding/impact discovery—not more decoding
  of supplied annotations—is an outstanding research gap.

Pilot Q ended at its registered matrix; no outcome-conditioned extension, private
acceptance case, installation, deployment or push. The framework remains provisional:
procedural feasibility is not comparative
fidelity, sustained usability, reduced overload or end-to-end delivery validation.
