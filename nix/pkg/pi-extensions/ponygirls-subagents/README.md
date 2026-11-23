# ponygirls-subagents

Supervisor/worker subagents for pi 1.1.0: durable asynchronous delegation
with inspectable progress, attributed messages, interruption, resumption,
bounded nesting, reviewer-panel validation gates, and one-shot advisory reviews.

One supervisor owns the governing pi session. Each resident child runs in a
separate SDK worker process with a native pi session, reached over a private
validated IPC protocol. All child tools execute through a supervisor-owned
broker, either directly on the host or in a Linux bubblewrap sandbox, as
chosen per child (see Isolation). One `/agents` screen (the agent tree,
live transcripts with a chat line) and seven core tools plus
`manage_gate` share the same controller methods. There are no manual approvals: a child's tool call is
allowed by its grants or fails with `POLICY_DENIED`.

## Status

Initial scope per `subagents-plan.md` (repository root), revised after an
adversarial review (see `docs/progress.md`): deterministic, real
SDK/filesystem/IPC/Git/sandbox, and live-provider checks pass.
`docs/ponygirls-subagents.md` lists supported versions, recovery diagnostics, and
genuine limitations.

## Layout

- `index.ts` — thin extension registration (tools, `/agents`, events)
- `src/notice-delivery.ts` — producer-driven journal notices with autonomous governor wake-up
- `src/types.ts`, `src/errors.ts` — domain identities, frozen error codes
- `src/protocol.ts` — versioned IPC envelopes, ownership/fencing validation
- `src/policy.ts` — root authority, grant intersection, fixed profiles,
  isolation floor
- `src/instructions.ts` — skills/context-file selection handed to children
- `src/scheduler.ts` — atomic admission leases, canonical path registry
- `src/store.ts` — durable root store (file journal + in-memory contract pair)
- `src/tools.ts` — child tool contract: pi-shaped schemas, argument
  validation, file-tool scripts (arguments on stdin)
- `src/broker.ts` — supervisor-owned tool brokering and owned jobs
- `src/governing-runtime.ts` — pinned (1.1.0) governing-session adapter:
  handle snapshots, prototype-preserving scoped contexts, result bounds
- `src/external-dispatcher.ts` — approved external (MCP etc) dispatch with
  child-owned IDs/signals, independent journal, public `runToolCall`
  validation (no parent hook replay)
- `src/sandbox.ts` — host and bubblewrap tool backends (+ dummy contract pair)
- `src/workspace.ts` — Git worktree manager (+ dummy contract pair)
- `src/process-identity.ts` — pid + boot id + start time ownership checks
- `src/supervisor.ts` — tree, policy, scheduler, journal, recovery, gates host
- `src/worker.ts` — SDK worker process (native child session, proxy tools)
- `src/worker-launch.ts` — supervisor-side transport (fork, handshake, guard)
- `src/parent-models.ts` — selected parent provider metadata and private request-auth bridge
- `src/backend-contract.ts`, `src/backends.ts` — provider-neutral backend registration, revocable sessions, trusted worker adapters and usage ownership
- `src/gate.ts` — optional validation gate controller + decision schema
- `src/ui.ts` — border badge, headless projection, the `/agents` screen
  (tree inspector, transcript view with chat)
- `src/transcript.ts` — a child's native session as transcript lines
- `src/display.ts` — sanitization and theme styles shared by the views
- `src/deterministic.ts` — scripted provider for credential-free tests
- `tests/` — behavioral/contract suites (`node --test`), dual-test pairs,
  deterministic provider tests, real SDK/filesystem/IPC/Git/sandbox checks

## Isolation

`spawn_agent` takes `isolation`; a child is never less isolated than its
owner. Omitted, it is `worktree`, or the owner's isolation where that is
stricter.

| `isolation` | Tool jobs | Workspace | Policy file |
|---|---|---|---|
| `worktree` (default) | host, as the user, with pi's environment and network | a writer gets its own Git worktree of the owner's checkout (same project-relative directory, committed base), or of the source selected by `repo_path`; readers read in place; or the Git work tree named by `workspace_path` | not needed by default |
| `none` | host | the owner's working directory; writers edit it in place | not needed |
| `sandbox` | bubblewrap view, no network | a registered repository (`repo_id`); writers get their own worktree | required |

```text
spawn_agent(task_name="survey", profile="reader", message="List callers of FileRunStore.open under src/.")
spawn_agent(task_name="fix-glob", profile="writer", message="Fix globSrc in src/tools.ts; run node --test tests/broker.test.ts.")
spawn_agent(task_name="hotfix", profile="writer", isolation="none", message="...")
spawn_agent(task_name="untrusted", profile="writer", isolation="sandbox", repo_id="myrepo", message="...")
```

A worktree writer's changes stay in its worktree (`workdir` in the spawn
result and in `list_agents`); nothing is merged back, so bring them over
yourself (`git -C <workdir> diff`). A dirty checkout needs `base_commit`
(the worktree will not contain the uncommitted changes) or `isolation:
"none"`. Under host isolation, `reader` is a tool list, not a boundary: its
`read` reaches anything the user can. Two `none` writers in one directory
are not locked against each other.

