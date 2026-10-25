# ponygirls-subagents — supported versions, recovery, limitations

## Supported versions and platforms

- Repository-patched pi **1.4.0** (`@earendil-works/*` namespace). The worker imports the
  **built** package tree (`dist/index.js`, `pi-ai/dist/compat.js`,
  `typebox`) from `PI_SUBAGENTS_SDK_ROOT`, which the home-manager pi wrapper
  sets to the exact pi derivation it runs. Unset, spawning fails with an
  explicit error. Use this flake's derivation, including its retained custom-message
  ingress/flush/reload patch: a matching version string alone does not establish
  protocol compatibility. Other pi builds are untested and unsupported.
  External delegation additionally pins the five-argument tool-runtime
  adapter (`tool-definition-wrapper.js`): public `AgentTool.execute` has four
  arguments, but the runtime forwards a fifth `ExtensionToolContext`. The
  narrow adapter (`src/governing-runtime.ts`) names that contract without
  private session access; if the runtime signature drifts, external dispatch
  fails visibly rather than bypassing grants.
- Node **24.x** (type-stripped `.ts` worker fork; `node --test` suites).
- OS: **Linux x86_64**. `sandbox` isolation additionally needs bubblewrap
  (`bwrap`) with user-namespace support: the backend probes it before
  running a job and rejects with `SANDBOX_UNAVAILABLE` when unsupported;
  there is no macOS/Windows sandbox backend and a sandboxed job is never
  silently replaced with host execution. Distributions that restrict
  unprivileged user namespaces (Ubuntu 24.04's AppArmor default) fail the
  probe, so every tool of a sandboxed child returns `SANDBOX_UNAVAILABLE`
  until bwrap is allowed.

## Supervisor recovery procedure

1. Inspect `list_agents` and capacity feedback before solo fallback. The default
   `maxOpenAgents` cap is 32 open identities, including idle/nested agents and
   managed reviewers. Closing a subtree reclaims its slots after cleanup and
   durable closure; closed identities cannot resume. Runnable saturation parks
   work; resident saturation can clear when eligible idle workers are evicted.
2. Reuse settled open ordinary agents with `send_message(mode="task")`. The
   governor may reuse any eligible descendant, including nested agents; capacity
   feedback lists all eligible descendants within the caller's authority. The
   retained model does not follow governing-session provider/model changes.
   For an explicit change, pass `model: {provider, id, thinkingLevel?}` on that
   task. Only an owner/governor can do this, and root `allowedModels` applies.
3. Model switching requires a current validated native checkpoint, known usage,
   no admission hold, and a quiescent, non-gated target: no running/starting,
   queued/parked, joining, checkpointing, loading, recovery-uncertain, or owned
   work. Wait for transient states; do not discard history when capture fails.
   Acceptance journals model and task together; replay retains the same identity,
   history, grants, workspace, and cumulative billing. Worker reload records the
   explicit native model/thinking selection without rewriting historical messages.
4. Same-model reuse is distinct from checkpoint-ready switching. A fresh required
   review panel still needs fresh managed identities; ordinary reuse cannot
   replace it. Unresolvable models and failed checkpoints are visible failures,
   never an implicit provider fallback. Unknown usage remains sticky; switching
   does not reconcile it or make outstanding billing disappear.
5. Use `close_agent` on an unneeded subtree to reclaim open-agent slots. The
   governor may close any subordinate, including nested agents; a child controls
   only its own descendants. Associated managed reviewers are included. Repeated
   or overlapping closes release each identity once, only after its durable close
   fact. Historical identities, paths, sessions, results, worktrees, and cumulative
   creation/usage accounting remain; no extra kill/reset tool is required.
6. Recovery reconstructs open capacity from final journal lifecycle states,
   including journals written under the former lifetime cap. Eviction frees only
   resident resources, not an open identity slot. Retained-file cleanup is separate.
   Closing does not establish that uncertain/background-owned effects stopped,
   reconcile billing, or clear recovery holds; inspect and join/manage backend
   effects explicitly. If safe reuse or enough open slots for a required panel
   remain unavailable, report **delegation unavailable** before solo fallback.
   Never reopen tombstones or bypass reviews. Report independent delegated review
   as **not performed** when unavailable; do not relabel self-review as independent
   review.

See [Capacity recovery and retained models](../README.md#capacity-recovery-and-retained-models)
for the tool example and limit defaults.

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
Reviewer feedback stays separate: `read_agent view=reviews` pages the complete
concatenation of attributed verdicts and errors from all candidate rounds after
the task settles, with the same `offset`/`length`/`nextOffset` contract.
`result.reviewCount` indicates how many reports are available; `task_run_id`
selects a historical run. Feedback is durable and is not cut at `result_limit`.

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
worktrees, worker scratch) — outside all child tool views. Setting
`worktreeRoot` in `subagents-policy.json` (null default) relocates only
writer worktrees under `<root>/<sessionId>/worktrees/...`; journal,
manifest, checkpoints, sessions, and tmp stay home, and recorded
allocations keep their absolute paths. The pooled directory must exist (and,
under yolo, be an explicit `extraReadWritePaths` binding); unwritable
destinations fail visibly. New allocations land in a single traversal-free
leaf inside the exact session destination (verbatim for ordinary repo IDs,
hashed otherwise). Sandbox tool views hide the pooled root except
the child's own writable worktree (sibling/other-session content stays
masked even under a covering read root), including pools retained from
saved allocations after the option changes — from the recorded
allocation-time namespace, else the exact default, else the namespace
anchored on the recorded repo ID, never marker counting; anything else
fails visibly. An unprovable retained namespace (missing leaf,
missing/emptied/rewritten backlink) fails closed session-wide with
WORKSPACE_UNAVAILABLE — blocking fresh sandbox filesystem operations,
checks, and reviewer file tools in that session until the namespace
re-proves (alias/backlink restored). Closing the stale retained agent
does not clear the hold: closed records are retained and still examined.
Recorded paths are never migrated or dropped. Canonical symlink targets are
masked alongside the configured path, and recorded paths are never
rewritten, migrated, or deleted. The root lock
(`root.lock/`) records its owner's pid, boot id, and process start time; a
live owner keeps it, and a crashed owner's lock is retired atomically by
exactly one successor. Switching sessions or shutting down pi cancels owned
tool jobs and stops workers; runs left active are reconciled when the
session is attached again (below). Ephemeral (`--no-session`) governing
sessions still delegate, but recovery has no native session to restore.
Notice delivery does not depend on session persistence or user-input handlers.

