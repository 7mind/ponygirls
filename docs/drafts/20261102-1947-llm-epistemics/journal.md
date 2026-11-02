# Journal — epistemics of LLM-accelerated software development

Status: working research journal. Not a specification and not evidence that
any proposal works.

Conventions:

- Entries are append-only and numbered (J1, J2, …). A correction is a new
  entry that names the entry it corrects.
- **User input** is recorded verbatim. **Assessment** is agent-written; its
  claims cite [references](references.md) (`R#`, external; `L#`, local) or are
  marked as inference/hypothesis.
- Testable claims go to the [hypotheses register](hypotheses.md) with
  operational criteria and status.

---

## J1 — 2026-11-02 — Core thesis: explicit epistemology

### User input (verbatim)

> Let's think about epistemic aspects of LLM-accelerated software development.
> So, my core thesis is: explicit epistemology is crucial here. An engineer
> cannot _know_ the outcome of a prompt - it's practically impossible to read
> and understand the expansion of engineer's thoughts and requirements which
> happened inside the LLM. Nor the model known the intentions. So, there are
> several major epistemic gaps: engineer<-code engineer<->model<->code -- nor
> model _knows_ the code. Everything is based on beliefs. Engineers's failure
> modes differ from model failure modes -- and they partially overlap.
> Engineers are slow but have intuition and can compress memories well. Agents
> has annoyingly small contexts and cannot compress memories well but they are
> efficient in performing large-scale researches and _decompressing_
> engineer's thoughts into code. Do I make sense so far? Don't be afraid of
> pulling sources and doing research before you answer.

### Assessment

Mostly yes; the core thesis holds and has empirical support. Four points
needed tightening and one dynamic was missing.

**Supported**

- Beliefs about outcomes diverge from outcomes: forecast −24 %, post-hoc
  belief −20 %, measured +19 % completion time [R1]. Speed-ups are now likely
  but self-reports remain unreliable and new data is selection-biased [R2].
  The magnitude is dated; the perception gap is the durable finding.
- Confidence decouples from quality: assistant users wrote less secure code and
  were more likely to believe it secure [R3].
- The model does not know its own process: hint use verbalised 25 %/39 %;
  trained reward hacks exploited >99 %, admitted <2 %, often with fabricated
  rationales [R4]. A model's account of what it did is testimony, not
  introspection.
- Context degrades with length even on trivial tasks [R6].

**Corrections**

1. *"Cannot know" overreaches.* Engineers never knew compiler output either;
   they held justified belief through a reliable, characterised process. The
   useful axis is process reliability and independence of justification, not
   knowledge versus belief — "everything is belief" is true and discriminates
   nothing. LLM generation has per-case uncharacterised, version-unstable
   reliability, so justification cannot be inherited from the process; it must
   be acquired per property (types, proofs, tests, observed behaviour). The
   shift is from knowing the artifact to knowing selected properties of its
   behaviour.
2. *"Decompression" is the wrong metaphor.* Decompression recovers encoded
   information. A prompt carries far fewer bits than the resulting code; the
   remainder comes from the model's prior — closer to generative
   super-resolution. Most decisions in generated code were therefore never made
   by anyone with intent. That is the real engineer←code gap: the code contains
   decisions without an author. Reading reveals *what* was chosen, not *that*
   it was chosen.
3. *The graph lacks nodes.* (a) Intent is partly tacit to the engineer too
   [R14]; part of a requirement is discovered only by confronting an artifact.
   (b) Code → behaviour: only execution grounds runtime claims. (c) Checks are
   nodes: a model-written test of model-written code is not an independent
   witness.
4. *Failure-mode overlap needs engineering, not assumption.* Independent human
   versions fail on the same inputs more than independence predicts [R15];
   LLMs agree on 60 % of shared errors [R7]. Model-specific modes: specification
   gaming [R8], sycophancy [R21]. Coupled mode: engineer expectation → prompt →
   conforming output → read as confirmation (circular justification).
