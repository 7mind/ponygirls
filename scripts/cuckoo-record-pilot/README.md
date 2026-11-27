# Cuckoo numbered-record pilot (synthetic, live provider)

Does a model follow the ID protocol of Cuckoo's numbered record at a checkpoint, and does it keep the record current
with `cuckoo_update` without being asked? Small, controlled, feasibility only. It does not alter or deploy Cuckoo.
The subject of the experiment is the extension's model-facing text (the inquiry, the system-prompt section, the tool
description and guidelines) as shipped at the commit under test.

## Protocol (registered before the batch below was run)

**Subjects.** `ai-gateway-anthropic` models through the gateway extension, Pi 1.5.2 SDK: `claude-fable-5-2` at `high`,
`claude-haiku-5-5` at `low`, `claude-sonnet-5-5` at `medium`. One provider family: no claim about other families.

**Cells.** One process runs one cell for one subject.

| Cell | Session | Measures |
|---|---|---|
| `checkpoint-visible` | Seeded: Pi's own leading system message, a numbered checkpoint of 8 objectives and 25 rules (the median and 90th percentile of saved reports) with its inquiry and reply in context, then a conversation that completes one objective, cancels one, adds one and lifts one rule. Two live inquiries. | IDs in the replies |
| `checkpoint-compacted` | The same, with the numbered exchange absent from model context, as after a compaction. The record reaches the model only through the inquiry. | IDs without the exchange |
| `tools-only` | Four live user turns, then one inquiry. Only `cuckoo_update` and `cuckoo_recall` are declared. Two scenarios. | Unprompted use of the tool |
| `tools-builtins` | The same with Pi's built-in tools (`read`, `bash`, `edit`, `write`) declared as in a working session. Their execution is blocked and recorded; no task needs them. | The same beside other tools |

The scenario `report` was written after the wording under test was fixed and is used for nothing else (held out);
`build` was used while the runner was developed.

**n.** Six sessions per cell and scenario for fable and haiku, four for sonnet. Feasibility only: no significance
tests, no pooling across subjects.

**Isolation, checked from the request.** No user-level input: extension discovery, skills, context files, prompt
templates, themes and MCP are off; the agent directory is a fresh temporary one holding only Cuckoo's settings
(Automatic mode on, so that the tool is declared; a policy that never comes due). The working directory is a fresh
temporary directory whose path names nothing. Every request of every run is checked: the prompt is the leading system
prompt, no prompt patch stands inside the conversation, an inquiry is the last message of its request, and the seeded
reply is in context exactly in the `visible` variant. A run that fails a check is failed, not graded. Each run records
hashes of its system text (working directory normalised) and tool definitions; `analyze.mjs` prints them per cell and
flags a cell whose runs differ. `DRY=1` builds every session and stops each request before it is sent: the canary.
The request's model and the effort in force are read from the request, not from the runner's arguments. The gateway
may let another model answer (server-side fallback); Pi records that on the reply, the runner collects it per session,
and a session another model answered is reported apart from its cell.

**Outcomes** (`grade.mjs`; scripted cases for each in `grade.test.mjs`).

- Checkpoint reply, per round: valid or invalid; per ID, *right* (names the entry it was given to), *wrong*,
  *restated as new* (an entry of the record under a `null` id), *dropped* (an entry nothing closed is missing);
  the completed objective *Complete* at the first inquiry and *left out* at the second; the cancelled objective *left
  out*; the new objective `null` at the first inquiry and *its ID* at the second; the lifted rule *left out*, *kept
  under its id with the new meaning*, *replaced by a new rule*, or *kept with the old meaning* (undesired); rules the
  user never gave (*invented*, undesired).
