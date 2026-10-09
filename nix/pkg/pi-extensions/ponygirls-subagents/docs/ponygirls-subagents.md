# ponygirls-subagents — supported versions, recovery, limitations

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

### A workspace the caller prepared (`workspace_path`)

A governing session that prepares its own git work tree per child (and
later commits and removes it itself) passes it as `spawn_agent`'s
`workspace_path`. The child then runs there under `worktree` isolation,
with host tool jobs, exactly as it would in a worktree the extension made:
that directory is its working directory and, for a writer, the tree
`write`/`edit`/`bash` are meant for. As everywhere under host isolation,
this is not a filesystem boundary.

- **Denied by default.** It is accepted only when the policy's
  `workspaceRoots` lists a directory that contains it; otherwise the spawn
  fails with `POLICY_DENIED`. Both the path and the roots are compared after
  resolving symlinks, so a link under a root does not admit a directory
  outside it. A root that does not exist admits nothing.
- **What is verified at spawn** (before any capacity is charged):
  the path is absolute (`INVALID`); it resolves to an existing directory
  (`WORKSPACE_UNAVAILABLE`); the resolved path lies inside a listed root,
  does not overlap the supervisor's root store or the host agent directory,
  and is not the governing session's own checkout (a directory containing
  its working directory) unless `workspaceOwnerCheckoutAllowed` is `true`
  (`POLICY_DENIED`); it is the top-level directory of a git work tree that
  has a commit — a main checkout or a linked worktree, not a subdirectory
  of one and not a bare repository (`WORKSPACE_UNAVAILABLE`). Nothing else
  is checked: the tree may be dirty, on any branch or detached, and of any
  repository.
- **Combinations.** Only with `isolation: "worktree"` (the default) and
  without `base_commit`; `none` and `sandbox` are refused with `INVALID`.
  A sandboxed view is built from a registered repository, and its authority
  is that registration, not a path. Only the governing session may pass
  it: a child's `spawn_agent` does not offer the parameter (`FORBIDDEN`).
- **Ownership stays with the caller.** The extension never creates,
  resets, cleans, removes, or prunes the directory or its git registration,
  on any path: startup failure, settlement, interrupt, close, shutdown, or
  recovery. Of its own accord it runs only read-only git commands there
  (`rev-parse` at spawn; `status` and `diff` for a gate fingerprint, with
  optional locks off). Two children given
  the same directory are not locked against each other. A nested writer
  spawned by such a child still gets a worktree the extension makes from
  that repository (under the root store), which registers a worktree in the
  caller's repository.
- **Gates.** The git dir and `HEAD` found at spawn are recorded with the
  agent; a gated writer's candidate is the tree's changes relative to that
  commit (committed, dirty, and untracked, uncommitted edits already there
  included), fingerprinted through the recorded git dir even if the child
  rewrites the tree's `.git` file.
- **Recovery.** The resolved path is journaled with the agent. Replay never
  touches the directory. If its owner removed it meanwhile, a lost run
  settles by the usual rules with `workspace <path> no longer exists` in
  its detail, and any later task for that agent fails with
  `WORKSPACE_UNAVAILABLE` instead of starting a worker. Loading a worker
  into the directory again also re-checks `workspaceRoots`, so a root
  dropped from the policy fails the task with `POLICY_DENIED`.

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
A worktree candidate covers the allocation base..HEAD committed delta plus
dirty/untracked files and explicit promised outputs (content and mode);
exceeding the file cap fails closed instead of silently partial.
- Git required for writer worktrees.

## Results

A task run's result is the final assistant text of its last generation.

- **Retention.** By default the first 8,000 characters are kept. `spawn_agent`
  takes `result_limit` (characters, an integer from 8,000 to 524,288) to
  keep more for every task run of that agent; a value outside that range is
  refused with `INVALID`, never clamped. The maximum is four times a
  128 KiB structured report and bounds one retained result to 1.5 MiB of
  UTF-8. Gate reviewers and gate candidates use the first 8,000 characters
  whatever the limit.
- **Reading.** `read_agent view=result` returns one page of the retained
  text: `offset` (characters, default 0) and optional `length` select it;
  the reply states `totalLength` (retained characters), `offset`,
  `nextOffset` (`null` at the end), `truncated`, and `resultLimit`. A reply
  never exceeds one tool result (24,000 characters of JSON): a page is cut
  to fit and `nextOffset` continues it, so reading until `nextOffset` is
  `null` yields the whole retained text. An `offset` beyond `totalLength`
  is `INVALID`. Offsets count UTF-16 code units, as JavaScript strings do.
- **Truncation is stated.** `truncated` is `true` when the agent wrote more
  than was retained (its text exceeded `resultLimit`, or a large text could
  not be handed over; the latter also leaves a `recovery.event` with phase
  `result_handoff_failed`). For results journaled before lengths were
  recorded it is `true` when the retained text fills the limit.
- **Storage and recovery.** The journal's `generation.settled` record keeps
  the first 8,000 characters (`text`) and the written length (`textLength`).
  A longer retained text is a side file,
  `results/<agentId>/result-<taskRunId>-<generation>.txt` in the root store,
  referenced from that record as `result` (`file`, `bytes`, `sha256`). The
  worker hands such a text over as a synchronized file in the agent's
  session directory, checked against its digest, because one IPC payload
  is capped at 256 KiB. After a restart the reference is replayed and the
  file is validated on every read; a missing or altered file fails that
  read with `RECOVERY_CORRUPT` instead of returning the shorter journaled
  text. Journals without these fields replay with the 8,000-character
  limit. Result files are kept until the root store is removed.

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

## Usage accounting

`usage` in `list_agents` / `read_agent` (per agent) carries `inputTokens`,
`outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`,
`cost`, and `unknown`; the root keeps the same totals over all agents.

- `inputTokens` is the whole prompt as pi reports it per request: uncached
  input plus cache-read plus cache-write tokens. `cacheReadTokens` and
  `cacheWriteTokens` are its two cached parts, so uncached input is
  `inputTokens - cacheReadTokens - cacheWriteTokens`.
- `reasoningTokens` is the part of `outputTokens` spent on reasoning (pi's
  `Usage.reasoning`), summed over the requests whose provider reported that
  breakdown. It is `null` while no request has reported one, never zero.
- `cost` is `null` until a provider reports one. A generation whose usage
  never arrived (worker lost, run closed mid-flight) sets `unknown`; the
  counters then hold what was reported, not the whole spend.
- The journal records each generation as `usage.reported` with `input`,
  `output`, `cacheRead`, `cacheWrite`, `reasoning`, `cost`, `unknown`.
  Records written before the cache and reasoning counters existed replay
  with zero cache tokens and no reasoning breakdown; they do not set
  `unknown`.

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
- **No diff view.** `read_agent` returns status, paged results, and events; a
  worktree writer's changes are inspected with `git -C <workdir> diff`.
- **Transcripts show what the session file holds.** Text being generated
  streams into the view; thinking and tool calls appear when their message
  completes. Gate reviews appear inside the gated agent's transcript (each
  review is a fresh session file, never resumed). The `/agents` screen was
  exercised in a real terminal (tmux) in pi's fullscreen and regular modes
  at 160×45, 150×50, 120×32, and 100×30.