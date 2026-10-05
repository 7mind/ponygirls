# pi-subagents

Supervisor/worker subagents for pi 1.0.0: durable asynchronous delegation
with inspectable progress, attributed messages, interruption, resumption,
bounded nesting, and an optional reviewer/fixer validation gate.

One supervisor owns the governing pi session. Each resident child runs in a
separate SDK worker process with a native pi session, reached over a private
validated IPC protocol. All child tools execute through a supervisor-owned
broker with an OS sandbox (Linux bubblewrap) for generated commands.
Writers receive separate Git worktrees; readers receive read-only views.
A single TUI inspector (`/agents`) and seven core tools plus `manage_gate`
share the same controller methods.

## Status

Initial scope per `subagents-plan.md` (repository root): all twelve
milestones implemented; deterministic + real integration tests green.
See `docs/progress.md` for the verification log and `docs/pi-subagents.md`
for supported versions, recovery diagnostics, and genuine limitations.

## Layout

- `index.ts` — thin extension registration (tools, `/agents`, events)
- `src/types.ts`, `src/errors.ts` — domain identities, frozen error codes
- `src/protocol.ts` — versioned IPC envelopes, ownership/fencing validation
- `src/policy.ts` — root authority, grant intersection, fixed profiles
- `src/scheduler.ts` — atomic admission leases, canonical path registry
- `src/store.ts` — durable root store (file journal + in-memory contract pair)
- `src/broker.ts` — supervisor-owned tool brokering, approvals, owned jobs
- `src/sandbox.ts` — bubblewrap tool backend (+ dummy contract pair)
- `src/workspace.ts` — Git worktree manager (+ dummy contract pair)
- `src/supervisor.ts` — tree, policy, scheduler, journal, recovery, gates host
- `src/worker.ts` — SDK worker process (native child session, proxy tools)
- `src/worker-launch.ts` — supervisor-side transport (fork, handshake, guard)
- `src/gate.ts` — optional validation gate controller + decision schema
- `src/ui.ts` — widget, headless projection, tree inspector, sanitization
- `src/deterministic.ts` — scripted provider for credential-free tests
- `tests/` — behavioral/contract suites (`node --test`), dual-test pairs,
  deterministic provider tests, real SDK/filesystem/IPC/Git/sandbox checks

## Configure

Root authority is explicit. Writers require a registered repository in
`~/.pi/agent/subagents-policy.json`:

```json
{
  "maxDepth": 1,
  "repos": [
    {
      "repoId": "myrepo",
      "checkoutPath": "/home/user/src/myrepo",
      "readRoots": ["/home/user/src/myrepo"],
      "allowWriters": true
    }
  ],
  "allowedModels": [{ "provider": "openai", "id": "gpt-5" }],
  "gateBypassAllowed": false,
  "gateMaxRoundsCeiling": 3
}
```

Without registered repositories, readers work and writer spawns are denied
(`POLICY_DENIED`) — fail closed, never an unrestricted fallback.

Provider credentials stay in `~/.pi/agent/auth.json`. Workers open that
store live through `PI_SUBAGENTS_HOST_AGENT_DIR` (set automatically by the
extension); `auth.json` is never copied into worktrees or tool environments.

## Ungated example

```text
spawn_agent(task_name="triage", message="Summarize open defects in <repo> (read-only).", profile="reader", repo_id="myrepo")
list_agents()
wait_agent(targets=[{agentId:"<id>", taskRunId:"<run>"}], condition="all_settled", timeout_ms=120000)
read_agent(target="<id>", view="result")
```

## Gated example

```text
spawn_agent(task_name="parser", message="Implement empty-input handling per SPEC.md.", profile="writer",
  repo_id="myrepo", base_commit="a1b2c3d",
  gate={model:{provider:"openai", id:"gpt-5"}, thinkingLevel:"high",
        prompt:"Require the empty-input case with check evidence.", maxRounds:3})
```

The main execution settling records a *candidate*, not success. The managed
reviewer reads the paused worktree and returns one structured decision
through `submit_gate_decision`. Terminal outcomes are `passed`,
`review_limit_reached`, `gate_blocked`, `gate_error`, `candidate_superseded`,
or (explicit governor bypass only) `gate_bypassed`.

## Tests

```sh
node --test tests/*.test.ts
```

Most tests run without credentials. `tests/sdk-worker.test.ts` needs
`PI_SUBAGENTS_SDK_ROOT` pointing at the pi 1.0.0 monorepo (deterministic
provider; still no network). Live-provider tests are opt-in and not
included: set up credentials and drive the tools manually.