- Tool session: each stated objective and rule *by its turn*, *late* or *never*; completions and retirements by their
  turn and at the end; *over-recorded* (an objective made out of a plain arithmetic question, undesired); a small
  request answered in its own turn recorded as an objective (reported, not judged); duplicates; refused calls; blocked
  built-in calls (instrument interference: such a session is reported apart); the final checkpoint valid, not
  repeating a completion made with the tool, not reviving a retirement; `cuckoo_update` calls and provider requests
  beyond one per turn.

**Reading rules.**

- *Protocol followed* by a subject: every reply valid, no wrong ID, no restatement as new, nothing dropped, in both
  checkpoint cells. Any exception is reported with the session and the reply.
- *Keeps the record current*: a session counts when every stated objective and rule was recorded by its turn, no call
  was refused and the final checkpoint is valid without repeating a completion or reviving a retirement. Reported as
  sessions of n per cell and scenario; the held-out scenario is reported separately.
- Subjects are recognised by key patterns. Whatever the grader lists as unclear, wrong, restated, dropped or invented
  is read in the stored reply before it is reported.
- Every run is reported. No rerun replaces a run. A run that failed for a reason outside the subject (provider error,
  a request-shape check) is reported as failed; a cell may be topped up, and the top-up is labelled.
- Stored runs are rescored, never rerun, when the grader changes; both codings are then reported.

## Amendment 1 (2026-11-27, after reading the registered batch; before the top-up runs)

Observation. All 96 registered sessions completed. Two sonnet cells show outcomes that four sessions cannot size: in
`checkpoint-compacted` two of four sessions listed the cancelled objective once more, with "Cancelled by the user" as
its progress, before leaving it out at the second inquiry; in `tools-builtins` no session recorded an objective in the
scenario `report` (0 of 4) while all did in `tools-only` (4 of 4).

Change. The four sonnet cells are enlarged by eight sessions per cell and scenario, with the same runner, extension
and settings, under labels `sonnet-topup-<cell>`. Nothing registered is rerun or replaced. The registered four and the
eight added are reported separately and together; the added ones are labelled as run after outcomes were seen. No
wording of the extension changes in response to this batch.

## Amendment 2 (2026-11-27, after reading the tool sessions; grader only, stored runs rescored)

Observation. Reading the stored sessions showed a behaviour the scripted cases had not foreseen: a subject records
the several things a user asked for as **one** entry ("Deliver three items: (a) …, (b) …, (c) …"), updates it turn
by turn and completes it at the end. Its text matches the key of every stated objective, so the registered reading
"every stated objective recorded by its turn" counted such sessions as fully recorded.

Change. `gradeTools` reports `merged`: entries that carry several stated objectives or rules. The registered reading
is unchanged and still printed; the tables add the line "of these, as one entry for several objectives". A scripted
case covers it. No run was repeated.

## Exploratory batch (before registration; kept, labelled)

Run first, with an earlier runner (`.local/cuckoo-ledger/pilot/` in the main checkout, not tracked): fable/high and
haiku/low, 7 checkpoint sessions per subject and 14 tool sessions with only Cuckoo's tools. Reading its requests and
replies found three defects of the instrument, corrected here:

1. The seeded transcripts had no leading system message. In the variant without the numbered exchange Pi therefore
   sent the prompt as a system message *after* the inquiry; in the other variant Cuckoo's own context handler changed
   a message, and Pi then folds system messages into one leading message. The two variants differed in more than the
   exchange. Now a probe session whose request is stopped before sending supplies Pi's own leading system message.
2. The working directory, which Pi shows in the system prompt, named the cell and the scenario.
3. The grader counted a lifted rule kept under its ID with the opposite meaning as revived, its replacement as a
   restatement, and knew IDs given at the first checkpoint only for objectives. Coding `v2` distinguishes these;
   `v1` is kept and both are printed.

Its numbers are exploratory and are reported beside the registered ones, not pooled with them.

## Results (2026-11-27)

