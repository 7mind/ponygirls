# Code-quality review skill: design draft v0.6

Status: concluded, 27 Nov 2026 (decision Q222). The skill is a draft, v0.6,
in `20261127-1001-code-quality-review-skill/SKILL.md` (one file, as
`nix/pkg/llm-skills` packages skills); `measure.py` beside it is the script
embedded in the skill, byte for byte. It is not installed. Versions 0.3, 0.4
and 0.5 were each run once on this repository (sections 10, 12 and 13); v0.6
is a trim with the rules those runs called for and has not been run.

Outcome of the review itself: there is little to remove. Confirmed changes
were 0.2% to 1.2% of the production lines read in each run, about 1,000
production tokens in all for about 267 USD as the harness reports cost. Of
the eleven real changes that measured spikes confirmed, eight are on main
(33 production lines and 721 tokens; section 15), one was dropped when
another session's refactor took over its code, and two were left out as too
small. Section 14
lists what was found and not applied.

This note is a chronological record. Sections 1 to 9 are the proposal as it
stood before the first run and were not rewritten afterwards; the runs, the
tuning log and the state follow from section 10 on.

## 1. Task

Review haystack, manure and chronicle for bad abstractions and copy-paste, by
a structured procedure that becomes a reusable skill. Sketch given: several
lenses (abstraction quality, missing abstractions, under-generalization,
under-reuse of own and library code, under-use of DI), possibly one subagent
per lens with a supervising session reconciling, proposals framed as
hypotheses and tested before they enter the working set, lines of code as the
optimization metric, and a possible generalization to performance, security,
readability, idiom and conventions.

## 2. What the target looks like (measured, read-only)

Commit `e44b2924`; `chronicle`, `haystack`, `manure`, `shared`; tracked regular
files; generated code, the vendored Baboon runtime and two generated data
tables excluded. Counted by the draft's `measure.py`.

| Tree | Production lines | Production tokens | Test lines | Test tokens | Bytes |
|---|---:|---:|---:|---:|---:|
| chronicle | 33,312 | 704,462 | 43,063 | 1,021,434 | 6.7 MB |
| haystack | 10,834 | 225,667 | 11,036 | 257,574 | 1.7 MB |
| manure | 17,112 | 269,998 | 23,033 | 413,803 | 2.7 MB |
| shared | 7,954 | 151,877 | 7,403 | 138,000 | 1.2 MB |
| total | 69,212 | 1,352,004 | 84,535 | 1,830,811 | 12.2 MB |

Three observations decide parts of the design.

**Literal copy-paste is nearly absent.** `jscpd` 4.3.0 at 50 tokens and 6
lines reports 285 token-identical clones covering 2,502 of 175,420 lines
(1.43%). Production code holds 33 of them (328 lines, about 0.5% of production
lines, several inside the vendored Baboon runtime); tests hold 252. Only three
production clones cross a service boundary (25 lines). A first run, at
stricter thresholds, reported 2.6% because the detector followed five
symbolic links from `manure/web` into `shared/` and read generated code that
lives outside a `generated/` directory; both are false positives a naive
audit would report as its headline finding.
So if duplication is a problem here, it is independent re-implementation of
the same thing, which a token detector cannot see and only reading finds.
The review's yield is therefore uncertain, and the procedure has to be able
to end with "little found" without inventing work.

**Lines are a poor size measure for this code.** No formatter is configured.
By language and role, the 90th-percentile code line is 109 (Python tests) to
163 (JavaScript tests) characters long and the 99th is 160 to 368; the
longest production lines run from 1,163 to 8,342 characters; a line carries
11 to 21 lexical tokens on average. A line count would reward joining lines
and already understates this codebase.

**The same concepts exist in every service.** A regex index of definitions
finds 338 names defined in two or more of the four trees (noisy: many are
generic). The families behind them are plain: `Auth.scala`, `Http.scala` and
`Main.scala` in all three services beside `shared/service-auth`; `Mcp.scala`
in two; `account.ts` in two CLIs; `ConfirmDialog.tsx` in two web clients;
`failureText` in five TypeScript and JavaScript files; `isObject` in three.
These are leads, not findings: nobody has compared them yet. distage is in
the dependency set; 13 production Scala files mention it or its `ModuleDef`,
`Injector` or `Lifecycle`.

Reading cost: bytes ÷ 3 gives about 4 million model tokens of distinct text
for one full read of the four trees. Every additional independent read costs
that again, and the input a provider counts is a multiple of it, because each
tool call sends the accumulated context again (mostly as cache hits).

## 3. Prior art and what it contributes

Evidence level: *read* = the prompt or the cited passages were read in this
session; *abstract* = only the abstract or the publisher's summary; *via* =
cited through another paper; *memory* = not looked up again.

