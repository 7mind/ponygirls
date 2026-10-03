# Legacy cq prompt instructions. Not installed (see default.nix). cq4 is not wired yet.

## Chaining cq commands inline
Pi expands a prompt template only when the slash command enters through user
input. Pi does not recursively expand a `/cq:*` command name embedded in an
already-expanded prompt.

When an executing cq prompt says to run another `/cq:*` command **INLINE**:
1. Convert the invocation to its prompt-catalog role id: remove the `/cq:`
   prefix and replace each remaining `:` with `/`.
2. Call the ledger MCP `fetch_prompt` capability for that role id (as a direct
   `mcp__ledger__fetch_prompt` tool, loading it with `tool_search` first when it
   is not yet declared), and require
   `kind: "orchestrator-command"` with `dispatched: false`.
3. Substitute any text following the invocation for `$ARGUMENTS`, then execute
   the returned `promptTemplate` INLINE in this same parent session before
   resuming the caller. Preserve the caller's chained context, including any
   instruction to suppress the nested command's standalone handoff.

The `/cq:advance` sub-flow mappings are:
- `/cq:investigate:advance` → `fetch_prompt("investigate/advance")`
- `/cq:plan:advance` → `fetch_prompt("plan/advance")`
- `/cq:research:advance` → `fetch_prompt("research/advance")`
- `/cq:implement:advance` → `fetch_prompt("implement/advance")`

Do NOT infer or re-implement the nested command from its name, and do not send
an orchestrator-command role to `dispatch_agent`. If `fetch_prompt` is
unavailable or fails, report the composition failure and stop before performing
the nested flow's ledger mutations in the parent.

## Dispatching cq subagents
The shared cq command prompts speak a harness-agnostic named-agent + task
convention: they say things like "dispatch via the Agent tool with
subagent_type: \"<agent-name>\"", "launch the <name> subagent with <task>",
or "dispatch the <name> subagent with this task: …" (sometimes adding
`+ isolation: \"worktree\"`). In this harness that convention maps onto the
registered `dispatch_agent` tool.

When a cq command instructs you to dispatch / launch a named subagent with a
task — for example "dispatch the investigate-explorer subagent with this
task: …", "launch the plan-reviewer subagent", or "subagent_type:
plan-reviewer" — CALL the `dispatch_agent` tool rather than answering in
prose:

    dispatch_agent({ agent: "<name>", task: "<the task>", targetRef: "<canonical-ref>" })

and add `isolation: "worktree"` when the prompt asks for worktree isolation:

    dispatch_agent({ agent: "<name>", task: "<the task>", targetRef: "<canonical-ref>", isolation: "worktree" })

Rules:
- `agent` is the cq agent name / `subagent_type` named in the prompt (e.g.
  `investigate-explorer`, `plan-reviewer`); `task` is the task text the prompt
  hands you. `targetRef` is the exact canonical ledger item being dispatched:
  `tasks:T<n>`, `goals:G<n>`, `defects:D<n>`, or `researches:RS<n>`; use the
  owning flow item, never a child hypothesis id.
  `isolation` is optional and only `"worktree"` is recognized.
- Emit the tool CALL — do not describe, paraphrase, or simulate the dispatch
  in prose. The whole point of the convention is that you actually fire the
  tool.
- If YOU are the dispatched child and your rubric defines a `verdict` field,
  emit the EXACT canonical enum literal — no paraphrase or synonym.
  `verdict` is a CLOSED enum, not free text:
  - plan-review: exactly `go-ahead` or `revise`
  - implement-review: exactly `approve` or `disapprove`
  The orchestrator drops any off-enum value as an abstention. Never emit
  `fail`, `pass`, `ok`, `reject`, or any other synonym.
- You cannot re-dispatch from within a child: a dispatched agent runs as an
  isolated child turn with `dispatch_agent` excluded, so if you ARE that child
  you do the task yourself instead of trying to dispatch again.