Runner at `03619193` (registered batch) and `522ee57b` (top-up; the runner files are identical), extension at
`6f31b542`, Pi 1.5.2. 144 sessions, all completed; none failed a request-shape check, none was answered by another
model, and within each cell every run had the same system text and tool definitions (`node analyze.mjs` prints the
hashes). Stored runs: `results/<label>.jsonl` (written by `export-results.mjs`: everything the grader reads, without
the request payloads). The tables are the output of `summarize.mjs`. Sonnet's registered sessions and the eight added
by amendment 1 are in separate columns.

### checkpoint-visible (coding v2)

| | fable/high | haiku/low | sonnet/medium (registered) | sonnet/medium (top-up) |
|---|---|---|---|---|
| Sessions (two inquiries each) | 6 | 6 | 4 | 8 |
| Replies valid | 12 of 12 | 12 of 12 | 8 of 8 | 16 of 16 |
| ID references naming the entry they were given to | 372 of 372 | 381 of 381 | 248 of 248 | 496 of 496 |
| Entries restated as new | 0 | 0 | 0 | 0 |
| Entries dropped that nothing closed | 0 | 0 | 0 | 0 |
| Items the grader could not place | 0 | 0 | 0 | 0 |
| Completed objective reported `Complete` at the first inquiry | 6 of 6 | 6 of 6 | 4 of 4 | 8 of 8 |
| and left out at the second | 6 of 6 | 6 of 6 | 4 of 4 | 8 of 8 |
| Cancelled objective left out (replies) | 12 of 12 | 12 of 12 | 8 of 8 | 16 of 16 |
| New objective given `null` at the first inquiry | 6 of 6 | 6 of 6 | 4 of 4 | 8 of 8 |
| and named by its new ID at the second | 6 of 6 | 6 of 6 | 4 of 4 | 8 of 8 |
| Rule the user lifted (replies) | left out 12 | kept under its id, new meaning 6; left out 3; replaced by a new rule 3 | left out 8 | left out 16 |
| Rules the user never gave | 0 | 0 | 0 | 0 |

Under coding v1: fable/high: wrong 0, restated as new 0, lifted rule left out 12 · haiku/low: wrong 3, restated as new 3, lifted rule kept, old meaning 6; left out 6 · sonnet/medium (registered): wrong 0, restated as new 0, lifted rule left out 8 · sonnet/medium (top-up): wrong 0, restated as new 0, lifted rule left out 16

### checkpoint-compacted (coding v2)

| | fable/high | haiku/low | sonnet/medium (registered) | sonnet/medium (top-up) |
|---|---|---|---|---|
| Sessions (two inquiries each) | 6 | 6 | 4 | 8 |
| Replies valid | 12 of 12 | 12 of 12 | 8 of 8 | 16 of 16 |
| ID references naming the entry they were given to | 372 of 372 | 377 of 377 | 256 of 256 | 509 of 509 |
| Entries restated as new | 0 | 0 | 0 | 0 |
| Entries dropped that nothing closed | 0 | 0 | 0 | 0 |
| Items the grader could not place | 0 | 0 | 0 | 0 |
| Completed objective reported `Complete` at the first inquiry | 6 of 6 | 6 of 6 | 4 of 4 | 8 of 8 |
| and left out at the second | 6 of 6 | 6 of 6 | 4 of 4 | 6 of 8 |
| Cancelled objective left out (replies) | 12 of 12 | 12 of 12 | 6 of 8 | 15 of 16 |
| New objective given `null` at the first inquiry | 6 of 6 | 6 of 6 | 4 of 4 | 8 of 8 |
| and named by its new ID at the second | 6 of 6 | 6 of 6 | 4 of 4 | 8 of 8 |
| Rule the user lifted (replies) | left out 12 | kept under its id, new meaning 2; left out 7; replaced by a new rule 3 | kept under its id, new meaning 4; left out 2; replaced by a new rule 2 | kept under its id, new meaning 4; left out 6; replaced by a new rule 6 |
| Rules the user never gave | 0 | 0 | 0 | 0 |

