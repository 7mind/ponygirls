# Cuckoo: implemented design and next proposals

**Source snapshot:** 12 November 2026, repository `main` at `eeb83a38`; the latest extension change is `f459dd61`. This note describes the inspected source, not the state of an installed Pi process. The recent work was merged locally; it did not deploy the extension. Whether a running session has loaded that revision is a separate check.

## 1. The short version

Cuckoo is currently **a checkpoint protocol plus an on-demand archive of model self-reports**.

It periodically asks the **main conversation model** to restate its current objectives, progress, issues, ETA and session-local rules. It stores the answer in the Pi session, displays it to the human, and lets the model enumerate/read saved rounds through `cuckoo_recall`.

It is **not** an independent critic, an automatically maintained world model, a verifier, a task planner, or a cross-session learning system. A well-formed reflection can still be wrong.

| Capability | Status |
|---|---|
| Context-growth checkpoint scheduling and manual inquiry | Implemented |
| Model-facing explanation of Cuckoo and its protocol | Implemented |
| One `issues` list per objective | Implemented |
| Session-local, branch-aware `cuckoo_recall` list/read tool | Implemented |
| Preservation of invalid/interrupted and legacy rounds | Implemented |
| Delta/correction-focused inquiry wording | Pilot-only; not promoted |
| Selective keyword-search tool, `cuckoo_search` | Pilot-only; not promoted |
| Task IDs, evidence/work-product links, semantic supersession, verifier-backed memory | Proposals below |
| Global/cross-session semantic memory or automatic learning | Not implemented |

The distinction matters: **history access is implemented; reliable learning from history has not been demonstrated.**

## 2. Architecture and ownership

```text
User's ordinary task
        |
        v
Completed model-turn boundary <------ /cuckoo inquire now
        |                              (idle: immediate;
        |                               busy: one queued request)
        v
Cadence + safe-boundary checks
        |
        v
One correlated inquiry to the MAIN model
        |  JSON only; no tool execution
        v
Versioned structural validation
        |
        +--> Save valid OR invalid attempt in the Pi session
        |        - exact reflection text
        |        - parsed report or error
        |        - request/response identity
        |
        +--> Resume interrupted work when required, otherwise finish

Saved session metadata
        +--> Human panel/history/badge
        +--> cuckoo_recall list/read during ordinary work
```

Responsibilities are deliberately separated:

| Module | Responsibility |
|---|---|
| `index.ts` | Integrates with Pi events, commands, tools and lifecycle; correlates inquiry/capture/resumption |
| `src/state.ts` | Branch-local cadence/capture state; inquiry and resume text |
| `src/policy.ts` | Growth policy validation and threshold calculation |
| `src/preferences.ts` | Global preferences plus session-specific overrides |
| `src/report.ts` | Current/legacy report decoding, structural bounds and normalized report representation |
| `src/recall.ts` | Read-only history projection, paging, branch attribution and model guidance |
| `src/view.ts`, `src/presentation.ts` | Human-facing panel, badge, navigation and safe terminal rendering |

All paths above are under `nix/pkg/pi-extensions/ponygirls-cuckoo/`. There is no separate memory database or secondary reflection agent.

## 3. When a checkpoint happens

### Automatic cadence

Automatic inquiries are **OFF by default**. The default policy, when enabled, is growth equal to **15% of the model's context-window capacity**.

Cuckoo observes Pi's context-token usage at completed model-turn boundaries, including cached tokens. Let `B` be the baseline usage and `T` the current observation. An inquiry is due when `T - B` reaches the configured increment:

| Policy | Increment | Example: baseline 20k, window 200k |
|---|---|---|
| `relative 15` | 15% of the baseline | Next inquiry at 23k |
| `window 15` | 15% of window capacity | Next inquiry at 50k |
| `tokens 10000` | 10,000 additional tokens | Next inquiry at 30k |

