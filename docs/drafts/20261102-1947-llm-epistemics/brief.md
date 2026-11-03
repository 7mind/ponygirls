# Brief — epistemics of LLM-accelerated development (2026-11-02 … 11-03)

Status: summary of journal entries J1–J23 for the user and the next agent;
J21–J22 clarify the framework; J23 records real-task intake/framing, not new
acceptance or efficacy results.
Source of truth for every claim: [journal](journal.md), [hypotheses](hypotheses.md),
[references](references.md), the [design draft](belief-dag-design.md), the
[validation-frame proposal](belief-network-validation.md), the
[joint-construction proposal](belief-network-construction.md) and the pilot repository `~/work/epistemics-pilots` (local git, `main` at `3768c9e`).

## 1. Problem

An engineer writes a short prompt; an agent expands it into far more code
than a person can absorb. The prompt is a low-rate encoding of intent, and
generation is lossy, generative decoding: most details in the code are
defaults sampled from the model's prior that nobody decided (J4). Engineers
try to restore justified belief by reading the expansion and burn out (J2,
J5). The question is how to keep the engineer's understanding accurate and
their load bounded while agents do most of the work.

## 2. Thesis and hypotheses

- **Explicit epistemology** (J1): track who vouches for what — observed vs
  inferred vs assumed, human-ratified vs model-produced. Generated artifacts
  carry no authority over intent until a human ratifies them.
- **Belief-level interface** (J10, J21, design draft): human and agent jointly
  construct a compact, high-level belief DAG — goals R, domain assumptions W, key
  decisions, obstacles and their resolutions [Zave–Jackson, KAOS, GSN]; agents
  own the hidden refinement into spec, code and evidence. Hiding the spec is
  sound only if the belief→spec links are checked by channels independent of
  the generator.
- **Joint construction** (J22, proposed): ask about differences that could
  change later acceptance, not every implementation choice. Preserve positive
  success obligations as well as safety, broad goals above examples, known
  material obstacles, and the distinction between required and checked scope.
  No human trial establishes that this achieves useful compression.
- **Cybernetic framing** (J5): Quine's web of belief tested by generated
  artifacts; Beer's variety engineering — designed attenuation upward,
  amplification downward, sporadic audit (System 3*) and alarms.
- Operational hypotheses tested: provenance gating of tests (H-T1–T3),
  level mismatch (H-T5), generator instructions and framing (H-O1, H-T6,
  H-T7), independent refinement (B2), ratified scenarios (B3), plus the J16
  recombinations (pilots 1–7).

## 3. What was validated (feasibility pilots; 1–2 model families, n = 3–5 per cell)

Subjects: gpt-6.1-sol (xhigh) throughout; employer-hosted DeepSeek-V4-Pro
(high) from Pilot E on. Isolated pi in a bubblewrap sandbox, hidden oracles,
pre-registered protocols, scorer validation committed before runs.

