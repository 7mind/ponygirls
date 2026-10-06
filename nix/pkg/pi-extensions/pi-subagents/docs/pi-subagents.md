# pi-subagents — supported versions, recovery, limitations

## Supported versions and platforms

- pi **1.0.0** (`@earendil-works/*` namespace). The worker imports the
  **built** package tree (`dist/index.js`, `pi-ai/dist/compat.js`,
  `typebox`) from `PI_SUBAGENTS_SDK_ROOT`, which the home-manager pi wrapper
  sets to the exact pi derivation it runs. Unset, spawning fails with an
  explicit error. Other pi versions are untested and unsupported; SDK drift
  surfaces as worker startup errors, never as silent behavior change.
- Node **24.x** (type-stripped `.ts` worker fork; `node --test` suites).
- OS: **Linux x86_64**. `sandbox` isolation additionally needs bubblewrap
  (`bwrap`) with user-namespace support: the backend probes it before
  running a job and rejects with `SANDBOX_UNAVAILABLE` when unsupported;
  there is no macOS/Windows sandbox backend and a sandboxed job is never
  silently replaced with host execution. Distributions that restrict
  unprivileged user namespaces (Ubuntu 24.04's AppArmor default) fail the
  probe, so every tool of a sandboxed child returns `SANDBOX_UNAVAILABLE`
  until bwrap is allowed.

## Isolation

Chosen per child with `spawn_agent`'s `isolation`; a child is never less
isolated than its owner (`none` < `worktree` < `sandbox`). Omitted, it is
`worktree`, or the owner's isolation where that is stricter.

- **`worktree` (default):** tool jobs run on the host as the user, with the
  governing pi process's environment and network. A writer gets its own
  worktree of the owner's checkout at the same project-relative directory,
  from a committed base (`base_commit` is required when the checkout is
  dirty, and the worktree does not contain the uncommitted changes); its
  changes stay there (`workdir` in the spawn result and agent status) and
  are never merged back. Readers read the owner's directory in place. No
  policy file is needed; writers need a git checkout with a commit.
- **`none`:** host execution in the owner's working directory. Writers edit
  it in place; nothing locks two such writers against each other. A gated
  writer needs a git checkout: its candidate is the live checkout's changes
  relative to `HEAD`, the user's own uncommitted edits included, and any
  edit during review supersedes it.
- **`sandbox`:** the bubblewrap view below over a registered repository
  (`repo_id`); a writer gets its own worktree.

Under host isolation the `reader` profile is a tool list, not a boundary,
and gate checks can modify sources. Host jobs run as their own process
group, which is killed when the job ends, times out, or is cancelled; a pi
process that crashes cannot kill them (there is no `--die-with-parent`
equivalent), so recovery treats their effects as uncertain.

## Tool sandbox view

Every sandboxed tool job runs in a fresh bubblewrap view built on an empty
root (an allowlist, never `--ro-bind / /`): read-only system runtime
(`/nix/store`, `/usr`, `/bin`, `/lib*` when present), `/etc/passwd`,
`/etc/group`, and `/etc/alternatives`, the host `PATH` directories (except those under `$HOME` and
setuid wrapper directories), the agent's approved read roots and the
directories of the skills it was given, its own worktree (writers,
read-write), and private scratch as `HOME`/`TMPDIR`.
New PID/IPC/UTS/network/cgroup namespaces, a new session, no inherited
environment, death with the parent. The root store and the host agent
directory (credentials) are hidden even where a read root contains them.
Host git never follows a worktree's `.git` file: it targets the git dir
recorded at creation, with hooks, fsmonitor, and external diff/textconv
disabled, and candidate fingerprints are computed without a shell.
- Git required for writer worktrees.

## Root lifetime and storage

One supervisor per governing pi session. Durable state lives in
`~/.pi/agent/subagents/<sessionId>/` (journal, manifest, checkpoints,
worktrees, worker scratch) — outside all child tool views. The root lock
(`root.lock/`) records its owner's pid, boot id, and process start time; a
live owner keeps it, and a crashed owner's lock is retired atomically by
exactly one successor. Switching sessions or shutting down pi cancels owned
tool jobs and stops workers; runs left active are reconciled when the
session is attached again (below). Ephemeral (`--no-session`) governing
sessions still delegate, but recovery has no native session to restore.
With `--no-session`, pi core also skips `turn_end` boundary handlers, so
governing-run notice drains are inactive there.

Child notices (terminal outcomes, messages and questions addressed to the
governing session) are delivered once per journal position: appended at
the turn boundary while the root runs, queued for the next user turn while
it is idle (no idle-root inference). The footer status shows the tree
counts.

## Recovery diagnostics

- Attaching a session whose journal holds unfinished runs runs recovery
  before any new command: a new epoch fences old instances, the journal is
  replayed (identities, tree, authority, mailbox text and questions,
  queues, outcomes, usage, gate rounds/candidates/decisions/limits), and
  each lost run gets exactly one terminal outcome. Old joins settle on old
  task IDs; replacements always take new IDs.
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

- **Tool sandboxing, not worker sandboxing.** Under `sandbox` isolation,
  generated commands run in a restricted bubblewrap view; the trusted SDK
  worker and control plane always run on the host. Children never load
  extensions.
- **Reviewer judgment is not correctness.** `passed` records a model
  verdict about frozen evidence, never proof. External writers during
  review are detected by fingerprint comparison (invalidating the review),
  not prevented transactionally — tasks needing stronger isolation must
  say so; no snapshot backend exists in v1.
- **Cross-process credential-refresh serialization is best-effort.**
  Workers share the host `auth.json` live; concurrent OAuth refresh from
  two processes may double-refresh. `auth.json` is never copied.
- **Extension-registered providers are unavailable to children.** Workers
  load built-in providers plus declarative `models.json` entries; a model
  only an extension provides fails with `MODEL_UNAVAILABLE`.
- **The sandboxed tool `PATH` is the host's.** Sandboxed commands see the
  host runtime `PATH` directories read-only (not `$HOME` ones); there is no
  network, no nix daemon, and no package installation inside the sandbox.
- **No token/cost budgets are enforced yet.** Usage is accounted per
  agent and cumulatively (unknown usage is flagged, never treated as zero),
  but nothing stops admission on spend; the plan's budget stops are not
  implemented. Agent count, depth, runnable and resident limits are.
- **No daemon, workflows, auto-merge, sibling mesh, session takeover.**
  Deferred per the plan. Questions have deadlines; unanswered questions do
  not wait forever.
- **Deterministic tests prove contracts, not live providers.** Live runs
  are manual; `docs/progress.md` records which provider/OS combinations
  were exercised.
- **Children receive their task text plus selected skills and context
  files.** `skills` / `context_files` (or `all_skills` /
  `all_context_files`) select from what the owner holds (the
  governing session: what pi loaded for its current run, observed on
  `before_agent_start`). The selection is snapshotted at spawn (128 KiB
  ceiling) and survives reloads; children discover nothing from their
  working directory (no SYSTEM.md, AGENTS.md, skills, or settings
  packages) and load no extensions. The governing session's other prompt
  additions (appended system prompts, extension prompt sections) are not
  transferred.
- **No manual approvals.** Every child tool call is decided by grants
  alone: a granted call runs, anything else fails with `POLICY_DENIED`.
  There is no `ask` setting or approval mechanism.
- **No diff view.** `read_agent` returns status, results, and events; a
  worktree writer's changes are inspected with `git -C <workdir> diff`.
- **Transcripts show what the session file holds.** Text being generated
  streams into the view; thinking and tool calls appear when their message
  completes. A gate reviewer's conversation is not kept, so it has no
  transcript. The `/agents` screen was exercised in a real terminal (tmux)
  in pi's fullscreen and regular modes at 160×45, 120×32, and 100×30.
