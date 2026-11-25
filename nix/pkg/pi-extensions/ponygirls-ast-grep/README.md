# Pi structural search with ast-grep

`ast_grep_search` matches syntax without creating an index. Use it for things
like calls with a certain argument or nested expressions. Use CodeGraph for
symbols and call paths, and `grep` for text, comments, or a cross-check. An
ast-grep hit does not resolve a symbol; a zero is not proof of no usages.

```json
{"lang":"ts","pattern":"pi.registerTool($$$ARGS)","path":"nix/pkg/pi-extensions"}
```

For a qualified Go call, include the function body context and select the call
node. A bare `pkg.Name($$$ARGS)` can parse as a type conversion and miss real calls:

```json
{"lang":"go","pattern":"func t() { pkg.Name($$$ARGS) }","selector":"call_expression","path":"internal"}
```

`path` defaults to the caller's working directory. Relative paths start there;
absolute paths must resolve within the same checkout (or the working directory
outside Git). Recursive scans skip hidden paths and respect ast-grep ignore
rules even for tracked files. Use `git grep` to cross-check tracked text that
an ignore rule or hidden path might conceal. The tool excludes `.git`,
`.codegraph`, and `.worktrees`, and does not follow directory symlinks during
traversal. Inside Git it also excludes other registered linked worktrees under
the search path; outside Git there is no worktree lookup. It does not load a
project's `sgconfig.yml` or custom native grammars. Use `python` for `.bzl` and
`BUILD.bazel`, and select `ts` and `tsx` separately. If zero files were scanned,
check the path, language and ignore rules. A nonzero scan count still doesn't
prove every file matched the chosen grammar: try the pattern on a known
positive file and check the parsed pattern.

The tool returns at most 40 concise `file:line:column` hits within a 12 KiB
hit budget. If capped, the displayed subset depends on CLI arrival order and
can vary across runs. Paths are relative to the caller's cwd; lines and Unicode
code-point columns are one-based. It stops at a 15s scan deadline or a
1 MiB CLI output limit and reports an incomplete scan separately from a zero.
There is no background process, rewrite, outline, or custom rule support.

Home Manager (`nix/hm/pi.nix`) loads the extension independently of CodeGraph
and sets `PONYGIRLS_AST_GREP_BIN` and `PONYGIRLS_AST_GREP_GIT_BIN` to pinned
executables. For a local trial, `pi -e ./nix/pkg/pi-extensions/ponygirls-ast-grep/index.ts`
loads it; set those paths or put `ast-grep` (not `sg`) and `git` on PATH. The tool is not granted to
subagents by default. Explicitly allowlisted host subagents search from their
own working directories. Sandboxed subagents and gate reviewers do not get the
tool. The path checks do not replace OS-level isolation.

Check against the pinned Pi SDK, ast-grep and a real Git worktree:

```sh
nix build --no-link -L .#checks.x86_64-linux.ponygirls-ast-grep
```
