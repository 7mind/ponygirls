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

## Running

```bash
export PI_SDK_ROOT=<pi-monorepo of the pinned Pi> GATEWAY_EXTENSION=<pi-ai-gateway>/extension/index.ts
DRY=1 ./run.sh canary <frozen copy of the extension> <out> 2 claude-fable-5-2 high tools-builtins   # no model call
./run.sh fable-tools-builtins <frozen copy of the extension> <out> 6 claude-fable-5-2 high tools-builtins
node analyze.mjs <out>/fable-tools-builtins ...                                                     # rescore stored runs
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
