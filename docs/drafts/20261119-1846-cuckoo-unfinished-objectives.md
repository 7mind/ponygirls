# Cuckoo: reports list unfinished objectives only

Change: commit `1565709e` on base `ff04a534`. This note was corrected after an independent review of that commit; the
section "Review and follow-up runs" is new, and the claims it replaces are named there. The inquiry text did not change
after `1565709e`.

## Request and interpretation

The user wants models to stop adding completed objectives to Cuckoo reports. Operational reading: an objective belongs in
a report only while work on it is still left for the model, including work it must do once something it waits for
arrives. Completed, cancelled and superseded objectives are omitted. The report schema has no status field, so the
decoder cannot enforce this; the change is to the model-facing text.

## Observed defect

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
nonempty issues list (1 to 6 items), often an open problem ("fix underway", "waits for another session"). The old inquiry
already contained "List only current objectives; use an empty array if none remain", as the last sentence of its field
rules, about 270 characters before the end of a 2777-character request.

## Change

- `src/state.ts`: a rule paragraph directly after the schema example (`INQUIRY_OBJECTIVES`), the example objective text
  `unfinished objective`, and a reminder that replaces the old rule sentence. The opening sentence is unchanged:
  fixtures and pilots recognise an inquiry by it.
- `src/recall.ts`: the system-prompt section says reports list unfinished objectives only.
- Tests: the prompt contract (`tests/data.test.mjs`), the base-inquiry pin and the standing-question composition
  (`tests/questions.test.mjs`). README updated.

Which of these elements produces the effect was not separated; no ablation was run.

## Live comparison

Harness (kept in `.local/cuckoo-open-objectives/harness/`, outputs next to it): a Pi SDK session with the gateway
provider extension and the Cuckoo extension loaded from one source tree; a seeded synthetic conversation with at least
one earlier closed checkpoint; then one real `/cuckoo inquire now`. Baseline is the installed extension build, whose
inquiry is the one of `main` at the base commit (2777 characters, SHA-256 `f89443cc…`); the committed wording is 3388
characters, SHA-256 `61f43461fe7c17beb5ea0a178e6f2d844a7da9148c8c185d58ce1583a50f823c`, in every run counted for it.
Model `claude-fable-5-2` through the gateway, no tools, invented content only. Grading is a keyword match on objective
titles, checked against the known number of open objectives per scenario; an independent reviewer read about 120 raw
reports and found no report of the committed wording misgraded.

"Lists a finished objective" below means an entry for an objective with no work left for the model.

| Scenario set | Effort | Baseline | Committed wording |
|---|---|---|---|
| 10 development scenarios | high, medium, xhigh | 16 of 92 | 0 of 80 |
| 4 first held-out scenarios, 4 runs each | high | 1 of 16 | 0 of 16 |
| `heldout-loose-ends`, 12 more runs | high | 9 of 12 | 0 of 12 |
| `review-just-delivered` | high | 8 of 8 | 0 of 8 |
| `review-unreported-defect` (must not list the finished objective) | high | 0 of 8 | 0 of 8 |

No report in either arm missed an open objective (136 baseline and 124 committed-wording reports). In the 12-run
row one baseline report was found by its objective count; the keyword grader missed its title.