Child notices (terminal outcomes, quarantines, controller failures, messages
and questions addressed to the governing session) are drained by one
session-scoped delivery pump whenever the supervisor changes. Every page is
handed to the patched SDK's `pi.enqueueMessage` with
`triggerTurn:true, deliverAs:"steer"`. SDKs without this capability are rejected
before delegation; there is no legacy fallback. While busy, Pi inserts
accepted notices after complete tool results; the next natural model request
consumes them, or a continuation is scheduled when current work would stop.
While idle, Pi starts a coalesced turn containing the accepted notices. No user
input or status polling is required to resume the governing model.

Explicit `clearQueue()` or abort cancels the existing wake intent, not accepted
context; it does not immediately restart the canceled run. Genuinely new child
activity can request another turn. Shutdown revokes scheduled delivery and retries;
the footer status independently shows tree counts.

The attachment's journal cursor suppresses repeat submissions, not a durable
session receipt. A successful synchronous `enqueueMessage` return transfers message ownership to
Pi; a pre-acceptance rejection retains the page in the pump. Its scheduling fields
are explicit, and it supports `steer` / `followUp`, not deferred `nextTurn`. Rejected ingress has
three attempts with 100 ms between failures. Pi separately retains its accepted
pending queue and bounds background drain retries to three attempts, reporting
failures through the host's `onError` binding. Later producer activity permits a
new attempt; permanent failure does not spin or hold the active-run flag forever.
A failed disk rollback disables further appends on that session manager: repair
storage and reopen it rather than append behind an uncertain suffix.

Retained ingress appends native context and emits public message events; it does
not replay extension message-transformation hooks. Ordinary `pi.sendMessage` keeps
its existing pipeline and is not an ownership receipt. Retained ingress can and
does request inference independently of that pipeline.

Ownership acceptance is neither model-run completion nor fsync. The pending SDK
queue is in-process; reattaching starts at the current journal end, so old history
is not replayed. There is no crash-durable exactly-once governing-notice receipt.

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
- Gate/review recovery: running panel members become `interrupted` (resumable
  with fresh context, counters kept). Completed verdicts and failed-member
  diagnostics are preserved; resuming runs only missing members, never infers
  their verdicts. If every member reported before a crash but the aggregate
  was not applied, explicit `resume_review` finishes that aggregate without
  rerunning reviewers or charging another round. A committed repair reservation
  retains its existing deduplicated command; it is not reserved a second time.
- `spawn_agent review` is advisory: one successful main candidate and one panel,
  no acceptance condition and no automatic repair. It ends `succeeded` even if
  reviewers request changes, are blocked, or fail; the report retains those
  outcomes. `gate` retains unanimous approval and round-limit semantics. Both
  modes pause the candidate while reviews run, use the same protected read-only
  workers, and charge all reviewer identities before dispatch.

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
  host runtime `PATH` directories read-only. An explicitly selected executable
  alias can expose its runtime directory under `$HOME` and synthesize ancestor
  directories, but does not bind the surrounding home/profile contents. There is
  no network, no nix daemon, and no package installation inside the sandbox.
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
- **Delegated external tools skip parent hooks by design.** Governing
  `tool_call`/`tool_result` extension hooks (permission prompts, logging),
  transcript `tool_execution_*` events, `nestedCalls` summaries, and image
  normalization are NOT replayed for delegated external calls. Authority is
  the root+owner `allowedTools` intersection plus the supervisor journal;
  billed usage is accounted exactly once there, not in the parent
  transcript. Do not claim hook/event equivalence.
- **External delegation is host-only and least-privilege.** Only
  `none`/`worktree` children receive approved concrete external names;
  `sandbox` and gate reviewers never do, and reserved names are never
  delegable. The default `allowedTools` is empty; Home Manager grants
  `mcp__codegraph__codegraph_explore` by default only when the `codegraph`
  MCP server is configured. Arbitrary whitelisted tools are not magically
  read-only: reader/writer profiles do not bound external effects, only
  naming (the whitelist bounds *which* tools, not JS isolation).
- **No diff view.** `read_agent` returns status, paged results, and events; a
  worktree writer's changes are inspected with `git -C <workdir> diff`.
- **Transcripts show what the session file holds.** Text being generated
  streams into the view; thinking and tool calls appear when their message
  completes. Gate reviews appear inside the gated agent's transcript (each
  review is a fresh session file, never resumed). The `/agents` screen was
  exercised in a real terminal (tmux) in pi's fullscreen and regular modes
  at 160×45, 150×50, 120×32, and 100×30.