The first eligible observation establishes the baseline. Issuing an inquiry resets it to the observed usage; manual inquiries reset it too. Percentage increments round upward. A context decrease or a model/capacity change establishes a fresh baseline.

This is **not a timer**: there is no idle wakeup, periodic wall-clock job, or background inference while the agent is idle.

Scheduling defers when usage is unknown, when the window-based policy lacks known capacity, or when the boundary has competing work such as queued user input, compaction/context edits or another extension's model-facing draft. Inquiry and resume responses do not immediately schedule another checkpoint at that same boundary.

### Manual inquiry

`/cuckoo inquire now` works even with automatic mode OFF. In a fresh session, send a task first: a manual inquiry requires known context usage.

When idle, it requests a main-model response immediately. When busy, it queues one request for a safe completed-turn boundary; repeated requests coalesce. A queued request is not a durable promise to run later: abort, new user input, navigation or reload can cancel it. Failure to reach a safe boundary is surfaced rather than retried silently.

## 4. What the model is told—and what it returns

At each run start, Cuckoo adds a structured system-prompt section describing:

- the current automatic ON/OFF state and policy;
- the context-growth cadence;
- the JSON-only checkpoint and resumption protocol;
- the existence and scope of `cuckoo_recall`;
- the fact that saved reflections are historical self-reports, not current instructions or authorization.

If settings cannot be read/validated, the guidance reports the configuration as unavailable instead of pretending a default state is valid. Adding this guidance does not itself request inference.

### Current answer format

New checkpoints use **report metadata version 4**. The model's answer itself has these two top-level fields; it does not supply the metadata version:

```json
{
  "objectives": [
    {
      "objective": "Finish the current validation task",
      "progress": "Implementation inspected; regression checks remain",
      "issues": [
        "One validation case still fails",
        "Access approval is needed for the remaining external check",
        "Serial execution limits validation throughput"
      ],
      "eta": "Unknown: the external check cannot run yet"
    }
  ],
  "rules": [
    {
      "rule": "Show the proposed layout before implementation",
      "source": "user",
      "scope": "This UI change"
    }
  ]
}
```

The three conceptual categories are deliberately retained in the prompt, but **not in separate output fields**:

- issues: defects and risks;
- obstacles: dependencies and impediments;
- bottlenecks: constraints on progress or throughput.

They all go into one `issues: string[]` per objective. Overlapping concerns should be combined. `[]` means none are known—not that their absence was independently proved. Separate `obstacles` and `bottlenecks` fields are invalid in a new reply.

The prompt asks for concise, human-friendly language; evidence-qualified progress; and an ETA with a basis and uncertainty, or `Unknown` with a reason. These are instructions to the model, **not guarantees enforced by the decoder**.

### Rules are reported, not established

`rules` contains the model's restatement of active session-local user instructions and assistant-adopted conventions, each with attribution and scope. The prompt excludes inherited system/developer instructions, `AGENTS.md`, installed-skill rules, superseded instructions and inferred preferences.

The decoder checks the shape and the `user|assistant` enum. It does **not** independently prove attribution, applicability, completeness, or whether an instruction was superseded. A model-written `source: "user"` is not new user approval.

### Structural limits

- At most 100 objectives, 100 issues per objective and 100 rules.
- Nonempty strings where required, at most 8,000 JavaScript string units per string.
- At most 100,000 JavaScript string units for the response.
- `objectives: []` reports zero current objectives; `rules: []` reports no session-local rules.

**Schema-valid is not factually verified.** The experiment found valid reflections containing contradictory reasoning.

## 5. Lifecycle: why this should not hijack the task

A pending inquiry has a request ID and records whether ordinary work needs resumption. The next correlated assistant response is captured at the turn boundary.

During the checkpoint, **all tool calls are blocked**, including `cuckoo_recall`. The model must answer from its currently supplied context. It cannot decide to read old rounds or run tests inside that JSON-only turn.

After capture:

- a valid answer is saved as a parsed report plus raw evidence;
- malformed JSON, interrupted/failed replies and attempted tool use are saved as invalid attempts with errors;
- there is no automatic correction/retry loop;
- interrupted work receives an explicit resume cue under the original task's constraints;
- an already-finished ordinary answer does not require a new normal response;
- attempted checkpoint tool use receives bounded resumption handling because Pi continues after tool results.

Abort, delivered user input, reload/session replacement and branch navigation cancel outstanding capture rather than letting an unrelated future response become its answer.

Old inquiry messages remain in the session evidence, but closed/cancelled inquiries are replaced with a neutral “this checkpoint is closed” notice in future provider context. This prevents an old control prompt from remaining an active request. **It is control-message deactivation, not semantic correction of old beliefs.**

## 6. Storage, branches and compatibility

Pi's session log is the owner of persistence:

| Stored item | Meaning |
|---|---|
| `cuckoo.state` | Baseline/observed usage, model identity, pending capture and resumption state on the branch |
| `cuckoo.inquiry`, `cuckoo.resume` | Explicit model-facing control messages |
| `cuckoo.report` | Versioned raw/parsed answer, error and source-response association |
| Enablement/policy entries | Session overrides, qualified by session ID |

Global defaults live separately in `<agentDir>/cuckoo.json`. Enablement and policy inherit independently. Session overrides span branches of that session but do not automatically configure a different fork/session ID.

Reports follow the current branch. Explicit session-wide history includes alternative branches and labels them. Reopening the same session restores its records. A fork contains only what Pi copies into it; the recall tool does not open arbitrary parent/other session files.

Compaction reduces model context, but the persisted report metadata remains available. Thus:

> **Persistence survives compaction; model awareness of every old report does not.**

There is no automatic replay of all saved rounds after compaction. During ordinary work the model must choose to retrieve relevant history, or work from current sources instead.

### Old formats

- Version 1 has no recorded issues/ETA or rules; these remain unknown/unrecorded, not invented empty values.
- Versions 2 and 3 preserve their old obstacles/issues/bottlenecks statements as labeled legacy items in the normalized issues list—even literal “None known” statements.
- Versions 1 and 2 have unrecorded rules; version 3 already records rules.
- Original raw answers are not rewritten on read.

The original assistant message/full content can remain in the transcript and stored metadata. **The recall projection does not expose thinking blocks**: it returns reflection text, parsed fields, errors and response metadata, not arbitrary assistant-message content or a private thought trace.

## 7. The model-facing recall API

`cuckoo_recall` is read-only and performs no model inference or history mutation. It remains available with automatic inquiries OFF, subject to ordinary Pi tool-selection restrictions.

```json
{"action":"list"}
{"action":"list","scope":"session","limit":10}
{"action":"list","before":"<nextBefore>"}
{"action":"read","entryId":"<report entry ID>"}
{"action":"read","entryId":"<report entry ID>","offset":6000,"limit":6000}
```

**Scope:** `branch` by default; explicit `session` includes all branches of the current session. Keep the same scope when following pages. Other-branch records describe alternative histories, not facts automatically applicable to the active branch.

**List:** newest first, default 10/max 20 rounds. Metadata includes entry/request IDs, timestamp, branch label, saved format version, valid/invalid status, objective/rule counts and the checkpoint response entry ID when recorded. `nextBefore` is an exclusive entry-ID cursor, so newly appended rounds do not shift the already enumerated older pages. Missing/out-of-scope cursors fail explicitly.

**Read:** returns a `text` page from a serialized JSON document containing the normalized report, exact raw answer, error and response provenance. Concatenate pages using `nextOffset` until it is `null`, then parse the document. Default 6,000/max 8,000 UTF-16 units; the outer response is capped at 50,000 UTF-8 bytes. Oversized metadata is an error, not silent truncation.

The response's source-message ID points to the **checkpoint answer**. It is not a link to every fact, tool result, test or work product behind that answer.