Under coding v1: fable/high: wrong 0, restated as new 0, lifted rule left out 12 · haiku/low: wrong 3, restated as new 3, lifted rule kept, old meaning 2; left out 10 · sonnet/medium (registered): wrong 2, restated as new 2, lifted rule kept, old meaning 4; left out 4 · sonnet/medium (top-up): wrong 6, restated as new 6, lifted rule kept, old meaning 4; left out 12

### tools-only, scenario build

| | fable/high | haiku/low | sonnet/medium (registered) | sonnet/medium (top-up) |
|---|---|---|---|---|
| Sessions (four user turns, then one inquiry) | 6 | 6 | 4 | 8 |
| Every stated objective recorded by its turn | 6 of 6 | 1 of 6 | 4 of 4 | 8 of 8 |
| of these, as one entry for several objectives (amendment 2) | 0 of 6 | 1 of 6 | 4 of 4 | 8 of 8 |
| Every rule the user gave recorded by its turn | 6 of 6 | 6 of 6 | 4 of 4 | 8 of 8 |
| No objective recorded at all | 0 of 6 | 4 of 6 | 0 of 4 | 0 of 8 |
| **Kept the record current** (registered rule) | 6 of 6 | 1 of 6 | 4 of 4 | 8 of 8 |
| Final checkpoint valid | 6 of 6 | 6 of 6 | 4 of 4 | 8 of 8 |
| Final checkpoint repeats a completion made with the tool | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Final checkpoint revives a retirement | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| An arithmetic question recorded as an objective | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| A request answered in its own turn recorded as an objective | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Duplicate entries | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Sessions with a refused call | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Sessions in which a built-in tool was called (blocked) | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| `cuckoo_update` calls per session | 8 | 2 to 6 | 7 to 9 | 6 to 8 |
| Provider requests beyond one per turn | 5 | 1 to 4 | 4 | 4 |

### tools-only, scenario report (held out)

| | fable/high | haiku/low | sonnet/medium (registered) | sonnet/medium (top-up) |
|---|---|---|---|---|
| Sessions (four user turns, then one inquiry) | 6 | 6 | 4 | 8 |
| Every stated objective recorded by its turn | 6 of 6 | 1 of 6 | 4 of 4 | 8 of 8 |
| of these, as one entry for several objectives (amendment 2) | 0 of 6 | 1 of 6 | 4 of 4 | 8 of 8 |
| Every rule the user gave recorded by its turn | 6 of 6 | 6 of 6 | 4 of 4 | 8 of 8 |
| No objective recorded at all | 0 of 6 | 4 of 6 | 0 of 4 | 0 of 8 |
| **Kept the record current** (registered rule) | 6 of 6 | 1 of 6 | 4 of 4 | 8 of 8 |
| Final checkpoint valid | 6 of 6 | 6 of 6 | 4 of 4 | 8 of 8 |
| Final checkpoint repeats a completion made with the tool | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Final checkpoint revives a retirement | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| An arithmetic question recorded as an objective | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| A request answered in its own turn recorded as an objective | 6 of 6 | 0 of 6 | 2 of 4 | 2 of 8 |
| Duplicate entries | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Sessions with a refused call | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Sessions in which a built-in tool was called (blocked) | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| `cuckoo_update` calls per session | 6 to 7 | 1 to 3 | 4 to 5 | 4 to 6 |
| Provider requests beyond one per turn | 4 | 1 to 3 | 4 | 4 to 5 |

### tools-builtins, scenario build