| Claim | Evidence | Verdict |
|---|---|---|
| Agents let concrete artifacts outrank stated intent | Field instance 2026-10-23 (Sol, user's full rules): no-wake paths called "deliberate … the existing tests check that it does"; DeepSeek reproduces it in fixtures (Pilot E, R, DF), Sol does not (0 of ~40 runs) | real, model-dependent; Sol's field failure not reproduced |
| Provenance tags protect human intent | ticket vs human-approved test: rewritten 5/5 without tags, 0/5 with tags, escalated instead (Pilot A, two batches) | **supported** (strongest result) |
| Tags cause tampering, discarding, forging | none in 40 gated runs | **no side effects seen** |
| Ratification rule stops the defence | defence moved into narrowing the belief's scope (Pilot E) | **not alone** |
| Ratified scenarios stop narrowing | failure too rare in the control batch (Pilot 7) | inconclusive |
| Bounded elicitation discloses defaults | 67/72 planted decisions named, all consistent (Pilot B); upper bound | supported, caveated |
| A second model family exposes ambiguity | disagreements fall on unstated parts of a belief (Pilot E2); within Sol 1/24 points flagged, cross-family 9, 13/24 hidden by shared conventions (Pilot 3) | **supported**; shared conventions are the blind spot |
| Mutation-ranked review queue | 29/72 planted points; blind to omissions (Pilot C) | weak |
| Agent tests witness beliefs | partly; strongest crash tests coupled to internals (Pilot 1) | **weak evidence** |
| Perturbation finds hidden assumptions | concurrent writers/readers broke all DeepSeek stores (Pilot 2) | **supported** |
| Auditor role catches defences | DeepSeek flagged as auditor every defence it wrote as author; Sol 10/10 (Pilot 5) | supported, confounded with enumeration |
| Theory recoverable from artifacts | 22/24 strict; experimenting readers found latent defects (Pilot 6) | **supported** |
| Scenario selection by disagreement | beats own and random picks (Pilot 4) | supported, partly circular |
| Rationale framing changes behaviour | no detectable effect; rules dominate (Pilot R) | not supported (n = 3) |
| User's rules / direction-of-fit clause | no increase in defence under the rules; clause effect not measurable (Pilot DF) | not supported (n = 5) |
| Human-side NASA-TLX | uniform ratings in a trial | instrument rejected |

**Pattern across pilots:** what worked supplies a channel independent of the
generator's own account — perturbation, a second family, an auditor role, a
fresh reader who experiments. Self-description and self-testing are weak.
**Untested:** whether any of this reduces the engineer's overload.

## 4. Instrument lessons (the experimenter is a generator too)

Nine instrument defects, all corrected openly (protocol amendments, original
codings kept): pytest missing from the subject PATH; narrow disclosure terms;
strengthening vs weakening of tests; a scorer contradicting its protocol;
a fixture whose wording suppressed the behaviour (E1); keyword false
positives; a too-lenient liveness oracle (found by Pilot 5 auditors); a
too-narrow crash harness (found by Pilot 6 readers; E2 corrected 6/6 → 4/6
atomic); unlabelled secondary codings in two write-ups (found by independent
reviews, J9, J12). The skill draft `agent-behaviour-pilot` (Haystack r2)
captures the procedure.

## 5. Current focus and parked options

Item 1 is the current direction. Items 2–5 are earlier proposals, not newly
authorized by Q17/Q18; no field replay or policy-tool implementation is underway.

1. **Real-task manual framing (Q18, J23; current phase).** The user supplied a
   complete Warcraft-II-inspired web RTS as the task and requested a feature/
   mechanics inventory first. Separate workspace:
   `/home/pavel/work/warcraft-inspired-rts`. Its README links 63 candidate feature
   entries and a five-goal proposed belief network. No game code exists; final
   modes/content, the acceptance envelope and human attention ceiling await
   agreement (Q19–Q21; read current answers before acting). Private human cases
   remain unknown. This is a larger task than the bounded component envisaged;
   do not silently redefine the final target as a small demo. The
   [validation-frame](belief-network-validation.md) and
   [construction](belief-network-construction.md) notes supply proposed methods,
   not evidence that the tryout works. Autonomous work begins only after joint
   baseline agreement; no deployment or push. Source hashes/provenance are in J23.
   The external planning files are not versioned by ponygirls.
2. **Field replay** (agent side): ponygirls just before commit `c1bb530a`
   ("ponygirls-bg-tasks: completion notices never wait for user input"), the
   original prompt verbatim (session
   `~/.pi/agent/sessions/**/2026-10-23T13-54-49-396Z_01a1690a-f9b3-7*.jsonl`),
   the user's full global prompt (AGENTS.md, operating manual, skills, MCP
   where possible), real tests; Sol and DeepSeek. Ground truth: the fix
   commit's tests. Explains why Sol failed only in the field (session length,
   real repo, baseline-test-first investigation).
3. **Workflow integration (parked proposal):** cross-family audit and a
   "fresh reader who experiments" step; environment perturbation for stated
   assumptions; scenario selection by cross-family disagreement. These have
   agent-side feasibility evidence, not validation of the human acceptance
   workflow.
4. **Policy proposals (parked):** test provenance with escalation on conflict
   (Pilot A); reports naming changed tests with old and new assertions;
   tests, docstrings and measured behaviour do not establish intent.
