# Cuckoo standing questions and report comments

Base `f153d1ae`; branch `task/cuckoo-comments-questions`, worktree
`.worktrees/wt-ponygirls-cuckoo-comments-questions`.

## Request

1. The user can add and remove *standing questions*: additional questions the
   model must answer at every checkpoint. Storage must be durable.
2. The user can comment on every rule, answer or objective of a report: open
   the panel, scroll, select a node, press a hotkey, write a comment. When the
   panel closes, all comments are preserved in the checkpoint history and
   communicated to the model.

## Interpretation and assumptions

- "Durable" means files that outlive the session. Two stores, mirroring the
  existing preference files and their trust rule: global
  `<agentDir>/cuckoo-questions.json` and trusted-project
  `<cwd>/<CONFIG_DIR_NAME>/cuckoo-questions.json`. The effective list is global
  then project. No session scope: it was not requested and is not durable
  across sessions. Unprefixed commands write the global store.
- "Answer" means the model's answer to a standing question. Commentable nodes
  are therefore each rule, each objective (with its progress, issues and ETA)
  and each standing-question answer. Invalid reports have no nodes.
- "Communicated to the model" does not force an extra model request. Comments
  reach the model at the next request it makes anyway: at the next completed
  turn boundary while a run is active, otherwise appended to the transcript at
  once and read on the next turn. Rejected alternative: start a turn when the
  panel closes while idle. It spends an unrequested model run on closing a
  viewer; `i` (close and inquire) already gives an explicit immediate path.
- An objective is one commentable node, including its progress, issues and
  ETA. Individual issues are not separate nodes; the comment text can name one.

## Design

### Standing questions (`src/questions.ts`)

Owner of the question schema, both stores, limits and add/remove. Records are
`{id, question}`; ids are short, unique across both stores, and are what the
model echoes. Text is one normalized line. Limits: 32 questions per store,
2000 characters per question.

### Inquiry and report schema

- `inquiryText(questions)` composes the prompt. With no questions it is
  byte-identical to the previous prompt, so unused installations see no change.
- With questions the response gains `answers: [{id, answer}]`, exactly one per
  asked id. The asked snapshot `{id, question, scope}` is carried in the
  pending state and stored with the checkpoint, so history stays readable after
  a question is edited or removed.
- Report version identifies the response schema: 4 without questions, 5 with a
  nonempty question snapshot and required answers. A parsed report carries
  `answers: Answer[] | null`; null means no standing questions were asked,
  matching the existing null convention for unrecorded legacy fields. Records
  written by this version also carry the (possibly empty) `questions` snapshot;
  older version-4 records without it stay readable.

Rejected: always requiring `answers: []`. It changes the prompt and saved
format for every user of the extension to carry no information.

### Comments (`src/comments.ts`)

- A comment is one `cuckoo.comment` custom entry: id, checkpoint `requestId`,
  target `{kind, index}`, a self-contained `subject` quote, text, timestamp.
  The entry is appended synchronously when the panel closes, on every close
  path, so the history write does not depend on model delivery.
- Delivery is derived state, not a queue: a comment on the current branch is
  undelivered until a `cuckoo.comments` custom message on that branch lists
  its id. Delivery points: completed `turn_end` boundaries (as a boundary
  draft, placed before every Cuckoo draft of that boundary, so before an
  inquiry issued there); while idle, an immediate append without `triggerTurn`
  (panel close, before a manual inquiry, `agent_settled`); and, as the
  catch-all for comments no such point took (compaction, exit while busy), the
  `before_agent_start` result message of the next run. That last path places
  the message after the run's starting message, which is why the idle paths
  exist: a manual inquiry must remain the last message of its request.
  Rejected: handing the message to the SDK while busy
  (`pi.sendMessage` or the retained `pi.enqueueMessage`, `triggerTurn: false`),
  which queues it in SDK memory and appends it after the current turn. That is
  less code and survives abort, but the queue is not observable from the
  extension: either a comment is lost for the model when Pi exits before the
  turn ends, or a branch-derived catch-up delivers a second copy of a message
  that is still queued. Keeping one owner (the branch) avoids both. Also
  rejected: appending at `session_start` (a write on merely opening a session).
  Precedent checked: the decisions extension uses `enqueueMessage` with
  `triggerTurn: true` because an answer should wake the agent; a comment should
  not. Cuckoo's own inquiry and resume messages already use boundary drafts.