Every result warns that the content may be stale, invalid or from another branch. The model is instructed to check current evidence/instructions and not promote old self-reports or assistant conventions into authority.

## 8. Human controls

The main commands are:

- `/cuckoo` or `/cuckoo status`: current-branch reports and settings;
- `/cuckoo history`: all saved rounds in this session;
- `/cuckoo inquire now`: one manual checkpoint;
- `/cuckoo on|off|inherit`: session enablement;
- `/cuckoo policy relative 15|window 15|tokens 10000`: cadence;
- `/cuckoo default ...`: corresponding global defaults.

The panel has a selectable checkpoint table and independently scrollable details. `i` requests an inquiry; `q`/Escape closes it. Ctrl+Alt+C and the bird badge toggle the view. The badge distinguishes a reported objective count, no validated report (`?`), a failed latest attempt/settings (`!`, with any prior count stale), and automatic mode OFF.

Invalid output stays inspectable. Terminal control characters are sanitized for display, not removed from the stored raw evidence. Merely opening reports/history makes no model request.

## 9. What the pilots established

The current design was compared with two experimental additions: delta/correction-focused inquiry text and a literal-word selective recall tool. Both remain in `scripts/cuckoo-memory-pilot/`, **not the extension**.

There were 96 held-out continuations: four tasks, two repetitions, three model families, four conditions. Each table cell is 8 artifacts:

| Model | Current + ordinary recall | Current + search available | Delta + ordinary recall | Delta + search available |
|---|---:|---:|---:|---:|
| GPT-6.1 Sol | 8/8 | 8/8 | 8/8 | 8/8 |
| DeepSeek V4 Pro 0813 | 8/8 | 8/8 | 6/8 | 8/8 |
| Qwen3 30B A3B Instruct 2507 | 3/8 | 3/8 | 4/8 | 4/8 |

These are strict work-product successes, not self-ratings. The two DeepSeek failures were formatting-only. Search was invoked in only 5 of 48 search-enabled continuations. GPT-6.1 Sol never used reflection history. Retrieval siblings shared the same prefix, so observations are not all independent; Qwen's apparent gain came from one meeting repetition repeated across siblings.

The pilot used **four manual checkpoints and controlled context reduction**, not normal automatic cadence. All arms could still read the original/amended source records. It is not a memory-OFF comparison or evidence about general coding/deployment performance.

Two findings guide the proposals:

1. **A reflection can repeat correct facts without validating the decision.** One public sensor reflection correctly stated a 0°C reading and a 28°C threshold, yet claimed that reading qualified. Some errors already existed before context reduction.
2. **A progress summary is not a saved work product.** Correct earlier drafts lost details needed later; reduced-context runs omitted relevant original records or returned the answer to an unrelated audit. This motivates better evidence/task anchoring, not more confidence in prose.

The measured changes showed no reliable correctness improvement sufficient to promote either variant. Sparse search use does not prove search itself is ineffective.

## 10. Further proposals — not implemented

### Priority 1: evidence- and artifact-linked task memory

Keep human-readable `cuckoo.report` history, but give reusable task memory a separate responsibility rather than treating a status paragraph as the current world state.

A minimal candidate would link a task/thread identity to:

- the latest relevant work-product snapshot or entry ID and digest;
- source message/tool-result references supporting important facts;
- critical unchanged premises that a later correction depends on;
- branch/task scope and observation/version information;
- whether a statement is an observation, model interpretation, decision or unresolved assumption.

For example, “the exporter was added to the plan” is not enough to recover its rollback version. A link to the original inventory or the earlier draft preserves the missing basis.

References should cover authorized, user-visible evidence—not private thinking or an indiscriminate copy of the whole session. A pointer proves where something was recorded, not that the content is true or still current. Fetching/evaluating it must retain privacy and scope boundaries.

