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
| `checkpoint-visible` | Seeded: Pi's own leading system message, a numbered checkpoint of 8 objectives and 25 rules (see amendment 4 for where the sizes come from) with its inquiry and reply in context, then a conversation that completes one objective, cancels one, adds one and lifts one rule. Two live inquiries. | IDs in the replies |
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

## Amendment 3 (2026-11-27, after an independent fact check of this pilot; tooling and wording only)

A reader who had not done the work compared this README and the runner with the stored runs. Its points, and what
changed:

- The analysis printed sessions answered by another model but still graded them with their cell, against the
  protocol. `analyze.mjs` and `summarize.mjs` now leave such sessions out of every total and list them
  (`bySubject`, with a scripted case). No stored session is affected: none was answered by another model, and the
  tables are unchanged line for line.
- "Every request is checked" said more than the runner does. Stated precisely under "What the runner checks" below.
- `DRY=1` was described as a canary without its limits. Stated below.
- The exploratory batch was described as "7 checkpoint sessions per subject"; it was 8 and 6. Corrected below.
- The two tool cells differ in more than the tool definitions. Stated under "Limits".

### What the runner checks

After a session has run, on **every** request it sent: there is a leading system prompt; no system message inside
the conversation carries text (the empty messages that only carry the effort are allowed); at most one open inquiry
is present and, when present, it is the last message that is not a system message. On the **first** request only:
the working directory in the prompt is the one the run chose and names nothing; the hashes of the system text and of
the tool definitions; the model named; the effort in force; for checkpoint cells, whether the seeded reply is in
context. A session that fails a check is marked failed and is not graded; its requests have been sent by then.

Effort and model. On this path (Pi 1.5.2, pi-ai `api/anthropic-messages.js`, models with mid-conversation effort) the
top-level `output_config.effort` of a request is the constant `low`, and the level for each reply is set by an empty
system message inside the conversation; the SDK's source says so in a comment ("Effort markers set the level for
every reply. The top-level effort is part of the cached prompt, so it stays fixed"). The runner records the last such
marker of the first request, and every request of the stored runs carries the configured level in its markers
(checked over all stored first and last requests). That the provider applies the marker is the SDK's statement, not
something this pilot verified. Pi sets `responseModel` on a reply only when the provider's reply names another model
than the one requested (same file), so a live reply without it was reported by the provider as the requested model;
the seeded assistant messages carry the subject's name by construction and say nothing about the provider.

`DRY=1` stops each request before it is sent and runs the same checks. It builds the first request of a checkpoint
session and the first request of each turn of a tool session; requests that depend on a reply (a second inquiry, a
continuation after a tool call) are not built. Every dry session ends as `invalid-report` and the process exits
non-zero by design: it is an inspection of request shape, not a passing smoke test.

## Amendment 4 (2026-11-27, after the batch; wording only)

The seeded record has 25 rules, the median of saved reports, and 8 objectives, which was their 90th percentile in the
survey the protocol was written from. That survey had skipped one large session file; over all files the 90th
percentile is 7 objectives (median 3) and the median is still 25 rules (90th percentile 41). The record is one
objective above the percentile it was meant to sit at. The fixture is unchanged; only its description here and the
comment in `scenarios.mjs` were corrected.

## Exploratory batch (before registration; kept, labelled)

Run first, with an earlier runner (`.local/cuckoo-ledger/pilot/` in the main checkout, not tracked): fable/high (8
checkpoint and 8 tool sessions) and haiku/low (6 and 6), with only Cuckoo's tools declared, after one smoke session. Reading its requests and
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