- The delivered message quotes each subject and comment, names the checkpoint
  and states that these are user comments, not a Cuckoo inquiry.

### Panel

- Detail pane becomes a list of blocks; rule, objective and answer blocks are
  selectable nodes. Tab / Shift-Tab move the node cursor (scrolling it into
  view; from an off-screen cursor Tab picks the first visible node, Shift-Tab
  the last); a left click selects the node under the pointer. `c` opens an
  inline editor in the footer for the selected node: Enter adds the comment
  (shown as `[new]`), Shift+Enter inserts a newline, Escape discards the draft.
  `x` removes the last new comment of the selected node. Text still in the
  editor when the panel closes is saved, not dropped.
- The panel saves in its `dispose()`, which the shared view toggle calls
  synchronously on every close path, so `i` saves before the inquiry is sent
  and session shutdown saves while the session is still bound.
- The commented node is re-anchored when the allocated viewport changes while
  the editor is open (found in the PTY run: after a shrink the node had left
  the viewport, because the scroll position was clamped against the old size).
- Saved comments render under their node in the panel, in plain reports, in
  history and in `cuckoo_recall` documents.
- Existing keys keep their meaning.

## Plan

1. Questions store and commands. Verify: store/command tests.
2. Inquiry/report v5 and presentation of answers. Verify: schema tests, real
   Pi loop test with a scripted provider.
3. Comment model, delivery and panel interaction. Verify: unit, lifecycle and
   view tests, real Pi loop test.
4. README; full `tests/*.test.mjs`, typecheck, Nix check; PTY smoke of the
   panel flow.

## Verification

