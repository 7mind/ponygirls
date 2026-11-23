# Archeologist

`/archeologist` shows the main context files and configures five independent switches. Each defaults to **off**. Pi still loads its normal startup instructions. In the pane, choose Session, Project or Global, stage a change with Space, remove a local override with `r`, and save with Ctrl+S. Session overrides take precedence over trusted project preferences, then global preferences, Home Manager defaults, and finally off.

- **Main: auto-discover nested AGENTS.md** adds applicable rules after a successful stock `read`, `write`, `edit`, `grep`, `find` or `ls` below the session cwd. This includes individual calls in builtin codemode. It records the directory identity when Pi reports a successful tool result, and skips a directory that has since moved or been replaced. It does not scan shell commands, change tool output or stop a first write. Snapshots are offered on the next model request, not as additional turns. Disabling the switch stops this projection. Re-enabling it restores snapshots on the current branch, with their original text even after compaction or a disk edit.
- **Subagents: auto-discover nested AGENTS.md** applies on successful native file access by ordinary subagents.
- **Subagents: worktree AGENTS.md** loads rules from the actual checkout root through the working directory and allows named instruction files in that directory tree.
- **Subagents: project AGENTS.md** passes project rules already held by the direct parent.
- **Subagents: global AGENTS.md** passes the operator's Pi agent-directory rule, or the direct parent's snapshot of it for nested subagents.

Each visited directory contributes at most one automatic rule, in Pi's own filename order. Explicit subagent skill/context selections remain available with all switches off. Subagents retain admitted snapshots; descendants cannot enlarge automatic grants beyond their direct parent's. Reviewers do not discover rules.

Enter on the subagent files list to inspect the paths per recipient. Shared paths count once in the aggregate. The pane includes closed ordinary subagents in this root session. “History incomplete” means some installation or delivery evidence is unavailable; known files still appear. Neither inventory is a provider audit. `/agents` remains the subagent inspector. Without `ponygirls-subagents`, the main switch works and the other four controls are unavailable.

Global preferences live in `archeologist.json` under Pi's agent directory. Project preferences use `<cwd>/.pi/archeologist.json` and require both active trust and a saved positive decision for the project or an ancestor. Session values are non-model session entries. `smind.hm.dev.llm.pi.archeologist.{mainNested,nested,worktree,parent,global}` supplies overridable boolean defaults via `archeologist-defaults.json`; yolo shares only the defaults, not mutable preferences.