# Batch 2: the eight record scenarios, two arms under the labels <subject>-<A|B>-<cell>
SCENARIO_SET=record ./run.sh sonnet-B-tools-builtins <frozen copy, arm B> <out> 12 claude-sonnet-5-5 medium tools-builtins
node record-summary.mjs "sonnet A=<out>/sonnet-A-tools-builtins" "sonnet B=<out>/sonnet-B-tools-builtins"   # tables
node record-summary.mjs --sessions "sonnet B=results/batch2/sonnet-B-tools-builtins.jsonl.gz"               # per session
node adoption.mjs results/batch2                                                                              # the rule
node first-deliverable.mjs "sonnet B=results/batch2/sonnet-B-tools-builtins.jsonl.gz"                           # see results
node export-results.mjs --gz results/batch2 <out>/<label> ...
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
- `tools-builtins` differs from `tools-only` in the tool definitions and in the system text Pi derives from them (the
  tool list and the built-in tools' guidelines: 6255 against 5541 characters). The pilot does not separate the two,
  and the built-in tools were blocked, which a subject that calls one learns in its first turn.
- Key patterns recognise the scripted subjects; a reply that rewords beyond them is listed as unclear and read.
- One coder, the grader's author, read the flagged replies.

## Batch 2: the wording of the guidance for `cuckoo_update`

In short: batch 1 showed that sonnet/medium keeps one entry for a whole request, or none. A reworded guidance was
developed in three rounds, frozen, and compared with the shipped one on 576 sessions with held-out scenarios by a
blind author. The registered rule for adopting it holds, by one session on its main point; the wording is adopted.
With it sonnet records objectives as separate entries and retires cancelled ones, records every rule, and makes
about twice as many extra provider requests. A deliverable that the first message asks only to sketch or to start
still gets its entry in that turn unevenly (10, 0 and 0 of 12 in the three held-out scenarios that have one), so
"keeps the record as specified" is not claimed. Details below.

### Protocol (registered 2026-11-27, before any run of this batch)

**Question.** In batch 1 sonnet/medium kept one entry for a whole request, never retired a cancelled part and, with
Pi's built-in tools declared, recorded no objective in 10 of 12 sessions of one scenario. Does a rewording of the
tool's guidance make that subject keep the record as specified below, without making the other subjects worse and
without filling the record with entries that do not belong there? Only the model-facing text of `cuckoo_update`
changes (`promptGuidelines`, and `description` if needed); the checkpoint request and the decoder do not.

**Desired behaviour.** The wording and the scenarios are both written against this.

1. An objective is a deliverable the user asked for, or the model committed to, whose work continues after the reply
   to the message that states it. Each gets an entry of its own, in the turn that states it; a message that asks for
   several deliverables gives several entries, the one started first included.
2. A question, or a request that its own reply answers completely, is not an objective.
3. The steps toward one deliverable are not objectives.
4. A deliverable that is delivered and accepted is completed in that turn, with what was delivered and the caveats.
5. A deliverable the user cancels or replaces is retired in that turn with the reason, not completed.
6. An instruction the user gives for the session is recorded as a rule in the turn that gives it.
7. A checkpoint after such edits repeats no completion and revives no retirement.

**Arms.** A: the extension as merged on main. B: the same with the candidate wording. Both run in the same batch at
the same time. Every run records the hashes of the system text and the tool definitions it sent: equal within an arm
and cell, different between the arms of a cell; the difference is read once per cell on stopped requests (`DRY=1`)
and must be the guidance text only.

**Subjects.** As in batch 1: fable-5-2/high, sonnet-5-5/medium (the subject the wording is for), haiku-5-5/low.

**Cells.** `tools-builtins` (the ordinary tool menu; the cell the rule below reads), `tools-only` (sonnet),
`checkpoint-visible` and `checkpoint-compacted` (non-regression: their system prompt carries the guidance too).

**Scenarios** (`RECORD_SCENARIOS`). Development: `build` and `report` of batch 1 (`report` was held out there and is
not here), `chat` (control: questions, one rule, one small request; nothing to record but the rule) and `single` (one
deliverable built over four turns). Held-out: two work scenarios, one single-deliverable scenario and one control,
written by an author who has seen neither the candidate wording nor any result: a subagent given the seven points
above, the scenario format and the subjects of the development scenarios to avoid. They are requested once this
protocol is committed. The experimenter reads them only after the wording is frozen, checks each key against the
scenario's own text and may correct a defect of a fixture, which is recorded; the wording is not touched after that.
Before the batch each held-out fixture is run twice with fable/high in arm A, the subject and arm that kept the
record as specified in batch 1, and the runs are read: a fixture whose expected outcome that subject cannot reach
for a reason in the fixture is corrected or dropped, with the reason.

**Development.** At most three rounds, sonnet/medium, `tools-builtins`, development scenarios, arm B, at most six
sessions per scenario and round. Arm A's rates under this batch's coding are known from the stored runs of batch 1
(table below). Every development run is kept and reported as development.

**Freeze.** The candidate is committed and copied; the system text and the tool definitions it sends are recorded
by length and SHA-256 from a stopped request. After the freeze the wording is not edited. One second candidate is
allowed, only with a new held-out set made the same way; otherwise the result stands as it falls.

**n.** `tools-builtins`: 12 sessions per arm and scenario for sonnet, 6 for fable and haiku. `tools-only`: 6 per arm
and scenario, sonnet. Checkpoint cells: 12 per arm and variant for sonnet, 6 for fable and haiku. Every run is
reported; no rerun replaces a failed run.

**Outcomes** (`gradeRecord`; scripted cases in `grade.test.mjs`). A stated objective counts as recorded only by an
entry of its own: one whose text matches its key and the key of no other stated objective.

- *Record right*: every stated objective has an entry of its own by its turn; every objective is closed the way it
  ended, in its turn (complete, retired, or still active); every rule is recorded by its turn; no call was refused;
  the final checkpoint is valid, repeats no completion and revives no retirement.
- *No surplus entries*: no objective entry made out of a question, out of a request its own reply answers, or out of
  anything else that is not a stated objective, and no second entry for one objective or rule.
- Beside these: the reading of batch 1 (named in some entry), sessions with an entry that holds several objectives,
  sessions without any objective entry, the cancelled objective retired at the end, calls and provider requests.

**Adoption rule.** The wording is merged only if all of this holds. It is read on sonnet/medium in `tools-builtins`
unless said otherwise; the two held-out work scenarios together are 24 sessions per arm.

1. *Effect.* Over the held-out work scenarios together, arm B has *an entry of its own for every stated objective, by
   its turn* in at least 8 sessions more than arm A, and in neither scenario in fewer sessions than arm A by more
   than 2. This is the defect batch 1 showed (one entry for a whole request, or none). A scenario supports the change
   only where the baseline fails: where arm A already does it the scenario shows no harm, not an effect.
2. *No surplus.* In every control and single-deliverable scenario, development or held-out, arm B has *no surplus
   entries* in at most 2 sessions fewer than arm A. In every work scenario arm B has an entry made out of a question
   in at most 1 session more than arm A.
3. *Rules.* In every scenario arm B has *every rule recorded by its turn* in at most 2 sessions fewer than arm A.
4. *Other subjects.* For fable/high and haiku/low in `tools-builtins`, in every scenario, *record right* and *no
   surplus entries* are each at most 1 session lower in arm B than in arm A.
5. *Checkpoints.* For every subject, the checkpoint replies that are invalid or have a wrong ID, an entry restated
   as new or a dropped entry are at most 1 more in arm B than in arm A.

The number of calls and of provider requests is reported and not judged. If the rule fails, the wording is not
merged and the runs are.

**What may be said afterwards.** "Keeps the record as specified" is said of a subject with a wording only where
*record right* holds in at least 20 of its 24 held-out work sessions and its control and single-deliverable sessions
pass point 2. Otherwise the documentation gives the counts. *Record right* is stricter than point 1 on purpose: a
wording can be worth merging because entries appear, while closing them in their turn is still unreliable.

**Limits known beforehand.** Those of batch 1 ("Limits"): no work in the sessions, built-in tools declared and
blocked, one provider family, short sessions. One reader who knows the arm reads the flagged sessions. What counts
as one deliverable is the experimenter's reading in the development scenarios and the author's in the held-out ones.

### Amendment 5 (2026-11-27, during development; before the freeze and before the batch)

Observation. In the second development round the candidate recorded, in 4 of 6 `build` sessions, a rule attributed
to the user for an instruction about one deliverable ("start with (a) and give only the five bullets"). The grader
did not see it: it looked for the rules the user gave and for surplus objectives only. The stored runs of batch 1
hold the same behaviour under arm A in 3 of 18 `build` sessions with the built-in tools declared (fable 1 of 6,
sonnet 2 of 12).

Change. `gradeRecord` lists the rules, active or retired, that match no rule the scenario's user gave for the session
(`extraRules`), by the source the model gave them; a scripted case covers it. A session has *no surplus rules* when
none of them is attributed to the user. A convention the model adopts itself is a rule by definition and is listed
for reading, not counted. The registered readings are unchanged. The adoption rule gets a sixth point:

6. *Surplus rules.* In every scenario arm B has *no surplus rules* in at most 2 sessions fewer than arm A.

### Amendment 6 (2026-11-27, written while the registered batch ran; before any of its results was read)

Observation. In the fixture check (below) fable/high in arm A completed the curtain speech of `h2` after the first
message, which asks for a sketch only, reopened it and completed it again in the next turn. All eight sessions were
graded *record right*: the grader reads an objective's status after the turn that settles it and at the end, so it
does not see a closing that came too early.

Change. `gradeRecord` lists the objectives whose own entry was complete or retired after a turn before the one that
settles them (`closedEarly`; scripted case), and the summary counts such sessions. Reported, not judged. The
scenarios name the turn in which the user accepts a deliverable; a subject that completes it one turn earlier, in the
turn that delivers it, does what both wordings of the tool allow ("nothing is left to do"). It is premature only
where the closing comes before the delivery: after the first message of `h1` or `h2`, which ask for a sketch. Those
are counted apart in "What was read by hand".

Also added while the batch ran, without touching the runner or the scenarios: `adoption.mjs`, the adoption rule as
code, checked on constructed inputs that trip each point in turn and pass the two allowed boundary cases; and a line
in `record-summary.mjs` that prints what each column's sessions were sent (model, effort, the two hashes).

### Development (kept; not evidence for the wording)

Three rounds, sonnet/medium, `tools-builtins`, the four development scenarios, six sessions each, arm B only; all 72
sessions completed. Arm A for the same subject and cell is in the table of the next section (0 of 12 *record right*
in `build` and in `report`).

- Round 1 said what an objective is and asked for one entry per deliverable. Entries of their own appeared in every
  `build` and `report` session, but in `single` the objective was added one turn late in 6 of 6 (the first message
  asks only for a first part), and the final checkpoint repeated a completion in 3 of 24 sessions.
- Round 2 added when to look ("before you answer a user message, check whether it brings a new deliverable, accepts
  or cancels one, or gives an instruction") and that a completed objective is left out of the next checkpoint answer.
  *Record right* in 24 of 24. New defect, found by reading: a rule attributed to the user for an instruction about one
  deliverable in 4 of 6 `build` sessions (amendment 5).
- Round 3 said that a rule is a standing instruction and that an instruction about one deliverable belongs to its
  objective. *Record right* in 24 of 24, no surplus rule. The request for a title in `report`, which its own reply
  answers, became an objective in 3 of 6 sessions (1 and 2 of 6 in the rounds before).

**tools-builtins, scenario build (development, work)**

| | round 1 | round 2 | round 3 |
|---|---|---|---|
| **Record right** (registered rule) | 5 of 6 | 6 of 6 | 6 of 6 |
| An entry of its own for every stated objective, by its turn | 6 of 6 | 6 of 6 | 6 of 6 |
| Every objective closed the way it ended, in its turn | 6 of 6 | 6 of 6 | 6 of 6 |
| Every rule recorded by its turn | 6 of 6 | 6 of 6 | 6 of 6 |
| Final checkpoint repeats a completion made with the tool | 1 of 6 | 0 of 6 | 0 of 6 |
| **No surplus entries** (registered rule) | 6 of 6 | 6 of 6 | 6 of 6 |
| of a request its own reply answers | 0 of 6 | 0 of 6 | 0 of 6 |
| **No surplus rules** (amendment 5) | 6 of 6 | 2 of 6 | 6 of 6 |
| `cuckoo_update` calls per session | 8 | 8 to 10 (median 9) | 8 |
| Provider requests beyond one per turn | 4 to 5 (median 5) | 4 to 5 (median 5) | 5 |

**tools-builtins, scenario report (development, work)**

| | round 1 | round 2 | round 3 |
|---|---|---|---|
| **Record right** (registered rule) | 5 of 6 | 6 of 6 | 6 of 6 |
| An entry of its own for every stated objective, by its turn | 6 of 6 | 6 of 6 | 6 of 6 |
| Every objective closed the way it ended, in its turn | 6 of 6 | 6 of 6 | 6 of 6 |
| Every rule recorded by its turn | 6 of 6 | 6 of 6 | 6 of 6 |
| Final checkpoint repeats a completion made with the tool | 1 of 6 | 0 of 6 | 0 of 6 |
| **No surplus entries** (registered rule) | 5 of 6 | 4 of 6 | 3 of 6 |
| of a request its own reply answers | 1 of 6 | 2 of 6 | 3 of 6 |
| **No surplus rules** (amendment 5) | 6 of 6 | 6 of 6 | 6 of 6 |
| `cuckoo_update` calls per session | 5 to 6 (median 5) | 5 to 7 (median 6) | 5 to 7 (median 6) |
| Provider requests beyond one per turn | 4 | 4 to 5 (median 4) | 4 |

**tools-builtins, scenario chat (development, control)**

| | round 1 | round 2 | round 3 |
|---|---|---|---|
| **Record right** (registered rule) | 6 of 6 | 6 of 6 | 6 of 6 |
| Every rule recorded by its turn | 6 of 6 | 6 of 6 | 6 of 6 |
| Final checkpoint repeats a completion made with the tool | 0 of 6 | 0 of 6 | 0 of 6 |
| **No surplus entries** (registered rule) | 6 of 6 | 6 of 6 | 6 of 6 |
| of a request its own reply answers | 0 of 6 | 0 of 6 | 0 of 6 |
| **No surplus rules** (amendment 5) | 6 of 6 | 6 of 6 | 6 of 6 |
| `cuckoo_update` calls per session | 1 | 1 | 1 |
| Provider requests beyond one per turn | 1 | 1 | 1 |

**tools-builtins, scenario single (development, single)**

| | round 1 | round 2 | round 3 |
|---|---|---|---|
| **Record right** (registered rule) | 0 of 6 | 6 of 6 | 6 of 6 |
| An entry of its own for every stated objective, by its turn | 0 of 6 | 6 of 6 | 6 of 6 |
| Every objective closed the way it ended, in its turn | 6 of 6 | 6 of 6 | 6 of 6 |
| Every rule recorded by its turn | 6 of 6 | 6 of 6 | 6 of 6 |
| Final checkpoint repeats a completion made with the tool | 1 of 6 | 0 of 6 | 0 of 6 |
| **No surplus entries** (registered rule) | 6 of 6 | 6 of 6 | 6 of 6 |
| of a request its own reply answers | 0 of 6 | 0 of 6 | 0 of 6 |
| **No surplus rules** (amendment 5) | 6 of 6 | 6 of 6 | 6 of 6 |
| `cuckoo_update` calls per session | 3 | 3 | 3 to 4 (median 3) |
| Provider requests beyond one per turn | 2 | 3 | 3 to 4 (median 3) |

**Freeze.** Commit `2ae3376f`: the wording of round 3 with the tool's name written into three more guidelines (Pi lists
the guidelines of all tools as one flat list, and a test of the extension requires each to name its tool); that form
was first run in the registered batch. Guidelines: 6 items, 2108 characters joined by newlines, SHA-256 `225a0d04…`;
description: 1530 characters, SHA-256 `09f3346c…`. On stopped requests the two arms differ in those lines of the
system text and in the definition of `cuckoo_update`, and in nothing else: system text 6230 against 7423 characters
with the built-in tools declared (hashes `07499ee7b2c1` and `354f2ce07dbd`), 5516 against 6709 without (`9fa30787ad66`,
`811806fce31a`); tool definitions `e6d59e0e214b` and `793b7c70e6d2`, `485d6b501f50` and `3b3380abd263`.

**Held-out scenarios.** Written by a subagent of another model family (gpt-6.2-sol) from the seven points of the
desired behaviour, the format and the list of subjects to avoid; it was told to read no file and its reply named
only the file and its hash. The protocol was committed at 13:30 UTC, the file was written at 13:33, the wording was
frozen at 13:43, and the file was read after that. It is `heldout.mjs`, unchanged (SHA-256 `2959702f…`). The scripted check of its keys against the author's example
titles and the user's own words passed; no fixture was corrected. `h1`: three deliverables stated in running prose,
one cancelled, one accepted, one still open, one rule, one plain question. `h2`: two deliverables, a third added in
the second message, one cancelled, two accepted, one rule. `h3`: one label built in parts. `h4`: questions and small
requests, one rule.

**Fixture check.** fable/high, arm A, `tools-builtins`, two sessions per held-out scenario: 8 of 8 completed and
*record right*, so no fixture asks for something that subject cannot reach. Seen in them: the early completion of
amendment 6; one `bash` call (blocked) in each `h2` session; in one `h1` session a rule added at the checkpoint for
"hold off on finishing the card".

### Arm A before the batch: the stored runs of batch 1 under this batch's coding

`node record-summary.mjs` over `results/*tools*.jsonl` (sonnet: the registered sessions and the top-up together).

#### tools-builtins, scenario build (development, work)

| | fable/high | sonnet/medium | haiku/low |
|---|---|---|---|
| Sessions graded (failed runs apart) | 6 | 12 | 6 |
| **Record right** (registered rule) | 6 of 6 | 0 of 12 | 0 of 6 |
| An entry of its own for every stated objective, by its turn | 6 of 6 | 0 of 12 | 0 of 6 |
| Every stated objective named in some entry by its turn (reading of batch 1) | 6 of 6 | 10 of 12 | 2 of 6 |
| Sessions with an entry that holds several objectives | 0 of 6 | 12 of 12 | 2 of 6 |
| No objective entry at all | 0 of 6 | 0 of 12 | 4 of 6 |
| Cancelled objective retired at the end | 6 of 6 | 0 of 12 | 0 of 6 |
| Every rule recorded by its turn | 6 of 6 | 12 of 12 | 6 of 6 |
| Final checkpoint sound | 6 of 6 | 9 of 12 | 6 of 6 |
| **No surplus entries** (registered rule) | 6 of 6 | 12 of 12 | 6 of 6 |
| of a request its own reply answers | 0 of 6 | 0 of 12 | 0 of 6 |

#### tools-builtins, scenario report (development, work)

| | fable/high | sonnet/medium | haiku/low |
|---|---|---|---|
| Sessions graded (failed runs apart) | 6 | 12 | 6 |
| **Record right** (registered rule) | 6 of 6 | 0 of 12 | 0 of 6 |
| An entry of its own for every stated objective, by its turn | 6 of 6 | 0 of 12 | 0 of 6 |
| Every stated objective named in some entry by its turn (reading of batch 1) | 6 of 6 | 0 of 12 | 0 of 6 |
| Sessions with an entry that holds several objectives | 0 of 6 | 2 of 12 | 0 of 6 |
| No objective entry at all | 0 of 6 | 10 of 12 | 6 of 6 |
| Cancelled objective retired at the end | 6 of 6 | 0 of 12 | 0 of 6 |
| Every rule recorded by its turn | 6 of 6 | 12 of 12 | 6 of 6 |
| Final checkpoint sound | 6 of 6 | 12 of 12 | 6 of 6 |
| **No surplus entries** (registered rule) | 0 of 6 | 12 of 12 | 6 of 6 |
| of a request its own reply answers | 6 of 6 | 0 of 12 | 0 of 6 |

#### tools-only, scenario build (development, work)

| | fable/high | sonnet/medium | haiku/low |
|---|---|---|---|
| Sessions graded (failed runs apart) | 6 | 12 | 6 |
| **Record right** (registered rule) | 6 of 6 | 0 of 12 | 0 of 6 |
| An entry of its own for every stated objective, by its turn | 6 of 6 | 0 of 12 | 0 of 6 |
| Every stated objective named in some entry by its turn (reading of batch 1) | 6 of 6 | 12 of 12 | 1 of 6 |
| Sessions with an entry that holds several objectives | 0 of 6 | 12 of 12 | 1 of 6 |
| No objective entry at all | 0 of 6 | 0 of 12 | 4 of 6 |
| Cancelled objective retired at the end | 6 of 6 | 0 of 12 | 0 of 6 |
| Every rule recorded by its turn | 6 of 6 | 12 of 12 | 6 of 6 |
| Final checkpoint sound | 6 of 6 | 12 of 12 | 6 of 6 |
| **No surplus entries** (registered rule) | 6 of 6 | 12 of 12 | 6 of 6 |
| of a request its own reply answers | 0 of 6 | 0 of 12 | 0 of 6 |

#### tools-only, scenario report (development, work)

| | fable/high | sonnet/medium | haiku/low |
|---|---|---|---|
| Sessions graded (failed runs apart) | 6 | 12 | 6 |
| **Record right** (registered rule) | 6 of 6 | 0 of 12 | 0 of 6 |
| An entry of its own for every stated objective, by its turn | 6 of 6 | 0 of 12 | 0 of 6 |
| Every stated objective named in some entry by its turn (reading of batch 1) | 6 of 6 | 12 of 12 | 1 of 6 |
| Sessions with an entry that holds several objectives | 0 of 6 | 12 of 12 | 1 of 6 |
| No objective entry at all | 0 of 6 | 0 of 12 | 4 of 6 |
| Cancelled objective retired at the end | 6 of 6 | 0 of 12 | 0 of 6 |
| Every rule recorded by its turn | 6 of 6 | 12 of 12 | 6 of 6 |
| Final checkpoint sound | 6 of 6 | 12 of 12 | 6 of 6 |
| **No surplus entries** (registered rule) | 0 of 6 | 8 of 12 | 6 of 6 |
| of a request its own reply answers | 6 of 6 | 4 of 12 | 0 of 6 |

### Results of batch 2 (2026-11-27)

576 sessions, all completed; none was answered by another model than its subject. Arms A and B of a subject ran at
the same time, with the runner at `15f27a45` and a clean tree. Every cell was sent one profile, and the profiles are
the ones recorded at the freeze (system text `07499ee7b2c1` and `354f2ce07dbd` with the built-in tools declared,
`9fa30787ad66` and `811806fce31a` without). Stored runs: `results/batch2/<subject>-<arm>-<cell>.jsonl.gz`; the
development rounds and the fixture check under `results/batch2/development/`. Full tables as printed by the tools:
`results/batch2/summary-tools-builtins.md`, `summary-tools-only.md`, `summary-checkpoints.md`, `adoption.txt`. The
tools give the same output from the stored files as from the run directories.

#### The adoption rule

`node adoption.mjs results/batch2`: **the rule holds**, point 1 by one session.

| Point | Reading | Arm A | Arm B | |
|---|---|---|---|---|
| 1 | sonnet, `h1` and `h2` together: an entry of its own for every stated objective, by its turn | 1 of 24 | 10 of 24 | +9, needed +8 |
| 1 | the same, `h1` alone | 1 of 12 | 10 of 12 | |
| 1 | the same, `h2` alone | 0 of 12 | 0 of 12 | no effect |
| 2 | sonnet, *no surplus entries* in `chat`, `single`, `h3`, `h4` | 12 of 12 each | 12 of 12 each | |
| 2 | sonnet, sessions with an entry made of a question, in the four work scenarios | 0 | 0 | |
| 3 | sonnet, *every rule recorded by its turn*, per scenario | 12, 12, 8, 12, 12, 0, 1, 0 of 12 | 12 of 12 in all eight | order: `build`, `report`, `chat`, `single`, `h1` to `h4` |
| 4 | fable, *record right*, per scenario | 6 of 6 except `h2` 4 of 6 | 6 of 6 in all eight | |
| 4 | fable, *no surplus entries* | 6 of 6 except `report` 0 of 6 | 6 of 6 in all eight | |
| 4 | haiku, *record right*, per scenario | 0 of 6 in all eight | 5, 6, 5, 0, 5, 1, 5, 1 of 6 | same order |
| 4 | haiku, *no surplus entries* | 6 of 6 in all eight | 6 of 6 except `single` 5 of 6 | |
| 5 | checkpoint replies invalid, with a wrong ID, a restatement as new or a dropped entry | 0 of 48, 0 of 24, 0 of 24 | 0 of 48, 0 of 24, 0 of 24 | sonnet, fable, haiku |
| 6 | sonnet, *no surplus rules* | 12 of 12 except `report` 9 of 12 | 12 of 12 in all eight | |

"Keeps the record as specified" may **not** be said of sonnet/medium with either wording: *record right* holds in 1
of 24 held-out work sessions in arm A and in 9 of 24 in arm B (20 were required).

#### Built-in tools declared, per scenario

***Record right* (registered reading)**

| Scenario | sonnet A | sonnet B | fable A | fable B | haiku A | haiku B |
|---|---|---|---|---|---|---|
| `build` (development, work) | 0 of 12 | 10 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 5 of 6 |
| `report` (development, work) | 0 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 6 of 6 |
| `chat` (development, control) | 8 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 5 of 6 |
| `single` (development, single) | 0 of 12 | 9 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 0 of 6 |
| `h1` (held-out, work) | 1 of 12 | 9 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 5 of 6 |
| `h2` (held-out, work) | 0 of 12 | 0 of 12 | 4 of 6 | 6 of 6 | 0 of 6 | 1 of 6 |
| `h3` (held-out, single) | 0 of 12 | 0 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 5 of 6 |
| `h4` (held-out, control) | 0 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 1 of 6 |

**An entry of its own for every stated objective, by its turn (point 1 of the rule)**

| Scenario | sonnet A | sonnet B | fable A | fable B | haiku A | haiku B |
|---|---|---|---|---|---|---|
| `build` (development, work) | 0 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 5 of 6 |
| `report` (development, work) | 0 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 6 of 6 |
| `single` (development, single) | 0 of 12 | 9 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 0 of 6 |
| `h1` (held-out, work) | 1 of 12 | 10 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 5 of 6 |
| `h2` (held-out, work) | 0 of 12 | 0 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 2 of 6 |
| `h3` (held-out, single) | 0 of 12 | 0 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 6 of 6 |

**No objective entry at all**

| Scenario | sonnet A | sonnet B | fable A | fable B | haiku A | haiku B |
|---|---|---|---|---|---|---|
| `build` (development, work) | 0 of 12 | 0 of 12 | 0 of 6 | 0 of 6 | 4 of 6 | 0 of 6 |
| `report` (development, work) | 9 of 12 | 0 of 12 | 0 of 6 | 0 of 6 | 6 of 6 | 0 of 6 |
| `single` (development, single) | 2 of 12 | 0 of 12 | 0 of 6 | 0 of 6 | 6 of 6 | 1 of 6 |
| `h1` (held-out, work) | 0 of 12 | 0 of 12 | 0 of 6 | 0 of 6 | 5 of 6 | 0 of 6 |
| `h2` (held-out, work) | 12 of 12 | 0 of 12 | 0 of 6 | 0 of 6 | 5 of 6 | 0 of 6 |
| `h3` (held-out, single) | 12 of 12 | 1 of 12 | 0 of 6 | 0 of 6 | 6 of 6 | 0 of 6 |

**Every objective closed the way it ended, in its turn**

| Scenario | sonnet A | sonnet B | fable A | fable B | haiku A | haiku B |
|---|---|---|---|---|---|---|
| `build` (development, work) | 0 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 5 of 6 |
| `report` (development, work) | 0 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 6 of 6 |
| `single` (development, single) | 10 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 4 of 6 |
| `h1` (held-out, work) | 1 of 12 | 11 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 5 of 6 |
| `h2` (held-out, work) | 0 of 12 | 1 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 2 of 6 |
| `h3` (held-out, single) | 0 of 12 | 11 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 6 of 6 |

**Every rule recorded by its turn**

| Scenario | sonnet A | sonnet B | fable A | fable B | haiku A | haiku B |
|---|---|---|---|---|---|---|
| `build` (development, work) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `report` (development, work) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `chat` (development, control) | 8 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 5 of 6 |
| `single` (development, single) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `h1` (held-out, work) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 1 of 6 | 6 of 6 |
| `h2` (held-out, work) | 0 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `h3` (held-out, single) | 1 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 2 of 6 | 6 of 6 |
| `h4` (held-out, control) | 0 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 0 of 6 | 1 of 6 |

***No surplus entries* (registered reading)**

| Scenario | sonnet A | sonnet B | fable A | fable B | haiku A | haiku B |
|---|---|---|---|---|---|---|
| `build` (development, work) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `report` (development, work) | 10 of 12 | 11 of 12 | 0 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `chat` (development, control) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `single` (development, single) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 5 of 6 |
| `h1` (held-out, work) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `h2` (held-out, work) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `h3` (held-out, single) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `h4` (held-out, control) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |

***No surplus rules* (amendment 5)**

| Scenario | sonnet A | sonnet B | fable A | fable B | haiku A | haiku B |
|---|---|---|---|---|---|---|
| `build` (development, work) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `report` (development, work) | 9 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `chat` (development, control) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `single` (development, single) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `h1` (held-out, work) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `h2` (held-out, work) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `h3` (held-out, single) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 5 of 6 | 6 of 6 |
| `h4` (held-out, control) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |

**Final checkpoint sound**

| Scenario | sonnet A | sonnet B | fable A | fable B | haiku A | haiku B |
|---|---|---|---|---|---|---|
| `build` (development, work) | 10 of 12 | 10 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `report` (development, work) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `chat` (development, control) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `single` (development, single) | 12 of 12 | 11 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `h1` (held-out, work) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `h2` (held-out, work) | 12 of 12 | 10 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| `h3` (held-out, single) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 5 of 6 |
| `h4` (held-out, control) | 12 of 12 | 12 of 12 | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |

**`cuckoo_update` calls per session**

| Scenario | sonnet A | sonnet B | fable A | fable B | haiku A | haiku B |
|---|---|---|---|---|---|---|
| `build` (development, work) | 3 to 6 (median 5) | 8 | 8 | 8 to 10 (median 10) | 2 to 4 (median 2) | 8 to 9 (median 8) |
| `report` (development, work) | 1 to 5 (median 1) | 5 to 7 (median 6) | 6 | 5 to 6 (median 5) | 1 | 5 |
| `chat` (development, control) | 0 to 1 (median 1) | 1 | 1 | 1 | 0 | 0 to 1 (median 1) |
| `single` (development, single) | 1 to 3 (median 3) | 3 | 3 to 4 (median 3) | 4 to 5 (median 4) | 1 | 1 to 5 (median 3) |
| `h1` (held-out, work) | 4 to 7 (median 5) | 6 to 9 (median 7) | 7 to 8 (median 8) | 8 | 0 to 3 (median 0) | 5 to 7 (median 7) |
| `h2` (held-out, work) | 0 | 5 to 7 (median 5) | 9 to 13 (median 10) | 7 to 9 (median 9) | 1 to 3 (median 1) | 5 to 11 (median 5) |
| `h3` (held-out, single) | 0 to 1 (median 0) | 1 to 3 (median 3) | 3 to 4 (median 4) | 4 to 5 (median 4) | 0 to 2 (median 0) | 4 |
| `h4` (held-out, control) | 0 | 1 | 1 | 1 | 0 | 0 to 1 (median 0) |

**Provider requests beyond one per turn**

| Scenario | sonnet A | sonnet B | fable A | fable B | haiku A | haiku B |
|---|---|---|---|---|---|---|
| `build` (development, work) | 2 to 4 (median 4) | 5 | 6 | 5 to 6 (median 6) | 1 to 3 (median 1) | 4 to 5 (median 4) |
| `report` (development, work) | 1 to 3 (median 1) | 4 | 4 | 4 | 1 | 4 |
| `chat` (development, control) | 0 to 1 (median 1) | 1 | 1 | 1 | 0 | 0 to 1 (median 1) |
| `single` (development, single) | 1 to 2 (median 2) | 2 to 3 (median 3) | 3 | 3 to 4 (median 3) | 1 | 1 to 4 (median 2) |
| `h1` (held-out, work) | 3 to 4 (median 4) | 3 to 5 (median 3) | 3 to 4 (median 4) | 4 | 0 to 2 (median 0) | 3 |
| `h2` (held-out, work) | 0 | 3 to 4 (median 3) | 5 to 8 (median 5) | 3 to 4 (median 4) | 1 to 2 (median 1) | 3 to 7 (median 3) |
| `h3` (held-out, single) | 0 to 1 (median 0) | 1 to 2 (median 2) | 3 | 3 to 4 (median 3) | 0 to 1 (median 0) | 3 |
| `h4` (held-out, control) | 0 | 1 | 1 | 1 | 0 | 0 to 1 (median 0) |

#### Only Cuckoo's tools declared (sonnet/medium, six sessions per scenario, arm A → arm B)

| Scenario | *Record right* | Own entry per objective by its turn | Every rule by its turn | *No surplus entries* |
|---|---|---|---|---|
| `build` (development, work) | 0/6 → 6/6 | 0/6 → 6/6 | 6/6 → 6/6 | 6/6 → 6/6 |
| `report` (development, work) | 0/6 → 6/6 | 0/6 → 6/6 | 6/6 → 6/6 | 1/6 → 5/6 |
| `chat` (development, control) | 6/6 → 6/6 | n/a | 6/6 → 6/6 | 6/6 → 6/6 |
| `single` (development, single) | 0/6 → 6/6 | 0/6 → 6/6 | 6/6 → 6/6 | 6/6 → 6/6 |
| `h1` (held-out, work) | 4/6 → 6/6 | 4/6 → 6/6 | 6/6 → 6/6 | 6/6 → 6/6 |
| `h2` (held-out, work) | 0/6 → 2/6 | 0/6 → 2/6 | 6/6 → 6/6 | 6/6 → 6/6 |
| `h3` (held-out, single) | 0/6 → 6/6 | 0/6 → 6/6 | 5/6 → 6/6 | 6/6 → 6/6 |
| `h4` (held-out, control) | 6/6 → 6/6 | n/a | 6/6 → 6/6 | 6/6 → 6/6 |

#### What was read by hand

- **What the new wording changes for sonnet.** Under arm A sonnet keeps one entry for a whole request (`build` 12 of
  12 sessions, `h1` 11 of 12) or no objective at all (`report` 9, `h2` 12, `h3` 12 of 12). Under arm B there is no
  merged entry in any of the 96 sessions and an objective entry in every work and single-deliverable session but one;
  the cancelled objective is retired, in an entry of its own, in 48 of 48 work sessions (1 of 48 in arm A).
- **Uneven: the deliverable that the first message asks only to sketch or to start.** Four scenarios have one. The
  table says in how many sessions it has an entry of its own after the first message ("at once": already complete
  then), gets one later, or never does (`node first-deliverable.mjs NAME=PATH ...` on the stored runs; built-in tools
  declared unless said otherwise):

  | | `h1` welcome | `h2` speech | `h3` label | `single` plan |
  |---|---|---|---|---|
  | sonnet A | 2 of 12 (1 at once); later 0, never 10 | 0 of 12; later 0, never 12 | 0 of 12; later 0, never 12 | 0 of 12; later 10, never 2 |
  | sonnet B | 10 of 12 (4 at once); later 1, never 1 | 0 of 12; later 1, never 11 | 0 of 12; later 11, never 1 | 9 of 12; later 3, never 0 |
  | haiku A | 0 of 6; later 0, never 6 | 0 of 6; later 0, never 6 | 0 of 6; later 0, never 6 | 0 of 6; later 0, never 6 |
  | haiku B | 5 of 6; later 0, never 1 | 2 of 6 (2 at once); later 0, never 4 | 6 of 6; later 0, never 0 | 0 of 6; later 5, never 1 |
  | fable A | 6 of 6; later 0, never 0 | 6 of 6 (6 at once); later 0, never 0 | 6 of 6; later 0, never 0 | 6 of 6; later 0, never 0 |
  | fable B | 6 of 6; later 0, never 0 | 6 of 6; later 0, never 0 | 6 of 6; later 0, never 0 | 6 of 6; later 0, never 0 |
  | sonnet A, only Cuckoo's tools | 4 of 6 (4 at once); later 0, never 2 | 0 of 6; later 1, never 5 | 0 of 6; later 2, never 4 | 0 of 6; later 6, never 0 |
  | sonnet B, only Cuckoo's tools | 6 of 6 (3 at once); later 0, never 0 | 2 of 6 (1 at once); later 1, never 3 | 6 of 6; later 0, never 0 | 6 of 6; later 0, never 0 |

  For sonnet B the speech of `h2` never gets an entry in 11 of 12 sessions, not even after the message that asks to
  finish it, while the two other deliverables of `h2` get theirs in their turn in 12 of 12 and end as they should
  (the cancelled one retired, the invitation completed). The first messages of `h1` and `h2` are built alike ("just sketch the welcome here for now and leave
  the other two for later"; "just sketch the speech here for now and leave the blurb for later"), and the results
  are 10 of 12 and 0 of 12: the batch does not show what makes the difference. The wording has a clause for the case
  ("even when the message asks only for a first step of it"), written against `single`. The batch compared whole
  wordings, so it says nothing about that clause alone; it says that the wording as a whole does not make the first
  entry reliable in scenarios it was not developed on.
- **Closing before the delivery.** After the first message of `h1` or `h2`, which ask for a sketch, an objective was
  already complete in: sonnet A 1 of 24 sessions, sonnet B 4 of 24 (reopened when the user asked to finish it in 2;
  a second completion refused in 1), fable A 6 of 12 (all in `h2`; reopened in 5, two with a refused call, which is
  why fable A has 4 of 6 there), fable B 0 of 12, haiku A 0 of 12, haiku B 2 of 12 (both reopened). Neither wording
  says that a sketch is not a delivery. The row "closed before the turn that settles it" of the full tables also
  counts completions made in the turn that delivers, one turn before the user's acceptance, which both wordings
  allow; it is not a count of defects.
- **Refused calls**, arm B: 2 of 96 sonnet sessions (both `h1`: the completion just mentioned, and one session that
  recorded two of three deliverables and then used the retired one's ID for the third), 1 of 48 haiku sessions, none
  for fable. Arm A: 2 of 48 fable sessions.
- **The final checkpoint repeats a completion made with the tool**: sonnet A in 2 of the 31 sessions that had such a
  completion, sonnet B in 5 of 70, haiku B in 1 of 34 (haiku A 0 of 4), fable 0 of 36 in both arms. The sentence the
  new wording adds about this changes nothing that these numbers can show.
- **Rules under the shipped wording.** Batch 1 found that every subject recorded every rule, in its two scenarios.
  Over the eight of this batch arm A records every rule in its turn in 57 of 96 sonnet sessions and 27 of 48 haiku
  sessions (fable 48 of 48). Sonnet misses the rule in `h2` (0 of 12), `h3` (1 of 12) and `h4` (0 of 12), where it is
  one sentence of a longer message, and in a third of the `chat` sessions (8 of 12), where it is a message of its
  own; haiku in `chat` and `h4` (0 of 6), `h1` (1 of 6) and `h3` (2 of 6). Arm B: sonnet 96 of 96; haiku 42 of 48
  (`chat` 5 of 6 and `h4` 1 of 6, the two control scenarios, in which nothing else calls for the tool).
- **Surplus.** No entry was made of a question in any of the 384 sessions with the built-in tools. The request that
  its own reply answers (a title, in `report`) became an objective for fable A in 6 of 6 and fable B in 0 of 6, for
  sonnet A in 2 of 12 and sonnet B in 1 of 12. Surplus rules attributed to the user, all in arm A: sonnet in 3 of 12
  `report` sessions, where the cancellation of the fact-check, which no objective entry could take, was written down
  as a rule ("Do not fact-check the risk section; legal will handle it"), and haiku once in `h3`, for an instruction
  about the label's opening. None in arm B. haiku B once made a second entry for one objective (`single`).
- **haiku/low.** Arm A: an objective entry in 4 of 36 work and single-deliverable sessions. Arm B: in 35 of 36, with
  *record right* in 5 or 6 of 6 in `build`, `report`, `h1` and `h3`; in `single` the plan is entered in the second,
  third or fourth turn or not at all (0 of 6 in its turn), and `h2` goes as for sonnet (4 of 6 without the speech).
- **fable/high.** The two arms make the same number of calls (251 in 48 sessions each). What differs is named above:
  no premature completion in `h2` and no entry for the title request in `report`.
- **Cost.** Each turn that edits the record is one more provider request. Over the eight scenarios with the built-in
  tools: sonnet 186 calls and 137 extra requests in arm A against 412 and 271 in arm B, in 96 sessions each (1.4
  against 2.8 extra requests in a session of four turns and one checkpoint); haiku 41 and 33 against 208 and 131 in
  48; fable 251 and 168 against 251 and 156 in 48.
- **Built-in tools.** fable called one (blocked) in 23 of 48 sessions in either arm, to look for a file the request
  might refer to; haiku in 1 and 2; sonnet in none.
- **Checkpoints** (seeded record, both variants): all 192 replies valid, every ID reference right, nothing restated
  as new or dropped, in both arms. The rule the user lifted is handled as in batch 1 (left out, kept under its ID
  with the new meaning, or replaced by a new rule); the arms do not differ in a way these numbers can show.

#### Reading, by the registered rule

- The wording is adopted: every point of the rule holds. Point 1 holds by one session (+9 against +8), and the whole
  effect on that reading is in `h1`; in `h2` no session of either arm has an entry of its own for every objective.
- The reading the rule was written for understates what changed in `h2` and `h3`: from no objective entry at all (24
  of 24 sessions in arm A) to an entry for two of three deliverables in their turn (`h2`, 12 of 12) and for the one
  deliverable a turn late (`h3`, 11 of 12). It also hides nothing: by the registered readings those sessions are not
  right, and they are counted so.
- No guard shows harm: in no scenario and for no subject is arm B lower than arm A on a registered reading by more
  than the rule allows, and in most it is higher. The rules a user gives are recorded far more reliably (sonnet 57 of
  96 sessions against 96 of 96), which the batch was not designed to show.
- What may be said: with the new wording sonnet/medium records objectives as separate entries and retires cancelled
  ones; it does not yet "keep the record as specified" (9 of 24 held-out work sessions right). The open defects are
  the entry for a deliverable that starts with a sketch or a first part (19 of 48 sonnet sessions and 13 of 24 haiku
  sessions have it in the first turn, very unevenly by scenario), and completion before delivery.
- Not tested: sessions with real work and working tools, long sessions, other provider families, a tool set between
  the two tried here. The held-out scenarios are four, by one author, and three of them open with the same
  construction (a request to sketch or to start one deliverable); they are less independent than four scenarios by
  four authors would be, and the two "0 of 12" are not two findings.

A second candidate was not frozen. If one is written, the four held-out scenarios become development scenarios for
it and it needs new ones that its author has not seen, preferably by more than one author.