- Baseline failures in the development set are confined to two scenarios (`ledger-habit` 10 of 10, `residual-risk` 6 of
  8); the listed entry is always the objective on which someone else acts later ("Complete unless the team comments",
  "My part is done; completion depends on your run next week"). In eight other development scenarios the baseline listed
  no finished objective, including those where earlier checkpoints had "Done" entries. In at least 9 of those baseline
  runs finished work was still reported as done inside the progress of an open objective (reviewer's reading); the
  committed wording has none.
- The first held-out set was run once on an intermediate wording that differed from the committed one only in its
  opening sentence ("Restate me your unfinished objectives"), then on the committed wording. It reproduced the baseline
  behaviour in one scenario only, so it is mostly evidence that open objectives are not dropped on unseen sessions.
- Two earlier wordings also listed no finished objective (30 and 98 reports). The first told the model to restate an
  objective as its remaining step; it renamed partly finished objectives that way, so that sentence was removed.

## Review and follow-up runs

An independent read-only review of `1565709e` recomputed the counts and found the code and tests correct. Its findings
changed what the numbers mean:

1. **What the baseline's finished entries carried.** In these sessions the baseline did not list finished objectives at
   random: it listed them when it had something to say about them. 15 of the 16 development entries carried caveats the
   conversation had not stated (a root cause that was an inference, SQL that was never run, assumed columns, a lock
   risk). In `heldout-loose-ends` 10 of 16 baseline reports listed the finished work, all 10 to raise a risk the model
   noticed at the checkpoint (the job is scheduled in the clock-change hour); the first version of this note counted
   the one such report among four as the defect. In `review-just-delivered` all 8 baseline entries carried untold
   caveats about the delivered regex.
2. **Consequence of the committed wording.** With the finished objective, its caveats leave the report when no open
   objective depends on them: caveat text present in `ledger-habit` 9 of 10 baseline reports and 0 of 8 with the
   committed wording, `residual-risk` 8 of 8 and 1 of 8, `heldout-loose-ends` 10 of 16 and 0 of 16. Where an open
   objective depends on the finished work the caveats moved into its issues (`programme-stages` 10 of 10 and 8 of 8).
   A definite defect that needs a correction is still reported: the invented endpoint in `review-unreported-defect`
   appears in 8 of 8 reports of both arms, as a new objective under the committed wording.
3. **Right after a delivery.** An inquiry that follows a complete delivery, before the user reacts, now gets an empty
   objectives array (0 of 8 list anything; the baseline listed the delivered objective in 8 of 8). This follows the
   stated interpretation; it is also the state at the end of most runs.
4. **Not held out strictly, grading blind spot, a dead harness flag.** Covered above; the runner's
   `systemHasCuckooSection` flag was false in every run although the provider payloads carried the section, and now
   reads the payload.

Two ways to keep the caveats were measured; neither is part of the change.

- **A standing question** (existing feature, no code): `Do you know of any defect or risk in finished work that you
  have not yet told me about?` with the committed wording, 40 runs over 13 scenarios. All replies were valid in the
  composed form (4079 characters, one answer); none listed a finished objective or missed an open one; the answers
  named the caveats in every scenario that has them (`heldout-loose-ends` 8 of 8, `review-just-delivered` 6 of 6,
  `review-unreported-defect` 6 of 6, four development scenarios 2 of 2 each). This is also the only live evidence for
  the inquiry with standing questions.
- **A disclosure sentence in the inquiry** ("A defect or risk that you know of in finished work and have not yet told
  the user is work still left: list an objective for it that states the problem"), 80 runs, not merged. It produced
  "Tell the user about …" objectives with real caveats, and more of them than the baseline had entries: `all-finished`
  4 of 4 (baseline 0 of 10), `tracked-plan` 4 of 4 (baseline 0 of 8), `heldout-loose-ends` 12 of 12,
  `review-just-delivered` 8 of 8. It makes a checkpoint create objectives of its own, which the extension otherwise
  avoids.

## Limits

- The entries in real sessions ("Done … No work left", with residual issues) were kept across many checkpoints of long
  tool-using sessions. The synthetic sessions are short and tool-less, and reproduced the baseline behaviour only for
  finished work with something left to say. The effect on real sessions is not measured; rerun the survey after some
  days of use.
- Residual issues that real reports kept under done objectives will no longer appear unless they belong to an open
  objective or a standing question asks for them.
- An absent objective is ambiguous: a report does not distinguish completed, cancelled and wrongly dropped objectives.
- One model was run live. GPT models were not run: the isolated harness reaches the gateway only, and their saved
  reports rarely show the defect.
- One author wrote scenarios, wording and grader; 4 to 16 runs per cell. The first four-run sample of
  `heldout-loose-ends` showed 1 of 4 where 16 runs show 10 of 16.
- `scripts/cuckoo-memory-pilot` appends its delta focus to the live inquiry. Its frozen protocol pins the extension
  sources by hash and refuses to run against the changed text; a new freeze is a different study from `study-v1`.

## Verification

- Fail-first: the new and updated tests run against the base sources fail on the missing rule and on the pin
  (`logs/fail-first.log`: 2 of 17 fail, `2777 !== 3388`).
- Local: `PI_OFFLINE=1 PI_TELEMETRY=0 node --test tests/*.test.mjs`, 562 tests pass, none skipped (`logs/local-tests.log`).
- Nix: `nix build .#checks.x86_64-linux.ponygirls-cuckoo .#checks.x86_64-linux.subagents-policy-shape --no-link -L`.
