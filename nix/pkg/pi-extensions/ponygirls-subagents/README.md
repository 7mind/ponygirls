# ponygirls-subagents

Supervisor/worker subagents for pi 1.0.0: durable asynchronous delegation
with inspectable progress, attributed messages, interruption, resumption,
bounded nesting, and an optional reviewer/fixer validation gate.

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
- `src/sandbox.ts` — host and bubblewrap tool backends (+ dummy contract pair)
- `src/workspace.ts` — Git worktree manager (+ dummy contract pair)
- `src/process-identity.ts` — pid + boot id + start time ownership checks
- `src/supervisor.ts` — tree, policy, scheduler, journal, recovery, gates host
- `src/worker.ts` — SDK worker process (native child session, proxy tools)
- `src/worker-launch.ts` — supervisor-side transport (fork, handshake, guard)
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
| `worktree` (default) | host, as the user, with pi's environment and network | a writer gets its own Git worktree of the owner's checkout (same project-relative directory, committed base); readers read in place; or the Git work tree named by `workspace_path` | not needed (`workspace_path`: `workspaceRoots`) |
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

### A workspace you prepared

A governing session that makes its own worktree per child, and commits and
removes it itself, hands it over with `workspace_path`:

```text
spawn_agent(task_name="impl", profile="writer", workspace_path="/home/user/worktrees/impl-1", message="...")
```

It is refused (`POLICY_DENIED`) unless `workspaceRoots` in the policy file
lists a directory containing it, compared after resolving symlinks. It
must be the top-level directory of a Git work tree with a commit, apart
from the governing checkout (unless `workspaceOwnerCheckoutAllowed`) and
the supervisor's own storage. It works with `isolation: "worktree"` only
(not `none`, not `sandbox`), without `base_commit`, and only from the
governing session. The extension never creates, resets, or removes that
directory; if you remove it, the agent's later tasks fail with
`WORKSPACE_UNAVAILABLE`.

## Skills and context files

A child's pi session discovers nothing from its working directory. It
lists exactly the skills and context files (`AGENTS.md` and the like) its
owner passes, snapshotted at spawn and kept across reloads:

```text
spawn_agent(task_name="review", profile="reader", message="...", all_skills=true, context_files=["/home/user/src/myrepo/AGENTS.md"])
```

`skills` lists skill names and `context_files` lists paths as shown in the
owner's project context; `all_skills` / `all_context_files` pass
everything; omitted passes nothing.
The governing session offers what pi loaded for its current run; a child
can pass on only what it holds. Extensions are never loaded in children.

## Configure

`~/.pi/agent/subagents-policy.json` is optional; it registers repositories
for `sandbox` children and sets nesting, model, and gate limits (an
invalid file is an error, not a fallback to defaults):

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
  "gateBypassAllowed": false,
  "gateMaxRoundsCeiling": 3,
  "workspaceRoots": ["/home/user/worktrees"],
  "workspaceOwnerCheckoutAllowed": false
}
```

A sandboxed writer without a registered repository is denied
(`POLICY_DENIED`), and sandboxing never falls back to host execution.
`maxDepth` 1 (default) disables nesting; with `nesting: true` and
`maxDepth: 2`, children receive `spawn_agent`/`interrupt_agent`/
`close_agent` and may delegate within their own authority.
`workspaceRoots` (absolute paths; default none) are the only places a
`workspace_path` is accepted; a list that is not absolute paths is an
error.

Children inherit the governing session's current model and thinking level;
`model` on `spawn_agent` overrides it only with an `allowedModels` entry
(`"allowedModels": null` allows every model instead of listing them).
Gate reviewer models must also be allowlisted (or run under `null`).
The whole file is declarative in home-manager — setting any of these
manages `subagents-policy.json` complete, so partial files are never
half-clobbered:
`smind.hm.dev.llm.pi.subagentsAllowAllModels` (allow every model, wins on
conflict), `...AllowedModels`, `...MaxDepth` (1–2), `...Nesting` (needs
depth 2), `...Repos` (`repoId`, `checkoutPath`, optional `readRoots`,
`allowWriters`), `...GateBypassAllowed`, `...GateMaxRoundsCeiling`
(`null` for unlimited), `...WorkspaceRoots`,
`...WorkspaceOwnerCheckoutAllowed`.

Provider credentials stay in `~/.pi/agent/auth.json` (declarative custom
models in `models.json`). Workers open that store live through
`PI_SUBAGENTS_HOST_AGENT_DIR` (set by the extension); `auth.json` is never
copied and is hidden from sandboxed tool views. Workers import pi's built
package tree from `PI_SUBAGENTS_SDK_ROOT`, which the home-manager pi wrapper
sets to the exact pi derivation (`nix/hm/pi.nix`); without it spawning fails
explicitly.

## The /agents screen

`/agents` opens a full-screen view of the tree: path (nested agents
indented), profile and isolation, state, outcome, and model per row, with
the selected agent's workdir, usage, open question, and result below. The
list refreshes on its own.

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
The badge (`agents 3 · running 1 · questions 1`) shows on the editor's
bottom-left border, next to the background-tasks and goal badges. Clicking
it opens `/agents`.

## Child tools

Children see pi's built-in tool names and argument shapes, all executed by
the supervisor broker: `read`, `grep`, `find`, `ls` (everyone), `write`,
`edit`, `bash` (writers, in their writer workspace; sandboxed `bash` has no
network and a read-only runtime `PATH`). Every child also has
`send_message` (to `parent` or its subtree; `request_reply` asks a question
that preempts the parent's settlement waits), `wait_agent` (releases its
runnable slot while waiting), `list_agents`, and `read_agent`. Reviewers
hold only the read tools plus `submit_gate_decision`.

## Ungated example

```text
spawn_agent(task_name="triage", message="Summarize open defects in this repository.", profile="reader")
list_agents()
wait_agent(targets=[{agentId:"<id>", taskRunId:"<run>"}], condition="all_settled", timeout_ms=120000)
read_agent(target="<id>", view="result")
```

A child's question ends a settlement wait with `reason: "needs_response"`;
its text is in `messages` (and `openQuestion` in `list_agents`). Answer with
`send_message(target="<child>", mode="note", reply_to="<messageId>", message=...)`
and wait again.

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

The main execution settling records a *candidate*, not success. The managed
reviewer reads the paused workspace and returns one structured decision
through `submit_gate_decision`. Terminal outcomes are `passed`,
`review_limit_reached`, `gate_blocked`, `gate_error`, `candidate_superseded`,
or (explicit governor bypass only) `gate_bypassed`.

## Tests

```sh
nix build .#checks.x86_64-linux.ponygirls-subagents   # tsc + the suite, in the nix sandbox
```

Locally, link `node_modules` as the check does and run
`node --test tests/*.test.ts`. Most tests need no credentials;
`tests/sdk-worker.test.ts` needs `PI_SUBAGENTS_SDK_ROOT` pointing at the
pi 1.0.0 monorepo (deterministic provider; still no network). Live-provider
runs are manual: `pi --no-extensions -e <this dir>/index.ts --model ... -p ...`.