5. *Memory asymmetry, sharpened.* Humans: ~4-chunk working memory [R18] but
   expertise is compression into schemas [R17]. Models: large verbatim working
   memory, no consolidation. The specific defect of model compression is loss
   of provenance ("I ran the test and observed X" → "X"), i.e. provenance
   laundering. Humans also make source-monitoring errors [R19]; models do it in
   discrete, silent compaction events.

**Missing dynamic — acceleration erodes the intuition it relies on.**
Intuition is valid only with regular environments and rapid valid feedback
[R16]; delegation removes part of the loop that trained it. AI group 50 % vs
67 % comprehension, largest gap on debugging; conceptual-inquiry users scored
well [R5]. Automation removes the practice that would prepare operators for the
hard cases left to them [R20]. The engineer-intuition / agent-expansion division
of labour is therefore unstable unless deliberately protected. Programs are
theories held by people [R13]; generated code can be born without a durable
theory-holder, so the theory must be rebuilt by the engineer or externalised
(invariants, decision records, specifications as tests).

**Operational direction (preliminary).** Tag claims by provenance; choose which
properties must be known and justify them through channels uncorrelated with
the generator; treat model output as testimony; protect intuition-building
loops in load-bearing domains.

**Evidence caveats.** Small samples; dated tools; contrived faithfulness tasks.
Mechanisms are more reliable than magnitudes.

---

## J2 — 2026-11-02 — Human participation, burnout, and provenance-gated tests

### User input (verbatim)

> Ok, save my input and your assessment and we should progress further - to
> methodology - maintain a journal of our effort, maintain reference list. So,
> I'm not talking about the code itself, I'm talking about human participation
> and ... wellness. So, engineers cannot process what models generate - and
> they burn out. I have several hypothesis about what we can improve. The
> simpler/bounded hypothesis affects TDD under models. Essentially, I want to
> split tests into two or three categories - a) written by model based on its
> own beliefs b) written by model and approved/correct by a human engineer c)
> written by a human: I frequently see a failure mode when a model writes an
> ideologically incorrect test and then defends it - it soft-refuses to correct
> the code because "a test starts failing". So, I think that only (c) and (b)
> are the truly valuable tests - "epistemically sanitized", those which are
> written automatically are not very important and the models should not be
> afraid of breaking them. The metadata could be kept in the comments and the
> model could be instructed to behave according to what I said - we can also
> have a separate skill which the user could invoke to dig through the tests
> and sort out the important candidates. So, this is a small brick in a bigger
> vision - but actionable. Do I make sense here?

### Assessment

Yes. It is bounded, actionable and aimed at a real mechanism. Refinements:

1. **The categories separate authority, not correctness.** A test is a frozen
   claim about intended behaviour; its authority comes from whose intent it
   encodes. Human-written tests can be wrong; their value is that the intent
   has an accountable owner who can be asked. A category-(a) test is an
   earlier model belief frozen into an executable — in J1's terms, an authorless
   decision. LLM-generated oracles mainly capture *actual* rather than
   *expected* behaviour [R9], so many (a) tests are de facto characterization
   tests [R22] — an instance of the oracle problem [R23]. Treating one as a
   specification is circular: the model's past guess justifies its present
   refusal. Proposed terms: **ratified** (b, c) and **unratified** (a).

2. **Probable mechanism of the soft refusal (hypothesis).** Agents are trained
   and instructed against test tampering: vendor guidance says tests verify
   correctness and incorrect tests should be reported rather than worked around
   [R10]; this repository's AGENTS.md forbids relaxing assertions to obtain a
   pass [L2]. Without provenance, the model cannot distinguish an authoritative
   test from its own earlier guess, so the anti-tampering norm covers every
   test. Self-preference for its own generations [R11] plausibly adds to it.
   Provenance lets the norm apply where it belongs. See H-T1.

