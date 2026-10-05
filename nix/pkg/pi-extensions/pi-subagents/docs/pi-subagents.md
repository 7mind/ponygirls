# pi-subagents — supported versions, recovery, limitations

## Supported versions and platforms

- pi **1.0.0** (`@earendil-works/*` namespace). The worker imports the
  **built** package tree (`dist/index.js`, `pi-ai/dist/compat.js`,
  `pi-agent-core/dist/index.js`, `pi-tui`, `typebox`) via
  `PI_SUBAGENTS_SDK_ROOT`, set automatically from the vendored package.
  Other pi versions are untested and unsupported: the worker handshake
  advertises the exact pi version and rejects mismatches at the protocol
  level only for the extension protocol itself — SDK drift is a hard
  failure, surfaced as worker startup errors, never silent behavior change.
- Node **24.x** (type-stripped `.ts` worker fork; `node --test` suites).
- OS: **Linux x86_64 with bubblewrap** (`bwrap`) and user-namespace
  support. The sandbox backend probes namespace support before accepting
  a task and rejects with `SANDBOX_UNAVAILABLE` when unsupported; there is
  no macOS/Windows backend and restricted execution is never silently
  replaced with host execution.
- Git required for writer worktrees.

## Root lifetime and storage

One supervisor per governing pi session. Durable state lives in
`~/.pi/agent/subagents/<sessionId>/` (journal, manifest, checkpoints,
worktrees, worker scratch) — outside all child tool views. The root lock
(`root.lock/`) is OS-owned; a second pi process cannot adopt a live root.
Switching sessions or shutting down pi cancels and joins the live subtree,
closes owned tool jobs, and preserves durable state. Ephemeral
(`--no-session`) governing sessions still delegate, but recovery has no
native session to restore — durable supervision needs a saved session.
With `--no-session`, pi core also skips `turn_end` boundary handlers, so
governing-run notice drains are inactive there (a pi-core diagnostic, not
an extension defect).

## Recovery diagnostics

- `/agents` (headless: notified counts) after restart shows recoverable
  roots; recovery assigns a new epoch and fences old instances. A fresh
  supervisor process replays the journal (identities, tree, authority,
  mailbox text, queues, outcomes, usage, gate rounds/candidates/decisions)
  and reconciles unfinished runs: old joins settle on old task IDs,
  replacements always take new IDs.
- `RECOVERY_OWNER_UNCONFIRMED`: replacement execution is quarantined where
  owned-job termination cannot be verified. Live worker PIDs are signalled
  only after boot-identity verification (never guessed PIDs). Inspect the
  preserved crashed native file and journal, reconcile effects manually,
  then resume explicitly — the extension never auto-replays uncertain effects.
- `RECOVERY_CORRUPT`: committed journal/checkpoint corruption. The store
  refuses to start rather than invent state. Restore from backup.
- Lost main/repair generations settle `interrupted` (cleanup confirmed)
  or `uncertain` (outstanding effects preserved, workspace quarantined).
  Accepted-but-undispatched tasks keep their IDs for explicit resume
  (`dispatchPending` path); replacements always get new task-run IDs.
- Gate recovery: running reviews become `interrupted` (resumable with
  fresh context, counters kept). A committed decision is never reapplied;
  a reviewer that died without one is retried explicitly, never inferred.

## Genuine limitations

- **Tool sandboxing, not worker sandboxing.** Generated commands run in a
  restricted bubblewrap view; the trusted SDK worker and control plane run
  on the host and must be trusted. Do not load arbitrary child extensions.
- **Reviewer judgment is not correctness.** `passed` records a model
  verdict about frozen evidence, never proof. External writers during
  review are detected by fingerprint comparison (invalidating the review),
  not prevented transactionally — tasks needing stronger isolation must
  say so; no snapshot backend exists in v1.
- **Cross-process credential-refresh serialization is best-effort.**
  Workers share the host `auth.json` live; concurrent OAuth refresh from
  two processes may double-refresh. `auth.json` is never copied.
- **Inner shell commands need absolute paths** (or a sandbox `PATH`
  carrying the runtime closure). The broker resolves the outer argv; the
  sandbox environment is allowlisted, not inherited.
- **Costs are admission stops, not prepaid cutoffs.** In-flight requests
  and late provider accounting can overshoot; unknown usage is displayed,
  never treated as zero.
- **No daemon, workflows, auto-merge, sibling mesh, session takeover.**
  Deferred per the plan. Questions/approvals have deadlines; unanswered
  questions do not wait forever.
- **Deterministic tests prove contracts, not live providers.** Live
  delegation/resume/nesting/interruption and gated revise→repair→approve
  against real providers are opt-in manual checks; record which
  provider/OS combinations were exercised.