### A repository below your working directory

A governing session started in a non-Git directory can select a descendant
repository as the source of a fresh managed writer worktree:

```text
spawn_agent(task_name="impl", profile="writer", repo_path="/home/user/projects/myrepo", message="...")
```

`repo_path` must be an absolute path to the top-level directory of a Git
work tree with a commit. After resolving symlinks, it must equal or lie
beneath the governing session's working directory and must not overlap the
supervisor's storage or managed worktree pools. It selects the source, not
an in-place workspace: the child, gate checks, and reviewers use the newly
allocated worktree. A dirty source still requires `base_commit`, resolved
in that source repository; uncommitted source changes are not copied.

Only the governing session may select it, only for `worktree` writers.
Readers, `none`, `sandbox`, and combinations with `repo_id` or
`workspace_path` are refused. No repository registration is needed.
Omitting `repo_path` preserves the usual owner-directory
selection, including refusal of a worktree writer from a non-Git directory.

### A workspace you prepared

A governing session that makes its own worktree per child, and commits and
removes it itself, hands it over with `workspace_path`:

```text
spawn_agent(task_name="impl", profile="writer", workspace_path="/home/user/worktrees/impl-1", message="...")
```

No repository registration or path allowlist is needed. The absolute
path must resolve to the top-level directory of a Git work tree with a
commit. It must not overlap the supervisor's own storage or be the
governing checkout (unless `workspaceOwnerCheckoutAllowed` is set).
It works with `isolation: "worktree"` only
(not `none`, not `sandbox`), without `base_commit`, and only from the
governing session. The extension never creates, resets, or removes that
directory; if you remove it, the agent's later tasks fail with
`WORKSPACE_UNAVAILABLE`.

## Skills and context files

By default the child receives only explicitly selected skills and context
files, snapshotted at spawn and kept across reloads:

```text
spawn_agent(task_name="review", profile="reader", message="...", all_skills=true, context_files=["/home/user/src/myrepo/AGENTS.md"])
```

`skills` lists owner-held skill names. `context_files` lists owner-held paths;
`all_skills` and `all_context_files` pass everything the direct owner holds in
that category. They never enumerate a child workspace. Explicit selections
work even when all discovery is off.

With [Archeologist](../ponygirls-archeologist) loaded, `/archeologist` controls four independent AGENTS.md sources for **new**
ordinary children. All are off by default:

| Setting | What the child receives |
| --- | --- |
| Auto-discover nested | On a successful direct model call to `read`, `write`, `edit`, `grep`, `find` or `ls` with a path below its working directory, the child receives newly encountered rules along that path in its tool response. No recursive scan, shell parsing, inspection of an external tool’s internal reads or inference about paths mentioned in tool output. |
| Child worktree AGENTS.md | Startup rules from the child's allocated checkout root through its working directory, least to most specific. Outside a checkout this uses the working directory only. `context_files` may then also name an existing rule inside that working directory, relative or absolute. No `..` components or links outside that directory. |
| Parent project AGENTS.md | The direct parent's already-loaded project rules, not the conversation, agent-directory rules or a fresh read of the parent tree. |
| Global user AGENTS.md | The user rule in Pi's agent directory. A grandchild can receive only the snapshot its direct parent holds. |

Each directory contributes the first readable regular file in Pi's order:
`AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`.
An explicit name can select a non-winning file. Project reads use the child's
actual filesystem view and cannot use links outside the permitted root. No
additional skills, extensions or other project resources are discovered.
Before asynchronous startup discovery, the supervisor journals its temporary
directory and, for an extension-created writer worktree, its Git and directory
identities. A discovery-staged writer checkout carries a Git worktree lock
until its spawn is published or rolled back. While that claim is unresolved, another Pi session cannot reuse that checkout
or its subdirectories as a working directory, prepared workspace, sandbox read root,
or source for another writer worktree. Reopening the
session after a crash releases only verified, unpublished allocations. A prepared checkout is never a cleanup target.

Startup ordering is global, inherited project, explicit owner selection, then
child checkout and named child-local files. At the same path, explicit owner
text wins over child-local text, and child-local text wins over automatic
inherited text. The combined skills and rules have a 128 KiB serialized limit;
an on-access addition must also fit half a 24,000-character tool result. A
lookup or size failure after a successful tool does not undo the operation;
the tool response reports the discovery error. Snapshots and discovery grants
stay with the admitted child across follow-ups and reloads. A descendant's
automatic discovery cannot exceed either the current settings or its direct
parent's admitted switches. Gate and one-shot review bundles retain their
separate, explicit review context and do not run discovery.

The operator pane lists paths confirmed installed by each ordinary worker,
including explicit selections and closed agents. Missing or legacy delivery
records leave coverage incomplete. No path inventory is sent to model tools.
Without Archeologist, new admissions remain explicit-only; switching it off
does not revoke snapshots already admitted.

## Configure

`~/.pi/agent/subagents-policy.json` is optional; it registers repositories
for `sandbox` children and sets nesting, model, gate, and capacity limits
(an invalid file is an error, not a fallback to defaults):