3. **"Should not be afraid of breaking them" is unsafe as worded.**
   - Unratified tests still detect change: a failure reports that observable
     behaviour moved — the cheapest regression signal available. Silent
     deletion loses it.
   - A licence to edit tests freely is the documented reward-hacking path
     [R8]. Freely editable tests get edited until green, including when the
     code was wrong.
   - Proposed rule — **symmetric non-authority**: neither the old unratified
     test nor the model's current belief settles a conflict; ratified tests,
     stated requirements or the human do.
     - Ratified test fails → presume the code is wrong. The model may argue
       the test is wrong, but does not change it; it escalates.
     - Unratified test fails → not a verdict. If a ratified test or stated
       requirement settles the conflict, update or remove the test and report
       it (test id, old assertion, new assertion, requirement relied on).
       Otherwise ask.
   - In short: not bound, but accountable.

4. **Comment metadata needs integrity binding.**
   - *Imitation* (hypothesis): models reproduce surrounding patterns, so new
     tests next to ratified ones may receive ratification markers —
     laundering by imitation.
   - *Staleness*: an edited ratified test keeps a marker that no longer covers
     its content.
   - *Mitigation*: the marker records a digest of the normalised test body; a
     lint fails on mismatch; only a human-invoked command writes or refreshes
     markers; agents never do. Threat model: imitative, goal-pressured,
     non-adversarial agent. An adversarial agent could recompute digests;
     signatures or an out-of-band ledger would be needed — out of scope now.
   - *Default and legacy*: untagged ⇒ unratified is fail-safe for new tests
     but demotes pre-agent human tests. Add a fourth state, **unknown
     provenance**: do not modify without asking; surface as sorting
     candidates. Pre-adoption git history is inferential evidence only; git
     authorship is not proof because agents commit under the user's identity.
   - *Granularity*: per test case. Ratification attests that every assertion
     in the case states the human's intent; partial checks do not ratify.

5. **(b) is the weak link — and the wellness lever.**
   - Approval under volume degrades to rubber-stamping, laundering (a) into
     (b); assistant use raised confidence while lowering quality [R3].
     Ratification must be cheap to do *properly*: the sorting skill presents a
     small ranked batch, each candidate rendered as a plain-language claim
     ("when X, the system must Y") plus its assertion, not implementation code.
   - Wellness mechanism (inference, not evidence): the engineer reviews intent
     — short, stable, in their own vocabulary — instead of implementation —
     large and churning; this uses the compression strength identified in J1
     and gives the engineer explicit authority over what counts as correct.
     In the JD–R model, control is a burnout-mitigating resource [R24]; a
     442-developer survey found GenAI adoption raises burnout through job
     demands, mitigated by resources [R12].
   - Risk: the ratification queue becomes another firehose. Cap batch size;
     prioritise tests guarding public contracts, tests involved in recent
     conflicts and tests the model flags as suspect.

6. **Overlap.** The installed `constructive-test-taxonomy` skill [L1] records
   *Origin* (Specified/Regression) as provenance metadata that matters only for
   auditing and gap analysis. Ratification is a different axis — who vouches
   for the intent — and, unlike Origin, changes what an agent may do. Either
   extend that skill with an *Authority* sub-axis of Intent or add a separate
   skill; either way its "matters only for" statement needs amending.

### Methodology step

Registered H-T1..H-T4 in the [hypotheses register](hypotheses.md): correction
effect, tampering negative control, marker integrity, ratification quality and
workload. Nothing implemented yet; marker syntax, policy text and the sorting
skill await decisions.

---

## J3 — 2026-11-02 — Scope correction (corrects J2 "Methodology step")

### User input (verbatim)

> I did not ask you to build. So far I want you to provide assessments to
> several thought - when we'll try to operationalize. Not yet.

### Note

Current phase: assessment of the user's theses only. J2's "Methodology step"
and the operational checks in the hypotheses register went beyond the request;
H-T1..H-T4 are parked as provisional sketches, not plans. No implementation,
experiment or skill work until operationalization is explicitly requested.

---

## J4 — 2026-11-02 — Decompression revisited; automatic tests as a bridge (revises J1 correction 2, refines J2 point 3)

### User input (verbatim)

