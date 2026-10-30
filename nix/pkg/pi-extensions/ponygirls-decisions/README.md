# Decisions

A persistent, asynchronous question inbox for Pi. Asking records a question and
returns immediately; it does **not** open a modal or suspend the agent. Unanswered
questions are not permission to choose an answer. The agent should continue only
independent work and explain what remains dependent on the decision.

## Use

Home Manager loads this extension with the other ponygirls extensions after the
next configuration activation. To try it without activation:

```bash
pi -e ./nix/pkg/pi-extensions/ponygirls-decisions
```

- `/decisions` or **Ctrl+Shift+D** opens the project's pending inbox.
- `/decisions Q12` opens a particular question, including answered history.
- The **? N** pending-count badge lives on the editor's bottom-left border alongside
  the existing badges. In fullscreen mode it is clickable.
- The inbox supports keyboard navigation, Markdown context and recommendations,
  suggested answers, and a multiline free-form answer editor. Answers are saved
  explicitly, never by merely moving the selection. Escape cancels an edit.
- **↑/↓** selects; **Enter** expands detail; **Page Up/Down** scrolls; **Tab**
  toggles pending/history. **a/e** edits an answer, **o** or **1–9** stages an
  option, **d** stages dismissal, **u** stages reopening. **Ctrl+S** saves.
  A stale edit keeps its draft; **Ctrl+R** explicitly adopts the latest revision.
- History retains answered and dismissed questions. Answers can be revised;
  reopening withdraws the previous answer and makes the question pending again.

Commands also work without custom terminal UI (for example, through RPC):

```text
/decisions answer Q12 Use SQLite; concurrent sessions need atomic ID allocation.
/decisions dismiss Q13
/decisions reopen Q12
```

Dismissing means “no answer”, not approval. The model tool cannot answer,
reopen, dismiss, delete, or rewrite a question.

## Agent tool

```json
{
  "action": "ask",
  "question": "Should the cache expire after 1 hour or remain until invalidated?",
  "context": "Invalidation is reliable locally, but another session may update the source.",
  "options": ["Expire after 1 hour", "Explicit invalidation only"],
  "recommendation": "Use expiry as a bounded backstop; retain explicit invalidation."
}
```

Call `decisions` with `action: "list"` to read pending summaries. `status` may be
`pending`, `answered`, `dismissed`, or `all`; `offset` and `limit` paginate (10 by
default, maximum 50). `action: "get", id: "Q12"` retrieves full context and the
current answer. Repeated calls with the same project/session/tool-call identity
are idempotent. Separate questions receive separate IDs even if their text matches.

An open requesting session receives a visible answer message automatically,
including the exact question and answer. Busy sessions queue it as a follow-up;
idle sessions wake. Cancellation clears wake intent but retains the admitted
answer in context. This uses this repository's retained-message API patch, as
well as its editor-border badge patch. Another open session can answer using the same inbox. Other
sessions' questions do not automatically wake the current agent. Resuming the
requesting session reconciles resolved questions against persisted notification
receipts; a crash before queued delivery is persisted may cause redelivery.
Question state is authoritative; notifications are at-least-once, not an
exactly-once delivery service. Other sessions can always use `list`/`get`.

A compact visible project summary is supplied before a run to make unresolved
questions and recent resolutions discoverable. It is not a substitute for reading
the full, current answer before acting. Notification snapshots are revalidated
against storage for every model request, including low-level follow-ups: a queued
answer withdrawn elsewhere is replaced with the current pending state. The
transcript preserves the original event. If verification fails, the request sees
an explicit unavailable state instead of the historical answer. This is a
request-time snapshot, not revocation of an already-running action. Answers never
expand the authorization of the original question.

## Persistence and isolation

Storage is `<agent-dir>/decisions/questions.sqlite`, normally
`~/.pi/agent/decisions/questions.sqlite`; `PI_CODING_AGENT_DIR` selects another Pi
home. Node 24's built-in SQLite is used, with no npm runtime dependency.

The canonical Git common directory defines a project: checkout subdirectories,
symlinks, and linked worktrees share one sequence, Q1, Q2, …. Outside Git, the
canonical working directory is the project. Different repositories are isolated.
Moving a repository to a different canonical path creates a different identity.
IDs are never reused after dismissal or reopening. Questions are external to
session branches: forks and `/new` do not roll back project decisions.

Concurrent writes allocate IDs atomically. Answer changes compare the question
revision, so a stale editor cannot silently overwrite someone else's answer.
Storage failures are visible; there is no in-memory fallback, reset, or automatic
data deletion. Polling starts with the session, stops at shutdown/reload, and
refreshes other sessions' changes approximately once a second. A failure retains
the last badge instead of claiming the inbox is empty.

The database and its immediate directory are private to the Unix user. Questions,
context, and answers remain plaintext local data and appear in relevant session
transcripts. Do not put credentials in questions. Back up the database with
SQLite's backup facility, or close Pi sessions before copying it (including any
SQLite journal/WAL sidecars).

## Validation

```bash
nix build .#checks.x86_64-linux.ponygirls-decisions
```

The check typechecks against the pinned Pi API and runs storage contracts,
concurrency/project-identity tests, component interaction tests, extension
wiring checks, and real Pi SDK tests with a scripted, network-free provider.
The scripted provider verifies tool/message lifecycle, not model judgement.
Terminal journeys must additionally be exercised through a real PTY; component
and SDK tests alone are not evidence of rendered interactive behavior.