**Success check:** after context reduction, the model retrieves the relevant artifact/source and preserves an unchanged fact without fabricating it; changed dependencies invalidate stale snapshots. Include bad earlier artifacts so the system is not rewarded for blindly copying them.

### Priority 2: explicit corrections and downstream invalidation

A useful correction record should identify the old claim/decision, the new evidence, what it supersedes, and which derived decisions require recomputation.

Example: changing a sensor from 32°C to 32°F changes more than a label. It changes its converted value, threshold eligibility, alert membership and potentially the mean. Merely writing “unit correction applied” does not establish those downstream changes happened.

Keep immutable history, but make superseded/current/unresolved relationships explicit. Do not infer that a newer report is necessarily better, or let a reflected rule override the current user.

**Success check:** a corrected premise causes every affected decision to be reconsidered, while unaffected requirements remain intact; there are no false corrections when the original result was already right.

### Priority 3: verifier-backed reflection

Where checks exist, attach their **actual results** to the relevant artifact before asking the model to reflect. Examples include stock-capacity, eligibility, scope and schema checks, or an authorized test run in a coding task.

A check record needs the input/artifact identity, check identity/scope, observed outcome and provenance. “I checked it” in model prose is not such a record. Passing one check is not universal verification.

This should happen through explicit ordinary-work/control boundaries—not by quietly lifting the JSON-only inquiry's tool block or automatically running arbitrary commands. No checkpoint grants new authority.

**Success check:** the model corrects a demonstrated invariant failure and retains the evidence-qualified correction later. Compare feedback-only against feedback-plus-memory so verifier benefit is not mislabeled as reflection benefit.

### Later: task-scoped retrieval and read ergonomics

Candidate changes include task/topic metadata in enumeration, filters for relevant scope and supersession, and a concise structured default read with exact raw text available separately.

These may reduce navigation and duplicated/raw JSON paging, but the pilot did **not** establish pagination as a cause of failure: inspected traces included both pages of a relevant round, and a missing fact was absent from the report itself.

Test these as usability/retrieval changes. Do not equate making a tool available with models actually using it or understanding its results. If cases require prior decisions unavailable from current sources, state that distinction rather than artificially depriving only the control arm of evidence.

### Defer global memory and autonomous reflection agents

Cross-session transfer, a semantic/vector index, or a second autonomous reflection agent would add privacy, authority, freshness and lifecycle responsibilities. None is justified simply by having a growing archive. Start with session-local evidence and task identity; establish measurable benefit before broadening scope.

## 11. Recommended next step

Prototype **task-scoped artifact/evidence links plus explicit invalidation**, then compare:

1. current Cuckoo;
2. evidence/artifact-linked memory;
3. the same evidence and check results with verifier-backed correction memory.

Give every arm the same underlying source and verifier access, state exactly which representation/retrieval capability differs, keep prior-good and prior-bad artifacts, use fresh held-out cases, preserve all failures, and score the final work product. Separate record coverage, retrieval, reasoning, formatting and verification failures.

That is a proposal for another controlled pilot, **not a claim those features are implemented or proven**. The current extension should remain unchanged until an improvement clears that test.

## 12. Evidence and references

This note was checked against `index.ts` and `src/{state,policy,preferences,report,recall}.ts`, plus the extension README. The source snapshot and module paths make implementation claims inspectable.

The extension's recorded validation includes the full 99-case application check and real terminal interaction. The pilot instrument/old-harness regression run passed 67 tests. Such tests establish workflow behavior; the separate live pilot supplies the limited behavioral observations above. None establishes deployment.

Detailed pilot methods, raw-observation limitations, per-artifact accounting and resource comparisons are recorded in:

- `docs/drafts/20261112-1945-cuckoo-reflection-pilot-results.md`;
- its companion `.json`;
- `scripts/cuckoo-memory-pilot/README.md`.

The central boundary is unchanged: **remembering what the model said is not the same as knowing what is true, current, authorized or checked.**