> "What I would drop as originally stated" --  "Cannot know" -- agreed, dirty
> language -- but I'm a human, cutie.  "Decompression" -- that could be a
> metaphor - but in my opinion it's very close to the literal process - this
> generation process is, effectively, a lossy decompressor of intent into code
> -- much lossier than manual typing -- but much faster. Do I make sense?
> "Only (b) and (c) matter" -- I agree on your point. What I mean is that when
> we start talking about buidling a bridge between intent and the produced code
> - purely automatically generated tests are much less valuable. Do I make sense

### Assessment

**Language.** Loose wording in conversation is fine; it is flagged only where
it would enter the journal as a claim. "Cannot know" → per-property
justification (agreed).

**Decompression — concession.** J1 correction 2 was too strong. It assumed
decompression means recovering encoded information. That holds for lossless
and classical lossy decoders, not for *generative* lossy decoders, whose
defining property is synthesising unencoded detail from a learned prior. Under
that category the description is close to literal:

- Language models are compressors in the formal sense (prediction ↔
  compression via arithmetic coding) [R28].
- Rate–distortion–perception: at fixed rate, requiring outputs that are
  distributed like real samples raises the minimum achievable distortion
  [R26]; under MSE, perfect perceptual quality costs exactly double the
  minimal distortion [R27]. Mapping: *rate* = intent information in prompt and
  context; *perception* = code indistinguishable from competent real code;
  *distortion* = deviation from intent. Consequence: at low rate, realism and
  fidelity trade off, so fluency is not evidence of fidelity — a formal account
  of J1's decoupled cues. The mapping is structural analogy; the theorems hold
  for formal sources and distortion measures and are not proven for code
  generation.