| | fable/high | haiku/low | sonnet/medium (registered) | sonnet/medium (top-up) |
|---|---|---|---|---|
| Sessions (four user turns, then one inquiry) | 6 | 6 | 4 | 8 |
| Every stated objective recorded by its turn | 6 of 6 | 2 of 6 | 3 of 4 | 7 of 8 |
| of these, as one entry for several objectives (amendment 2) | 0 of 6 | 2 of 6 | 3 of 4 | 7 of 8 |
| Every rule the user gave recorded by its turn | 6 of 6 | 6 of 6 | 4 of 4 | 8 of 8 |
| No objective recorded at all | 0 of 6 | 4 of 6 | 0 of 4 | 0 of 8 |
| **Kept the record current** (registered rule) | 6 of 6 | 2 of 6 | 2 of 4 | 5 of 8 |
| Final checkpoint valid | 6 of 6 | 6 of 6 | 4 of 4 | 8 of 8 |
| Final checkpoint repeats a completion made with the tool | 0 of 6 | 0 of 6 | 1 of 4 | 2 of 8 |
| Final checkpoint revives a retirement | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| An arithmetic question recorded as an objective | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| A request answered in its own turn recorded as an objective | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Duplicate entries | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Sessions with a refused call | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Sessions in which a built-in tool was called (blocked) | 6 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| `cuckoo_update` calls per session | 8 to 10 | 1 to 4 | 4 to 6 | 5 to 6 |
| Provider requests beyond one per turn | 6 to 7 | 1 to 3 | 2 to 4 | 3 to 4 |

### tools-builtins, scenario report (held out)

| | fable/high | haiku/low | sonnet/medium (registered) | sonnet/medium (top-up) |
|---|---|---|---|---|
| Sessions (four user turns, then one inquiry) | 6 | 6 | 4 | 8 |
| Every stated objective recorded by its turn | 6 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| of these, as one entry for several objectives (amendment 2) | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Every rule the user gave recorded by its turn | 6 of 6 | 6 of 6 | 4 of 4 | 8 of 8 |
| No objective recorded at all | 0 of 6 | 6 of 6 | 4 of 4 | 6 of 8 |
| **Kept the record current** (registered rule) | 6 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Final checkpoint valid | 6 of 6 | 6 of 6 | 4 of 4 | 8 of 8 |
| Final checkpoint repeats a completion made with the tool | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Final checkpoint revives a retirement | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| An arithmetic question recorded as an objective | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| A request answered in its own turn recorded as an objective | 6 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Duplicate entries | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Sessions with a refused call | 0 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| Sessions in which a built-in tool was called (blocked) | 3 of 6 | 0 of 6 | 0 of 4 | 0 of 8 |
| `cuckoo_update` calls per session | 6 to 7 | 1 | 1 | 1 to 4 |
| Provider requests beyond one per turn | 4 | 1 | 1 | 1 to 3 |

### What was read by hand

- Every rule text listed under the lifted rule's ID (16 replies) and every rule given a `null` id (14): all say the
  linter may now run without asking. Coding v2's "kept under its id, new meaning" and "replaced by a new rule" are
  therefore what happened; no reply kept the old instruction, and no reply invented a rule.
- Sonnet, `checkpoint-compacted`: in 3 of 12 sessions the first reply listed the cancelled objective once more, with
  "Cancelled by the user" as its progress and no completion, and left it out at the second inquiry. The record then
  shows it as active until that second checkpoint. In 2 of 12 the second reply reported the completed objective as
  `Complete` again, although the request named it as already reported. Neither occurred in the `visible` variant
  (0 of 12) or with the other subjects.
- Tool sessions, how the record ends (not a registered outcome; counted from the final snapshots):

  | | An entry of its own for each stated objective | One entry for all of them | Only some recorded | None | The cancelled item at the end |
  |---|---|---|---|---|---|
  | fable/high, both tool sets (24 sessions) | 24 | 0 | 0 | 0 | retired with a reason 24 |
  | sonnet/medium, only Cuckoo's tools (24) | 0 | 24 | 0 | 0 | inside a completed entry 15, still active 8, retired 1 |
  | sonnet/medium, built-in tools declared (24) | 0 | 14 (12 `build`, 2 `report`) | 0 | 10 (all `report`) | inside a completed entry 12, still active 2, no entry 10 |
  | haiku/low, both tool sets (24) | 0 | 4 | 2 | 18 | inside a completed entry 4, no entry 20 |

