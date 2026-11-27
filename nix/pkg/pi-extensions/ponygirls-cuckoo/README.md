# Cuckoo

Opt-in objective/progress and session-local rule checkpoints from the **main conversation model**, and a
numbered record of those objectives and rules that the model keeps current between checkpoints. Uses
`@ponygirls/pi-settings` and `@ponygirls/pi-ui`, like the other extensions.

## Controls

- `/cuckoo` or `/cuckoo status`: view the current set of objectives and rules, the
  current-branch reports and the effective settings; see
  [The numbered record](#the-numbered-record).
- `/cuckoo settings`: staged checkbox dialog for Automatic mode, **Show Cuckoo
  JSON**, and all seven feature preferences. Tab or Left/Right changes Session/Project/Global scope;
  Space/Enter toggles, `r` resets to inheritance, `p` edits the complete growth
  policy, Ctrl-S applies the selected scope, and Escape discards unsaved drafts.
  Scope tabs, checkboxes and footer actions also support mouse clicks. The dialog
  shows local overrides, effective sources and inactive dependency reasons.
- `/cuckoo history`: view all saved answers in this session, newest first, with
  timestamps, checkpoint/entry IDs and current/other-branch labels. Includes
  invalid or interrupted answers and remains available while Cuckoo is OFF.
- `/cuckoo reports`: view current-branch reports and effective settings.
- `/cuckoo inquire now`: request a checkpoint even while automatic mode is OFF.
  Command completion walks both words, as well as the existing settings grammar.
- Press **`i`** in any Cuckoo panel to close it and request the same inquiry.
- `/cuckoo questions` (or `questions list`): show the standing questions and their stores.
- `/cuckoo [default|project] questions add TEXT`: add a standing question, asked at
  every checkpoint. `project` writes the trusted-project store; no prefix or `default`
  writes the global store. Without `TEXT` the terminal UI prompts for it.
- `/cuckoo [default|project] questions remove ID`: remove a question by the ID shown in
  the list. Without a prefix every readable store is searched; without `ID` the
  terminal UI offers a selection.
- In a report panel, **Enter** focuses the current set or the report of the
  selected checkpoint: the arrows then move through its rules, objectives and
  answers, and **Escape** returns to the list; see [Reading the panel](#reading-the-panel).
- **Tab**/**Shift-Tab** (or a click, or the arrows in the focused report) select a
  rule, objective or answer; on a saved checkpoint **`c`** comments on it; see
  [Commenting on a report](#commenting-on-a-report).
- **Ctrl+Alt+C**: toggle the report view without submitting or losing the editor draft.
- Click the **🐦 N** border badge (N: active objectives) to toggle reports (fullscreen, or regular
  mode with Pi's `regularMouse` enabled). At 120 columns or more, when the badge
  fits, it also shows **⌃⌥C**. Escape or `q` closes the view; from the focused
  report they first return to the list.
- `/cuckoo on|off|inherit`: session master override, or inherit project/global.
- `/cuckoo default on|off`: global master default.
- `/cuckoo project on|off|inherit`: trusted-project master override.
- `/cuckoo [default|project] feature NAME on|off|inherit`: set or reset one
  feature; omit the prefix for session scope. Names: `evidence`, `corrections`,
  `verifiers`, `reader`, `transfer`, `vectors`, `critic`.
- `/cuckoo transfer export|import|task|revoke|clear|status`: operator-only,
  same-project historical packet workflow; see below.
- `/cuckoo vectors approve|revoke|status`: choose a configured encoder and a task,
  grant bounded disclosure consent, revoke it, or inspect current status.
- `/cuckoo critic approve|revoke|status|reconcile`: choose a configured critic and
  a task, revoke consent, inspect recent advice/status, or explicitly reconcile
  one unresolved admission. None of these actions is a model tool.
- `/cuckoo policy relative 15`: grow 15% relative to the checkpoint's token count.
- `/cuckoo policy window 15`: grow by tokens equal to 15% of context-window capacity.
- `/cuckoo policy tokens 10000`: grow by 10,000 tokens.
- `/cuckoo policy inherit`: inherit project/global policy independently of enablement.
- `/cuckoo default policy window 15` (or `relative 15`, `tokens 10000`): global policy.
- `/cuckoo project policy tokens 10000` (or `relative`, `window`): project policy;
  `project policy inherit` removes that complete override.

Manual inquiries do not change enablement or policy. When idle, they start a
main-model response immediately; known context usage is required (send a task
first in a fresh session). While busy, one request is queued for the next safe
completed-turn boundary and unfinished work resumes afterward. Repeated requests
are coalesced. Abort, new user input, reload and branch navigation cancel queued
requests. Issuing a manual inquiry resets the cadence baseline just like an
automatic checkpoint.

Policy kind and value are one setting, so changing units cannot inherit a value
from a different mode. Existing `threshold PERCENT`, `threshold inherit`, and
`default threshold PERCENT` commands remain aliases for the relative policy.

Defaults: **master OFF**, **all seven new features OFF**, **growth equal to 15% of
context-window capacity** (`window 15`). Each field resolves independently:
session → trusted project → global → built-in default. Policy kind/value remains
one indivisible setting. A checked feature stays checked when master/dependencies
are off; the UI reports why it is inactive instead of enabling prerequisites.

Global preferences are mutable `<agentDir>/cuckoo.json`; project overrides use
`<cwd>/<CONFIG_DIR_NAME>/cuckoo.json` (normally `.pi/cuckoo.json`). Project files
are neither read nor written without Pi's project trust. Both store sparse
version-3 overrides; omitted fields inherit. Existing global version-1 percentages
and session threshold records keep their relative meaning; version-2 policies keep
their units. Reading old files does not rewrite them; explicit writes use version 3.

Apply rereads current storage and changes only edited fields. File replacement is
atomic, not a cross-process transaction. Session Apply appends one batch entry;
settings span branches but do not configure another fork/session ID. Resetting a
field never revives an older session override. Home Manager loads the extension
without managing or overwriting these preference files. Reports
follow the active branch and remain readable when automatic inquiries are OFF.
The history command reads all branches of the current session's persisted log;
reopening that session restores its history without a separate global history
file. A new session starts with no answers; a fork contains only entries Pi
copies into that new session. Opening history does not request model inference.

## Standing questions

Standing questions are additional questions the model must answer in every
checkpoint, next to objectives and rules. They are operator configuration, not
session state:

- Global questions live in `<agentDir>/cuckoo-questions.json`; project questions in
  `<cwd>/<CONFIG_DIR_NAME>/cuckoo-questions.json` (normally
  `.pi/cuckoo-questions.json`). Both are small versioned JSON files written by
  atomic replacement (not a cross-process transaction) and survive sessions,
  reloads and restarts. Home Manager does not manage or overwrite them.
- The project file is neither read nor written without Pi's project trust: an
  untrusted checkout cannot add text to the inquiry.
- An inquiry asks the global questions, then the project ones. There is no
  session-scoped list. Limits: 32 questions per store, one line of at most 2000
  characters each; control characters are removed on entry.
- Each question has a short ID (`q-…`), unique across both stores. The model
  echoes it, so answers do not depend on question order or wording.
- A malformed file, or one ID present in both stores (typically after copying
  the global file into a project), is a visible configuration fault: badge `!`,
  one error notification, and an error line at the top of the report panel and
  of `/cuckoo status`. No inquiry is issued from questions that cannot be read;
  saved reports stay readable and commentable.

Adding or removing a question takes effect at the next inquiry. Each checkpoint
stores the questions it asked, so saved answers stay readable after a question
is edited or removed, and a reply is validated against what was actually asked.

Without standing questions the inquiry text and the saved report format are
exactly those described under [Cadence and output](#cadence-and-output). A
standing question asks for a report; the prompt states that it is not a new
task, instruction or authorization. Answers are model self-reports like the rest
of a checkpoint.

## The numbered record

Cuckoo numbers every objective and every session-local rule: objectives are
`AO1`, `AO2`, … ("agentic objective"), rules `AR1`, `AR2`, …. Only Cuckoo assigns
IDs, one counter per kind for the whole session including all its branches, so an
ID is never reused and never names two entries. A fork is a new session: it
continues after the highest numbers among the entries Pi copied into it.

The **current set** of a branch is derived from two kinds of saved session
entries, in branch order. Nothing else stores it, so it follows branch
navigation and survives compaction, reload and restart:

- **Checkpoint reports** (`cuckoo.report`, version 6). A reply names every
  objective and rule by `id`: the ID of the entry it continues, or `null` for a
  new one, which Cuckoo numbers when it captures the reply. A valid reply is a
  full restatement: each listed entry takes the reply's text; a listed objective
  whose `eta` is `Complete` becomes **complete**, any other listed entry
  **active** (this reopens a closed entry that is listed again). An active
  objective or rule the reply leaves out becomes **retired**; a complete
  objective stays complete. An invalid reply changes nothing. `Complete` may be
  followed by punctuation and more text (`Complete: merged`); an estimate such as
  `Complete by Friday` is not a completion.
- **Edits** (`cuckoo.edit`), one per call of the model's `cuckoo_update` tool.

A reply that names an ID the record of its branch never held, an ID of the
other kind, or one ID twice is invalid, like a reply with a missing field: an ID
identifies an entry only when Cuckoo gave it. Reports of versions 1 to 5 carry
no IDs and do not enter the record; a session that has only such reports gets a
current set with its next checkpoint or first edit.

Every entry keeps the event that created it, the event its present text comes
from, and, once it is completed or retired, the event that closed it. What a
completed objective says can change afterwards (a defect found later); when it
was completed does not.

### `cuckoo_update`

While Automatic mode is ON, the model has the **`cuckoo_update`** tool to keep
the record current between checkpoints; one edit per call:

```json
{"action":"add_objective","objective":"Ship the parser"}
{"action":"add_objective","objective":"Write the docs","progress":"Outline exists","issues":["No reviewer yet"],"eta":"About a day"}
{"action":"add_rule","rule":"Ask before pushing","source":"user","scope":"This repository"}
{"action":"update","id":"AO1","progress":"Grammar done","eta":"Two days"}
{"action":"complete","id":"AO2","progress":"Docs published","issues":["No index yet"]}
{"action":"retire","id":"AR1","reason":"The user dropped the rule"}
{"action":"reopen","id":"AO2"}
```

| Action | Arguments | Effect |
|---|---|---|
| `add_objective` | `objective`; optional `progress`, `issues`, `eta` | New active objective; the result carries its ID |
| `add_rule` | `rule`, `source` (`user` or `assistant`), `scope` | New active rule; the result carries its ID |
| `update` | `id`; any of `objective`, `progress`, `issues`, `eta` (objective) or `rule`, `source`, `scope` (rule) | Changes what an active entry or a completed objective says, not its status |
| `complete` | `id`, `progress` (what was delivered), `issues` (remaining defects, risks, caveats; `[]` when none are known) | Active objective becomes complete |
| `retire` | `id`, `reason` | Active objective or rule becomes retired: cancelled, superseded or no longer applicable |
| `reopen` | `id` | A completed or retired entry is active again; a reopened completed objective has no estimate until one is stated |

- The tool never accepts an ID for a new entry, and rejects arguments that
  belong to another action instead of ignoring them. An edit that does not fit
  the record (unknown ID, completing a rule, retiring a completed objective,
  changing a retired entry, an `eta` that says `Complete` outside `complete`) is
  refused with the reason and saves nothing.
- Limits are those of a report: 100 active objectives, 100 active rules, 100
  issues, 8000 characters per string. In addition the tool keeps the text of the
  active objectives, rules and scopes within 50000 characters, half of what one
  checkpoint reply may hold, so that a checkpoint can restate the record. A
  checkpoint reply may itself state more; the tool then accepts only edits that
  do not add to it.
- Rules are session-local only, as in a checkpoint: instructions the user gave
  in this session and conventions the model adopted, not rules from system or
  developer prompts, AGENTS.md or skills. `source: user` is the model's
  attribution, not proof of a user instruction.
- A completion made with the tool counts as reported: the next checkpoint
  leaves the objective out, and the current set keeps what was delivered and the
  caveats.
- The tool is declared to the model only while Automatic mode is ON and is
  withdrawn when it is turned off; there is no separate setting. Without it the
  record is still built from manual inquiries. It is blocked during a
  checkpoint like every other tool, and it runs one call at a time.
- Its guidance asks the model to add an objective when it takes one on, to
  complete or retire it when it is done, cancelled or superseded, to update it
  when scope, blocking issues or the expected completion change materially, to
  do the same for session-local rules, and not to use it for routine progress.
  This is a prose instruction, not a guarantee of model behaviour.
- In the transcript a call is one line while collapsed
  (`cuckoo_update retire AO5 → retired · Superseded by the rewrite`); an error and
  the expanded form show the full text.

The record is the model's own account for the user, like a report: **not
independently verified progress, a user instruction, approval or authorization**.
Entries are append-only history in the session file: nothing is deleted, a
retired entry keeps its last text and reason. Whether a model keeps the record
current depends on the model; a checkpoint restates the whole record either way.

Limits of the record:

- Numbering assumes that one Pi process writes a session at a time, as the
  session file itself does. Two processes that append to the same session file
  concurrently each number from their own view and can give the same ID to
  different entries on their two branches.
- A report holds at most 100 objectives. With exactly 100 active objectives it
  has no room for a row that reports a completion or a new defect in completed
  work; `cuckoo_update` (`complete`, or `update` of the completed objective)
  records that without a report.
- A request names at most the 50 most recently stated completed objectives. An
  older completion is no longer named, so a model can report it again after its
  own earlier answers were compacted away.
- Saved data this version cannot read (an edit or the numbering of a report,
  for example written by a later version or damaged) is reported as a fault:
  badge `!`, an error line in the panel and in `/cuckoo status`. Saved reports
  stay viewable, the current set is shown as unavailable, no inquiry is issued,
  and `cuckoo_update` refuses. A reply captured in that state is kept as an
  invalid checkpoint with its raw text.

## Commenting on a report

Every rule, objective and standing-question answer of a valid report is a
selectable item in the report and history panels. Comments are made on saved
checkpoints: the current set, which the report panel shows first, takes none.

1. Open the panel and select a checkpoint (`↓` from the current set). Scroll
   (`ctrl-u`/`ctrl-d`, wheel), or press **Enter** to focus the report and read it
   with the arrows.
2. Move the item cursor (accent bar in the left gutter). In the focused report
   the **arrows** move it; **Tab**/**Shift-Tab** move it in either state and
   scroll it into view. From a cursor that is off screen, Down and Tab take the
   first item on screen, Up and Shift-Tab the last. A left click selects the item
   under the pointer where mouse input is available.
3. **`c`** opens an editor under the report for the selected item (with no cursor,
   the first item on screen). **Enter** adds the comment, **Shift-Enter** inserts a
   newline, **Escape** discards the draft without closing the panel. While the
   editor is open all keys, including `i`, `q` and pasted text, are text, and the
   checkpoint table is hidden so that the report keeps its rows.
4. New comments appear under their item marked `[new]`. **`x`** removes the last
   new comment of the selected item.

When the panel closes, by any path (Escape or `q` in the list, `i`, the badge,
Ctrl+Alt+C, session shutdown), all new comments are saved together; text still
in the editor is saved too rather than dropped. Saving means:

- **History.** Each comment becomes its own `cuckoo.comment` session entry holding
  the checkpoint request ID, the item, a quotation of the item (with its ID when
  the report has IDs: `Objective AO2: …`), the text and a timestamp. Comments are append-only: saved comments cannot be edited or
  removed. They are shown under their item in the panel, in plain-text reports,
  in `/cuckoo history` and in `cuckoo_recall`. An objective is commented as a
  whole; its issues and ETA are not separate items.
- **The model.** The comments are delivered once as a visible `cuckoo.comments`
  message that quotes each commented item. What follows depends on what the
  model is doing when the panel closes:
  - **Idle:** the message is appended immediately and the model is asked to
    respond at once, in an ordinary turn (not a JSON report). The request to
    respond is a hidden `cuckoo.comments.respond` message. Escape aborts that
    turn like any other.
  - **Running:** the message arrives at the next completed turn boundary, before
    any inquiry issued at that boundary; no separate turn is started, because the
    running model reads it with its next request.
  - **Closed with `i`:** the comments are delivered and the inquiry is the only
    request, so the model answers with a report that can reflect them.
  - **Session shutdown, or nothing new to save:** no turn is started.

  Comments that no such point could take (made during compaction or an aborted
  response, or when Pi exits first) are appended once the session is idle, or
  join the first request of the next run; these catch-up deliveries do not start
  a turn.

Delivery is derived from the session tree, not from a queue: a comment counts as
delivered on a branch only when a delivery message on that branch lists it. A
branch that lacks the comment is not told about it; `/cuckoo history` still shows
comments from all branches. A comment made in `/cuckoo history` on a checkpoint
of another branch is saved on, and delivered to, the current branch; the
delivery message says that the checkpoint belongs to another branch. Quotations
of report text in comments and in the delivery message have terminal control
characters removed. Comments are user feedback, not approval, and the
delivery message says it is not an inquiry. Invalid reports have no items to
comment on. Commenting requires the terminal UI; RPC/plain output only displays
saved comments.

## Model awareness and reflection recall

At each run start, a structured system-prompt section explains Cuckoo's
context-growth cadence, the current automatic enablement/policy, and the
JSON-only inquiry/resumption protocol. It does not start an inquiry. Invalid
settings are reported as unavailable rather than as an enabled/disabled default.

The section also explains the numbered record, its two writers and that it is
the model's own account, not an instruction or authorization.

The model can use the read-only **`cuckoo_recall`** tool during ordinary work:

```json
{"action":"list"}
{"action":"list","scope":"session","limit":10}
{"action":"list","before":"<nextBefore from previous page>"}
{"action":"read","entryId":"<round entryId>"}
{"action":"read","entryId":"<round entryId>","offset":6000,"limit":6000}
{"action":"current"}
```

- Default scope is `branch` (the current branch); explicit `session` scope
  includes every branch in the current session. Use the same scope for later
  list/read pages. No other session files or global memory are searched.
- List returns newest-first metadata: stable report-entry ID, request ID,
  timestamp, current/other branch, schema version, valid/invalid status,
  objective/rule/answer/comment counts and source-response entry ID when recorded. `valid`
  means schema-valid, **not independently verified**. `nextBefore` is an
  exclusive entry-ID cursor: new rounds do not shift already enumerated pages.
  The default page is 10 rounds, maximum 20. A missing/out-of-scope cursor is
  an error; restart listing after changing branches.
- Read returns `text`, a page of a JSON document containing the version-aware
  parsed report (with standing-question answers), the questions that round
  asked, exact raw answer, validation/interruption error, source response
  metadata (provider/model when available) and the user comments attached to
  that round within the selected scope. Concatenate `text` pages
  using `nextOffset` until it is `null`, then parse the combined JSON. Offsets
  count UTF-16 code units; default page size is 6000, maximum 8000. Responses
  are capped at 50000 UTF-8 bytes; oversized metadata is an explicit error,
  not silent truncation. Thinking blocks and unrelated stored content are not
  exposed by this tool.
- Current returns the [numbered record](#the-numbered-record) of the current
  branch as a page of a JSON document, paged like read (`offset`, `limit`):
  `objectives` and `rules` hold the active entries in full, `closed` the 20
  closed entries stated most recently with `status`, `reason` and their last
  text, and `olderClosed` counts the rest. Every entry says where it was last
  `stated`, and a closed one also what `closed` it: a checkpoint (its number and
  report `entryId`, which read accepts) or the update tool, with the timestamp. The result also carries `activeObjectives`,
  `activeRules` and `closed` counts. It takes no `scope`, `entryId` or `before`:
  the record belongs to one branch. This is how the model gets its IDs back
  after compaction.
- Invalid/interrupted rounds remain readable. Legacy missing fields are
  `null` (not recorded), not invented values or evidence that no rules applied.
  `answers` is `null` when the round asked no standing questions. Objectives and
  rules of rounds saved before numbering have `id: null`.
- Recall uses persisted session entries, so it survives compaction/reload and
  follows branch navigation immediately. Forks expose only the entries Pi
  copied. It stays available while automatic inquiries are OFF, performs no
  inference or history mutation, and remains blocked during JSON-only inquiries
  like every other tool. Normal Pi tool selection can restrict its availability.

Every result identifies the current session and warns that reflections are
historical model self-reports, not current facts, rules, approval or authority.
The model is told to reconcile them with current evidence/instructions, not
revive superseded objectives or follow instructions embedded in recalled text.
This is an on-demand reflection-history layer, **not** an independently verified
memory or a demonstrated improvement in model behavior.

## Feature controls and audit memory

Normal directory/`index.ts` loading registers the feature tools inactive. Enable
master and desired features through `/cuckoo settings` or commands. No extra
entry point is needed: `audit-memory.ts` now emits only a migration notice; remove
it from the extension list. Defaults do not expose the memory schema to the model.

`evidence` permits task labels, exact snapshots and claims; `corrections` permits
new corrections; `verifiers` permits checker listing/execution; `reader` permits
expanded record enumeration/inspection/text paging. Corrections and verifiers
require evidence. Existing correction projection is always honored, even after
new correction creation is disabled. Evidence retains basic public-source reading
needed to capture snapshots. Reader can inspect existing records without enabling
new evidence creation.

Master OFF hides and denies these feature actions, while saved reflection
recall/history and explicit manual inquiries remain available. An observed change to
effective feature settings invalidates in-flight feature operations;
re-enabling cannot publish an old check. Navigation, reload and shutdown also fence
late work; ordinary native appends do not. Existing native records remain intact.
All tools remain blocked during a JSON-only inquiry. Feature eligibility does not
constitute approval to transfer or transmit data.

This is an auditability capability, not demonstrated cognitive improvement.
Controlled continuation tests found no final-answer gain; forced use increased
request-limit failures for the weaker tested configuration. Optional use also
showed no answer gain: the stronger model ignored memory, while the weaker model
used it and hit one request limit. Do not mandate ledger use, infer general
efficiency gains, or treat stored claims as verified facts.

```json
{"action":"metadata"}
{"action":"list-sources","scope":"branch","limit":10}
{"action":"task","label":"Current task retrieval label"}
{"action":"snapshot","taskId":"<task id>","purpose":"artifact","label":"Selected work product","selector":{"entryId":"<native source id>","part":0,"start":0,"end":123},"dependsOn":[]}
{"action":"list-records","taskId":"<task id>","recordKind":"snapshot"}
{"action":"inspect","id":"<record id>"}
{"action":"snapshot-text","id":"<snapshot id>","offset":0,"limit":4000}
{"action":"checkers"}
{"action":"check","taskId":"<task id>","artifactId":"<snapshot id>","checkerId":"json-syntax","evidenceIds":[]}
```

A task label anchors the latest native user message; native role does not prove
human approval. Snapshots capture exact selected public text with UTF-16 offsets,
source identity and digest. They cannot read arbitrary paths, private content
blocks, other session files, or recycle Cuckoo tool/checkpoint output as fresh
evidence. Artifact snapshots require assistant or ordinary tool-result sources;
evidence snapshots can also select user text. Recorded text survives source
loss/change, which is reported separately from snapshot integrity.

`claim` records explicitly model-authored observations, interpretations,
decisions or assumptions using `taskId`, `category`, `text`, `evidenceIds` and
`dependsOn`. `correct` requires explicit `targetIds`, `replacementIds`, supporting
`evidenceIds` and a `reason`; labels, timestamps and similar text never imply
supersession. Only declared descendants become `needs-recheck`. Superseded
records do not silently become active again. **Active is not verified or true.**

Writes return bounded receipts rather than repeating large snapshot bodies.
Use their IDs for inspection or lossless text paging. Reads default to the
current branch; alternative history requires explicit `scope:"session"` and is
not projected as current. List pages default to 10/max 20, text pages to 4000/max
6000 UTF-16 code units, and results to 50000 UTF-8 bytes. Missing, malformed or
oversized records fail explicitly; metadata inspection says when text is omitted.

The built-in `json-syntax` checker checks JSON syntax only—not task correctness,
coverage, approval or deployment. A trusted registry binds standalone checker
bytes/export/bootstrap and Node/V8 identity. Model arguments cannot provide code,
paths, expected answers, outcomes or approvals. Actual executions persist a start
and a bound terminal observation; starts without a terminal remain unresolved.
Workers are terminated on cancellation/deadline, and navigation/reload/shutdown
fence late results. Ordinary appends do not invalidate an in-flight check.
Workers provide termination, **not a security sandbox**; registered code is trusted.

## Operator-approved session transfer

Enable `transfer` and master, then use these TUI commands:

- `transfer export`: provide a current-branch task ID, explicit record IDs and a
  new absolute output path. Review the complete reference closure, then separately
  confirm writing the exact canonical packet. Export creates an exclusive `0600`
  file; it never overwrites, creates directories or discovers sessions.
- `transfer import`: select one explicit readable regular manifest file. Symlinks
  and nonregular files are rejected; reads are byte-bounded with strict UTF-8.
  Review the immutable escaped contents, then separately approve the displayed
  digest, input path, destination and expiry. The bounded confirmation defaults
  to Cancel; Left/Right selects the choice and Enter confirms it.
- `transfer task`: choose an existing destination task or no selected task.
  Changing this selection revokes retained packets.
- `transfer revoke` / `clear`: revoke one or all packets. Clear also cancels
  pending dialogs. Previously returned text cannot be erased.
- `transfer status`: inspect the current destination and retained approval count.

The model's `cuckoo_transfer` tool only lists approved packet metadata or performs
`list`, `inspect` and lossless `text` reads by returned packet/record IDs. It accepts
no paths, manifests, approval fields or destination identity. Nothing is appended
to the destination memory graph. Origins are declared provenance, not signatures;
old user text and successful checks remain historical, not new authority or fresh
verification.

The lease is 15 minutes, with at most four retained packets and 2 MB in total.
Approvals are runtime-local and are removed by expiry, revocation, observed effective
feature changes, navigation, reload or shutdown. Destination branch identity uses a digest
of the stable navigation epoch, not the changing leaf. Source branch heads remain
exact export observations. Projects are identified by canonical cwd digest;
declared cross-project packets are rejected.

## Per-task network consent

Enabling `vectors` or `critic` starts no network work. Vectors require reader;
critic requires evidence. Each separately requires an operator TUI approval: choose
an existing current-branch task and configured destination, inspect the current
snapshots and future-content policy, then approve in a bounded Cancel-default
confirmation panel. The grant covers snapshots assigned to that **task ID**,
including future snapshots; vector consent also covers bounded model-written
query text. Task assignment/labels remain model-authored, not proof of semantic
scope. The host never harvests ambient/system/developer/hidden-reasoning blocks.
A native user-role message or model-written permission field cannot create a grant.

Grants are runtime-local and bound to project, session, navigation/configuration
scope, task and exact model configuration. They last at most 30 elapsed minutes
(monotonic lease; civil timestamps for display), with at most 256 encoder calls or
32 critic calls per grant. These are runaway/resource safeguards, not financial
approval gates. Revocation, expiry, observed configuration drift, navigation,
reload and shutdown remove authority. Native receipts do not restore grants on
restart; failed/uncertain calls are not automatically refunded or retried.

### Encoder configuration and search

Configure global `<agentDir>/cuckoo-encoders.json`; project preferences and model
arguments cannot choose credential sources or routes. Example structure:

```json
{
  "version": 1,
  "encoders": [{
    "id": "team-encoder",
    "label": "Selected team encoder",
    "url": "https://encoder.example.invalid/v1/embeddings",
    "model": "configured-model-id",
    "version": "advertised-model-version",
    "dimensions": 4096,
    "normalization": "unit",
    "credentialEnv": "ENCODER_API_KEY"
  }]
}
```

Use a real configured HTTPS URL/model/version/dimension. The named environment
variable supplies the credential to the Pi process; never put its value in this
file, a model argument, source control or a disclosure preview. Missing/malformed
configuration fails visibly; there is no provider discovery call or fallback.
Owned-loopback transport is an explicitly injected test service, not a production
profile flag. Encoder identities bind configuration, implementation sources and
Node/V8; advertised labels do not attest provider weights.

After consent, `cuckoo_search` takes `taskId`, `query`, and optional bounded `topK`.
It indexes exact source-available snapshots of the approved task, serializes index
updates and rechecks current digests/status/authority at HTTP handoff and after
awaits. The task inventory is bounded to 128 snapshots and 1 MB; oversized inputs
fail rather than silently shrinking coverage. Search returns active candidates,
IDs/digests and explicit total/available/excluded/indexed counts, never vectors or
credentials. Inspect exact text through `cuckoo_memory`. Status-only corrections
do not require re-encoding; new task snapshots are admitted on the next search.
Inventory changes mid-search fail explicitly. Completed cached rows may be reused
by a later explicit search, but an incomplete search is never reported successful.
Cancellation stops local waiting, not necessarily provider work.

### Advisory critic

Critic selection uses the existing Pi model registry and scoped-model list; it
never creates a second runtime or reads authentication files. Supported native
APIs are OpenAI completions/responses/Codex responses with a verifiable off-thinking
configuration. Virtual, incompatible and recognized prohibited model bindings are
excluded. URL/configuration drift fails closed; the SDK resolves its own auth.
No ambient history, tools, delegation, mutations or new goals are given to it.

At an already-continuing ordinary boundary, the critic may review the selected
latest native task's latest active artifact plus its bounded active/available
evidence snapshots. It does not transmit task labels or checker output as input.
The exact bundle must fit 64 records, 24000 characters and 96000 UTF-8 bytes; it is
not truncated. Requests are tool-free, at most 30 seconds/2000 output tokens, and
advisory only. There is also a persistent session-wide cap of 128 requests.

Completion records state/advice but never starts another main-model turn. Advice
can be proposed only at a pre-existing ordinary continuation; JSON inquiries defer
that proposal, and ordinary final/failed/aborted work cannot be resumed by advice.
A handoff record is a host proposal, not proof of commit, model reading or benefit.
`critic status` exposes bounded recent advice with its historical outcome and
applicability-at-completion, including when no continuation received it.

Native start/transport/terminal records preserve unresolved admission through
reload. Config OFF revokes applicability while genuine same-owner settlement can
still be recorded; stale-owner callbacks cannot write into another session/branch.
`critic reconcile` is a separate Cancel-default release of one unresolved
reservation when no live owned client is known. It acknowledges that provider work
may continue; it neither proves remote stop nor retries/resumes anything.

The controlled study harness remains on `experiment/cuckoo-candidates`. The
previous study showed no final-answer gain; runtime integration and mechanical
acceptance are not new semantic-quality evidence.

## Reading the panel

The terminal panel shows a selectable table with the detail of the selected
row beneath. Once the branch has a [current set](#the-numbered-record), its row
(`now`) is the first one and is selected when the panel opens; the saved
checkpoints follow, newest first. A branch without a current set opens on its
newest checkpoint. The panel has two focus states; the arrows act on the
focused part:

- **List** (initial). `↑`/`↓` select the current set or a checkpoint; the report scrolls with
  PgUp/PgDn, Home/End and the wheel. **Enter** focuses the report.
- **Report.** The table folds away and the report takes its rows. `↑`/`↓` move
  the item cursor over rules, objectives and answers, and the view follows. The
  cursor item is shown to its end first: at once when it fits the view, one line
  per press when it is taller. Then the next item is taken and shown the same
  way. While no item is on screen, before the first and after the last item,
  and in a report without items (an invalid one), the arrows scroll one line.
  The view never moves by more than its own height, so no line is skipped in
  either direction, and the cursor never moves to an item that is not on
  screen. **Escape** returns to the list; Escape there closes the panel.

A focus change keeps the report where it is: its first visible line stays first
as far as the size of the view allows, and Enter followed directly by Escape
returns to the same view. The size matters in two places. At the end of a report
the taller view of the focused report shows more of what precedes it. And when
Escape does not directly follow Enter and would hide the selected item that was
on screen, the shorter view of the list follows it, so that `c` still comments
on that item. Enter puts the item
cursor on the first item on screen, if there is one and the cursor is not on
screen already; the cursor is kept until another checkpoint is selected.

**Table viewport:** Shows up to 3 rows (bounded dynamically
by allocated panel height): the current set, then checkpoints newest-first, with columns: index, request ID, objective count, and
status (saved or invalid). The row of the current set reads `now`, counts its
active objectives and has the status `current`. Column widths adapt to the terminal; the request-ID
column yields first in narrow layouts. Odd rows have a subtle panel-background
stripe; the selected row has an accent marker and selected-background band. When
the list is longer than the table, the panel title says which rows are shown
(`1–3 of 8`). The table is shown while the list is focused and no comment is
being written.

**Current set:** Titled `Current set` (`Cuckoo current set` while the table is
hidden). One muted line says how many objectives and rules are active and what
changed the set last (`4 active objectives · 3 active rules · last change:
cuckoo_update · 2m ago`). Then, each entry with its ID: the active objectives
(progress, issues, ETA, and `As of`: the checkpoint or tool call their present
text comes from, with its age), the active rules, and under `Closed · newest
first` the 20 closed entries stated most recently, with how they were closed:
`Complete` (when, by a checkpoint or the tool) with what was delivered and the
caveats, or `Retired` with the model's reason, or the checkpoint that left the
entry out. A completed objective that was restated later, for example with a
defect found afterwards, moves up and shows that statement under `As of`.
Older closed entries are counted. Objectives precede rules here, unlike in a
report: the view answers what the model is working on now. Fields the model
has not stated are not invented: one line names them (`Not stated: issues,
ETA`), for example for an objective added with a title only or reopened
without a new estimate. Entries can be walked like report items but not
commented on (`c` says so). The panel
shows the set as it was when the panel opened; reopen it to see later edits.
Ages are counted when the panel is drawn.

**Report:** A fixed title line names the selected checkpoint: `Checkpoint 4`
under the table, `Cuckoo checkpoint 4 of 8` while the table is hidden (`Answer`
in history; the row of the current set is not counted). When the report does not fit, the title shows the scroll position
on the right (`↑ lines 13–30 of 65 ↓`; an arrow marks a side with hidden lines).
At narrow widths the title keeps the checkpoint and gives up `Cuckoo` before
the position. Under the title, runtime errors appear first, then one muted line with
the request ID and metadata (timestamp, branch, entry ID, qualifier, comment
count; it wraps at narrow widths), then the report body. The body renders
inline behind a two-column gutter: rules section, then objectives with
compact labeled fields (progress, a single issues list, ETA), then standing
questions with their answers when the checkpoint asked any. Rules and objectives
carry their IDs; in a report saved before numbering, rules have none and
objectives are numbered by position. Comments follow the
item they belong to. The gutter shows an accent bar beside the selected item. Invalid reports show the raw output and
error rather than parsed fields. After the report, effective settings and
configuration scroll into view. The entire body (errors + report + settings)
scrolls independently of the table via PgUp/PgDn or ctrl-u/ctrl-d (half-page)
and Home/End (top/bottom). All body lines are wrapped to the panel width so no
content is clipped.

**Footer:** Key hints are fixed at the bottom, always visible, and list the keys
that act in the current state: a checkpoint without items offers neither `c` nor
`tab/shift-tab`. The `i` key closes the panel and requests an immediate inquiry.
A notice appears above the hints in place of the count of new comments and
keeps that line's rows. While a comment is being written the footer holds the
editor and its own hints, and the commented item is kept in view, also across a
resize.

**History view** (`/cuckoo history`) adds timestamp, branch attribution, and
entry IDs to the metadata line (wrapped, not as separate table columns).

**Keyboard:**

| Keys | List focused | Report focused |
|---|---|---|
| `↑` `↓` `j` `k` | Select checkpoint | Next/previous item, or one line (see above) |
| `enter` | Focus the report | — |
| `esc` `q` | Close panel | Back to the list |
| `PgUp` `PgDn` `ctrl-u` `ctrl-d` | Scroll report half-page up/down | same |
| `Home` `End` | Scroll report to top/bottom | same |
| `tab` `shift-tab` | Select next/previous rule, objective or answer | same |
| `c` | Comment on the selected item of a saved checkpoint | same |
| `x` | Remove the last new comment of the selected item | same |
| `i` | Close and request inquiry now | same |
| Mouse wheel | Scroll report | same |
| Left click | Select the item under the pointer | same |

In regular mode the table and report fit within the allocated height. In
fullscreen, PgUp/PgDn scroll the report while the panel has focus and return
to scrolling the transcript when it closes. RPC/plain-text output remains the
complete unstyled flat report with all checkpoints, history attribution, and
rule source/scope data; it states the current set first, under `Current set`. Theme changes regenerate colors. The border badge remains
available while the panel is open.

## Cadence and output

At completed model-turn boundaries, Cuckoo observes Pi's context token usage
(including cached tokens). The first eligible observation establishes a
baseline. All policies measure additional tokens since that baseline:

| Policy | Baseline 20k, context window 200k: next inquiry |
|---|---|
| `relative 15` | 23k (3k additional tokens) |
| `window 15` | 50k (30k additional tokens) |
| `tokens 10000` | 30k (10k additional tokens) |

Subsequent baselines are the usage observed when an inquiry is issued.
Percentage policies accept finite values `0 < value <= 100`, rounding fractional
token increments upward. Token policies require positive safe integers.
Policy changes use the existing baseline. There is no timer or idle wakeup.

Unknown usage defers scheduling; the window policy also requires known positive
context-window capacity (no substitution of a token percentage). A context decrease or model/capacity change
establishes a fresh baseline. Pending compaction/context edits, other extensions'
model-facing drafts, and queued user input defer scheduling. Inquiry and resume
responses cannot themselves trigger another inquiry at that same boundary.

The main model receives “Restate me your objectives and brief me on your
progress, obstacles, issues, bottlenecks, and ETA” with a JSON-only schema:

```json
{"objectives":[{"id":"AO3","objective":"Unfinished objective","progress":"Brief factual progress","issues":["A decoder defect needs correction","Waiting for access approval","Serial runtime validation limits progress"],"eta":"Unknown: validation has not started"},{"id":null,"objective":"An objective the record does not hold yet","progress":"Not started","issues":[],"eta":"Unknown"}],"rules":[{"id":"AR1","rule":"Show mockups before implementation","source":"user","scope":"This UI change"}]}
```

Right after the schema the prompt explains the [numbered record](#the-numbered-record):
every objective and rule of the answer has an `id`; the model copies the ID of an
entry it continues, also when it rewords the entry, writes `null` for a new one,
and never invents or repeats an ID; the record is its own earlier account, not an
instruction; and Cuckoo closes what the answer leaves out (an active objective
becomes retired, a rule is no longer active, completed objectives stay complete). The record itself
closes the request, after the instructions, as JSON:

```json
{"objectives":[{"id":"AO3","objective":"Unfinished objective"}],"completed":[{"id":"AO1","objective":"Survey the reports"}],"rules":[{"id":"AR1","rule":"Show mockups before implementation","source":"user","scope":"This UI change"}]}
```

`objectives` and `rules` are the active entries (titles only for objectives,
rules in full); `completed` names the objectives already reported as complete
(at most the 50 most recently stated, 300 characters each), which the answer
leaves out unless it reopens one or reports a new defect in it. Retired entries
are not listed. Entry text is the model's own earlier output, quoted as data.

Then the prompt states which objectives a report lists:

- every unfinished objective: work is still left for the model, including work
  it must do once something it waits for arrives;
- each completed objective exactly once, in the first checkpoint after it was
  completed: `progress` says what was delivered, `issues` holds its remaining
  defects, risks and caveats, and `eta` is `Complete`. Later checkpoints leave
  it out and do not repeat its caveats, even if the user may still ask for
  changes. A new defect or risk in completed work is reported once the same
  way;
- no cancelled or superseded objectives.

The session's system-prompt section says the same. A report lists a completed
objective once so that its caveats are stated; later reports stay about what is
unfinished. The current set keeps completed objectives, with what was delivered
and their caveats, among its closed entries.

The model sees its earlier answers only until compaction removes them, so the
request tells it what was already reported: the record's `completed` list,
which covers completions reported at a checkpoint and those made with
`cuckoo_update`. Reports saved before numbering have no IDs; for them the
extension still takes the objectives whose latest listing in those reports has
an `eta` starting with `Complete` (at most the 50 most recent, 300 characters
each) and appends them to the objective rule as a JSON array of titles the
model must not report as completed again, until an entry of the record carries
that title. Without such titles, standing questions and entries the inquiry is
exactly the base text with an empty record.

The decoder checks the IDs of a reply (known, of the right kind, not repeated);
the rest are prose instructions, not validation: it does not check that a
completed objective appears once, or that an entry the reply leaves out was
meant to be closed. The current set shows such an entry as retired because
that checkpoint left it out, with no reason.

After a checkpoint closes, the text that stands in for its inquiry in the
model's context names the IDs Cuckoo gave to the entries the answer introduced,
each with the start of its text (120 characters), so that the model can name
them in later answers and edits without counting positions in its answer. Pi
delivers that text in the user role; it says that the quoted titles are the
model's own earlier wording, not instructions. A round whose saved report
cannot be read is closed without that note.

The prompt asks for brief, concise, human-friendly plain language in every field,
preferably one short sentence or phrase. It discourages jargon, repetition, filler
and unnecessary implementation details without sacrificing accuracy, material
blockers, rule scope/attribution or uncertainty. This is a prose instruction,
not an additional length limit or a guarantee of model behavior.

Each objective has exactly `id`, `objective`, `progress`, `issues`, and `eta`.
`objective`, `progress` and `eta` are nonempty strings. `issues` is one list of
nonempty strings covering all three conceptual categories: known defects/risks,
obstacles/impediments/blocking dependencies, and bottlenecks limiting progress or
throughput. The model is asked to combine overlapping concerns, not emit separate
category fields or sublists. Use `[]` when none are known; this does not mean they
were independently ruled out. The panel shows `None known` for an empty list.
Limits: 100 objectives, 100 issues per objective, 8000 characters per string,
and 100000 characters for the complete response. ETA is time to completion with its evidence, assumptions
and uncertainty, or `Unknown` with the reason an estimate is unavailable; the
inquiry explicitly prohibits invented deadlines or estimates.

The `rules` array restates active session-local user instructions and
assistant-adopted working conventions, excluding inherited system/developer,
AGENTS.md and installed-skill rules, superseded instructions and inferred
preferences. Each rule has an `id`, required `rule` and `scope` nonempty strings (at most
8000 characters each), and `source` exactly `user` or `assistant`. At most 100
rules are allowed, within the existing total response limit. Rules remain separate
from objectives and may apply even when no objectives remain. An empty array
means no session-local rules were reported. Assistant conventions are not user
approval or authorization. This is a recall prompt, not a policy enforcement or
independent provenance-verification mechanism.

With standing questions configured, the inquiry also lists them as JSON and
the response must carry `"answers":[{"id":"q-…","answer":"…"}]` with exactly one
item per asked question: only `id` (copied exactly) and a nonempty `answer` of at
most 8000 characters. Missing, duplicate, unknown or extra answers make the
reply invalid; its raw text and the asked questions are retained. A reply to an
inquiry without standing questions must not contain `answers`.

New checkpoints use metadata version 6: the reply carries IDs, and the record
stores the questions the inquiry asked (`id`, `question`, `scope`; none means
the reply has no `answers`) and `assigned`, the IDs Cuckoo gave to the reply's
`null` items in the order listed. IDs are checked and assigned once, when the
reply is captured; reading a saved report decodes the reply and applies
`assigned`, and saved numbering that does not fit its reply is a visible fault.
Version 4 (no standing questions) and version 5 (with a stored question
snapshot) are the formats saved before numbering; their items have no IDs
(`id: null` in recall, numbered by position in the panel). Version-1 through version-3 saved reports
remain readable without rewriting their original raw responses. Version-2/3
obstacles, issues and bottlenecks normalize into three labeled legacy items in
the unified issues list, preserving every original statement (even `None known`)
rather than inferring an empty list. This normalized projection is also returned
by `cuckoo_recall`; its `version` identifies the saved format and `raw` retains
that exact format. Version-1 issues and ETA remain unrecorded (`null` in recall,
`Not recorded (legacy report)` in the panel). Version-1/2 rules likewise remain
unrecorded rather than implying there were none. New replies with missing fields,
a string-valued issues field, or obsolete category fields are invalid and retain
their raw output.

The objective count of a report covers unfinished objectives and those completed since the
previous checkpoint; an empty list means nothing is unfinished and nothing
completed is unreported. Reports are model
self-reports, **not independently verified progress or new authorization**.

By default Pi displays the checkpoint reply as `🐦 Updating cuckoo status ...`, including on
reopen when its saved report is present. **Show Cuckoo JSON** restores the original reply
in the main chat, even when Automatic mode is off. Ordinary replies are unchanged. The
original assistant response stays in the session. Cuckoo stores its
entry ID, full content, exact text, parsed report and validation error separately
as session metadata. Invalid JSON, interrupted replies and attempted tool calls
are retained and surfaced, without correction retries. Checkpoint tool calls
are blocked. Unfinished tool-loop work resumes after the checkpoint; an already
finished answer does not require another normal response. A forbidden checkpoint
tool call receives a bounded normal-task follow-up because Pi itself continues
after tool results.

Abort, new delivered user input, reload and branch navigation cancel an
outstanding capture rather than capturing an unrelated future answer. Closed
inquiries are neutralized in future provider context; original session evidence
is retained. There is no automatic retry after cancellation.

The badge shows the number of active objectives in the current set; for a
branch without one, the objective count of the latest valid report, if there
is one. `!` means the latest attempt/settings failed (a count taken from a
report is then stale); `off` means automatic scheduling is disabled. The report view shows report
history newest first, with raw invalid output and errors. Terminal control bytes
are removed for presentation, not from stored raw output.

## Validation

```bash
nix build .#checks.x86_64-linux.ponygirls-cuckoo --no-link -L
nix build .#checks.x86_64-linux.subagents-policy-shape --no-link -L
```

The extension check typechecks and runs all `tests/*.test.mjs`, including real
Pi loader/model-loop/JSONL tests with a controlled in-process provider. These
establish workflow behavior, not live-model classification or semantic quality.
Recall checks cover bounded enumeration/read, exact text reconstruction, legacy
and invalid rounds, source provenance, branch/fork isolation, compaction/reload,
model-facing guidance/tool declarations, argument validation, and continued
checkpoint tool blocking. Standing-question checks cover the file stores, trust,
prompt composition, answer validation and history after removal; comment checks
cover item selection, the editor, every close path, the allocated panel layout,
branch-scoped single delivery and ordering relative to inquiries. Record checks
cover ID syntax and numbering across branches, capture and reading of numbered
reports (unknown, foreign and repeated IDs, saved numbering that does not fit),
the fold over checkpoints and edits, what an edit may do, the request text with
the record, the update tool through its registered form and in the real model
loop (declaration with Automatic mode, refused calls, reload), the current
action of recall, the transcript rows, and the current set in the panel, the
badge and the plain output. They establish the mechanism, not whether a model
keeps the record current. Navigation
checks cover both focus states, the arrow rule in both layout paths (every line
of a report shown in both directions, also through items taller than the view),
the folding table in a pane sized by its content, what a focus change keeps in
view, and the report title with its scroll position.
`tests/fixtures/tui-provider.ts` is an explicitly loaded, network-free provider
for manual PTY validation; it is not loaded by the extension.