```json
{
  "maxDepth": 2,
  "nesting": true,
  "repos": [
    {
      "repoId": "myrepo",
      "checkoutPath": "/home/user/src/myrepo",
      "readRoots": ["/home/user/src/myrepo"],
      "allowWriters": true
    }
  ],
  "allowedModels": [{ "provider": "zai", "id": "glm-5.3" }],
  "latestModelsOnly": true,
  "gateBypassAllowed": false,
  "gateMaxRoundsCeiling": 3,
  "allowedTools": ["mcp__codegraph__codegraph_explore"],
  "worktreeRoot": null,
  "workspaceOwnerCheckoutAllowed": false,
  "maxRunnable": 16,
  "maxResidentWorkers": 24,
  "maxOpenAgents": 48
}
```

Writer worktrees default to `~/.pi/agent/subagents/<sessionId>/worktrees`.
`worktreeRoot` (null or an absolute path; relative, empty, or NUL-bearing
values fail visibly) relocates only writer worktrees — host `worktree` and
`sandbox` writers alike — under `<root>/<sessionId>/worktrees/...` for
cross-session separation. Session, log, IPC, and tmp dirs stay home; saved
allocations keep their recorded paths (no migration, prune, or deletion);
an unwritable destination fails visibly instead of falling back home. New
allocations land in a single traversal-free leaf component inside the exact
session destination (`wt-<repoId>-…` verbatim for ordinary IDs, hashed
otherwise); the fresh worktree is canonicalized once, so the recorded
workdir and pool namespace name the allocation-time physical target even
if a configured alias is later removed or retargeted. Logical repo IDs
stay unrestricted plain strings. The
directory must already exist; under the yolo sandbox it must also be listed
in `smind.hm.dev.llm.yolo.extraReadWritePaths` (missing paths are skipped
there, so an unlisted root is not persistently visible). The pooled root
stays hidden from sandbox tool views except the child's own workspace:
sibling and other-session pooled content is masked even under an approved
read root covering the pool. The mask covers retained pools too: reallocating
under a new root (or back to null) never unhides a recorded pool namespace.
Provenance is physical, not nominal: a retained namespace whose git
administration identity cannot be proven — missing leaf, missing/emptied
backlink, or a backlink that no longer resolves bidirectionally — fails
closed with a user-visible WORKSPACE_UNAVAILABLE rather than masking on
guesswork (a backlink string matching the recorded path proves nothing by
itself; no token, marker, or mere file readability certifies a namespace).
Concrete case corrected in-tree (not deployed in main): an alias-born pool
whose alias was replaced by an ordinary directory and whose backlink was
rewritten to the recorded path used to keep the alias mask while the true
pool stayed natively readable. Fail-closed is session-wide by construction
— every retained allocation is examined for every sandbox tool view — so
one unprovable retained namespace blocks fresh sandbox filesystem
operations, controller checks, and reviewer file tools in the same
supervisor session until resolved. Closing the stale retained agent does
NOT restore availability: closed records are kept and still examined, so
the hold persists. Truthful restoration requires a trustworthy successful
namespace re-proof — restore the alias/backlink so the proof succeeds
again. Nothing is migrated, dropped, or rewritten automatically. Boundaryless
host isolation "none" remains boundaryless; only this retained-provenance
failure is not a global model-inference hold (runtime recovery holds are a
separate policy). Recorded
workdir/gitDir paths are never rewritten, migrated, or deleted.
Canonical host targets are masked alongside the configured path, so a pool
reached through a symlink inside a protected dir stays masked at its real
location; unresolvable paths fail visibly instead of silently unhiding.
Pool masks are hard storage namespaces: unlike legacy hides (which re-bind
approved paths beneath them, e.g. skill/context dirs), a read root equal
to or nested under pooled storage stays masked — only the child's own
writable worktree is bound again. A retained namespace comes from the
recorded allocation-time pool, else the exact default namespace, else the
namespace anchored on the recorded repo ID (never untrusted marker
counting); legacy host worktrees prove theirs by actual allocation shape
(writer with git, flat leaf, session-namespace parent, persisted isolation
"worktree") while isolation-"none" in-place workdirs contribute none,
and anything else fails visibly instead of guessing. A managed
reviewer's candidate worktree and a controller check's own workspace are
bound read-only after the masks as exact supervisor-selected exceptions
(never arbitrary approved roots, never writer permission).

A sandboxed writer without a registered repository is denied
(`POLICY_DENIED`), and sandboxing never falls back to host execution.
`maxDepth` 1 (default) disables nesting; with `nesting: true` and
`maxDepth: 2`, children receive `spawn_agent`/`interrupt_agent`/
`close_agent` and may delegate within their own authority.
`maxDepth` is the only depth limit (enforced when grants are intersected);
the admission scheduler has none.

