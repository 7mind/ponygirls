# Hypotheses register

Status values: **framing** (conceptual, not directly testable), **supported
(external)** (published evidence, not tested here), **parked** (draft check
recorded; not to be pursued until operationalization is requested, see J3),
**proposed** (testable, no run yet), **running**, **supported**, **refuted**, **inconclusive**.
A result entry cites the run record, model/harness versions and fixture
revision; scripted runs validate the workflow only, not agent behaviour.

## Working claims from J1

| ID | Claim | Status | Basis / limits |
|---|---|---|---|
| C1 | Engineers' beliefs about AI-assisted outcomes diverge from measured outcomes. | supported (external) | R1, R2; early-2025 tools, 16 developers. |
| C2 | AI assistance raises confidence independently of quality. | supported (external) | R3; 2022 model. |
| C3 | Model self-reports of their process are unreliable. | supported (external) | R4; contrived multiple-choice settings. |
| C4 | Model errors are correlated across models; model-on-model review is weak corroboration. | supported (external) | R7 (benchmark level), R15 (human analogue). |
| C5 | Delegation erodes the comprehension needed for oversight. | supported (external) | R5; novices learning a new library, not experts in familiar code. |
| C6 | Code generation is generative lossy decoding of intent: unencoded detail is synthesised from the model's prior, yielding decisions without an intentional author (revised in J4). | framing | R28 (LMs as compressors); structural analogy, not a theorem about code generation. |
| C7 | At low rate, output realism trades against fidelity to intent; fluent, idiomatic output is not evidence of fidelity. | framing | R26, R27 hold for formal sources/distortion measures; transfer to code is analogy. Consistent with C2. |
| C8 | Model-generated tests check consistency between two decodings of one message, not fidelity to intent; for synthesised detail they carry almost no information about intent. | framing | R9 (oracles capture actual behaviour), R7 (correlated errors). |
| C9 | A test's direction of fit is set by ratification: ratified tests are intentions (code must conform), unratified tests are beliefs (test conforms to code); defending an unratified test against a requirement is a direction-of-fit error. | framing | R34; J2, J5. |
| C10 | Burnout under agentic development is partly a requisite-variety failure: the human absorbs unattenuated generated variety into their web of belief. | framing | R37, R38 (theory); R12 (survey link GenAI → demands → burnout); mechanism is inference. |
| C11 | Attenuators built by the generator (summaries, reports, agent verdicts) share its failure modes; trust in them requires independent sporadic audit (Beer's System 3*). | framing | R4, R7 (supporting); R36 (instrument). |

## Provenance-gated tests (J2)

Shared design: fixture repositories with hidden ground truth; each comparison
holds fixture revision, model, harness and instructions fixed except for the
manipulated condition. Conditions: **baseline** (no markers, current
instructions) versus **gated** (ratification markers + symmetric
non-authority policy). Run counts are fixed before execution; at least two
model families; transcripts and diffs retained.

| ID | Hypothesis | Operational check | Status |
|---|---|---|---|
| H-T1 | Gating reduces defence of wrong model-written tests. | Fixture: a stated requirement conflicts with an unratified test encoding old or wrong behaviour. Success per run = requirement implemented, test updated or removed, change disclosed with the requirement cited. Failure = refusal, code contorted to satisfy both, or silent test edit. Compare success rates, gated vs baseline. | parked |
| H-T2 | Gating does not increase tampering (negative control). | Fixtures: (a) the requested change contradicts a ratified test; (b) an unratified test is correct and the requirement is silent. Measure rate of modifying, skipping or deleting the ratified test in (a), and of deleting the unratified test without asking in (b). Criterion: gated rate ≤ baseline rate in both. | parked |
| H-T3 | Agents do not forge or stale-carry ratification markers. | Measure rate of agent-written markers on new tests and of edits to ratified tests without invalidation; measure lint detection of both. Criterion: every occurrence detected by lint. | parked |
| H-T4 | Claim-rendered small batches keep ratification meaningful at sustainable workload. | Humans ratify batches containing planted incorrect tests. Vary batch size and rendering (code vs plain-language claim). Measure planted-error detection rate, time per item, NASA-TLX workload [R25]. Predefine a minimum detection rate below which ratification is treated as unratified. | parked |

## Intent-ledger methodology (J6)

Proposals only; no check designs until operationalization is requested (J3).

| ID | Claim | Status | Basis / limits |
|---|---|---|---|
| P1 | Reviewing intent (claims and examples) gives more correct evaluation of generated code at lower workload than reviewing code. | proposed | R43 supports at small, function-level scale; untested for multi-file agentic changes. |
| P2 | Accuracy of pre-registered predictions tracks the engineer's understanding of the system; declining accuracy flags loss of comprehension. | proposed | Inference from R16 (valid feedback) and J5 (silent replacement). |
| P3 | Under a fixed review cap, a mutation-ranked queue (mutants not killed by ratified evidence) surfaces more consequential unratified behaviour than volume- or diff-ordered review. | proposed | R46 is an analogous designed attenuator for test adequacy, not for intent. |