| Source | What it does | Taken into the draft |
|---|---|---|
| Anthropic `code-review` plugin (read) | Four parallel reviewers on one pull request, then one validation subagent per reported issue; an explicit list of false-positive classes; quality concerns excluded on purpose | Validation as a separate step by a separate agent; skip lists per lens |
| Claude Code `/simplify` (second-hand descriptions only) | Three parallel agents (reuse, quality, efficiency) on recently changed files, fixes applied at once | The reuse/quality split; not its lack of a test before applying |
| Anthropic `code-simplifier`, `type-design-analyzer` (read) | Single-purpose agent prompts; the simplifier warns against trading clarity for fewer lines | Density and readability as things a saving may not be bought with |
| desloppify (read: skill, 19 of its 20 dimension prompts, four review prompts) | Mechanical detectors plus LLM review per "dimension", each with `look_for` and `skip` lists; signals are "navigation aids, not evidence"; devil's-advocate stage with a required counter-case; anti-gaming rules around a score target | Lens cards with look-for and skip lists; leads as navigation aids; the remaining risk a refuter must state even when it does not refute |
| Refute-or-Promote, arXiv 2604.19049 (read) | Adversarial stages, reviewers without the proposer's reasoning, cross-family critic, mandatory empirical gate. 79% of 171 candidates killed. More than 80 agents endorsed a vulnerability that did not exist; one executed test killed it | "Agreement is not evidence"; withheld fields; another model family for refuters; measurement as the only route to `confirmed` |
| OpenCodeReview, arXiv 2608.09290 (read) | Deterministic choice of files and criteria; a reflector that sees less than the reviewer and may only delete comments the evidence contradicts | Refutation needs a concrete counterexample, doubt does not kill; mechanical dispatch and admissibility checks |
| Liu et al., arXiv 2411.04444 (read) | On 180 real refactorings an LLM found 15.6% of the opportunities from a bare prompt and 86.7% when the refactoring subcategory was explained and the search space narrowed; about 7% of suggested solutions changed behaviour or did not compile | Narrow lenses with named sub-kinds and one partition per pass; spikes that compile and test |
| RepoReuse, arXiv 2609.35357 (read) | Agents re-implement code they have seen: self-reuse falls from 83.9% to 69.1% over five turns although recall is saturated, and half the task chains contain a re-implementation by turn 5 while pass rates do not move | The premise of the `reinvention` lens; tests passing says nothing about reuse |
| When Single Agent Is Enough, arXiv 2611.23283 (read) | On review-comment and refinement benchmarks a single agent matched multi-agent systems at a fraction of the tokens (about 1.6k against 47k per instance) | Do not assume one agent per lens pays; decide it by measurement (section 6, question 2) |
| Tufano et al., arXiv 2611.32676 (read) | Taxonomy of 87 issue kinds in AI-written code from commits, conversations and interviews; duplication named by half the interviewees; a refactoring that removes one smell can introduce another | Check the result of a refactoring for new problems, not only for the targeted one |
| Waseem et al., arXiv 2610.24790; Midolo et al., arXiv 2601.13139 (abstract) | LLM refactorings break downstream callers in 7.3% of candidates; GPT-4o refactorings preserve behaviour and reduce smells but lower measured readability | Callers and consumers in the refuter's checklist |
| GitClear 2025 (publisher's abstract; vendor study) | Share of moved lines fell from 25% (2021) to under 10% (2024); copy-pasted lines rose from 8.3% to 12.3% | Motivation only |
| Clone studies: Juergens et al., Wagner et al. (abstract); Kapser and Godfrey (title and abstract) | Inconsistent changes to clones cause faults (17% of type-3 clones in one study); some cloning is a sound decision | Divergent copies as defect candidates; "keep the duplication" as a legitimate outcome with its reason |
| Perspective-based reading, Basili et al. 1996 (title only); Metz, "The Wrong Abstraction"; rule of three; Ousterhout, deep modules (memory) | Reading from assigned perspectives; a wrong abstraction costs more than duplication | The lens idea itself; the `abstraction-fitness` lens and the kill tests on flags and variation points |

Own material: the Haystack drafts `assembled-change-review` (readers by
concern on one frozen tree, every finding checked before a fix is ordered) and
`independent-mutation-review` (deliberate faults as negative controls) shaped
the freeze step and the spike's negative control. No draft covering a
codebase-wide audit turned up in an exact search on eight terms (first 30
hits) and one ranked retrieval; the full list of drafts was not paged to its
end, so this is a best-effort statement.

## 4. The design in one page

```text
scope ─ freeze ─ exclude ─ baseline            supervisor, mechanical
   │
leads (clone report, sibling index, history, reuse inventory)
   │
plan and budget ── stop for go-ahead
   │
lens passes ──────────── readers: one lens, one partition ──► hypothesis records
   │
admissibility (paths, verbatim anchors) ─ cluster ─ precedence ─ rank
   │
refutation ───────────── refuters: fresh context, other model family,
   │                     reader's reasoning withheld ──► refuted | supported
spikes ───────────────── spikers: own work tree, tests before and after,
   │                     targeted checks, measured delta, negative control
patch review ─────────── someone who did not write the patch
   │                     ──► confirmed | confirmed-unguarded | failed
working set (measured only) and report ── stop: "name the ids to apply"
   │
apply, only on request
```

Decisions, each with the alternative it was chosen over:

1. **A proposal is a record with sites, a prediction and a refuter**, not a
   paragraph. Alternative: free-text findings. A record can be checked
   mechanically (does the path exist, does the quoted line occur there) and
   tested; a paragraph can only be agreed with.
2. **Two tests, cheap before dear.** Independent refutation by reading, then
   a spike that builds, tests and measures. Alternative: spike everything
   (each spike is a build and a test run) or validate by reading only (the
   failure that prior art warns about). Only a measured spike admits a
   hypothesis to the working set; a survivor of refutation is `supported`, a
   candidate listed apart from it.
3. **Refutation requires a counterexample.** Alternative: a default-no
   reviewer. A wrong acceptance costs one spike; a wrong rejection loses the
   saving silently, so doubt alone must not kill.
4. **Tokens as currency, lines beside them** (section 2). A proposal predicts
   lines, because people and models estimate lines; the spike measures both,
   and the report gives the ratio of measured to predicted as a calibration
   factor for the candidates not spiked.
5. **Invariants instead of a readability judge.** Tests, test-case inventory,
   contracts, boundary validation, dependency direction, object lifetime,
   order of effects and cost class are listed as things no proposal may be
   bought with, and denser formatting, deleted comments and code moved out of
   the script's sight do not count as savings. Alternative: an LLM score for
   "readability", which has no test. A negative control alone does not show
   that the particular risk is guarded, so the spiker also checks each named
   risk by a run, and the patch is read by someone who did not write it.
6. **A lens against the metric.** A size target pushes towards merging things
   that merely look alike. `abstraction-fitness` proposes inlining, deleting
   and splitting, and the kill tests of the merging lenses (a flag parameter,
   more than about three variation points, copies with separate histories)
   refute over-eager abstractions.
7. **Precedence when lenses collide on the same code:** delete, reuse what
   exists, use a locked library, generalize, introduce something new.
8. **Project rules outrank lens cards.** Here that covers, for example, kept
   Baboon model versions, immutable migrations and suites that must not share
   a database.
9. **The procedure watches itself.** Per lens: more than a third inadmissible
   records means the brief or model is at fault; more than two thirds refuted
   means the card is too loose for this codebase and gets a recorded
   amendment; nothing admissible on two partitions parks the lens.
10. **A pack supplies its currency, what readers leave alone, and its
    empirical test**; the pipeline supplies records, mechanical
    admissibility, independent refutation and the rule that only an executed
    test admits a hypothesis. The spike of section 7 is the structural pack's
    test. Without that split the structural gate ("tokens must fall", "the
    tests were green before") would reject every performance or correctness
    proposal.

## 5. Where the draft departs from the sketch

- **Lines of code** became tokens with lines beside them, for the measured
  reason in section 2.
- **One subagent per lens** is the default allocation, but the draft treats a
  lens as a unit of attention, not necessarily of agents. Nine lenses on four
  trees is up to nine full reads (about 37 million tokens of distinct text).
  When the budget does not allow that, lenses merge into four groups by
  reading mode, one pass per lens inside a reader. Which is better is an open
  question the pilot can answer.
- **Lenses added:** `dead-weight` (nothing shrinks code more cheaply than
  deletion, and it should win before anything is refactored), `test-support`
  (tests are 55% of the code and hold 88% of the literal clones) and a split
  of reuse into `reinvention` (own code) and `library-underuse` (locked
  dependencies; a new dependency is never "reuse" and goes to the user).
- **Generalization** is in the pipeline, not in more lens cards: a pack states
  its currency and what admits a hypothesis (a reproduction for correctness, a
  measurement for performance, a quoted rule for conventions). Only the
  structural pack is written out. Cards for the other packs would be guesses
  until the pipeline has run once.

## 6. Questions

1. **Metric.** Tokens as the currency, lines reported beside them? The
   alternative is lines after a formatter, which needs three formatters
   configured for a codebase that has none. **Decided 27 Nov 2026 (Q183):
   tokens as the currency, lines beside them, as drafted.**
2. **Allocation.** (a) One agent per lens per partition, as sketched;
   (b) the four groups; (c) run both on the pilot target and choose by yield
   per token. Recommended: (c). **Decided 27 Nov 2026 (Q185): (c), on
   haystack.**
3. **Admission.** The draft admits to the working set only what a spike
   measured; survivors of refutation that were not spiked are listed apart as
   candidates with a calibrated estimate. Is that the bar you meant by
   "tested", or should a refutation attempt by an independent reader be
   enough? The strict bar costs one build and test run per admitted item.
   **Decided 27 Nov 2026 (Q184): measured only, as drafted.**
4. **Lens set.** Are the nine right? `test-support` is the one most likely to
   be unwanted: it touches tests, under the rule that the executed cases and
   assertions may not shrink.
5. **Pilot target, models and budget** (section 7). **Decided 27 Nov 2026
   (Q185): haystack, both allocations, five planted smells, the session's
   model for supervisor, readers and spikers, `gpt-6.2-sol` for refuters,
   stop after the first wave and report the measured cost.**
6. **Name and home.** `code-quality-review`, installed from
   `nix/pkg/llm-skills/skills/` once it has run; until then on this branch.
   Recording it in Haystack as a skill draft is planned after the pilot, when
   there is evidence to record with it.
7. **Tracking.** No Linear issue was named for this work, so nothing was
   written there. Say if it should be tracked and where. **Decided 27 Nov
   2026 (Q186): not tracked in Linear.**
8. **After the first wave** (asked 27 Nov 2026). **Q193: tune the text from
   the first wave, then one held-out run on the manure backend with the cost
   cuts (group readers, one bundled file per partition, readers on the
   employer-hosted open models), and report before anything further. Q194:
   production and test tokens count together; moving code from one to the
   other is not a gain.**
9. **After the held-out run** (asked 27 Nov 2026). **Q202: fix the refutation
   stage (reading refutes only feasibility, rules and the token balance;
   behaviour is settled by the spike; isolated spikes), then one cross-service
   run on the families the three servers share (Auth, Http, Main, Mcp,
   Config) against `shared/`, and report. Q203: apply all five confirmed real
   changes, without the full verification.**
10. **How to conclude** (asked 27 Nov 2026). **Q222: stop; merge the docs
    branch into main, leave the skill as the Haystack draft, keep the six
    cross-service patches beside the note, remove the spike work trees and
    the two planted branches; also trim the skill to a v0.6 from the three
    runs' notes, without further runs, and update the Haystack draft. Q223:
    apply cross-service changes 1 to 4, one commit each, with
    `scripts/verify all` on a quiet host.**
11. **Change 4 after main moved** (asked 27 Nov 2026). **Q225: drop it; that
    code belongs to the account refactor now; keep the patch as a record and
    delete the local branch.**

## 7. Proposed test

**Pilot on haystack** (10.8k production and 11.0k test lines, 1.7 MB), with
`shared/` as its reuse inventory. A subagent with a fresh context is given the
skill file and the scope and acts as supervisor; it reports and applies
nothing; its spikes live in throwaway worktrees. This session watches the run
against a checklist and changes the skill text only for failures it observed,
each logged in section 11.

Checklist (did the text steer the agent): tree frozen; symbolic links and
generated code outside `generated/` excluded; plan presented before fan-out;
reader briefs free of the supervisor's conclusions; records valid and anchors
checked mechanically; refuters given only the permitted fields; kills checked
by reading the cited lines; spikes with tests before and after, measured by
the script, with a negative control; each patch read by someone who did not
write it; nothing unmeasured in the working set; residue reported.

Stated before any result:

- *Allocation* (question 2): both allocations run on the same partitions with
  the same leads, caps and model. Refutation and spikes are done on the union,
  without knowledge of the arm. Groups are preferred if they reach at least
  80% of the per-lens arm's supported and confirmed clusters at no more than
  half its reading cost; otherwise one agent per lens.
- *Usefulness:* the run is informative whatever it finds. A working set that
  is empty or small after honest refutation is a result about this codebase,
  not a failure of the pilot. What would count against the skill: more than a
  third of records inadmissible, kills accepted without a counterexample,
  unmeasured items reported as confirmed, or a report that omits its residue.
- *Recall* cannot be measured without ground truth. Optional: plant five
  smells of known kinds in a scratch commit (a renamed copy of a helper, an
  unused export, a pass-through wrapper, a hand-rolled standard-library
  function, a third near-identical handler). The share found is an upper
  bound: planted smells are easier than real ones.
- *Held-out check:* after tuning, one run without further changes on a target
  not used for tuning (the manure backend, or `shared/service-auth` with its
  three consumers).

Cost of the pilot, from byte counts, not measured: the readers of both arms
together read about 4 million tokens of distinct text (2.8 million with one
agent per lens, 1.4 million with groups). Refuters and spikes add an amount
that cannot be estimated well before the first wave, and the input a provider
counts is a multiple of the distinct text. The first wave gives measured
numbers; the skill's plan step exists to stop there.

To settle: models per role (supervisor, readers and spikers on the session's
model; refuters on another family, for example `gpt-6.2-sol`; or the
employer-hosted open models for readers), and a cap. `tokemon` shows the
Anthropic account's extra usage at 4,892 of 5,000 USD; whether that bounds
the gateway provider this session runs on is unknown.

### 7.1 Pilot protocol, registered before the run

Fixed on 27 Nov 2026 after Q185 and before any pilot agent was started.

- **Tree.** Base `c5643c26` (haystack and shared are unchanged since
  `e44b2924`) plus one commit with five planted smells, `04aa8cce`, on a
  local branch that is never merged. Kinds planted, all in
  `haystack/server` production code: a renamed copy of a helper, an unused
  public method, a pass-through class with one user, a hand-rolled
  standard-library function, one query written three times. Planted size:
  +27 lines, +423 tokens. The answer key with sites and intended
  interventions is kept outside every repository tree; its SHA-256 is
  `c7bb656c758efe6d2974ba967d62b885dbf85b341103d75ce519aa9a80351776`.
  The JVM suite passes on the base (40 suites, 758 cases, 82 s) and must pass
  on the planted commit before the supervisor starts.
- **Supervisor.** One fresh subagent, the session's model, thinking high. It
  gets the skill file (v0.3, outside the tree), the request below, and the
  user's and the project's instruction files. It is not told about the
  plants. It is asked to keep a list of every place where the skill text was
  unclear, impossible to follow or in conflict with its tools.
- **Request.** Review `haystack/` with the structural pack; first partition
  `haystack/server` production code, its tests a partition of their own; put
  that partition through every lens twice, once with one reader per lens (ids
  prefixed `A/`) and once with the affinity groups (`B/`), same leads and
  caps, neither arm seeing the other's answers; from reconciliation on, one
  pool with the prefixes kept; then stop and write the report. Apply nothing.
- **First wave** means that first partition through readers, admissibility,
  refutation and spikes. Caps: 10 hypotheses per lens pass, 15 hypotheses to
  refutation, 5 spikes.
- **Models.** Readers and spikers: the session's model, thinking high.
  Refuters: `gpt-6.2-sol`, thinking high.
- **Measured per arm:** records returned; inadmissible; clusters; plants
  found; and, after the pooled stages, refuted, supported, confirmed,
  confirmed-unguarded and failed; reader tokens and cost as the harness
  reports them. Per stage: agents, tokens, cost, wall time.
- **Plant scoring.** Found: an admissible record of the arm cites the planted
  site (path, and lines overlapping the planted ones) and proposes the
  intended intervention or an equivalent. Flagged otherwise: it cites the
  site with another intervention. Overflow only: the plant is named in a
  reader's list of candidates not written up. Missed: none of these. A plant
  found under another lens than intended counts as found.
- **Allocation rule,** as above: groups are preferred if they reach at least
  80% of the per-lens arm's supported and confirmed clusters at no more than
  half its reading cost. Plants found are reported beside it and do not
  enter the rule.
- **What counts against the skill,** as above, plus: a deviation of the
  supervisor that the text caused or failed to prevent.
- **Monitor.** This session watches and does not steer. It interrupts only if
  the supervisor writes into a checkout it does not own, pushes or merges,
  starts more than 35 agents, or runs longer than three hours.
- **Tuning.** The skill text changes only for failures observed in the run,
  each logged in section 11 with the observation.

### 7.2 Held-out run, registered before the run

Fixed on 27 Nov 2026 after Q193 and Q194 and before any agent of this run was
started. The skill is v0.4, used unchanged.

- **Tree.** Base `031b0c2b` (`manure/backend` is unchanged since `e44b2924`)
  plus one planted commit, `03f3b2a7`, on a local branch that is never
  merged. Six plants: five in production code, of the same kinds as in the
  first wave (+20 lines, +317 tokens), and one unused helper in test support
  (+1 line, +21 tokens). The plants are my addition to the decided run: the
  reader model changes, and without a positive control a thin result could
  not be told from readers that do not see. Answer key outside every tree,
  SHA-256 `5a4e4eba885efe9888ae956237caa6fa38ebb39af7de39dca8ddcf47ff2bbaa3`.
  The JVM suite must pass on the planted commit before the supervisor starts
  (it did: 24 suites, 303 cases, 98 s).
- **Supervisor.** One fresh subagent, the session's model, thinking high,
  with the skill file, the request and the instruction files; not told about
  the plants; keeps notes on where the text failed it.
- **Request.** Review `manure/backend` with the structural pack. Two
  partitions: its production code, read by the four affinity groups, and its
  test code, read by the group for tests. Bundles as in the skill. Readers on
  `moonshotai/Kimi-K3.1-Pro`, thinking high, with
  `deepseek-ai/DeepSeek-V4-Pro-0813` as the model to change to if section
  10's threshold on inadmissible records trips. Refuters `gpt-6.2-sol`,
  spikers the session's model, both thinking high. Caps: 10 hypotheses per
  lens pass, 15 to refutation, 5 spikes. Stop after section 8; apply nothing.
- **Measured.** Per stage: agents, tokens, cost as the harness reports it,
  wall time. Records and the share inadmissible; plants found; kills, second
  opinions and `reword` verdicts; spike results.
- **Stated before the run.**
  1. Readers on the open model are good enough if at most a third of their
     records are inadmissible and at least four of the five production
     plants are found.
  2. Refutation is repaired if no kill is overruled by the supervisor alone
     and at most a third of the kills go to a second opinion.
  3. Ranking is repaired if every plant among P1 to P5 that a reader found
     reaches refutation.
  4. Cost: an expectation, not a criterion. Supervisor, refuters and spikers
     together under 50 USD; the readers run on models the employer hosts,
     for which the harness reports a nominal cost that is not billed to us.
- **Plant scoring and monitor rules** as in section 7.1.
- **Confounded by design.** Tuned text, group readers, bundles, another
  reader model and another codebase change together. The run can show
  whether the combination works; it cannot attribute a difference to one of
  them.

### 7.3 Cross-service run, registered before the run

Fixed on 27 Nov 2026 after Q202 and before any agent of this run was started.
The skill is v0.5, used unchanged.

- **Tree.** Main as it stands when the run starts, without plants. Positive
  controls come for free: the two re-implementations of the shared `Secrets`
  that earlier spikes confirmed (haystack's `Tokens`, manure's `SecretCodec`)
  are still in that commit, because the five changes of Q203 are applied to
  main only after the run's tree is frozen.
- **Supervisor.** One fresh subagent, the session's model, thinking high,
  with the skill file, the request and the instruction files; it keeps notes
  on where the text failed it.
- **Request.** One partition across services: the files of
  `chronicle/server`, `haystack/server` and `manure/backend` that hold
  authentication and accounts, the HTTP layer, the entry point and wiring,
  the MCP endpoint and configuration loading (production code). `shared/` is
  read beside it, may be cited, and may be the home of what is common, so an
  intervention may have sites there. Lenses: duplication,
  under-generalization, missing-abstraction, abstraction-fitness, wiring and
  reinvention, in the groups repetition, shape and siblings. Readers on
  `moonshotai/Kimi-K3.1-Pro`, with `deepseek-ai/DeepSeek-V4-Pro-0813` as the
  model to change to; refuters `gpt-6.2-sol`; spikers the session's model;
  all thinking high. Caps: 10 hypotheses per lens pass, 15 to reading, 8
  spikes. Baseline over the three server trees and `shared/`. Stop after
  section 8; apply nothing.
- **Stated before the run.**
  1. Known positives: the readers report both re-implementations of the
     shared `Secrets`.
  2. Refutation: every kill by reading rests on a hard falsifier
     (feasibility, a rule or contract, the token balance, a countable card
     criterion) and none on behaviour; at most a third of the kills are
     doubted.
  3. Isolation: no spiker writes into another's scratch directory.
  4. The question the run is for. Count the production lines that confirmed
     and supported hypotheses would remove, as a share of the partition:
     5% or more supports "the services duplicate a substantial part of
     these families"; under 2% does not; between the two it stays open.
     What is deferred to the user (new shared modules, contract changes) is
     counted apart with its predicted effect.
  5. Cost: an expectation, not a criterion. Supervisor, refuters and spikers
     together under 60 USD.
- **Monitor.** No steering. Interrupt only for writes into a checkout the
  supervisor does not own, a push or merge, more than 40 agents, or more
  than three hours.

## 8. Known weaknesses of the draft

As of v0.2. Sections 11 to 13 say what the runs changed and added.

- 44 KB, of which about 13 KB are lens cards and 7 KB the script; the largest
  installed skill is 40 KB and most are 4 to 21 KB. Trimming should follow
  the pilot, which shows which sentences carry weight.
- Every threshold and cap (ten hypotheses per pass, a third, two thirds, five
  per refuter, three variation points) is a choice without data.
- The four lens groups are a guess about which lenses share a reading mode.
- The script's lexer is approximate. Known miscounts, left in and named in
  the skill: a JavaScript regular-expression literal containing `//`, nested
  block comments, shell here-documents and SQL dollar-quoted bodies. It is
  used for deltas between two runs of itself, never beside another counter.
- A spike's verdict is bounded by the tests that exist; the negative control
  detects the unguarded case but does not repair it.
- Nothing addresses a codebase without tests beyond `confirmed-unguarded`.
- Patch review adds one more reading per spike; whether it finds anything the
  spiker's checks miss is unknown.

## 9. Independent readings before discussion

Two read-only reviewers read v0 (commit `cf738b4e`) with separate concerns.
Neither ran anything.

| Reviewer | Concern | Findings |
|---|---|---|
| `moonshotai/Kimi-K3.1-Pro`, thinking high | cold walk-through: can a fresh agent execute the text for "review `haystack/`" | 14 |
| `gpt-6.2-sol`, thinking high | adversarial soundness: wrong admissions, silent losses, metric gaming, script defects, requirements | 14 |

Each of the 28 was compared with the passage it cites, and none turned out
to be wrong. Six script defects were reproduced (table at the end of this
section); the others about the script were accepted from reading its regular
expressions. Changes made for v0.1:

- **Script.** Counts untracked files and survives deleted ones (v0 listed the
  index only: code moved into a new file read as a saving, and a deleted file
  crashed it); counts the tokens inside strings (v0 counted a template
  literal as one word, so a concatenation rewritten as a template read as
  ten tokens cheaper); finds Python docstrings by the syntax tree (v0 dropped
  any triple-quoted string that began a line, including SQL passed as an
  argument); shell `${#x}` and Nix `''` strings no longer start a comment;
  `--compare` reuses the baseline's arguments and refuses others; a file name
  with a tab is refused.
- **Admission.** The working set is measured items only; `supported` became a
  separate candidates list; `confirmed-unguarded` has a place in the report;
  one status per record, with the step that sets it.
- **Spikes.** Tests run before the edit as well as after; a check by a run
  for each named risk and difference; everything staged before measuring and
  diffing; every patched file accounted for by the measurement; a patch
  review by someone who did not write it; pure deletions use a reference
  search and builds where a negative control has no code path to break.
- **Reconciliation.** Rivals are exempt from one-per-cluster; when the
  preferred hypothesis of a cluster falls, the next alternative goes forward;
  anchors are checked without pasting them into a shell; library references
  are verified by the refuter; scope is separate from what the script can
  measure.
- **Report.** Inadmissible, untested and alternative hypotheses by id; the
  candidates readers named without writing them up; leads left unfollowed
  when a lens is parked; a defined calibration with "insufficient data".
- **Packs.** The size gate and the ban on naming proposals moved from the
  pipeline into the structural pack, so other packs can state their own.
- **Smaller repairs.** Detector and baseline output directed to the run
  directory; the first wave may span several waves of five; the dead-weight
  card no longer asks for comments to be deleted and no longer dies on a
  reference from inside the deleted code; sampling removed from Boundaries.

Not repaired, by choice: nested block comments, regular-expression literals
containing `//`, and SQL dollar quotes are documented as known miscounts
instead of being lexed.

Reproduction of the script defects, old script (as committed in `cf738b4e`)
against the rewritten one on the same inputs. The reproduction was run after
the rewrite, against the unchanged old file:

| Input | Old | New |
|---|---|---|
| `return prefix + f(x) + g(y)` against the same as a template literal | 29 and 19 tokens | 29 and 38 |
| shell `n=${#value}; echo "$n"` | 4 tokens | 12 |
| Nix `let n = ''#tag''; in n` | 4 tokens | 12 |
| Python `return (` / `"""required payload"""` / `)` in a function | 3 lines, 8 tokens | 4 lines, 16 tokens |
| a definition moved from a tracked file into a new untracked one | tokens −13 | tokens +4 |
| a tracked file deleted without `git rm` | `FileNotFoundError` | reported as removed |

**Re-reading of v0.1** (commit `4bf77c32`) by `gpt-6.2-sol`, read-only. Of
the 28 findings it judged 19 resolved, 8 partly resolved and one (nested
comments) documented and unresolved as intended, and it reported ten new
defects, all accepted. Changes made for v0.2:

- **Procedure.** The spiker stages its patch before building, and the tree
  must show nothing else before it is measured (build output could enter the
  patch and the count); patch coverage is checked by membership in the two
  manifests (a file whose counts did not change was called unmeasured); a
  spike can proceed without a covering test and is then at most
  `confirmed-unguarded`; the project's build and test commands are recorded
  during scoping; `deferred` is assigned by a step of reconciliation;
  hypotheses with unmeasurable sites are kept out of the spike queue; a
  promoted alternative is refuted outside the cap; the two calibration
  spikes are taken only when the cap and the pool allow.
- **Packs.** Section 7 is now stated to be the structural pack's test. A
  pack whose hypotheses are not behaviour-preserving patches supplies its
  own executed test: a correctness pack's failing reproduction would have
  been stopped by "baseline not green".
- **Script.** Docstrings are removed by their span in the syntax tree, and an
  unparsable Python file is announced; shell single quotes no longer treat a
  backslash as an escape; Nix `''${` and `'''` no longer end a string; SQL
  `''` is an escaped quote; file names are read as bytes and unsupported ones
  refused; `--depth 0` and a baseline without a header are refused with a
  message; added and removed files are listed even when they count nothing.
  Ruby was dropped from the supported formats.

| Input | v0.1 | v0.2 |
|---|---|---|
| Nix `x = '' echo ''${HOME} # not a comment ''; y = 1` | 11 tokens | 21 |
| shell `x='path\'`, a comment line, `y='z'` | 3 lines, 16 tokens | 2 lines, 11 tokens |
| Python function with only `r"""raw docstring"""` and `return 1` | 3 lines, 16 tokens | 2 lines, 7 tokens |
| a new file holding only a comment | not listed | listed as added |
| `--depth 0` | ran with depth 2 | refused |
| baseline file without a header | traceback | message |
| file name containing a carriage return | file skipped silently | refused |

There was no third reading. v0.2's changes are unreviewed except by the tests
above; the pilot is the next check.

**Discussion, 27 Nov 2026.** Q183: tokens with lines beside them, no change.
Q184: measured-only admission, no change; with it came the suggestion to ask
agents for falsifiers on every hypothesis. v0.2 did ask for them, as a field
called `refuters`, and then never used them: they were withheld from the
refuter and nothing later read them. Changes made for v0.3:

- The field is `falsifiers`, each an observation with the way to check it, at
  least two per hypothesis, and the lens cards' "kill tests" carry the same
  name. A record whose falsifiers cannot be checked is inadmissible.
- The refuter still works blind first and returns the falsifiers it checked.
  Then a ledger per hypothesis merges the reader's, the lens's and the
  refuter's falsifiers and the differences only one of them saw; what reading
  can settle goes back to the refuter, what needs a run goes to the spike.
- `refuted` means a falsifier was observed; `supported` means none was and
  nothing is left that reading could settle; the spike checks the rest; the
  report shows falsifiers checked and still unchecked.
- A refuter needs the history of the sites, so it gets a shell to use
  read-only or the history in its brief.

v0.3's changes have had no independent reading.

## 10. Pilot, first wave (27 Nov 2026, 10:51 to 12:26 UTC)

Run as registered in section 7.1; the skill was v0.3. The supervisor's run
directory, with its 120 kB report and its notes on the skill text, is
`debug/cqr-20261127-1051` in its harness work tree (path in section 15).

**Outcome on `haystack/server` production code** (2,640 lines, 49,520 tokens
with the plants):

- 13 readers returned 123 records on 45 topics; none inadmissible.
- 19 hypotheses went to refutation (15 under the cap, 4 promoted
  alternatives). The refuters called 15 refuted; the supervisor accepted 9
  kills and overruled 6 after reading the cited lines.
- 5 spikes: 3 confirmed, together 21 lines and 302 tokens smaller, each with a
  negative control that fails a test; 2 failed. One failure was caught by the
  token gate (12 lines fewer, 5 tokens more); the other deleted the only test
  guarding live code, found by the spiker's fault injection.
- At the end: 3 confirmed, 5 supported and unmeasured, 9 refuted, 2 failed,
  17 deferred, 21 untested (cap), 64 alternatives, 2 defect candidates.
- Two of the three confirmed changes are real findings, not plants: token
  helpers in `Auth.scala` that re-implement `shared/service-auth` (159 tokens),
  and string overloads used only by tests (92 tokens).

**Plants** (answer key hash as registered):

| Plant | Arm A | Arm B | End state |
|---|---|---|---|
| P1 renamed copy of `Text.extractWords` in the parser | found | found | untested: cut by the refutation cap |
| P2 unused `QualifiedId.decodeKeyOption` | found | found | untested: cut by the refutation cap |
| P3 pass-through `ItemGateway` | found | found | supported, not spiked |
| P4 hand-rolled `joinWords` | found | found | confirmed: 10 lines and 62 tokens, exactly the planted size |
| P5 one query written three times | found | found | supported, not spiked |

Both arms found all five, which bounds recall from above only. The caps then
cut two of them: ranking by predicted lines sent large deletions forward and
left every three-line reuse or deletion untested.

**Allocation rule.** Arm B (four group readers) cost 28.31 USD against 53.20
USD for arm A (nine readers), 53% of it, and its records covered all eight
topics that ended supported or confirmed (two of them inside one composite
record). The registered rule asked for at least 80% of the topics at no more
than half the cost: the cost condition is missed by three points, so by the
rule one reader per lens stays the default. Beside the rule: the two
`reinvention` readers had the same allocation and agreed no better with each
other (8 of 12 topics shared) than the arms did (29 of 45), so one run cannot
separate the allocations on coverage; and the later lenses of a group came
back thinner (under-generalization 3 records against 9, library-underuse 4
against 8).

**Cost, as the harness reports it.** 121.83 USD in all: readers 81.51,
refuters 5.10 (14 agents on `gpt-6.2-sol`), spikers 6.39, probe 0.27,
supervisor 28.56. A reader cost 4.42 to 8.36 USD for a partition of about
63,000 tokens. 33 subagents, 95 minutes. Where the reader money went
(worked out afterwards from the per-reader figures, which fit prices of 0.20
USD per million tokens read from cache, 10 per million written to it and 40
per million of output): for the nine per-lens readers 23.7 USD of output,
23.8 of fresh input and 5.6 of cache reads. So 92% of the reader tokens were
cache reads, but only a tenth of the reader cost; reading in fewer calls can
save that tenth at most, and the levers are the reader model, the number of
readers and their output. The Anthropic account's extra-usage figure did not move
during the run (4,892.18 USD at 11:39 UTC), so the gateway is billed
elsewhere.

**Checklist of section 7.** Met: tree frozen and removed; generated code
excluded; plan written before fan-out; reader briefs free of conclusions and
of plant names (the names occur only in mechanical lead lists); anchors
checked mechanically with negative controls; kills checked against the cited
lines; spikes measured by the script, with tests before and after and a
negative control; patches read by the supervisor; nothing unmeasured in the
working set; residue reported. Not exercised: symbolic links, `test-support`
on a test tree (the request's wording kept tests out of this wave).
Deviations: anchors accepted as a verbatim part of a line; refuters had no
shell and got site history as files; one empty probe file created and removed
in the harness directory; five spike work trees left in place.

**Monitor rules.** No interrupt: 33 agents (limit 35), 95 minutes (limit 180),
no push or merge, the user's checkout untouched.

**What counts against the skill.** Refutation is the weak stage. The refuter
marked falsifiers observed from a property alone, without anyone who observes
it, so 6 of 15 kills had to be overruled; and the supervisor's own
adjudication erred twice in 19 (one kill accepted against its own rule, one
kill overruled that the spike then proved right). The text gave the last word
to one agent without a check on it.

## 11. Tuning log

### v0.4, 27 Nov 2026: from the first wave

Each change answers an observation of the first wave (F-numbers are the
supervisor's notes) or a decision; the candidates as first listed follow
below.

| Area | Changed in the skill | From |
|---|---|---|
| Falsifiers | A falsifier is observed only with its observer, cited by path and lines; lifetime, order and cost count only where something can observe them | F20, F33 |
| Refutation | Refuters and spikers get the list of section 0 and the pack's falsifiers; verdict `reword` for a change that stands but cannot be carried out as worded; the supervisor no longer overrules a kill: a doubted falsifier goes to a second refuter, and stays `unchecked` for the spike unless both observe it; rules for verdicts are written down before reading them | F18, F20, F21, F26, F27, F33 |
| Spike | Guarding tests must be among the executed cases; a patch that removes tests needs a fault in the production code they reached; the comparison file is written outside the work tree; patches are taken from the work tree | F25, F26, F27, F29 |
| Ranking | Intervention classes defined; records with the same intervention are twins; the refutation cap is filled class by class in turn; the two lowest-ranked are the calibration spikes | F11, F15, F17, F22, plants P1 and P2 |
| Currency | Production and test tokens count together and a move is not a gain; "tokens added are not fewer than tokens removed" is a falsifier of every structural hypothesis | Q194, F13, F28 |
| Records | Anchor may be 30 characters of a long line; one intervention per record; guards by file and case; suspected defects go to a list, not a status | F12, F14, F16, F29 |
| Scoping | Lenses by kind of partition; documents listed by file; a test-subset command that lists executed cases, run once before the spikes; where the frozen tree may live | F01, F04, F06, F08, F24 |
| Groups | A pass per lens is defined and made visible by one line per Look-for item; the comparison's numbers stand beside the allocation choice | F07, F30 |
| Leads and tools | Clone thresholds in tokens, with a fallback without a detector; occurrence counts where no unused report exists; answers saved byte for byte; history as files for a refuter without a shell | F02, F03, F09, F10 |
| Report | `report.md` for the reader and `residue.md` for the file, both generated from the records; cost per stage with what the tools do not report | F31, F32, F34 |
| Watch | Thresholds apply from five records; the share of kills sent for a second opinion is watched | F23 |
| Cost | One bundled file per partition and one for the documents | Q193 |

Not changed: several small hypotheses sharing one refuter and one spike; a
token prediction in the record; the script's lexer. The skill grew to 53 KB.

One read of v0.4 before the run (`gpt-6.2-sol`, read-only, against v0.3)
gave eight findings, all accepted and repaired in the text: a disputed
falsifier could be sent back for reading for ever; `reword` skipped the
mechanical checks; the observer rule shut out falsifiers that have no
observer (a missing library symbol, a token balance); a patch whose removed
tests reached only deleted code could not make its negative control; ranking
uses predicted lines while the spike passes on tokens (now said outright);
inlining, moving and splitting had no class; a component without tests could
not finish scoping; an empty reader pass left no trace (`passes.tsv`). These
repairs have been read by nobody else; the held-out run is their check.

### v0.5, 27 Nov 2026: from the held-out run

H-numbers are the notes of the held-out supervisor.

| Area | Changed in the skill | From |
|---|---|---|
| Refutation | Reading refutes only on a hard falsifier: the change is not feasible, a rule or contract forbids it, the tokens do not fall, or a countable criterion of the lens card fails. Behaviour becomes checks that the spike runs. A doubted kill that is really about behaviour moves to the checks | Q202; plants P1 and P4 of the held-out run; H24, H32, H40 |
| Spikes | A scratch directory per spiker, named by the supervisor; every behaviour check is run on the base commit and with the patch; a probe built for the spike is an open point, not a falsifier; checks that could not be run and open points are listed with the result; the two calibration slots are gone | Q202; H27, H28, H31, H32 |
| Twins | A criterion of one lens's card refutes only records of that lens; overlap and tie-breaks are defined | H17, H18, H21; plant P4 |
| Wording | abstraction-fitness: "the abstraction has two or more callers"; section 0: "an assertion that the patch removes or loosens"; `reword` when the change holds at all sites but one or two; history may speak for a hypothesis | H23, H24, H40; plant P1 |
| Readers | Bundles cut to what one read call returns; coverage from tool logs, not from the reader's statement; one JSON object from a group reader | H12, H13, H30 |
| Scoping, report | Status `admitted`; places for briefs and refuter output; one pass-log row per lens pass; where the inner loop may run; yield columns | H10, H14, H15, H36, H41 |

One interpretation of mine: Q202 names feasibility, rules and the token
balance. I kept the lens cards' countable criteria (callers, variation
points, flags) among what reading may refute on, because they are what stands
against over-merged abstractions and a run cannot settle them; the one that
was misread in the held-out run is reworded, and the patch review checks them
again on the code as written.

Not changed: a token prediction in the record (H16); a data table inside a
hand-written file, which a path pattern cannot exclude (H2); the size, now
56 kB.

One read of v0.5 before the run (`gpt-6.2-sol`, read-only, against v0.4)
gave eight findings, all accepted and repaired: the patch review could still
fail a hypothesis on behaviour by reading; a hard falsifier known only to
the reader was lost; twins shared a fate without sharing their falsifiers; a
missing caller fitted both `refuted` and `reword`; a scratch directory does
not isolate commands that write to fixed paths (the inner-loop commands must
be safe in several work trees at once, or spikes run one at a time); checks
not run could be missing from the report; the abstraction-fitness criteria
were not tied to the kind of intervention; a file larger than one read call
could not be bundled. Nobody else has read these repairs.

### v0.6, 27 Nov 2026: trim after three runs; not run

Decided under Q222. v0.6 is 50.5 kB against 56.1 kB for v0.5, and fits one
call of this harness's read tool (51,200 bytes). The lens cards and the
measurement script are unchanged: they are what the runs exercised, and a
skill here is a single file, so they cannot move out of it. Everything else
was rewritten more tightly.

Rules added, each from the notes of a run (X-numbers are the cross-service
supervisor's notes, H the held-out one's):

| Rule | From |
|---|---|
| Tests are run twice on the frozen commit to find flaky cases; a case that fails with a patch is rerun alternately on base and patch and counts only if it fails more often with the patch; reruns are reported, never repeated until green; spikes run one at a time on a loaded host | X27; the cross-service run's test noise |
| Refuted and failed hypotheses of earlier runs go into `scope.md` and into the reader's brief; a repeat without new evidence takes the earlier status | the session helper that failed twice with the same numbers |
| A hypothesis whose counted gain is under 40 tokens is thin and spiked last; the refuter gives both token counts | X23; three confirmed changes of 17 to 30 tokens |
| The reader marks each falsifier hard or behaviour and names the observer; the refuter's brief carries the scope; a doubted kill leaves the record `admitted` | X17, X18, X20 |
| A lens that returns few records while its reader set many candidates aside is read once more by another model, with that list as leads | X14 |
| A bundle of the shared modules for the reuse lenses | 24 of 36 shared files unread in the cross-service run |
| Partitions across components are cut by concern; a helper added to an existing shared module is class "generalize"; twins may cover a part of the sites | X1, X15, X16 |
| Documentation that the project's rules require belongs to the patch; the supervisor measures each patch itself; the calibration uses the prediction as last corrected | X28, X31, X32 |
| The supervisor does mechanical steps by script and reads records, not answers | the supervisor was the largest cost in two of three runs |

Removed: the two calibration spike slots; the example column of the
other-packs table; the clone-detector command line (no run could use it: no
network); explanatory sentences; the sentence in the description that
promised packs for correctness, security, performance, readability, idiom
and conventions, which are untested starting points (the description is 906
characters now).

One addition is mine and not from a supervisor's note: planted smells as a
positive control (section 3 of the skill). The two runs that had them could
be interpreted because of them, and the run without them could not say
whether its one kill was right.

Not done, because it needs a run to judge: a token prediction in the record;
a real exclusion for a data table inside a hand-written file; the
supervisor's cost beyond the one ground rule.

One read of v0.6 (`gpt-6.2-sol`, read-only, against v0.5) gave eight
findings, all accepted and repaired by changing words, not by adding rules:
one failing run of a flaky test could still kill a patch through the check
step; a doubted kill left its record `admitted`, and only `supported`
records were spiked; the trim had dropped "that names a file" from the guard
check, "without replacement" from the class delete, and the splitting of a
file larger than one read call; the low-return rule could not fire under the
five-record minimum; a thin record that was not spiked had two statuses; the
positive control did not say that plants are reported apart from the working
set. Nobody has read the repairs, and v0.6 has not been run.

### Candidates as listed after the first wave

Sources: the supervisor's 34 notes (F01 to F34 in its `friction.md`) and the
numbers above.

1. **Refutation.** State who or what observes each observed falsifier; give
   refuters and spikers the list of section 0, with "and something observes
   it" on lifetime, order and cost; send every overruled kill to the spike as
   an unchecked falsifier; let a second refuter, not the supervisor, break a
   tie; a kill of the wording (the literal edit does not compile) is not a
   kill of the change (F18, F20, F21, F26, F27, F33).
2. **Deletion that removes a test.** The negative control is a fault in the
   production code that test reached, not a reference search (F27).
3. **Ranking and caps.** Ranking by predicted lines starves the small, safe
   classes; rank inside precedence classes or reserve slots, and let several
   small hypotheses of one class share a refuter and a spike. Say which
   low-ranked ones are spiked for calibration (F17, F22; plants P1 and P2).
4. **Currency.** Decide whether moving test-only code out of production
   counts (production tokens fall, test tokens rise by as much): four readers
   ranked exactly that first and it was deferred (F13). Predict tokens, not
   only lines, or check the token balance before spending a spike (F28).
5. **Records.** Anchor: a verbatim part of one line (F12). One intervention
   per record (F14). Define the precedence classes, and treat records with
   the same intervention as twins, not alternatives (F11, F15). Guards as
   selectors a runner accepts, checked at admissibility (F29). Defect
   candidates as a by-product list, not a status (F16).
6. **Scoping.** Which lens runs on which kind of partition (F06). Name the
   contract documents in `scope.md` (F08). An inner-loop command that runs a
   named subset and lists the executed cases, run once before the spikes
   (F04, F24). The comparison file outside the spike's work tree (F25).
   Where the frozen tree may live so that subagents can read it (F01).
7. **Groups.** Drop "one pass per lens" or define it; the later lenses of a
   group got less attention (F30, F07).
8. **Leads and tools.** A clone lead without the network and without a line
   threshold; what to give the dead-weight reader when no unused report
   exists; how to save answers verbatim (F02, F03, F10).
9. **Report.** Separate what the user must read from what must be on file:
   the full section 8 came to 120 kB (F34).
10. **Cost.** Readers are 87% of subagent cost. Untested ways to cut it: one
    bundled file per partition and per document set instead of a read per
    file, a lower thinking level, cheaper reader models, fewer lenses per
    partition chosen from the leads.

## 12. Held-out run (27 Nov 2026, 12:49 to 13:56 UTC)

Run as registered in section 7.2 on skill v0.4 (`b69805bf`), without
interference. The supervisor's run directory
(`debug/20261127-1249-cqr-manure-backend` in its harness work tree) holds its
report, its residue file and 41 notes on the skill text.

**Outcome on `manure/backend`** (production 5,261 lines and 75,301 tokens,
tests 5,005 lines and 100,648 tokens, plants included):

- Five readers on `moonshotai/Kimi-K3.1-Pro` (four groups on production
  code, one on test code), ten lens passes, 29 records, none inadmissible.
- 15 went to refutation (the cap), 2 were cut as untested, 2 deferred, 10
  stood behind a twin or a preferred record.
- The refuters killed 4. The supervisor doubted 2 of those and asked a second
  refuter: one kill was confirmed, one was not and went to its spike as an
  unchecked falsifier. End: 3 refuted, 12 supported.
- 5 spikes, all confirmed, each with a negative control that fails a test:
  16 lines and 213 tokens of production code and 5 lines and 69 tokens of
  test code smaller. Three are real findings: `SecretCodec` re-implements
  the shared `Secrets` (8 lines, 91 tokens), `Payloads.hasLive` has no
  caller (4 lines, 46 tokens), two test set-ups repeat one drain loop (5
  lines, 67 test tokens). Two are plants, measured at exactly their planted
  size.
- 7 supported hypotheses stayed unmeasured behind the spike cap.

**Plants** (answer key hash as registered; all verified by site overlap):

| Plant | Found by a reader | End state |
|---|---|---|
| P1 renamed copy of `SecretCodec.sha256` | yes | refuted: "a test is weakened", because the test and the code would call the same helper again |
| P2 unused `Artifact.remainingSeconds` | yes | confirmed, 1 line and 21 tokens |
| P3 pass-through `CatalogueReader` | yes | confirmed, 3 lines and 55 tokens |
| P4 hand-rolled `exists` | yes, under three lenses | refuted, also by the second refuter: "inlining would repeat code", because the one-line predicate occurs twice elsewhere |
| P5 one validator written three times | yes | supported, not spiked |
| P6 unused helper in test support | yes | untested: cut by the refutation cap |

**Against what was stated before the run.**

1. *Readers on the open model: met.* None of 29 records inadmissible; five of
   five production plants found, and the one in the tests. Two reservations.
   The readers returned 29 records, against 55 from the four group readers of
   the first wave on half as much code; the run cannot say whether the code
   or the model is the reason. And one reader claimed a complete read that
   the tool logs contradict (four shared README files never reached it).
2. *Refutation repaired: not met.* The supervisor overruled no kill alone,
   but 2 of 4 kills needed a second opinion (stated limit: a third). Worse,
   and not foreseen in the criteria: two of the three final kills reject
   changes that are known to be sound, because they restore the code as it
   stood one commit earlier. Both kills had an observer by the letter of
   v0.4.
3. *Ranking repaired: met.* All five production plants reached refutation.
   The plant in the tests was cut by the cap.
4. *Cost.* 37.71 USD as the harness reports it, in 67 minutes: supervisor
   21.75, spikers 5.39, refuters and second opinions 3.11, stub generations
   for the model switch 0.88, readers 6.58 (nominal: they ran on a model the
   employer hosts). Without the readers 31.13, against an expectation of
   under 50. The first wave cost 121.83 for half as much code.

**What counts against v0.4.**

- *Reading still kills sound changes.* Two of five production plants died in
  refutation. The first wave showed the same weakness from the other side:
  of two kills the supervisor overruled there, the spikes confirmed one
  change and failed the other. In both runs the executed test was right
  where readers disagreed. Refutation by reading earns its cost as
  preparation (differences, guarding tests, things for the spike to check);
  as a gate on questions of behaviour it is not reliable.
- *Twins share a fate across lenses.* The kill of P4 came from a falsifier of
  the abstraction-fitness card and took the library-underuse and reinvention
  records of the same change with it.
- *Spikes were not isolated.* Two spikers wrote their test output into the
  same directory under the shared home directory; one overwrote the other's
  evidence. A spiker noticed, the procedure did not.
- *A reader's own account of what it read is not evidence*, and a bundle is
  not "a few calls": the read tool returns about 24 kB per call, so a reader
  needed 14 to 17 calls for the production bundle.
- *The calibration slots* took two of five spikes for the two smallest
  changes while supported ones predicting 6 to 19 lines stayed unmeasured.
- *History only ever counts against a hypothesis.* "This restores what stood
  until the last commit" has no weight in the text.

**Limits of this run.** Tuned text, group readers, bundles, another reader
model and another codebase changed together. The plants sit in the newest
commit, which the supervisor and one refuter noticed in the history (after
the readers had answered; readers had no history). JVM suites only: the
native executable and the full verification were not run for any spike.

### Candidates for v0.5, not applied

1. Reading refutes only what reading can prove: feasibility, project rules,
   contract changes, the token balance. Questions of behaviour become checks
   for the spike, and only a run refutes them; the spike cap rises
   accordingly (a spike cost about 1.10 USD here, a refutation about 0.20).
2. A kill by one lens's falsifier does not kill a twin from another lens.
3. Card and rule wording: "inlining would repeat code" means the abstraction
   has two or more callers; "a test is weakened" means the patch edits or
   removes assertions; `reword` also covers a hypothesis that holds at all
   sites but one; "can observe" against "does observe".
4. One scratch directory per spiker, named by the supervisor.
5. Reader coverage from tool logs where the harness keeps them; bundles cut
   to the read tool's size.
6. Calibration: one slot, or none below a cap of ten.
7. History as a lead (lines changed recently) and as support ("restores the
   previous code").
8. Smaller: a status for records in flight; `confirmed` with ledger entries
   still open; a subset wrapper that drifts from the project's runner; the
   yield columns; `passes.tsv` for group readers. The skill is 53 kB and
   should shrink.

## 13. Cross-service run (27 Nov 2026, 16:32 to 19:05 UTC)

Run as registered in section 7.3 on skill v0.5 (`14840099`), base
`bb9e490a`, without interference. The supervisor's run directory
(`debug/20261127-cqr-cross-service` in its harness work tree) holds its
report, residue file and 34 notes on the skill text.

**Outcome.** The partition is 31 production files of the three servers
(chronicle 15, haystack 9, manure 7; manure has no MCP endpoint): 4,691
lines, 99,197 tokens.

- Three readers on `moonshotai/Kimi-K3.1-Pro` returned 14 records of 60
  allowed, none inadmissible, and named 52 further candidates that they did
  not write up, mostly as token-neutral or as having too many variation
  points. The wiring lens returned nothing.
- 9 went to reading: 1 refuted, 1 deferred, 7 supported. All 7 were spiked.
- 6 confirmed, 1 failed (12 lines fewer, 5 tokens more: the same session
  helper in haystack's `AccountService` that failed with the same numbers in
  the first wave).
- Measured working set: production 27 lines and 617 tokens smaller, net of
  what the patches add under `shared/`; tests 18 tokens larger.

| Confirmed | Net production effect |
|---|---|
| Secret primitives of all three servers delegate to the shared `Secrets` | 10 lines, 264 tokens |
| The start-stage wrapper of the three `Main` files moves to shared service-runtime | 6 lines, 211 tokens |
| Chronicle's `StaticTokens` reads through the shared bounded secret-file reader | 2 lines, 49 tokens |
| Signup and enrollment value types with their defaults, shared | 3 lines, 48 tokens |
| Static-root containment check of chronicle and haystack, shared | 1 line more, 28 tokens fewer |
| Five part-upload routes of chronicle's `Http` through one typed helper | 7 lines, 17 tokens |

The first of these is two thirds on main already: the haystack and manure
parts were applied under Q203 after this run's tree was frozen.

**Against what was stated before the run.**

1. *Known positives: met.* The readers reported the re-implementations of
   the shared `Secrets`, in all three services.
2. *Refutation: mixed.* Two kills by reading. One stood, on a card
   criterion (the surviving implementation would need an option per caller).
   One was doubted, was not upheld by the second refuter and went to its
   spike as an open check, as the text now prescribes; the change was
   confirmed. One doubted of two is over the stated third, though two kills
   are too few for a rate. No kill rested on behaviour. Without plants in
   this run nothing shows whether the kill that stood was right.
3. *Isolation: met.* No spiker wrote into another's scratch directory.
4. *The question the run was for.* Confirmed hypotheses remove 56 lines
   inside the partition files, 1.19% of the partition, and 27 lines net
   (0.58%); nothing supported was left unmeasured; one deferred record
   predicts 9 lines (0.19%). That is under the 2% stated before the run: the
   run does not support that the three services duplicate a substantial part
   of these families. What they share is a handful of small helpers.
5. *Cost: not met.* 107.03 USD as the harness reports it: supervisor 50.69,
   spikers 47.87, refuters and the second opinion 3.63, readers 4.63
   (nominal), set-up 0.23. Supervisor, refuters and spikers together 102.19
   against an expectation of under 60. Seven spikes took 112 minutes.

**What bounds this result.**

- *The test gate was noisy.* The host's load average was 50 to 340 during
  the spikes, partly from other work. Timing-bound tests failed at random on
  the base commit as well as with patches. For four of the six confirmed
  changes "confirmed" means that repeated runs did not tell the patch from
  the base, not that every run was green. The skill has no rule for a
  failure that a rerun does not reproduce; this is also why the spikes cost
  6.84 USD each against 1.08 in the held-out run.
- *Readers were sparing.* 14 records and 52 candidates set aside by their
  own estimate; 24 of the 36 production files of `shared/` were read in full
  by no reader. The low yield is measured for what was proposed, not proven
  for what was not.
- JVM suites only; `scripts/verify`, the native executables and the browser
  suites were not run.

**Candidates for a v0.6, not applied.** A rule for test failures that do not
reproduce (alternate base and patch, compare rates, never retry until
green), and spikes one at a time on a loaded host. The refuted and failed
lists of earlier runs as input to a new run. A rule for "few records, many
self-rejected candidates". Who sorts falsifiers into hard and behaviour; a
status for a doubted kill; the scope in the refuter's brief. A digest of each
shared module for the reinvention reader. The supervisor's own cost, which
was the largest item in two of three runs.

### After three runs

| Run | Code read (production) | Confirmed, real | Cost as reported |
|---|---|---|---|
| First wave, haystack server | 2,640 lines | 12 lines, 251 tokens | 121.83 USD |
| Held-out, manure backend | 5,261 lines (and 5,005 of tests) | 12 lines, 137 tokens; tests 5 lines, 67 tokens | 37.71 USD |
| Cross-service, five families | 4,691 lines | 27 lines, 617 tokens net | 107.03 USD |

The procedure does what it was built for: no reader invented a path or a
quote in 166 records, eleven of eleven planted smells were found, every
change in a working set was measured and behaviour-checked, and two changes
that looked like savings were stopped by the token gate or by a fault
injection. On this code it finds little: between 0.2% and 1.2% of the
production lines read. The first measurement already pointed that way (0.5% literal
duplication in production code, most clones in tests); the three runs show
that re-implementation, which a clone detector cannot see, is not much larger
here.

## 14. Open findings for the owner

What the three runs found and did not turn into applied changes. Details are
in the run reports (paths in section 15). Plants are left out.

**Supported by reading, never measured** (a spike is needed before applying):

| Where | Finding | Predicted |
|---|---|---|
| haystack server | `QualifiedId.encodeComponent` checks UTF-16 well-formedness with its own surrogate loop; the JDK's encoder can do it (`A/library-underuse/3`) | 9 lines |
| haystack server | `ItemMetadata.stamp` is called only by a test; production stamps inline in `Mutation.decide` (`A/dead-weight/7`) | 5 lines, 3 of tests |
| haystack server | One production `ModuleDef` as composition root, as chronicle has (`B/wiring/1`) | 8 lines more, 30 of tests fewer |
| manure backend | Four callers repeat the classpath SQL-resource read for migrations (`duplication/prod/1`; the cross-service run deferred the same thing as `reinvention/xsvc/6`) | 9 lines |
| manure backend | `SweepTrace` hand-writes 21 pass-through `MetadataTxn` methods that Scala's `export` can generate (`test-support/test/2`) | 19 lines of tests |
| manure backend | No caller: `Artifacts.snapshot`, `ImportReceipt.rootBytes`, `SecretCodec.readToken` (`abstraction-fitness/prod/3`, `/5`, `dead-weight/prod/4`) | 3 lines each |
| manure backend | `Jdbc.double` reproduces `Option.orNull` (`library-underuse/prod/3`) | 3 lines |

**Confirmed by spike, not applied by decision:** the static-root check shared
by chronicle and haystack (28 tokens) and the typed helper for five
part-upload routes of chronicle (17 tokens); patches 5 and 6 beside this
note.

**Deferred as "not a saving"** (Q194): production code that only tests use,
first of all haystack's in-memory reference search engine (about 165 lines
that would move from `src/main` to `src/test`); 17 records in the first run.

**Suspected defects in haystack server, by reading, none reproduced** (first
run's report, section 6):

- The mapping from a failure to a client code is written at three to four
  places that disagree: `/mcp` answers a configuration failure with 400 and
  `config`, REST with 503 `unavailable` (`http/Http.scala:93-130`,
  `http/Mcp.scala:61-66`).
- One of three copies of the completion-fragment split lower-cases the whole
  fragment and then cuts at the colon index of the original
  (`query/Search.scala:155-157`).
- `writeSearchProjection` creates two JDBC arrays outside its `try`; the
  first is not freed if the second fails
  (`storage/PostgresItemRepository.scala:153-157`).
- `Wire.retrieved` parses the published version prefix with `.toInt` and no
  shape check (`http/Wire.scala:39-41`).
- The declarative login branch reads the auth configuration a second time
  instead of the request's snapshot (`http/Http.scala:237-238`).
- `Search.validateSort`'s rejection of an invalid sort has one JVM test, and
  that test reaches it only through the otherwise unused `parseSearchSort`
  (`query/Search.scala:23-27`).
- `PostgresSearch` and `Evaluator` disagree on inputs that the parser makes
  unreachable (`storage/PostgresSearch.scala:22-49`).

**Tests that failed at random under host load** (cross-service report,
section 6): `CheckConfigSuite.scala:54` in manure (a 2-second bound on a
child JVM), `BrowserWebSocketTest.scala:595` and
`TransientPublicationTest.scala:220` in chronicle.

**Never reviewed:** the web clients, the CLIs, the Python client, the
scripts, and chronicle outside the five families.

## 15. State

- **Skill.** Draft v0.6 in `20261127-1001-code-quality-review-skill/SKILL.md`
  (50.5 kB, not run; v0.3 to v0.5 were each run once). Not installed:
  nothing is under `nix/pkg/llm-skills/skills/`. In Haystack as
  `corporate-activity:skill-draft-code-quality-review`, revision 3 (v0.6 in
  full, the evidence of the three runs, known defects), attention required.
- **Beside this note:** `measure.py` (the script embedded in the skill, byte
  for byte), `cross-service-patches/` (the six patches of the third run),
  `answer-keys/` (the planted smells of the first two runs; their SHA-256
  are the ones registered in sections 7.1 and 7.2).
- **Applied to main, Q203:** five changes from the first two runs
  (`226908f5`, `1241db7f`, `96329e0b`, `ed425e0c`, `323d2497`): production
  24 lines and 388 tokens smaller, tests 4 lines and 58 tokens smaller. JVM
  suites only, by decision.
- **Applied to main, Q223:** changes 1 to 3 of the cross-service run, as
  `d81b43d7` (chronicle's `Wire.hash` and `Wire.secret` through the shared
  `Secrets`), `c8a0b2f1` (the start-stage wrapper of the three `Main` files
  in shared service-runtime) and `d7c947d7` (chronicle's `StaticTokens`
  through the shared bounded reader): production 9 lines and 333 tokens
  smaller, tests unchanged. Verified with `scripts/verify all` on commit
  `d7c947d7`, clean tree, which main was then fast-forwarded to: 15 member
  checks built, 29 reused, none failed. Built, with cases: chronicle
  backend-full 1,464, eval 176, account-e2e 1; haystack jvm 765, native 41;
  manure backend 303, native 411; shared jvm 402; and without counts the
  packages chronicle, haystack and manure, haystack-browser, haystack-proxy,
  manure-client and manure-config. The run started at 20:04 UTC, after the
  host's load had stayed below 32 (one minute) and 48 (five minutes) on its
  128 cores for two minutes, and took 516 seconds.
- **All eight applied changes together:** production 33 lines and 721 tokens
  smaller, tests 4 lines and 58 tokens smaller.
- **Change 4 dropped** (Q225). Main gained another session's account
  refactor (11 commits in `shared/service-auth` and `haystack/server`) while
  the changes were being prepared, and change 4 (signup and enrollment types
  from shared service-auth) collided with it. Its patch stays in
  `cross-service-patches/`; the local branch that carried it is deleted.
- **Run records** (untracked, in the supervisors' harness work trees under
  `/home/pavel/.pi/agent/subagents/01a21c5a-c75a-75bd-8567-4d3202e982bb/worktrees/`):
  `wt-ponygirls-04aa8cceee04-1795776647075/debug/cqr-20261127-1051` (first
  wave), `wt-ponygirls-03f3b2a7b890-1795783717555/debug/20261127-1249-cqr-manure-backend`
  (held-out), `wt-ponygirls-bb9e490a48f8-1795797135454/debug/20261127-cqr-cross-service`
  (cross-service). Each holds `report.md`, `friction.md`, the records and
  `spikes/` with every patch. The first two trees are detached at the
  planted commits `04aa8cce` and `03f3b2a7`, which no branch names any more.
- **Removed on 27 Nov 2026** (Q222): the 17 spike work trees, after checking
  that each staged patch is kept in its run directory; the local branches
  `haystack-server-helpers` and `manure-backend-helpers`.
- **Published** (public, expiring 27 Dec 2026): Manure artifact
  `f5faf8d04975a5059b0d1f102badcdfd` holds v0.6, this note at `133e4e6d`,
  the patches, the answer keys and the reports of all three runs; earlier
  snapshots are `ff9658ab13163498edafb152a63091ed`,
  `759b1d0dd27d3ea9a78992b0594cf250`, `00256bb27785abbc468e779cbae26880`
  and `b747a13411cf09afe1394f74b227897e`.
- **Decisions:** Q183 to Q186, Q193, Q194, Q202, Q203, Q222, Q223 and Q225,
  all answered (section 6). Never answered, asked in chat only: whether the nine
  lenses are right, and the name and home of the skill.
- **Scratch outside the repository,** not needed: `/tmp/cq-research`,
  `/tmp/cqr-xsvc-bb9e490a`.
