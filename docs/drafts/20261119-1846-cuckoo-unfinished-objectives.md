# Cuckoo: reports list unfinished objectives only

Base: `ff04a534`; branch `task/cuckoo-open-objectives`, worktree `.worktrees/wt-ponygirls-cuckoo-open-objectives`.

## Request and interpretation

The user wants models to stop adding completed objectives to Cuckoo reports. Operational reading: an objective belongs in
a report only while work on it is still left for the model, including work it must do once something it waits for
arrives. Completed, cancelled and superseded objectives are omitted. The report schema has no status field, so the
decoder cannot enforce this; the change is to the model-facing text.

## Observed defect

Survey of saved reports under `~/.pi/agent/sessions` (script: `.local/cuckoo-open-objectives/harness/survey-saved-reports.mjs`,
output `logs/survey-before.txt`). An objective counts as done-like when its ETA or progress starts with a completion
word or says no work remains; this is a narrow pattern, so the counts are lower bounds.

| Model | Valid reports | Reports with a done-like objective |
|---|---|---|
| ai-gateway-anthropic:claude-fable-5-2 | 103 | 26 |
| anthropic:claude-fable-5-2 | 27 | 4 |
| openai-codex:gpt-6.1-sol | 86 | 1 |
| openai-codex:gpt-6.2-sol | 15 | 0 |

Typical entries: "Done, landed on main and pushed … ETA: No work left unless the owner asks for changes", "Complete;
promotion is the owner's decision", "Done on my side; waiting for a reply". The old inquiry ended with "List only
current objectives; use an empty array if none remain", after about 2700 characters of other rules.

## Change

- `src/state.ts`: a rule paragraph directly after the schema example (`INQUIRY_OBJECTIVES`), the example objective text
  `unfinished objective`, and a closing reminder that replaces the old last sentence. The opening sentence is unchanged:
  fixtures and pilots recognise an inquiry by it, and a variant that changed it did no better.
- `src/recall.ts`: the system-prompt section says reports list unfinished objectives only.
- Tests: the prompt contract (`tests/data.test.mjs`), the base-inquiry pin and the standing-question composition
  (`tests/questions.test.mjs`). README updated.

## Live comparison

Harness (kept in `.local/cuckoo-open-objectives/harness/`, outputs next to it): a Pi SDK session with the gateway
provider extension and the Cuckoo extension loaded from one source tree; a seeded synthetic conversation with at least
one earlier closed checkpoint; then one real `/cuckoo inquire now`. Baseline is the installed extension build, which is
byte-identical to `main` at the base commit; the candidate is this worktree. Model `claude-fable-5-2` through the
gateway, no tools, invented content only. A report is graded by keyword match on objective texts, and the objective
count of every graded report was compared with the number of open objectives in its scenario.

Ten development scenarios cover accepted, cancelled, superseded and all-finished work, finished work with a loose end
(the team may comment, the user runs a migration later, a risk the assistant flagged), a habit of earlier checkpoints
that list finished objectives, and controls that must keep an objective (work that waits for a decision, a draft with
an announced revision round). Four held-out scenarios were written after the wording was frozen.

| Arm | Set | Effort | Reports | Listing a finished objective | Missing an open objective |
|---|---|---|---|---|---|
| baseline | development | high, medium, xhigh | 92 | 16 | 0 |
| baseline | held-out | high | 16 | 1 | 0 |
| final wording | development | high (40), medium (20), xhigh (20) | 80 | 0 | 0 |
| final wording | held-out | high | 16 | 0 | 0 |

All 16 baseline development failures are in the two loose-end scenarios (`ledger-habit` 10 of 10, `residual-risk` 6 of
8): "Complete unless the team comments", "My part is done; completion depends on your run next week". Two earlier
wordings also listed no finished objective (30 and 98 reports). The first one told the model to restate an objective as
its remaining step; it renamed partly finished objectives that way, so that sentence was removed.

## Limits

- The baseline dropped cleanly finished objectives in every synthetic scenario, including the ones with a habit of
  "Done" entries in earlier checkpoints. The long real sessions also kept such objectives; that mode was not reproduced,
  so the effect on it is not measured. Rerun the survey after some days of use to see it.
- Only one model was run live. GPT models were not run: the isolated harness reaches the gateway only, and their saved
  reports rarely show the defect.
- Short sessions, no tools, one inquiry per session. Keyword grading; no semantic judge.
- A finished objective that still has a known risk now leaves the report together with that risk.

## Verification

- Fail-first: the new and updated tests run against the base sources fail on the missing rule and on the pin
  (`logs/fail-first.log`: 2 of 17 fail, `2777 !== 3388`).
- Local: `PI_OFFLINE=1 PI_TELEMETRY=0 node --test tests/*.test.mjs`, 562 tests pass, none skipped (`logs/local-tests.log`).
- Nix: `nix build .#checks.x86_64-linux.ponygirls-cuckoo .#checks.x86_64-linux.subagents-policy-shape --no-link -L`.
- The model-facing inquiry of the committed tree is the one the final arm used: 3388 characters, SHA-256
  `61f43461fe7c17beb5ea0a178e6f2d844a7da9148c8c185d58ce1583a50f823c`.
