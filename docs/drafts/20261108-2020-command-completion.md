# Pi extension command completion audit

Scope: every `registerCommand` in `nix/pkg/pi-extensions` and
`nix/pkg/pi-search-hub/src/extensions`. Pi completes registered command names;
argument completers receive and replace the entire argument prefix.

## Inventory

| Commands | Argument contract | Result |
| --- | --- | --- |
| `/agents`, `/bg` | No arguments; inspectors | No artificial argument suggestions |
| `/search-setup`, `/search-status`, `/websearch` | No arguments; configuration/status/dashboard | No artificial argument suggestions |
| `/tokemon`, `/perf`, `/usage`, `/pick-model`, `/pick-thinking` | No arguments; reports/pickers | No artificial argument suggestions |
| `/fast` | Toggle actions | Existing token completer and regression suite |
| `/historian` | Toggles, defaults, model selection, free-text focus | Existing grammar-aware completer and regression suite |
| `/goal` | Actions, optional token budget, free-text objective | Share budget validation with parser; test accepted numeric spellings and safe-integer limits |
| `/cg` | Actions, flags, directory paths | Serialize option-like/quoted directory names safely; complete quoted paths and explicit `--` paths |
| `/decisions` | Actions, filters, question IDs | Complete nested defaults while retaining question suggestions and static actions during storage outages |
| `/cuckoo` | Toggles, policy, thresholds, reports | Complete nested policy units/defaults without inserting arbitrary numeric values |
| `/context-archive` | Toggles, threshold pairs, defaults | Complete nested defaults and session inheritance without inserting arbitrary threshold pairs |

The no-argument inventory was independently inspected by the controls/search
workers. Queries inside `/websearch` belong to its dashboard, not its slash
arguments. Completion must not execute commands, request credentials, perform
network calls, or invent numbers/objectives.

## Reproductions and verification

- `/cg use ` with a directory named `"demo` emitted malformed JSON; directory
  names beginning `--` were also inserted as unsupported options. A behavioral
  parser/completer regression failed with `SyntaxError` before the correction.
- `/goal --tokens 040000 ` returned no continuations although the parser accepted
  that budget; unsafe integers could receive continuations. The new regression
  failed with `actual: null` before shared parser validation was used.
- Controls worker reproduced all three nested-completion regressions before fixing
  them; its affected suites passed 245 tests. A separate read-only review found no
  substantive defects in those corrections.
- A separate review identified leading-whitespace directory names in `/cg`:
  `use  app/` selected the wrong path. The added round-trip test failed before
  leading-whitespace paths were quoted, then passed.

## Final validation

Source: task branch based on `14f9827e`, including controls commit `d6bab1e9`.
Node v24.21.0; TypeScript 7.0.2; installed pinned Pi SDK v1.4.0. Ignored
`node_modules` links point at that SDK and locally compiled shared UI/settings.

- `tsc -p nix/pkg/pi-extensions/EXT/tsconfig.json` passed for each of
  `ponygirls-codegraph`, `ponygirls-codex-goals`, `ponygirls-decisions`,
  `ponygirls-cuckoo`, and `ponygirls-context-archive`.
- One unfiltered `node --test` invocation covered all tests in those five
  extensions, plus `ponygirls-openai-fast.test.mjs` and historian's
  `tests/completion.test.mjs`: **436 tests, 436 passed, 0 failed, 0 skipped**.
  Host SDK variables were explicitly bound to the pinned SDK. Initial local
  setup attempts exposed missing dependency links/SDK environment variables;
  these were supplied before the successful integrated run, not skipped.
- Real PTY: Pi 1.4.0, private tmux 3.8 server, 120×40, extended keys, isolated
  HOME/agent directory, no credentials, offline, no sessions/MCP/tools invoked.
  Loaded all five changed extensions from the integrated worktree. Menus rendered
  and Tab inserted complete prefixes for `/cuckoo default policy win`,
  `/context-archive default th`, `/decisions default o`,
  `/goal --tokens 040000 res`, and `/cg use "app`. The last inserted
  `/cg use "app space/"`. No command or inference was submitted. Pi exited
  normally with status 0; the private tmux server was removed and its socket
  rejected subsequent control. This verifies terminal cells, not graphical IME
  or physical terminal-emulator behavior.
- `git diff --check` passed.

The skill-candidate analysis found no useful new pattern beyond existing
contract-testing skills. No draft was manufactured. Haystack overlap checking
was unavailable to that worker; no persisted-memory write is claimed.