`maxRunnable` (default 16, at most 64), `maxResidentWorkers` (default 24, at
most 128), and `maxOpenAgents` (default 48, at most 1024) set the capacity
limits described under [Capacity recovery](#capacity-recovery-and-retained-models).
An absent key keeps its default; a value that is not an integer in range
fails with `INVALID` naming the key. They must satisfy
`maxRunnable <= maxResidentWorkers <= maxOpenAgents` (a running agent holds a
resident worker and every resident worker is an open identity), otherwise
the file is rejected rather than carrying a limit that could never bind.
When upgrading from the old 4/8/32 defaults, check partial overrides against
this ordering. For example, keeping `maxResidentWorkers: 8` also requires
setting `maxRunnable` to 8 or less.
The file is read when a session starts: a running session keeps the limits
it started with, and an invalid file makes subagents unavailable for that
session (reported at start and by every subagent tool).
The former `workspaceRoots` JSON key is ignored. Remove any
`smind.hm.dev.llm.pi.subagentsWorkspaceRoots` declaration when upgrading;
that Home Manager option no longer exists.

Children inherit their owner's selected model and thinking level.
`spawn_agent`, `list_agents`, and `read_agent view=status` report `model` as
`provider/id`, `requestedThinkingLevel` as the selected level (including
inheritance), and `thinkingLevel` as the effective Pi session level after
clamping. An unconfirmed level is `"unresolved"`, not `"off"`.
Explicit overrides and reviewer models must be in `allowedModels` (or the
allowlist must be disabled with `"allowedModels": null`). Independently,
`latestModelsOnly` (default `true`) rejects older generations for inherited
and explicit models, reviewers, and reused agents. A model is older only if
the governing registry has an available, strictly newer version of the same
recognized family and serving variant on that provider route. Unrecognized
IDs and floating aliases are not retired. No model is switched automatically.

To permit older generations in Home Manager, set
`smind.hm.dev.llm.pi.subagentsLatestModelsOnly = false;`. If you maintain
`subagents-policy.json` yourself, set `"latestModelsOnly": false` instead.
The explicit model allowlist still applies.

A dispatch reserves one agent identity plus one per reviewer before creating
anything; reviewers share the normal runnable/resident limits and can drain a
panel even with one slot.
The whole file is declarative in home-manager — setting any of these
manages `subagents-policy.json` complete, so partial files are never
half-clobbered:
`smind.hm.dev.llm.pi.subagentsAllowAllModels` (disable the explicit allowlist;
takes precedence over `...AllowedModels`), `...AllowedModels`,
`...LatestModelsOnly` (default true), `...MaxDepth` (1–2), `...Nesting` (needs
depth 2), `...Repos` (`repoId`, `checkoutPath`, optional `readRoots`,
`allowWriters`), `...GateBypassAllowed`, `...GateMaxRoundsCeiling`
(`null` for unlimited), `...AllowedTools` (explicit full-name allowlist for
governing-session external tools; empty default denies all; Home Manager
grants `mcp__codegraph__codegraph_explore` by default only when the
`codegraph` MCP server is configured), `...WorktreeRoot` (null default keeps
the home layout; an absolute path pools writer worktrees per session as
above; setting it manages the file),
`...WorkspaceOwnerCheckoutAllowed`, `...MaxRunnable` (default 16),
`...MaxResidentWorkers` (default 24), `...MaxOpenAgents` (default 48; the
ordering above is asserted at evaluation).

Built-in and declarative `models.json` providers retain live access to the
approved `~/.pi/agent/auth.json` through `PI_SUBAGENTS_HOST_AGENT_DIR`;
`auth.json` is never copied and is hidden from sandboxed tool views. Stock
workers load Pi's saved `models-store.json` from that directory even when
`models.json` is absent; they do not fetch the model catalogue at launch.
For a parent extension's legacy registration using a stock SDK API, only the
selected model's public metadata is transferred. The parent resolves fresh
request credentials and headers over private, generation-fenced IPC; workers
use an empty in-memory credential store, not inherited environment variables.
Native extension providers and legacy custom streaming functions cannot be
transferred by the stock path. An independently loaded backend may claim a model
through `src/backend-contract.ts`. No claimant preserves the stock behavior;
exactly one claimant supplies an explicit trusted worker module and bounded JSON
initialization; multiple claimants fail with a visible conflict. Binding failure
never falls back. Workers do not discover parent or workspace extensions.

The versioned request/offer handshake uses `pi.events`, not shared module state.
Registration rejects duplicate identities and returns an owner-specific unregister
handle. Core fences requests, binds receipt sinks to immutable dispatched identities,
and captures usage ownership per generation. Stock worker accounting remains the
default; authoritative backend receipts use the existing durable accounting and
recovery holds. Backend request payloads remain opaque under the 256 KiB envelope
limit. See the separately installed `pi-claude-code-subagents` package for the
optional Claude Code backend; loading the original provider alone does not enable it.

Workers import pi's built
package tree from `PI_SUBAGENTS_SDK_ROOT`, which the home-manager pi wrapper
sets to the exact pi derivation (`nix/hm/pi.nix`); without it spawning fails
explicitly.

Pi `/reload` rebinds the new extension runtime to the existing process-local
supervisor instead of terminating workers. Active child conversations and
portable provider requests continue, and completion notices emitted during
reload are retained. Backend registrations are revoked synchronously, old sessions
are joined, and retained workers use current registrations before new backend
requests. Removing a backend makes retained requests visibly unavailable. Subsequent
stock requests use the current `auth.json` or parent model registry; public
metadata changes require a worker reload. Thus switching the authenticated account for the
same provider does not replace the child identity or transcript. An account
that cannot access the selected model fails on the next request; credentials
and models are never silently substituted. An unattached reload handoff expires
after 30 seconds, and a changed/invalid policy intentionally replaces the live
supervisor so new authority and limits take effect. Session switching, quit, and
process exit remain terminal for live workers (durable recovery still applies).
Generation-scoped governing external tools reject calls made during the detach
gap; native child tools and provider requests continue independently.

## The /agents screen

`/agents` opens a full-screen view of the tree: path (nested agents
indented), profile and isolation, state, outcome, and model per row, with
the selected agent's workdir, usage, open question, and result below. The
TOKENS cell shows the token totals, then the fill of the model's context
window after the `·` separator (`8.8k in · 5 out · 12%`), tinted
warning past 70% and error past 90%; the estimate is the whole context
(prompt plus response) of the agent's latest valid provider request, and
stays out of the cell until one reports. The model label includes the
effective thinking level (for example,
`claude-code/claude-sonnet-5-5:xhigh`), or `:unresolved` before confirmation.
If the MODEL or TOKENS column is hidden, its value appears in the selected agent's details.
The list refreshes on its own. By default it shows only non-closed agents,
including idle and completed agents. Press `f` to show all retained agents
(including closed ones), or press it again to hide closed agents. The toggle
lasts while the pane is open, including visits to transcripts; reopening the
pane restores the default. Tools and retained history are unchanged.

- `enter` (or a double click) opens the agent's **transcript**: its
  conversation as its native pi session records it (tasks, thinking, tool
  calls with their results, delivered notes and replies), streamed live
  while it runs. `↑↓`, `PgUp`/`PgDn`, and the mouse wheel scroll.
- The transcript's **chat line** messages that agent: it answers the
  agent's open question, steers a running task, or otherwise starts a new
  task run. Messages are recorded as from the governing session.
- On the list: `m` note and `t` task (editor), `a` answer a question, `i`
  interrupt, `c` close, `g` resume an interrupted review or retry a
  finished one under the same gate (from the agent or its reviewer row),
  `r` refresh, `esc` close. Nothing here stops children by closing it.

A gated agent's transcript also shows each gate review where it happened:
the reviewer's own conversation inside a `┃` gate frame, headed
`╭─ gate review-N · candidate · model` and closed by the decision (live
while the review runs); the gate's repair requests are labeled. A
reviewer's row shows the reviews it ran. Each review is a fresh
conversation (never resumed); its file is kept for the transcript.
The badge shows on the editor's bottom-left border, next to the
background-tasks and goal badges, while the tree has at least one agent:
`👥`, the number of agents, then the live ones behind the list's state glyphs
(`👥 3 ●1 ?1` is three agents, one running and one asking; `○` counts the
queued ones). Its colour follows the tree: an agent is asking, work is running
or queued, or everything is settled. On a narrow border it is the number
alone, with `?` while an agent is asking (`👥3?`). Clicking it opens `/agents`.

## Child tools

Children see pi's built-in tool names and argument shapes, all executed by
the supervisor broker: `read`, `grep`, `find`, `ls` (everyone), `write`,
`edit`, `bash` (writers, in their writer workspace; sandboxed `bash` has no
network and a read-only runtime `PATH`). Every child also has
`send_message` (to `parent` or its subtree; `request_reply` asks a question
that preempts the parent's settlement waits), `wait_agent` (releases its
runnable slot while waiting), `list_agents`, and `read_agent`. Reviewers
hold only the read tools plus `submit_gate_decision`.

### Delegated governing-session tools (MCP etc)

Host-isolated children (`none`/`worktree`; readers and writers alike) may
additionally call explicitly approved governing-session tools — typically
MCP tools such as `mcp__codegraph__codegraph_explore` — through the
supervisor's governing-runtime dispatcher. The root `allowedTools` list
holds full-name patterns (`*` globs whole names; other regex punctuation is
literal; no `+`/`-` grammar); sandbox children and reviewers never receive
external tools, and built-in/control/delegation names (`read`, `bash`,
`send_message`, `spawn_agent`, `submit_gate_decision`, `manage_gate`, …)
are never delegable even via `*`. A malformed list fails visibly
(`INVALID`), never silently discards entries.

Each edge resolves patterns to concrete currently-callable parent names and
intersects with the owner's grant, so children cannot widen authority and
runtime updates (deferred/codemode tools, MCP reconnects) never silently
widen admitted children. The worker registers only its allowed concrete
names with the parent's actual schemas/descriptions (no generic catchall);
every call is re-authorized at execution with binding, worker-instance,
task-run/generation, and interrupt fencing. Effects run in the supervisor
via the governing runtime with broker-owned IDs and child-owned
cancellation (a parent's spawn return is not inactivity); intent is
journaled before effects with unique IDs, outcomes as ok/error/uncertain
(never replayed), results bounded to IPC limits with text/image/structured
content, errors, and billed usage preserved and accounted exactly once in
the supervisor journal (not the parent transcript). Session
reload/replacement/disposal revokes the binding and cancels in-flight
external work.

This is independent subagent authorization (same model as the file/shell
broker): governing `tool_call`/`tool_result` hooks, permission prompts,
transcript events, and `nestedCalls` summaries are NOT replayed for
delegated calls. The pinned 1.1.0 five-argument runtime adapter is an
implementation constraint, not hook equivalence.

Extensions whose tools need the preparation such a hook performs opt in
through the `pi.events` channel `ponygirls-subagents:prepare-delegated-call`
(`src/delegated-call.ts`). After authorization and immediately before the
effect, the supervisor emits `{ toolName, input, cwd, waitUntil }`: `input`
is a copy of the validated arguments that handlers may change in place,
`cwd` is the child's working directory, and `waitUntil(work)` (called
synchronously, before the handler's first `await`) makes the call wait for
`work`; a rejection blocks the call with `BLOCKED: <message>`. A call no
handler claims starts without yielding, as before. Live checks run again
after preparation, and cancellation returns promptly without
waiting for it (the extension's own work continues). Preparation is not
authorization: a handler cannot grant a tool. The child's per-call wait is
bounded by its 15-minute supervisor tool timeout; a retry joins work still
in progress. ponygirls-codegraph uses it to build a missing index before a
child's query reaches the MCP server.

Every nested/direct call is re-authorized live immediately before effects
(current binding, worker identity, active task/generation, current
root/owner grants, live scope); completed scopes are revoked, so retained
contexts die with `STALE_GENERATION`, and each nested invocation gets its
own scoped context (never the outer scope object). Cancellation combines
child lifetime with explicit nested signals and never waits indefinitely:
cancelled calls return promptly while late settlements journal a single
`uncertain` outcome (usage preserved) or a guarded recovery event after
fencing. Results preserve the invocation's own valid SDK `Usage` verbatim
on the wire (totalTokens, cost breakdown); the internal ledger keeps a
separate numeric aggregate (own + nested, exactly once) for accounting and
`usage.reported`, never mapped back into SDK shape. Control-quiescence (no
owned jobs) is distinct from effects-stopped: fencing records durable
uncertainty and a next task may proceed after terminal UNCERTAIN in host
scope, with late billing preserved under the original identity; replays
rebuild duplicate fencing and never re-account.

## Capacity recovery and retained models

Before falling back to working alone, inspect `list_agents` and the capacity
feedback. `list_agents` returns `{ agents, capacity }`; `capacity` holds the
current use (`runnable`, `resident`, `queued`, `open`, `reserved`, `created`)
and the effective `limits` (`maxRunnable`, `maxResidentWorkers`,
`maxOpenAgents`) from the policy file (see Configure). `close_agent` returns
the same `capacity`, and `CAPACITY_EXCEEDED` errors name the exhausted limit
and carry it in their details. The three limits are independent and shared by
the whole tree:

- **Open identities** (`maxOpenAgents`, default 48) include ordinary agents,
  nested agents, and managed reviewers, even when idle or unloaded. A complete
  main/reviewer panel is reserved atomically. `close_agent` releases each newly
  closed identity's slot after cleanup and durable closure; waiting, eviction,
  interruption, and task completion do not. Closed identities cannot resume.
- **Runnable slots** (`maxRunnable`, default 16) park accepted work until a
  slot is free. Top-level children, nested children, and gate reviewers draw
  from one pool; an agent waiting in `wait_agent` releases its slot while it
  waits. Busy parents therefore starve queued nested children: work is not
  deadlocked, but stays queued until running work settles. Wait for owned runs
  to settle; do not create replacement identities. If this recurs, raise
  `maxRunnable` (and `maxResidentWorkers` with it) in the policy file. Each
  runnable agent is a full pi worker process: host CPU and memory and the
  model providers' rate limits set the real ceiling.
- **Resident workers** (`maxResidentWorkers`, default 24) are evicted automatically when eligible idle
  workers become available. Wait for running work/checkpoint capture to finish.
  Resident saturation is not open-agent exhaustion.

At the open-agent cap, reuse a settled, open, ordinary agent with
`send_message(target="<id>", mode="task", message="...")`. This starts a new
run under the same identity, history, workspace, grants, and retained model.
The governing session may reuse any eligible descendant, not just direct
children; a child may reuse only its own descendants. Capacity feedback lists
all eligible descendants within that authority. A governing-session
model/provider change **does not** switch retained children.
The capacity response separates same-model reusable IDs from checkpoint-ready
model-switch IDs. A fresh gated/reviewed spawn still needs its reserved managed
reviewer identities; ordinary-agent reuse is not a substitute for that panel.

To give a settled writer a fresh validation gate while keeping its identity,
model, history, and Git workspace, the governing session can pass:

```text
send_message(target="<settled-writer-id>", mode="task", message="Correct the implementation.", gate={model:{provider:"<provider>", id:"<reviewer-model>"}, thinkingLevel:"high", prompt:"Verify the correction."})
```

This starts a new task run and needs enough open slots for the whole new
reviewer panel. The previous run's result and reviews are unchanged. Do not
combine `gate` with a main `model` override or use it on a busy or queued agent.
If the writer needs to reload, the gate requires a validated checkpoint of its
latest execution generation; it will not start a fresh conversation.
Omitting `gate` starts an ordinary follow-up. To re-review an existing frozen
candidate without sending new work, use `manage_gate` with `retry_review`.

For an explicit model/provider change, the owner or governor can pass:

```text
send_message(target="<settled-id>", mode="task", message="Continue the audit.", model={provider:"openai-codex", id:"<exact-model-id>", thinkingLevel:"off"})
```

The exact provider/id must be permitted by root `allowedModels` (`[]` denies
explicit overrides; `null` allows all). The model must resolve in the worker's
approved model store. The override is task-only, not a note/steer/reply; children
cannot change their parent or siblings. Running, starting, queued, closed,
gated/reviewer, joining, checkpointing, quarantined, loading, and owned-work
states are rejected. Unknown usage or a root admission/billing hold also blocks
switching: this path never retires a potentially outstanding billing obligation.

Switching requires a validated checkpoint of the current settled generation.
If capture is still running, wait and retry. A missing/stale checkpoint fails
closed without stopping the old worker or discarding history. Resolve the
checkpoint failure before retrying; a same-model task can continue on a retained
worker without switching. Unknown usage is sticky accounting uncertainty, not a
zero-cost result; no automatic reconciliation/reset is supplied by this operation.
Once accepted durably, the replacement model and task intent survive replay;
the worker reloads the selected native branch and appends model/thinking metadata
without rewriting earlier messages or their billing attribution. Unavailable
models fail visibly at reload; they are not silently replaced by the root model.

Alternatively, close an unneeded subtree with `close_agent(target="<id>")`.
The governing session may target **any subordinate**, including a nested agent;
children may close only their own descendants. Closure includes associated managed
reviewers, releases one slot per newly closed identity, and never releases the same
slot twice. A replacement spawn uses a fresh identity and task path. No extra kill
or budget-reset tool is needed.

`close_agent` irreversibly tombstones identities while preserving sessions,
results, worktrees, and cumulative usage/creation accounting. Capacity is restored
from the final open/closed journal state on recovery, including sessions written
under the former lifetime-cap policy. Automatic resident-worker eviction releases
only a process: the identity stays open, consumes an identity slot, and remains
eligible for later reuse. Retained-file cleanup is a separate operator action.

Reclaiming admission is not proof that external effects have stopped. A settled
invocation or a closed identity may still have uncertain/background-owned effects;
inspect that backend's ownership/status and join or manage it explicitly. Closure
does not clear billing uncertainty, recovery holds, or required reviews. If safe
reuse or enough open slots for a required panel remain unavailable, report
**delegation unavailable** before solo fallback; never reopen tombstones or bypass
reviews. If independent delegated review cannot be obtained, state that it was
**not performed**; self-review is not independent review.

## Ungated example

```text
spawn_agent(task_name="triage", message="Summarize open defects in this repository.", profile="reader")
list_agents()
wait_agent(targets=[{agentId:"<id>", taskRunId:"<run>"}], condition="all_settled", timeout_ms=120000)
read_agent(target="<id>", view="result")
```

`usage` in `list_agents` and `read_agent` reports `inputTokens` (the whole
prompt, cached parts included) with `cacheReadTokens` and `cacheWriteTokens`
as its cached parts, `outputTokens` with `reasoningTokens` as its reasoning
part (`null` when the provider reports no breakdown), `cost`, and `unknown`
(some usage never arrived; never read as zero).

Workers also register the packaged headless `/perf` collector explicitly,
without discovering ambient extensions. Measured responses and failure counts
append to the host agent directory's `model-stats.jsonl`, so `/perf` combines
parent and child requests by model and effort. Unmeasured historical requests
are not backfilled. Existing retained worker processes need replacement to
pick up collector changes.

A child's question ends a settlement wait with `reason: "needs_response"`;
its text is in `messages` (and `openQuestion` in `list_agents`). Answer with
`send_message(target="<child>", mode="note", reply_to="<messageId>", message=...)`
and wait again.

`externalTools` in `list_agents` and `read_agent view=status` names the
governing-session tools a child may call (empty for sandbox children and
reviewers); anything else outside its files it knows only from what it is
told. The `spawn_agent` and `send_message` prompt guidelines (governing
session and nesting children alike) therefore ask the delegating side to
read such external state immediately before relaying it, including when
answering a child's question, and to state its source and observation
time; an earlier result, such as the response that created a merge
request, is relayed only as history with its age.

A result is the child's final text, the first 8,000 characters by default.
`result_limit` on `spawn_agent` keeps up to 524,288 characters per task run
(a larger value is refused), and `read_agent view=result` pages through
them: each reply states `totalLength`, `offset`, `nextOffset`, and
`truncated`.

```text
spawn_agent(task_name="audit", profile="reader", result_limit=200000, message="Report every finding as JSON.")
read_agent(target="<id>", view="result")                    # reply: nextOffset=<n>
read_agent(target="<id>", view="result", offset=<n>)        # repeat until nextOffset is null
```

## Gated example

```text
spawn_agent(task_name="parser", message="Implement empty-input handling per SPEC.md.", profile="writer",
  base_commit="a1b2c3d",
  gate={model:{provider:"openai", id:"gpt-5"}, thinkingLevel:"high",
        prompt:"Require the empty-input case with check evidence.", maxRounds:3,
        checks:[{id:"tests", command:"npm test", timeoutMs:300000}],
        promisedOutputs:["src/parser.test.ts"]})
```

`checks` (writers only) run in the writer's workspace before every review,
each with its own timeout (default 120 s, at most 600 s); a non-zero exit
forbids approval. `promisedOutputs` (writers only) name files the
deliverable must contain; they are part of the reviewed candidate.

The main execution settling records a *candidate*, not success. Each managed
reviewer reads the paused workspace and returns one structured decision
through `submit_gate_decision`. Terminal outcomes are `passed`,
`review_limit_reached`, `gate_blocked`, `gate_error`, `candidate_superseded`,
or (explicit governor bypass only) `gate_bypassed`.

### Reviewer panels

Use `reviewers` instead of `model` for a panel. `prompt` and `thinkingLevel`
can be shared or supplied independently on each reviewer; per-reviewer values
replace the shared ones. Each reviewer must resolve both values. Repeated
models are allowed (for example, with different rubrics).

```text
spawn_agent(task_name="parser", profile="writer", message="Implement SPEC.md.",
  gate={prompt:"Require conformance to SPEC.md.", thinkingLevel:"high",
        reviewers:[{model:{provider:"openai", id:"gpt-5"}},
                   {model:{provider:"anthropic", id:"claude-sonnet-4-5"},
                    prompt:"Check security and failure handling."}],
        maxRounds:3})
```

All reviewers evaluate the same candidate independently. The controller waits
for the entire panel, then combines findings in reviewer declaration order
(with reviewer attribution, including overlapping finding IDs). Every reviewer
must approve for a gate to pass; any execution/protocol error produces
`gate_error`, otherwise any blocked verdict produces `gate_blocked`, otherwise
any revision request triggers one combined repair. The round limit counts
**candidates**, not individual reviewers. Checks run once before the panel and
are rechecked once on unanimous approval.

A resumed panel retains completed feedback and reruns only interrupted members.
Recovery never infers a missing verdict or automatically reapplies a completed
panel; `manage_gate resume_review` explicitly resumes an interrupted panel or
finishes its unapplied aggregate. A replacement specification on `retry_review`
uses correctly configured reviewer models and prompts.

### One-shot reviews (no gate or repair loop)

Pass `review` instead of `gate` for advisory feedback. It accepts the same
single-reviewer or panel configuration, but not rounds, checks, or promised
outputs. `gate` and `review` are mutually exclusive; only the governing session
configures either.

```text
spawn_agent(task_name="analysis", profile="reader", message="Analyze the design.",
  review={thinkingLevel:"high", prompt:"Identify unsupported assumptions.",
          reviewers:[{model:{provider:"openai", id:"gpt-5"}},
                     {model:{provider:"anthropic", id:"claude-sonnet-4-5"}}]})
wait_agent(targets=[{agentId:"<id>", taskRunId:"<run>"}], condition="all_settled")
read_agent(target="<id>", view="result")
read_agent(target="<id>", view="reviews")
```

After successful main work, every requested reviewer runs once. Approval,
revision, blocked verdicts, and reviewer failures are returned as feedback;
none triggers acceptance/rejection or another main generation. The task ends
`succeeded`, not `passed`. Main execution failure still ends the task normally
without reviewing a nonexistent candidate. The candidate stays paused until
all reviews finish, so queued tasks cannot change it under the reviewers.

### Reading all feedback

`read_agent view=result` preserves the main deliverable and includes
`reviewCount`. After the task settles, `view=reviews` returns the concatenated,
attributed structured verdicts and failure diagnostics from **every round**,
including blockers, advisories, blocked reasons and missing prerequisites.
`task_run_id` selects an older run. Like result text, review text is paged using
`offset` / `length`; follow `nextOffset` until `null` to receive everything.
Reports are not cut at the main agent's `result_limit`, fit the tool's output
bound per page, and survive restart. During a panel use `view=events` for
progress; report pagination is available after settlement so offsets are stable.

## Tests

```sh
nix build .#checks.x86_64-linux.ponygirls-subagents   # tsc + the suite, in the nix sandbox
```

Locally, link `node_modules` as the check does and run
`node --test tests/*.test.ts`. Most tests need no credentials;
`tests/sdk-worker.test.ts` needs `PI_SUBAGENTS_SDK_ROOT` pointing at the
pi 1.0.0 monorepo (deterministic provider; still no network). Live-provider
runs are manual: `pi --no-extensions -e <this dir>/index.ts --model ... -p ...`.
