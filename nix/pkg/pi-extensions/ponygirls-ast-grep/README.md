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
outside Git). A recursive scan selects files by name for the language and
respects ast-grep ignore rules, even for files Git tracks. It scans hidden
files but skips hidden directories such as `.github`; name one as `path` to
search it. It follows no symlinks. Use `git grep` to cross-check text that an
ignore rule or a hidden directory might conceal. The tool always excludes
`.git`, `.codegraph` and `.worktrees`. Inside Git it also excludes other
registered linked worktrees under the search path; outside Git there is no
worktree lookup. It does not load a project's `sgconfig.yml` or custom native
grammars.

ast-grep takes a file's language from its name, also for a file named as
`path`: `python` covers `.py`, `.pyi`, `.bzl` and `*.bazel` but not a plain
`BUILD`, and `ts` and `tsx` are separate languages. The result says when
nothing was searched: no file selected, files that ast-grep skipped unread
(empty, unreadable, not UTF-8 or too large; a named file gets ast-grep's
reason), or a named file whose name belongs to another language or to none.
Otherwise an empty result shows how the pattern parsed and, for a one-line
pattern, flags an `ERROR` node inside it; an unclosed bracket is not detected.
A pattern that parses still says nothing about files with syntax errors: try
it on a known positive file.

The tool returns at most 40 concise `file:line:column` hits within a 12 KiB
hit budget. If capped, the displayed subset depends on CLI arrival order and
can vary across runs. Paths are relative to the caller's cwd; lines and Unicode
code-point columns are one-based. A scan stops at a 15 s deadline or a 1 MiB
CLI output limit. Hits found before that are returned and marked incomplete,
never as a zero. One file can exhaust the deadline: the Python grammar is very
slow on thousands of consecutive comment lines.
There is no background process, rewrite, outline, or custom rule support. The
tool writes nothing in the checkout. To learn whether a file name belongs to a
language it asks ast-grep about an empty file of that name, which it creates
in the OS temp directory and removes again.

Home Manager (`nix/hm/pi.nix`) loads the extension independently of CodeGraph
and sets `PONYGIRLS_AST_GREP_BIN` and `PONYGIRLS_AST_GREP_GIT_BIN` to pinned
executables. For a local trial, `pi -e ./nix/pkg/pi-extensions/ponygirls-ast-grep/index.ts`
loads it; set those paths or put `ast-grep` (not `sg`) and `git` on PATH.

Home Manager also grants the tool to subagents by default
(`smind.hm.dev.llm.pi.subagentsAllowedTools`). A subagent's call runs in the
governing session but searches from the subagent's own working directory, in
Git or outside it. Sandboxed subagents and gate reviewers never receive
delegated tools, so they do not get this one. The path checks do not replace
OS-level isolation.

Check against the pinned Pi SDK, ast-grep, real Git worktrees and the subagents
extension's dispatcher:

```sh
nix build --no-link -L .#checks.x86_64-linux.ponygirls-ast-grep
```
