# Code-quality review skill: design draft v0.4

Status: proposal for discussion, 27 Nov 2026. Nothing here has been run end
to end. The text has had two independent readings and one re-reading of the
revision (section 9); the script has been tested on small cases and on this
repository. The draft skill is
`20261127-1001-code-quality-review-skill/SKILL.md` (one file, as
`nix/pkg/llm-skills` packages skills); `measure.py` beside it is the script
embedded in the skill, byte for byte.

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

## 8. Known weaknesses of the draft

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
`debug/cqr-20261127-1051` in its harness work tree (path in section 13).

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

## 13. State, for resuming

- Branch `code-quality-review-skill`, work tree
  `.worktrees/wt-ponygirls-code-quality-review-skill`; not merged. Commits:
  `cf738b4e` (v0), `4bf77c32` (v0.1), `7f1ed212` (v0.2), `4225bf3e` (v0.3);
  v0.4 follows.
- Held-out tree: local branch `manure-backend-helpers`, planted commit
  `03f3b2a7` (its work tree is removed). Never merge or push it. Answer key:
  `/tmp/cq-research/pilot2/plants.md`. The spike patches of both runs are
  based on the planted commits.
- Pilot tree: local branch `haystack-server-helpers`, planted commit
  `04aa8cce` (its work tree is removed). Never merge or push it. Answer key
  and pilot scratch: `/tmp/cq-research/pilot`.
- Published, public, expiring 27 Dec 2026: Manure artifact
  `759b1d0dd27d3ea9a78992b0594cf250` (v0.4, this note at `56bd3254`, the
  reports and notes of both runs); earlier ones:
  `00256bb27785abbc468e779cbae26880` (v0.3 and the first wave),
  `b747a13411cf09afe1394f74b227897e` (v0.2).
- Haystack: `corporate-activity:skill-draft-code-quality-review`, revision 1
  (v0.4 complete, evidence of both runs, known defects), attention required.
- Decision inbox: Q183 to Q186, Q193 and Q194 answered (section 6). Open in
  chat only: the lens set, the name and the home of the skill.
- Left in place after the wave: five spike work trees with staged patches
  (listed in the run directory's `spike-worktrees.tsv`), the planted branch
  and its work tree. All subagents are closed.
- Pilot first wave done (section 10); the run directory is
  `/home/pavel/.pi/agent/subagents/01a21c5a-c75a-75bd-8567-4d3202e982bb/worktrees/wt-ponygirls-04aa8cceee04-1795776647075/debug/cqr-20261127-1051`
  (`report.md`, `friction.md`, `hypotheses.jsonl`, `spikes/`, `spike-worktrees.tsv`).
- Held-out run done (section 12) on skill `b69805bf`; its run directory is
  `/home/pavel/.pi/agent/subagents/01a21c5a-c75a-75bd-8567-4d3202e982bb/worktrees/wt-ponygirls-03f3b2a7b890-1795783717555/debug/20261127-1249-cqr-manure-backend`
  (`report.md`, `residue.md`, `friction.md`, `hypotheses.jsonl`, `spikes/`).
  Five more spike work trees with staged patches are left in place.
- Not done: v0.5 (candidates in section 12), the review of the remaining
  code, applying any confirmed change, installation under
  `nix/pkg/llm-skills/skills/`. Waiting for the user's decision on how to go
  on.
- Scratch material outside the repository, not needed to continue:
  `/tmp/cq-research` (prior-art downloads, clone-detector probes, the old
  script versions used for the reproductions).
