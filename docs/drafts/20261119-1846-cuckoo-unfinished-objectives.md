# Cuckoo: a completed objective is reported once

History of one task on base `ff04a534`:

1. `1565709e` told the model to omit completed objectives ("strict" below).
2. `5f91f874` corrected this note after an independent review: the omitted entries had carried caveats.
3. The user then chose a third behaviour (decision Q117): the model states a completed objective and its caveats once
   and does not repeat itself afterwards. This note describes that behaviour; sections 4 and 5 keep the earlier evidence.

## 1. Behaviour

- Every unfinished objective is listed: work is still left for the model, including work it must do once something it
  waits for arrives.
- A completed objective is reported exactly once, in the first checkpoint after it was completed: `progress` says what
  was delivered, `issues` holds its remaining defects, risks and caveats, `eta` is `Complete`. Later checkpoints leave
  it out. A new defect or risk in completed work is reported once the same way.
- Cancelled and superseded objectives are omitted.

Two mechanisms:

- **Wording** (`src/state.ts` `INQUIRY_OBJECTIVES` and the reminder at the end of the field rules; `src/recall.ts` for
  the system-prompt section). The opening sentence is unchanged: fixtures and pilots recognise an inquiry by it.
- **A list of what was already reported** (`completedObjectives` in `src/report.ts`, passed to `inquiryText` by both
  inquiry paths in `index.ts`). The model can see its earlier answers only until compaction removes them; saved reports
  stay on the branch. The extension takes the objectives whose latest listing in the valid saved reports has an `eta`
  starting with `Complete` (at most the 50 most recent, 300 characters each) and appends them to the rule as a JSON array
  the model must not report as completed again. An objective listed again as unfinished leaves the set. With none, the
  inquiry is exactly the base text (3672 characters, SHA-256
  `c6bd844b4130f45d3f2fa81c1ba87f2394c961d3e3e11190ddc7c1e36b6c3be5`, pinned in `tests/questions.test.mjs`).

The schema is unchanged: a completed objective is recognised by its `eta`, a convention in a text field. A typed status
field would be the explicit form; it needs a new report version, panel changes and new fixtures, and was not done.

## 2. Observed defect

Survey of saved reports under `~/.pi/agent/sessions` (script `.local/cuckoo-open-objectives/harness/survey-saved-reports.mjs`,
output `logs/survey-before.txt`). An objective counts as done-like when its ETA or progress starts with a completion
word or says no work remains; the pattern is narrow, so the counts are lower bounds.

| Model | Valid reports | Reports with a done-like objective |
|---|---|---|
| ai-gateway-anthropic:claude-fable-5-2 | 103 | 26 |
| anthropic:claude-fable-5-2 | 27 | 4 |
| openai-codex:gpt-6.1-sol | 86 | 1 |
| openai-codex:gpt-6.2-sol | 15 | 0 |
| two other models | 19 | 0 |

Typical entries: "Done, landed on main and pushed … ETA: No work left unless the owner asks for changes", "Complete;
promotion is the owner's decision", "Done on my side; waiting for a reply". Every one of the 40 flagged objectives had a
nonempty issues list (1 to 6 items), often an open problem. The original inquiry already contained "List only current
objectives; use an empty array if none remain", as the last sentence of its field rules, about 270 characters before
the end of a 2777-character request.

## 3. Evidence for the current behaviour

Harness (kept in `.local/cuckoo-open-objectives/harness/`, outputs next to it): a Pi SDK session with the gateway
provider extension and the Cuckoo extension loaded from one source tree; a seeded synthetic conversation with at least
one earlier closed checkpoint; then two real `/cuckoo inquire now` in a row. Model `claude-fable-5-2` through the
gateway, no tools, invented content only. Each objective of the 16 scenarios is classed as open, newly completed (not
yet reported as complete), or already reported, cancelled or superseded. Grading is a keyword match on objective titles
and progress, checked against the expected objective count of each report.

| Arm | Sessions | First report states a newly completed objective | Second report repeats one | Open objective missing | Already reported one listed again |
|---|---|---|---|---|---|
| Original wording (`ff04a534`) | 64 | 20 of 92 | 13 of 64 sessions | 0 | 0 |
| Strict (`1565709e`) | 64 | 0 of 92 | 0 of 64 | 0 | 0 |
| Current, effort high | 64 | 92 of 92 | 0 of 64 | 0 | 0 |
| Current, effort xhigh and medium | 40 | 56 of 56 | 0 of 40 | 0 | 0 |