Source identity: branch `task/cuckoo-comments-questions` on base `f153d1ae`.
Pinned Node 24.22.2, TypeScript 7.0.2, Pi 1.5.2 (the check's inputs).

- Baseline before edits: `node --test tests/*.test.mjs`, 505 pass.
- After: typecheck clean; 558 tests, 558 pass, 0 fail/skipped/cancelled
  (53 new in `questions`, `comments`, `view-comments`, `feedback-lifecycle`
  and `host` test files). Existing tests changed only for the new signatures and
  the explicit `answers: null`.
- Nix: `nix build .#checks.x86_64-linux.ponygirls-cuckoo
  .#checks.x86_64-linux.subagents-policy-shape --no-link` on the final tree:
  typecheck and 558 tests passed, 0 failed/skipped/cancelled, against the
  packaged extension; output
  `/nix/store/lf5rn8qmf715b7cfwarm023f0fqi5s0g-ponygirls-cuckoo-test`. The
  policy-shape output was reused from the store. Log: main checkout
  `.local/cuckoo-comments-questions-nix-final.log`.
- The no-questions inquiry was compared byte for byte with the previous prompt
  literal (identical, 2777 characters) before the tests were written. A test
  now pins its length and SHA-256, computed from the literal at `f153d1ae`;
  the earlier assertion compared the function with itself.
- Tests were written after the implementation, so they were checked by
  mutation instead of fail-first: at first sixteen deliberate defects (no boundary
  delivery, no idle delivery, no delivery at settlement, none at run start,
  delivery on an aborted boundary, questions not asked, pending snapshot
  ignored, version 4 kept with questions, panel close dropping comments,
  comments after the inquiry, delivered ids ignored, no delivery before a
  manual inquiry, untrusted project store read, resize re-anchor removed,
  Escape in the editor closing the panel, missing answer tolerated). Fifteen
  were detected, the manual-inquiry one only after a test was added for it.
  The last is an equivalent mutant: equal length, known ids and no duplicates
  already imply that no answer is missing. Eight more after the review
  corrections (base prompt wording, refresh ignoring the question store,
  shutdown not closing the panel, input fault not contained, quotation keeping
  controls, stale node ranges, status throwing on a question fault, branch
  label dropped) were all detected.
- Real-SDK loop tests (scripted in-process provider) cover each delivery
  point: idle append, turn boundary inside a tool run, settlement after an
  abort, and the first request of the next run for a comment left by an
  earlier process, each asserting a single delivery.
- The resize defect was reproduced first in the layout-engine test
  (`allocated layout: the commented node stays in view…` failed with the node
  outside the viewport), then corrected.
- Real PTY (private `tui-tmux` 3.8, `env -i`, disposable HOME/agent/session
  roots, no MCP/skills/context files/other extensions, controlled in-process
  provider, no network inference), fullscreen and regular modes at 120×40 and
  80×24: add a question; inquiry answered with `answers`; panel shows the
  standing-question section; Tab, Shift-Tab, `c`, Shift-Enter, Enter, `x`,
  Escape (draft only), `q`, `i`; comments saved on close with the delivery
  message visible in the transcript; restart with `--continue` shows the
  question and the saved comments and delivers nothing twice; `i` writes
  comment, delivery, state, inquiry in that order and the reply is a valid
  version-5 report. Pi exited with status 0 each time. Captures and the
  session file: main checkout `.local/cuckoo-comments-questions-pty/`. The
  action log of this first run was overwritten by mistake when the second
  run's log was copied there; only `actions-run2.log` remains.
  A second short run after the review corrections: with the question file
  made unreadable the panel opened with the error line above the saved report;
  `Tab` and `c` sent in one write opened the editor; the comment was saved and
  delivered on close; exit status 0.
- Not exercised in a real terminal: mouse click selection (covered with
  synthetic events through the layout engine), IME, bracketed paste (covered at
  the panel input boundary).

## Review

Read-only reviewer `e0fb06f8-6ee0-4add-97d5-0d5f7e9d3996` (run `28ac12fb`) read
the diff and the pinned SDK. It confirmed the delivery and cadence paths against
the SDK source (no double delivery, no entry between a tool call and its
result) and reported four defects, each reproduced by a failing test before the
correction:

1. Medium. A selection key and `c` in one input chunk, landing on a checkpoint
   without items, threw from the input handler; Pi does not catch that and
   exits. Cause: node line ranges cached from the last frame. Now computed on
   demand; a fault in the input handler is reported instead of thrown.
2. Low. An unreadable question store, or one id in both stores, made
   `/cuckoo`, status and Ctrl+Alt+C fail silently after the first notice. The
   status text and panel now show the fault and the saved reports; the
   duplicate-id error names the id and both files.
3. Low. Model text decoded from JSON escapes reached the visible delivery
   message unsanitized through the quoted subject. Quotations now drop control
   characters, also in the persisted record.
4. Low. A comment made in history on another branch's checkpoint was delivered
   as feedback on "your" report with a recall pointer that the default scope
   cannot follow. The delivery message now labels such checkpoints.

It also named untested wiring: the shutdown handler (now tested, and the panel
is closed first so other disposals cannot prevent the save) and the fault
raised at refresh (now tested). Not covered by a test: "idle" being false
during compaction with the real SDK; the fake host sets the flag directly.

The skill-analysis subagent `0c036058-8c51-47c2-ba4d-38c59ae4beff` found the
self-comparing prompt assertion noted above.

## Interface review

The rule to show UI mockups through Manure and wait for confirmation landed on
main (`abdd30f4`) while this task was in progress, so the interface was built
without one. The as-built screens are published as Manure artifact
`aab0cc269195bceaebd637c677fea77b` (public, expires 2027-01-16) and decision Q90 asks for acceptance or changes.
The published page shows the final wording of the delivery message; the
terminal captures were taken before its first paragraph was revised.

Workflow tests and the scripted provider show mechanism, not that a live model
answers standing questions well or acts on comments.

Observed, unrelated and left unchanged: the checkpoint table's header and rule
rows are not truncated and exceed the panel width below about 38 columns
(`tableLines` in `src/view.ts`, present on the base commit).
