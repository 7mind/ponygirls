# Cuckoo: numbered objectives and rules, and a current set the model edits

Base `e44b2924`. Paths under `.local/` are in the main checkout and are not tracked.

**State (2026-11-27): built.** Commits `7ece6521` (the change) and `6f31b542` (corrections after review), then this
note. The user's reference is `nix/pkg/pi-extensions/ponygirls-cuckoo/README.md`; this note records why it is built
this way, what was decided, and what the validation showed and did not show.

## Request

1. Objectives get sequentially numbered IDs (`AO1`, `AO2`, …, "agentic objective"). An ID is not reused within a
   session.
2. Agents can already inspect Cuckoo data. Give them a tool to edit objectives and rules as they go: add an entry when
   a new objective or rule appears, retire an objective that became obsolete. The user then sees fresher information
   and can lengthen the interval between inquiries. The panel shows the snapshots as today, plus the current set of
   entries.

## Observed before the change

Survey of the saved reports under `~/.pi/agent/sessions` (`.local/cuckoo-ledger/survey-identity.mjs`, output
`survey-identity-all-files.txt`): 694 valid reports of versions 3 to 5 in 79 sessions, 620 pairs of consecutive valid
reports on one branch.

| | Objectives | Rules |
|---|---|---|
| Per report, median / 90th percentile / maximum | 3 / 7 / 18 | 25 / 41 / 99 |
| Text per report, median / 90th percentile / maximum (characters) | 286 / 756 / 1738 (titles) | 3933 / 7272 / 14222 (rule and scope) |
| Texts of a report found unchanged in the previous one | 660 | 5845 |
| Texts of a report not in the previous one | 1679 | 10686 |
| Texts of the previous report missing from the next | 120 after `Complete`, 1512 still open | 10177 |
| Pairs with at least one such loss | 517 of 620 (open objectives) | 603 of 620 |

Correction, 27 Nov 2026. The first version of the survey script read each session file into one string and, without
saying so, skipped the one file that is too large for that (1.08 GB, about 100 reports). Its figures, on 591 reports
in 77 sessions, were: 427 of 519 pairs lose an open objective and 506 of 519 a rule; at most 62 rules and 11415
characters of rule text in a report; 8 objectives at the 90th percentile. Those figures stood in the decision
question Q182, on the mockup page, and behind the size of the pilot's seeded record. The shares are the same to
within a point (82 and 97 per cent then, 83 and 97 now); the largest report is larger than stated (99 rules, 14222
characters). The table above is from the corrected script, which streams every file and stops on one it cannot read;
it also includes the five reports this task's own session had saved by then. Found while checking that reports saved
by the deployed extension decode identically with the new code (`legacy-differential.mjs`: 732 of 732 entries of
versions 2 to 4, same decoding and same plain text, no entry numbered).