- The original wording repeats: where it listed a completed objective in the first report it listed it again in the
  second (`ledger-habit` 4 of 4, `residual-risk` 4 of 4, `review-just-delivered` 4 of 4, `heldout-loose-ends` 1 of 4).
  This is the behaviour the request was about, reproduced with two inquiries in a row.
- With the current code every objective count equals the expected one: open plus newly completed in the first report,
  open only in the second. In one session the second report added an entry for a completed objective to state a defect
  that the first had not mentioned, as the rule allows.
- All 182 completed entries carry `eta` exactly `Complete`. In the scenarios with known caveats the caveat text is in the
  first report of every session and in no second report.
- Every second inquiry carried the list of titles and contained each title the first report had marked complete (126
  sessions, including the two arms below).
- **Compaction.** With the seeded earlier reports kept as saved reports but removed from the model's context, the
  wording alone listed already reported objectives again in the first report of 12 of 12 sessions (and dropped them in
  the second). With the list: 0 of 12.
- **Standing questions.** 10 sessions with one standing question: valid composed replies, same objective behaviour.
- The wording of this behaviour was written once and not adjusted after its first run; the 16 scenarios existed before it.

## 4. The strict variant and its review

`1565709e` asked for unfinished objectives only. Its live comparison (one inquiry per session): the original wording
listed a finished objective in 16 of 92 development reports, the strict wording in 0 of 80; no open objective was missed
in 260 reports. An independent read-only review recomputed the counts, found the code and tests correct, and changed
what the numbers meant:

- In these sessions the original wording did not list finished objectives at random: it listed them when it had
  something to say about them. 15 of the 16 development entries carried caveats the conversation had not stated. In
  `heldout-loose-ends` 10 of 16 reports listed the finished work, all 10 to raise a risk the model noticed at the
  checkpoint; the first version of this note had counted the one such report among four as the defect.
- The strict wording removed those caveats unless an open objective depended on them (`ledger-habit` 9 of 10 against 0
  of 8, `residual-risk` 8 of 8 against 1 of 8, `heldout-loose-ends` 10 of 16 against 0 of 16; `programme-stages` 10 of
  10 against 8 of 8).
- Right after a complete delivery the strict wording gave an empty report (0 of 8 against 8 of 8).
- The first held-out set had been run on an intermediate wording; the keyword grader missed one title; a harness flag
  for the system section read the wrong source.

Two other ways to keep the caveats were measured and not adopted: a standing question (40 sessions, caveats named in
all 28 sessions of the scenarios that have them, objectives clean) and a sentence treating an untold defect or risk as
work left (80 sessions; it produced "Tell the user about …" objectives, more of them than the original wording had
entries).

## 5. Consequences and limits

- A defect in completed work is stated once and then leaves the reports, also when it needs a correction. In
  `review-unreported-defect` the current wording reported the invented endpoint in the first report of 4 of 4 sessions
  and kept no objective for it in the second; the strict and original wordings kept a correction objective in both
  reports of 4 of 4.
- The second inquiry follows the first directly. Real sessions have long tool-using stretches between checkpoints and
  several completions per stretch; that was not run. Rerun the survey after some days of use: under the new rule a
  title with `eta` `Complete` should occur in one report only.
- The list matches titles exactly. A completed objective that the model later lists as unfinished under a different
  title stays in the list; the rule then only forbids reporting its completion again.
- The badge and the panel count a completed objective in the one report that lists it. A report does not distinguish
  an objective that was never listed from a cancelled one.
- One model was run live. GPT models were not run: the isolated harness reaches the gateway only, and their saved
  reports rarely show the defect.
- One author wrote scenarios, wording and grader; 2 to 4 sessions per cell and arm.
- Which element of the wording produces the effect was not separated.
- `scripts/cuckoo-memory-pilot` appends its delta focus to the live inquiry. Its frozen protocol pins the extension
  sources by hash and refuses to run against the changed text; a new freeze is a different study from `study-v1`.

## 6. Verification

- Fail-first: the new and updated tests run against the previous sources fail on the missing export, the absent list
  and the pin (`logs/fail-first-once.log`, 3 failures); for the strict variant `logs/fail-first.log`.
- Local: `PI_OFFLINE=1 PI_TELEMETRY=0 node --test tests/*.test.mjs`, 564 tests pass, none skipped
  (`logs/local-tests-once.log`).
- Nix: `nix build .#checks.x86_64-linux.ponygirls-cuckoo .#checks.x86_64-linux.subagents-policy-shape --no-link -L`.
- The sources the "current" arms ran are saved in `once-final-*/src/` and are the committed ones.