5. Lower priority: retest B3 with a batch where the control fails reliably;
   larger n only for effects that matter to decisions.

---

## Handover to the next agent

**Read first, in order:** this brief; `journal.md` J23 (current task/status),
then J21–J22 (framework) and J16–J19 (latest experiments); `belief-network-validation.md` and
`belief-network-construction.md` (conceptual proposals); `hypotheses.md` (status column); `belief-dag-design.md` §5, §6, §11; the
pilot repo `README.md` and `protocols/pilot-e.md`, `pilot-5-7.md`.

**Where things are**
- Research record: `docs/drafts/20261102-1947-llm-epistemics/` in ponygirls
  (`journal.md` append-only — corrections are new entries that name what
  they correct; `references.md` with provenance per source: fetched /
  search-observed / from memory; `hypotheses.md`).
- Experiments: `~/work/epistemics-pilots` (`protocols/`, `fixtures/`,
  `runner/`, `results/`, `human/`). Runners: `pilot_a.py` (helpers, sandbox,
  scratch `/tmp/epi-runs`), `pilot_e.py` (subjects, `pi_phase`, liveness and
  atomic-store fixtures, `--rescore`), `pilot_r.py` (modality metrics),
  `pilot_5.py`, `pilot_12.py`, plus subagent-built `pilot_3/4/6/df` runners.
  Every runner has a committed `validate_scoring_*.py`; run it before trusting
  a rescore.
- Human-side tools: `human/ratify_session.py` is the historical P-D instrument,
  not a primary assessment of the current acceptance outcome. No replacement
  instrument is specified. `human/pf.py` is a prediction log; predictions and
  explain-back remain possible diagnostics. Data in
  `~/.local/state/epistemics-pilots/`, never committed.
- Skill draft: Haystack `corporate-activity:skill-draft-agent-behaviour-pilot`
  (r2, human-attention required). Pending amendment: experimenter oracles must
  vary inputs (equal sizes, repeated faults) and be audited by an independent
  channel (Pilots 5, 6).

**How subjects run** (keep this; it was verified repeatedly): `runner/sandbox.sh`
(bubblewrap: empty `$HOME`, writable run dir, `~/.pi/agent` read-write with
sessions/subagents/decisions masked); `pi -p -a -nc -ne -ns -np --no-mcp`;
condition text in the workspace `.pi/APPEND_SYSTEM.md`; `.pi/settings.json`
`shellCommandPrefix` restores the pilot Python (pi's Nix wrapper otherwise
hides pytest); DeepSeek needs `-e <tokenfactory-pi extension>` and
its provider API key in the environment (the variable the extension documents). Verify each new condition from the
persisted system message in the session JSONL. Never place `hidden/` files in
a subject workspace.

**Conventions and constraints**
- The ponygirls commit hook rejects the employer's company name in committed
  text; write "employer-hosted".
- Work in a git worktree per change (`.worktrees/wt-<repo>-<slug>`), commit,
  fast-forward merge, remove the worktree. Nothing has been pushed; do not
  push without an explicit request.
- Ask decisions through the `decisions` tool; do not build before the user
  asks (they redirected once, J3). Tokens and model usage are not budget
  constrained for this work (user statement, Q10).
- Report every number with its coding; distinguish observed from inferred;
  read runs before trusting unanimous or extreme results; have an
  independent channel (subagent review, cross-family audit) check
  write-ups — two overclaims were caught that way.
- Delegating whole pilots to writer subagents worked well (pilots 3+4, 6,
  DF) with a precise spec and the discipline list above; re-run their
  validation scripts after merging.

**Open items for the user**
- Stored Pilot DF sessions contain the user's skill files (read by Sol,
  about 8.8 MB, local repo only): the user decided to keep them (nothing to
  redact, 2026-11-03).
- Q18 authorized one manual real-task tryout; the RTS is at intake/framing only.
  Read Q19–Q21 for mode/content scope, proposed outcome ratification and active
  human-attention ceiling. Do not start code based on pending questions.
- The unresolved research question remains how dialogue selects material
  contrasts without sharing the generator's omissions or recreating
  specification overload. No acceptance or tractability result exists yet.
