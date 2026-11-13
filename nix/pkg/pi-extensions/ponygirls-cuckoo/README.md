# Cuckoo

Opt-in objective/progress and session-local rule checkpoints from the **main conversation model**. Uses
`@ponygirls/pi-settings` and `@ponygirls/pi-ui`, like the other extensions.

## Controls

- `/cuckoo` or `/cuckoo status`: view current-branch reports and effective settings.
- `/cuckoo settings`: staged checkbox dialog for the master switch and all seven
  feature preferences. Tab or Left/Right changes Session/Project/Global scope;
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
- **Ctrl+Alt+C**: toggle the report view without submitting or losing the editor draft.
- Click the **🐦 N** border badge to toggle reports (fullscreen, or regular
  mode with Pi's `regularMouse` enabled). Escape or `q` closes the view.
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

## Model awareness and reflection recall

At each run start, a structured system-prompt section explains Cuckoo's
context-growth cadence, the current automatic enablement/policy, and the
JSON-only inquiry/resumption protocol. It does not start an inquiry. Invalid
settings are reported as unavailable rather than as an enabled/disabled default.

The model can use the read-only **`cuckoo_recall`** tool during ordinary work:

```json
{"action":"list"}
{"action":"list","scope":"session","limit":10}
{"action":"list","before":"<nextBefore from previous page>"}
{"action":"read","entryId":"<round entryId>"}
{"action":"read","entryId":"<round entryId>","offset":6000,"limit":6000}
```

- Default scope is `branch` (the current branch); explicit `session` scope
  includes every branch in the current session. Use the same scope for later
  list/read pages. No other session files or global memory are searched.
- List returns newest-first metadata: stable report-entry ID, request ID,
  timestamp, current/other branch, schema version, valid/invalid status,
  objective/rule counts and source-response entry ID when recorded. `valid`
  means schema-valid, **not independently verified**. `nextBefore` is an
  exclusive entry-ID cursor: new rounds do not shift already enumerated pages.
  The default page is 10 rounds, maximum 20. A missing/out-of-scope cursor is
  an error; restart listing after changing branches.
- Read returns `text`, a page of a JSON document containing the version-aware
  parsed report, exact raw answer, validation/interruption error, and source
  response metadata (provider/model when available). Concatenate `text` pages
  using `nextOffset` until it is `null`, then parse the combined JSON. Offsets
  count UTF-16 code units; default page size is 6000, maximum 8000. Responses
  are capped at 50000 UTF-8 bytes; oversized metadata is an explicit error,
  not silent truncation. Thinking blocks and unrelated stored content are not
  exposed by this tool.
- Invalid/interrupted rounds remain readable. Legacy missing fields are
  `null` (not recorded), not invented values or evidence that no rules applied.
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

The terminal panel shows a selectable checkpoint table with detail beneath.
Newest checkpoint is selected by default. Navigation and detail scrolling use
separate key bindings so both the list and the selected content remain accessible.

**Table viewport:** Shows up to 3 checkpoints newest-first (bounded dynamically
by allocated panel height) with columns: index, request ID, objective count, and
status (saved or invalid). Column widths adapt to the terminal; the request-ID
column yields first in narrow layouts. Odd rows have a subtle panel-background
stripe; the selected row has an accent marker and selected-background band.

**Detail pane:** Below the table, runtime errors appear first (prominently at
top), then the detail header, then the selected checkpoint body. The detail
header wraps at narrow widths so all metadata (timestamp, branch, entry ID,
qualifier) remains accessible via scrolling. The body renders inline: rules
section, then numbered objectives with compact labeled fields (progress,
a single issues list, ETA). Invalid reports show the raw output and
error rather than parsed fields. After the detail, effective settings and
configuration scroll into view. The entire body (errors + detail + settings)
scrolls independently of the table via ctrl-u/ctrl-d (half-page) and Home/End
(top/bottom). All body lines are wrapped to the panel width so no content is
clipped.

**Footer:** Key hints are fixed at the bottom, always visible. The `i` key
closes the panel and requests an immediate inquiry.

**History view** (`/cuckoo history`) adds timestamp, branch attribution, and
entry IDs in the detail header metadata (wrapped, not as separate table columns).

**Keyboard:**

| Keys | Action |
|---|---|
| `↑` `↓` `j` `k` | Move selection in table |
| `ctrl-u` `ctrl-d` | Scroll detail half-page up/down |
| `Home` `End` | Scroll detail to top/bottom |
| `i` | Close and request inquiry now |
| `esc` `q` | Close panel |
| Mouse wheel | Scroll detail |

In regular mode the table and detail fit within the allocated height. Pi
fullscreen reserves PgUp/PgDn for transcript scrolling, so detail scrolling
uses ctrl-u/ctrl-d. RPC/plain-text output remains the complete unstyled flat
report with all checkpoints, history attribution, and rule source/scope data.
Theme changes regenerate colors. The border badge remains available while the
panel is open.

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
{"objectives":[{"objective":"Current objective","progress":"Brief factual progress","issues":["A decoder defect needs correction","Waiting for access approval","Serial runtime validation limits progress"],"eta":"Unknown: validation has not started"}],"rules":[{"rule":"Show mockups before implementation","source":"user","scope":"This UI change"}]}
```

The prompt asks for brief, concise, human-friendly plain language in every field,
preferably one short sentence or phrase. It discourages jargon, repetition, filler
and unnecessary implementation details without sacrificing accuracy, material
blockers, rule scope/attribution or uncertainty. This is a prose instruction,
not an additional length limit or a guarantee of model behavior.

Each objective has exactly `objective`, `progress`, `issues`, and `eta`.
The first, second and fourth are nonempty strings. `issues` is one list of
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
preferences. Each rule has required `rule` and `scope` nonempty strings (at most
8000 characters each), and `source` exactly `user` or `assistant`. At most 100
rules are allowed, within the existing total response limit. Rules remain separate
from objectives and may apply even when no objectives remain. An empty array
means no session-local rules were reported. Assistant conventions are not user
approval or authorization. This is a recall prompt, not a policy enforcement or
independent provenance-verification mechanism.

New checkpoints use metadata version 4. Version-1 through version-3 saved reports
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

Only current objectives count; an empty list means zero. Reports are model
self-reports, **not independently verified progress or new authorization**.

The original assistant response remains in the transcript. Cuckoo stores its
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

The badge shows the latest validated objective count. `?` means no validated
report; `!` means the latest attempt/settings failed (the prior count is stale);
`off` means automatic scheduling is disabled. The report view shows report
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
checkpoint tool blocking.
`tests/fixtures/tui-provider.ts` is an explicitly loaded, network-free provider
for manual PTY validation; it is not loaded by the extension.