Comparison is by text after lower-casing and collapsing whitespace. The sampled losses are rewordings ("Unify LK128
corpus embedding under …" became "Unify LK128 embedding under …"), splits and merges, and objectives that were dropped
without a statement. Consequences:

- Text does not identify an objective or a rule across checkpoints. The list of already completed objectives that the
  inquiry carries (`completedObjectives`, exact titles) therefore misses reworded ones.
- A snapshot cannot say whether an objective that is no longer listed was finished, cancelled, merged or forgotten.
- Rules are the larger part of a report, and they are restated in other words nearly every time.

## Design

### Terms

- **Entry**: one objective or one session-local rule with an ID. Objectives are `AO<n>`, rules `AR<n>`, `n` from 1,
  one counter per kind. The request named objectives; the user confirmed in a follow-up message that rules get IDs
  too, in the form `AR…`.
- **Current set** (model-facing: "the record"): the entries of the current branch with their present content and
  status. It is derived, not stored: a fold over two kinds of saved events in branch order.
- **Snapshot**: a saved checkpoint report, as today.

Entry status: an objective is `active`, `complete` or `retired`; a rule is `active` or `retired`. `retired` covers
cancelled, superseded and no-longer-applicable entries. Completion keeps its present convention in checkpoint answers
(`eta` starting with `Complete`); the fold turns it into the typed status, so one fact has one representation on the
wire.

### Events

1. **Checkpoint reports, version 6.** The answer is the present one plus an `id` in every objective and rule:
   `{"id":"AO3"|null,"objective",…}` and `{"id":"AR2"|null,"rule","source","scope"}`. A string names an entry of the
   record; `null` marks a new one. The `id` key is required; an unknown ID, an ID of the wrong kind or a repeated ID
   makes the reply invalid, like a missing answer does today. With standing questions the reply also carries
   `answers`; version 6 covers both cases (the saved record holds the question snapshot, as version 5 does).
   The saved entry gets `assigned: {objectives: [...], rules: [...]}`: the IDs given to the `null` items in their
   order. Reference checks and numbering happen once, when the reply is captured; later reads decode the reply and
   overlay `assigned`. The fold checks the result again: an ID a report names is either in the record or numbered by
   that report, and a number it introduces is not in the record yet. A saved report cannot name an entry into being.
2. **Edits** from the new tool: one `cuckoo.edit` custom entry per call, holding the operation and, for an addition,
   the assigned ID. Custom entries are not model context, follow the branch and outlive compaction, like reports.

Reports of versions 1 to 5 carry no IDs and do not take part in the fold. A session that has only such reports has an
empty current set until its next checkpoint or the first edit.

### Fold

In branch order:

- A valid version-6 report is a full restatement. Each listed objective updates its entry (or creates it): the four
  fields from the report, status `complete` when `eta` says so, else `active` (this reopens a closed entry that is
  listed again as unfinished, as today's "the latest listing decides"). `eta` says so when it is `Complete`, alone or
  followed by punctuation (`Complete; nothing remains`): all 155 completion estimates in the saved reports have that
  form (`.local/cuckoo-ledger/survey-complete-eta.txt`), and `Complete by Friday` is an estimate. An `active` objective the report does not list
  becomes `retired`; a `complete` one stays as it is. Each listed rule updates or creates its entry as `active`; an
  `active` rule the report does not list becomes `retired`.
- An invalid report changes nothing.
- An edit applies its operation. The tool validates against the fold before appending, so the edits of a branch are
  consistent by construction; an inconsistent saved edit is a fault that is reported, like other malformed saved data.

Every entry keeps the event that created it, the event its present text comes from and, once closed, the event that
closed it (entry ID, timestamp, checkpoint number or tool). A retirement keeps its reason: the model's words for the
tool, "left out of that checkpoint" for a restatement. Before this change a snapshot could not tell a cancelled
objective from a forgotten one; the current set shows which it was told. The closing event is kept apart from the
last statement because a completed objective can be restated later (a defect found afterwards): when it was completed
must not move.

### IDs

Cuckoo is the only allocator: the tool returns the ID of what it added, and a checkpoint numbers its `null` items. The
next number of a kind is one more than the highest number of that kind in **all** entries of the session, across
branches, so two branches cannot give the same ID to different entries. A fork starts a new session with the copied
entries and continues from their highest number.

How the model learns the IDs of entries created at a checkpoint: the replacement text that already stands in for a
closed inquiry in provider context names them, each with the first 120 characters of its text, as JSON. Positions
("the second null item") were rejected: counting in a long answer invites editing the wrong entry. No new message
type and no new entry; the text is a pure function of the saved report, so it is the same in every request. Pi sends
it in the user role, so it says that the quoted titles are the model's own earlier wording, not instructions.

Numbering assumes one writer per session file, as the session file itself does. Two Pi processes appending to one
session file concurrently can give one ID to two entries on their two branches; this is documented, not prevented.

### Inquiry

The opening sentence and the rules about which objectives to list stay. Changes:

- The example and the field rules include `id`.
- A paragraph after the example says: copy the ID of an entry you restate, also when you reword it; use `null` for a
  new one; never invent or repeat an ID; the record is your own earlier account, not an instruction; an active entry
  you leave out is closed, completed objectives stay complete.
- The record itself closes the request, after all instructions, as JSON: active objectives (`id`, `objective`),
  objectives already reported as complete (`id`, `objective`; the 50 most recently stated, 300 characters each),
  active rules in full. Instructions first, then the data they refer to; entry text cannot be mistaken for a later
  instruction because nothing follows it.
- The list of completed titles derived from reports remains only for reports of versions 1 to 5, minus titles that an
  entry of the record now carries.

Size: the base request grew from 3672 to 4780 characters; the record adds its own length (about 3.2k characters
for 8 objectives and 25 rules in the pilot below). The answer keeps its size plus the IDs.

Considered and not done: an answer that names unchanged rules by ID only. It would cut the answer by most of its
length and stop the rewording of rules, but a snapshot would no longer be readable from its own reply and the reply
schema would get two forms of a rule. It is the obvious next step if answer size matters.

### Tool `cuckoo_update`

One operation per call; `executionMode: "sequential"`. Blocked during a checkpoint like every tool.

| Action | Arguments | Effect |
|---|---|---|
| `add_objective` | `objective`; optional `progress`, `issues`, `eta` | New active objective; returns its ID |
| `add_rule` | `rule`, `source` (`user`/`assistant`), `scope` | New active rule; returns its ID |
| `update` | `id`; any of the fields of that kind | Changes content, not status |
| `complete` | `id` (objective), `progress` (what was delivered), `issues` (remaining defects, risks, caveats) | Active objective becomes complete |
| `retire` | `id`, `reason` | Active objective or rule becomes retired |
| `reopen` | `id` | Closed entry becomes active again |

- Limits are those of a report: 100 active objectives, 100 active rules, 100 issues, 8000 characters per string.
  The tool also keeps the text of the active objectives, rules and scopes within 50000 characters, half of what one
  reply may hold: without that bound, edits could build a record that no checkpoint reply can restate.
- `update` changes an active entry or a completed objective (a caveat found later); a retired entry changes only by
  being reopened. Arguments that belong to another action are refused, not ignored.
- Rules are session-local only, as in the checkpoint prompt: user instructions of this session and conventions the
  model adopted, not what system prompts, AGENTS.md or skills say. `source: user` remains the model's attribution, not
  proof of a user instruction.
- A completion made with the tool counts as reported: the next checkpoint leaves the objective out, and the record
  keeps what was delivered and the caveats. (The alternative, restating it once more at the next checkpoint so that
  every completion appears in a snapshot, costs output and a more intricate rule about what to repeat.)
- The tool is declared to the model while Automatic mode is on, and hidden otherwise. No new setting. With Automatic
  mode off the set is still built from manual inquiries.
- Reading: `cuckoo_recall` gets the action `current` (a page of JSON, paged like `read`): active entries in full and
  the most recent closed ones. It stays read-only and always available.
- Guidance to the model (tool guidelines and the system-prompt section): add an objective when taking one on;
  complete or retire it when it is done, cancelled or superseded; update when scope, blockers or the expected
  completion change materially; the same for session-local rules; not for routine progress.

### What the model edits versus what a checkpoint restates

Both paths write the same set. The tool is incremental and says explicitly what closes; the checkpoint is a full
statement and closes by omission. A model that never calls the tool gets exactly today's behaviour with IDs added. A
model that keeps the set current makes a checkpoint a confirmation, which is what allows longer intervals.

### Interface

- The panel's table has a first row (`now`) for the current set, selected when the panel opens; it shows the active
  objectives, then the active rules, then the 20 closed entries stated most recently, with how they were closed.
  Objectives come first there, unlike in a report: the view answers what the model is working on, and sessions hold
  many rules. Snapshot rows and their reports stay; version-6 reports show IDs where older ones show ordinals.
- The badge counts the active objectives of the current set (the last valid report's count when there is no set yet).
- A `cuckoo_update` call is one transcript line while collapsed.
- The current set takes no comments and the open panel is not refreshed while the model edits (both by decision).

### Faults in saved data

Saved data this version cannot read (an edit, or the numbering of a report) must not take more away than it has to:
saved reports stay viewable and the current set is shown as unavailable; no inquiry is issued, because its reply could
not be numbered; a reply captured in that state is kept as an invalid checkpoint with its raw text and the checkpoint
ends, because a pending one blocks every tool; closed inquiries are still replaced in model context.

## Decision (Q182, answered 2026-11-27)

Asked on a published mockup page (Manure artifact `d1b850635795fa96ed25bae1ba764676`, public, expires 2027-01-26;
sources under `.local/cuckoo-ledger/mockup/`, frames drawn by a prototype of the pane through Pi's layout engine).
Answer: "A, no extras, the three choices stand".

- Layout A: the current set as the first row of the list (B was two views switched with a key).
- No extras: no comments on entries of the current set (E1), no live refresh of the open panel (E2).
- A checkpoint closes what it leaves out; the tool is declared only while Automatic mode is on; a completion made
  with the tool is not repeated at the next checkpoint.

Differences between the built pane and the frames on that page: an objective whose fields the model has not stated
shows `Not stated: progress, issues, ETA` (the page showed `Progress: Not stated yet`), and a closed entry that was
restated later shows that statement under `As of`. Both came from review.

## Not in scope

- Changing the default inquiry interval. The user sets it (`/cuckoo policy …`).
- Putting the record into the system prompt. It would turn a self-report into standing context.
- Migrating old reports to IDs.
- User-side editing of entries; the user comments, as today.

## Review and what it changed

Two read-only reviewers on the first commit, cut by concern: data model, protocol and wiring (gpt-6.2-sol, high), and
panel, presentation, transcript rows, tests and README (claude-opus-5-5, high). The brief is
`.local/cuckoo-ledger/review/brief.md`. Neither ran code. Nine findings on the first cut, five on the second; none was
dismissed without a reason.

Corrected in `6f31b542`. The behavioural ones each have a test that failed before the correction
(`.local/cuckoo-ledger/fail-first-review-*.log`); the two wording ones have assertions that the second round of
deliberate defects, below, showed to detect their removal:

- A malformed entry on another branch let an inquiry start whose reply could not be numbered; the checkpoint then
  stayed pending and blocked every tool. Now no inquiry is issued, and a reply that cannot be numbered ends the
  checkpoint as invalid with its raw text.
- One undecodable saved report stopped every closed inquiry from being replaced in model context.
- A saved report could create an entry under an ID that numbering then gave out again.
- An unreadable edit made the panel refuse to open and the badge drop every saved report.
- `Complete by Friday` was read as a completion.
- Edits could build an active record of 2.4 million characters, which no reply can restate.
- The panel showed the last statement about a completed objective as the time it was completed.
- Fields the model had not stated were left out without a word once progress was stated.
- The guidance told the model both to report every completion once and to leave tool completions out.
- Three test assertions that could not fail or restated the implementation.

Documented as limits instead (README, "Limits of the record"): two processes on one session file; a report of exactly
100 active objectives has no row left for a completion; the request names only the 50 most recently stated
completions.

## Validation

- **Tests.** 610 before the change, 673 after it (`tests/*.test.mjs`); the type check passes. New files: `current`,
  `numbered-reports`, `inquiry-record`, `update-tool`, `update-lines`, `recall-current`, `view-current`, and cases in
  `lifecycle`, `feedback-lifecycle` and `host` (the real Pi loader and model loop with a scripted provider). The data
  model was written test-first; the tool, its transcript rows and the panel tests were written after their code.
- **Deliberate defects**, because part of the tests came after the code: single-site defects applied one at a time to
  a copy of the extension, the whole suite run for each (`.local/cuckoo-ledger/mutation/mutate.py`). First commit: 92
  defects, 82 detected, 10 not. Nine of the 10 pointed at missing tests (completing a retired objective, the title
  list kept for older reports, the empty update of a rule, numbering of a reply across branches, the badge, shortcut
  and status wiring, an interrupted reply, the registered transcript renderer) and each got one; the tenth was a
  second gate check in the tool that the first made redundant, and it was removed. Second commit: 120 defects (the
  92 re-aimed at the changed code, plus 28 for the corrections), 119 detected. The one not detected cannot be: it
  swaps the closing event of a retired rule for its last statement, and those are always the same event, because a
  retired rule changes only by being reopened.
- **Nix.** The flake checks whose derivations differ from the base (16 of 102, all the Pi extension checks, since
  they share one source derivation) were built at `7ece6521` and at `6f31b542`: all passed, `ponygirls-cuckoo` with
  660 and 673 tests. They are built once more on the merged tree; the final report states that result.
- **Real terminal.** Pi 1.5.2 in a private tmux server with a scripted provider (`.local/cuckoo-ledger/pty/`, four
  runs): transcript rows for successful and refused calls, badge, panel opening on the current set, the refused
  comment key, focus and End, a checkpoint row with IDs, a second checkpoint, a title-only objective, a completed
  objective restated later, sizes 60x24 to 140x40, clean exits, a relaunch with `--continue` in regular mode, and a
  session file with an edit of an unknown version (badge `!`, the error line above the saved report, refused tool
  calls and inquiry). Seen there: in a continued session the start-up notice about such a fault stands at the top of
  the transcript, above the replayed history, so it is off screen unless the user scrolls up; what stays visible is
  the badge and the panel's error line. That placement is Pi's and is the same for Cuckoo's other start-up faults.
  Mouse clicks were not exercised.
- **Live models.** `scripts/cuckoo-record-pilot` (protocol, runner, grader with scripted cases, stored runs and the
  full tables in its README). Extension at `6f31b542`, synthetic content, three subjects of one provider family,
  144 sessions, all completed. A first batch with an earlier runner was exploratory: reading its requests showed that
  seeded sessions lacked Pi's leading system message, so the prompt arrived as a patch after the inquiry, and that
  the working directory in the prompt named the cell. The protocol was then written down and committed before the
  batch reported here; two amendments followed in the open (more sonnet sessions; a reading the grader lacked).

  *Checkpoint replies* (a record of 8 objectives and 25 rules, a conversation that completes one objective, cancels
  one, adds one and lifts a rule; two inquiries per session; half the sessions with the numbered exchange out of
  context):

  | | fable-5-2, high | haiku-5-5, low | sonnet-5-5, medium |
  |---|---|---|---|
  | Sessions | 12 | 12 | 24 |
  | Replies valid | 24 of 24 | 24 of 24 | 48 of 48 |
  | ID references naming the entry they were given to | 744 of 744 | 758 of 758 | 1509 of 1509 |
  | Entries restated as new, or dropped | 0 | 0 | 0 |
  | Completed objective `Complete` once, then left out | 12 of 12 | 12 of 12 | 22 of 24 (2 repeated it) |
  | Cancelled objective left out at once | 12 of 12 | 12 of 12 | 21 of 24 (3 listed it once more as cancelled) |
  | New objective `null`, then named by its new ID | 12 of 12 | 12 of 12 | 24 of 24 |
  | Rule the user lifted | left out | left out, kept under its ID with the new meaning, or replaced by a new rule | left out with the exchange in context; without it, the same three ways as haiku |

  Sonnet's five deviations are all in the variant without the numbered exchange in context.

  *Keeping the record current with the tool* (four user turns that state objectives and rules, complete some and
  cancel one; `cuckoo_update` is never mentioned by the user; then one inquiry). "Current" by the registered rule:
  every stated objective and rule recorded in its turn, no refused call, a valid final checkpoint that neither
  repeats a completion nor revives a retirement.

  | | fable, high | sonnet, medium | haiku, low |
  |---|---|---|---|
  | Only Cuckoo's tools declared | 12 of 12 | 24 of 24 | 2 of 12 |
  | Pi's built-in tools declared as well (blocked) | 12 of 12 | 7 of 12 and, in the scenario held out, 0 of 12 | 2 of 12 |
  | Rules the user gave, recorded in their turn | 24 of 24 | 48 of 48 | 24 of 24 |
  | Shape of the record | one entry per objective; the cancelled one retired with a reason; completions with caveats | one entry for the whole request, updated each turn and completed at the end, the cancelled item inside it | mostly no objective (18 of 24 sessions) |
  | Refused calls, invented IDs, duplicates | 0 | 0 | 0 |
  | Provider requests beyond one per turn (4 turns) | 4 to 7 | 1 to 5 | 1 to 4 |

  What this shows. The ID protocol holds for all three subjects on a record of realistic size, also when the exchange
  that numbered it is out of context. Whether the record is current *between* checkpoints depends on the model: the
  strongest at high effort kept it current in every session; the middle one keeps a coarser record and, beside the
  built-in tools, recorded no objective in 10 of 12 sessions of the scenario whose request does not enumerate them
  (and in none of the 12 by the turn that stated them); the weakest at low effort records rules and rarely
  objectives. For the latter two the record is as current as their last checkpoint, which is
  the behaviour before this change, with IDs added. Whether to lengthen the interval is therefore a per-model choice
  of the user; the default is unchanged.

  What it does not show. There is no work in the tool sessions and the built-in tools were declared but blocked, so
  the model never chooses between the record and a task. Declaring the built-in tools also changes the system text
  Pi derives from them (the tool list and their guidelines), so the difference between the two tool cells is not
  attributable to the tool definitions alone. Sessions are short: nothing here is about long sessions,
  many checkpoints or real compaction. One provider family; 6 or 12 sessions per model and condition. In a chat turn each use of
  the tool costs one more provider request; in a working turn the call can ride with other tool calls, which was not
  measured. The wording of the guidance was not changed after these results: a change would need the whole batch
  again and a new held-out scenario.

## Not done

- A checkpoint answer that names unchanged rules by ID only. It would shrink the answer by most of its length and
  stop the rewording of rules, at the price of snapshots that are not readable from their own reply.
- Comments on entries of the current set, and a panel that follows edits while open (decided against for now).
- A second wording of the guidance aimed at what the pilot showed for the middle model (one entry per objective;
  retire a cancelled item instead of completing the entry around it; record objectives the user does not enumerate).
  The harness for measuring it is in the tree.
- The pilot harnesses under `scripts/cuckoo-pilot` and `scripts/cuckoo-memory-pilot` are frozen experiments in no
  check and were not ported to the numbered reply form; `scripts/cuckoo-memory-pilot` fails the same 9 of 51 tests
  before and after this change.