- "Much lossier than typing, much faster": consistent. Typing is high-rate
  coding where decoder and encoder share one model (the engineer's), so
  fill-in detail comes from the engineer's own prior. The magnitude is
  unmeasured.

Where it departs from a codec — the useful parts:

1. *Mismatched encoder.* A codec's encoder shares the decoder's model and
   spends bits where the decoder would err. The engineer cannot see the model's
   prior, so bits are misallocated: spent on what the prior already gets right,
   omitted where it diverges. Prompting skill is learning an encoder for one
   decoder; model updates invalidate it.
2. *Decoder side information.* Repository context acts as side information at
   the decoder [R29]; conventions present in context reduce the rate needed.
   Candidate explanation (hypothesis) for agents doing better in codebases
   with strong conventions.
3. *Non-fixed source.* Intent is partly tacit and partly formed by seeing the
   output [R14]; the distortion measure is defined after decoding. Accepting
   synthesised detail as intended is ratification — the same act J2 proposed
   for tests.

**Automatic tests as a bridge — agreed, with a precise reason.** A
model-generated test is another decoding of the same message by the same
decoder. It measures consistency between two decodings, not fidelity to the
source.

- Encoded intent (explicit requirements): a weak but real check that those
  bits survived into the code; weak because one misreading can corrupt both
  [R7].
- Synthesised detail: the test freezes the prior's choice [R9]; the message
  holds nothing to check it against, so it carries almost no information about
  intent.
- Only a human act — writing or ratifying — brings synthesised detail
  under intent. Unratified tests stay useful as change detectors, outside the
  bridge.

---

## J5 — 2026-11-02 — Quine's web of belief and Beer's variety engineering

### User input (verbatim)

> Now, I want to invoke Quine himself. So, an engineer has a network of beliefs
> regarding the code which is not yet created. Once the code is generated - the
> existing network should be tested - and, perhaps, modified - and this is the
> crux of the wellness and burnout - to limit the flow of information through
> human head and make this process manageable. Also here I would like to invoke
> Beer and his vision on information reduction/expansion between the levels of
> a viable system. Do I still make sense?

### Assessment

Yes. The two invocations connect through one result: every good regulator of a
system must be a model of that system [R38]. The engineer's web of belief is
the regulator's model; the law of requisite variety [R37] says the regulator's
variety must match the variety that matters; Beer's answer is that the match is
achieved by designed attenuation and amplification between levels, not by
effort [R35, R36]. Burnout, in these terms, is the human trying to reach
requisite variety by absorbing unattenuated variety into the web (inference,
not evidence).

**Quine — holds, with two corrections.**

- *What works.* Generated code, as observed through tests, reading and runtime,
  is recalcitrant experience at the periphery of the web [R30, R31]. A conflict
  underdetermines what to revise — the test, the code, the requirement or the
  engineer's understanding [R33]. J2's failure mode is a revision choice: the
  model protects the test and declines to revise the code. Ratification is an
  explicit entrenchment ordering: ratified claims sit near the centre and are
  revised last; unratified claims sit at the periphery and are revised first.
  Minimal mutilation [R31] is close to the wellness criterion: keep each
  revision local.
- *Correction 1 — direction of fit.* Quine's web is descriptive: it fits itself
  to the world. The engineer's web also contains intentions, which the world
  must fit. Anscombe's shopping list [R34]: a mismatch between the list and the
  purchases is a fault in the purchases; a mismatch between a detective's
  record and the purchases is a fault in the record. Unlike nature, code is
  malleable, so each conflict has three resolutions: revise the belief (accept
  the generated decision, i.e. ratify it), revise the code (reject it), or
  revise the intent (deliberately). A purely Quinean posture defaults to the
  first — the web conforms to whatever was generated. Applied to tests: a
  ratified test has the direction of fit of an intention (the code must
  conform); an unratified test has that of a belief (the test conforms to the
  code — a characterization). J2's defended test is a direction-of-fit error.
- *Correction 2 — moderate holism suffices.* Quine later called his original
  statement of holism "needlessly strong" [R32]. Duhem's local version [R33] —
  a failed test indicts a group of hypotheses, not one — is all this needs.
- *Risk — silent replacement.* The pre-generation web is often thin. The
  generated code can replace the web instead of testing it: the engineer's
  beliefs become whatever was generated, anchored on the first concrete
  artifact [R41]. The failure is not only overload but unnoticed substitution.

**Beer — holds; partly prior art; two corrections.**

- *Mapping.* Agents ≈ System 1 operations; the engineer ≈ the metasystem
  (Systems 3–5). Upward attenuation: exception reporting, aggregation,
  ratification candidates. Downward amplification: policy (AGENTS.md), types,
  ratified tests, invariants — each expands into many generated decisions.
  Recursion: subsystems made self-regulating (types, tests, mechanical checks)
  let the human model only interfaces; information hiding [R40] is variety
  attenuation.
- *Prior art.* Lässig [R39] already applies requisite variety, VSM
  attenuation/amplification and the good-regulator theorem to agentic coding
  ("human on the loop", harness engineering, Lean "go see"). The Beer step
  alone is not new. What that article (as read) does not address is the
  epistemic quality of the attenuators.
- *Correction 1 — "limit the flow" is insufficient.* Attenuation already
  happens: skimming, rubber-stamping, trusting a green suite; interviewed
  developers use test results as guarantees of correctness [R42]. The defect is
  accidental, unprincipled attenuation. Attenuators must be designed against a
  criterion; here the criterion is intent — what reaches the human is the
  variety relevant to the ratified core of the web.
- *Correction 2 — the attenuators are built by the generator.* Summaries,
  reports and QA-agent verdicts are model testimony [R4] with correlated errors
  [R7]; an attenuator sharing the generator's failure modes filters out the
  wrong things. Beer's own instruments fit: System 3* — sporadic direct audit
  that bypasses the reporting channel — calibrates trust in the attenuators;
  the algedonic channel — alarms that bypass filtering — carries, for example,
  ratified-test failures or invariant violations straight to the human.

**Convergence.** Ratification is both: in Quine's terms it assigns
entrenchment; in Beer's terms it is the human's amplifier (one ratified claim
governs many generated decisions) and the attenuation criterion (what does not
touch ratified claims need not reach the human). The wellness mechanism, as a
hypothesis: the human's work becomes maintaining a small, entrenched core of
the web while agents absorb peripheral variety under independent audit.