- Fable called a built-in tool in 9 of its 12 `tools-builtins` sessions, always in the first turn of a task (`ls`,
  `find`, reading a `Makefile` or a `README.md` that the empty working directory does not have), and was told the
  tool is unavailable. By the protocol these sessions are reported apart: all 9 recorded every objective and rule by
  its turn, as did the 3 without such a call.
- Fable recorded the request "propose a title" as an objective in 12 of 12 `report` sessions and left it active, with
  "waiting for the user's choice", which the final checkpoint restated. Sonnet did so in 4 of 12 with only Cuckoo's
  tools. No subject recorded the arithmetic question.

### Reading, by the registered rules

- *Protocol followed* (every reply valid, no wrong ID, no restatement as new, nothing dropped, both checkpoint cells):
  met by all three subjects under coding v2, on 96 of 96 replies and 3011 of 3011 ID references. Under coding v1,
  which counts a lifted rule's replacement as a restatement and does not know the ID it then gets, haiku and sonnet
  do not meet it (6 and 8 replacements, each counted once as a restatement and once as a wrong ID); those replies
  were read and are the replacements described above.
- *Keeps the record current*: fable/high in 24 of 24 sessions, including the held-out scenario with both tool sets,
  with an entry for each objective. Sonnet/medium in 24 of 24 with only Cuckoo's tools and, with the built-in tools
  declared, in 7 of 12 (`build`) and 0 of 12 (`report`, held out); wherever it recorded objectives it kept one entry
  for the whole request, so the rule is met in a coarser sense than for fable. Haiku/low in 4 of 24.
  Every subject recorded every rule the user gave in its turn (96 of 96 tool sessions).
- No call was refused and no final checkpoint was invalid in any session. A final checkpoint repeated a completion
  made with the tool in 3 of 12 sonnet `tools-builtins` `build` sessions and nowhere else.

What this does not show is in "Limits" below. In particular the tool cells have no work in them, and the built-in
tools were declared but blocked.

## Running

```bash
export PI_SDK_ROOT=<pi-monorepo of the pinned Pi> GATEWAY_EXTENSION=<pi-ai-gateway>/extension/index.ts
DRY=1 ./run.sh canary <frozen copy of the extension> <out> 2 claude-fable-5-2 high tools-builtins   # no model call
./run.sh fable-tools-builtins <frozen copy of the extension> <out> 6 claude-fable-5-2 high tools-builtins
node analyze.mjs <out>/fable-tools-builtins ...                                                     # rescore stored runs
node analyze.mjs results/fable-tools-builtins.jsonl                                                 # the same, from the kept copy
node summarize.mjs "fable/high=results/fable-tools-only.jsonl,results/fable-tools-builtins.jsonl" ...
node export-results.mjs results <out>/<label> ...
node --test grade.test.mjs
```

Give the runner a frozen copy of the extension (for example `git archive <commit>` into a scratch directory with the
`node_modules` links of the Nix check), never the working tree: `summary.json` records the hashes of its sources.
Bounds are execution controls: 6 concurrent sessions; per session 3 (checkpoint) or 30 (tools) provider requests and
600 s; one hour per process. Results hold synthetic content only.

## Limits

- There is no baseline arm: the behaviours measured (IDs in a reply, edits of the record) do not exist without the
  change. The pilot measures whether the new protocol is followed, not the effect of a wording.
- Seeded short sessions do not show behaviour in long working sessions, over many checkpoints, or under real
  compaction; the `compacted` variant imitates only the absence of the exchange.
- No task in the tool cells needs another tool, so the model never has to choose between the record and work.
- Key patterns recognise the scripted subjects; a reply that rewords beyond them is listed as unclear and read.
- One coder, the grader's author, read the flagged replies.
