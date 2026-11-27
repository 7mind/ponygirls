# Code-quality review skill: design draft v0.2

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
   configured for a codebase that has none.
2. **Allocation.** (a) One agent per lens per partition, as sketched;
   (b) the four groups; (c) run both on the pilot target and choose by yield
   per token. Recommended: (c).
3. **Admission.** The draft admits to the working set only what a spike
   measured; survivors of refutation that were not spiked are listed apart as
   candidates with a calibrated estimate. Is that the bar you meant by
   "tested", or should a refutation attempt by an independent reader be
   enough? The strict bar costs one build and test run per admitted item.
4. **Lens set.** Are the nine right? `test-support` is the one most likely to
   be unwanted: it touches tests, under the rule that the executed cases and
   assertions may not shrink.
5. **Pilot target, models and budget** (section 7).
6. **Name and home.** `code-quality-review`, installed from
   `nix/pkg/llm-skills/skills/` once it has run; until then on this branch.
   Recording it in Haystack as a skill draft is planned after the pilot, when
   there is evidence to record with it.
7. **Tracking.** No Linear issue was named for this work, so nothing was
   written there. Say if it should be tracked and where.

## 7. Proposed test

**Pilot on haystack** (10.8k production and 11.0k test lines, 1.7 MB), with
`shared/` as its reuse inventory. A subagent with a fresh context is given the
skill file and the scope and acts as supervisor; it reports and applies
nothing; its spikes live in throwaway worktrees. This session watches the run
against a checklist and changes the skill text only for failures it observed,
each logged in section 9.

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

## 10. Tuning log

Empty: no run yet.

## 11. State, for resuming

- Branch `code-quality-review-skill`, work tree
  `.worktrees/wt-ponygirls-code-quality-review-skill`; not merged. Commits:
  `cf738b4e` (v0), `4bf77c32` (v0.1), `7f1ed212` (v0.2).
- Published copy of `7f1ed212`, public, expires 27 Dec 2026: Manure artifact
  `b747a13411cf09afe1394f74b227897e`.
- Open questions in the decision inbox: Q183 (metric), Q184 (admission),
  Q185 (pilot, models, cap), Q186 (Linear tracking).
- Not done: the discussion, the pilot, the Haystack skill-draft record (to be
  written after the pilot), installation under `nix/pkg/llm-skills/skills/`.
- Scratch material outside the repository, not needed to continue:
  `/tmp/cq-research` (prior-art downloads, clone-detector probes, the old
  script versions used for the reproductions).
