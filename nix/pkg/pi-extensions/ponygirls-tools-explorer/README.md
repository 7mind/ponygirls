# Pi tools explorer

`/tools` opens a pane over every tool the session has registered: pi's own
tools, extension and package tools, and MCP tools, whether the model has them
or not. For each tool it shows the state, the source, an estimate of what the
definition costs in context, the description and the parameter schema, and it
can load a tool into the session or unload it. The extension registers no tool
for the model and adds nothing to the prompt.

`/tools <words>` opens the pane with a filter. Outside the terminal UI the
command answers with text: a line per source, or with words a line per
matching tool. An RPC client gets it as a notification. A print or JSON run
gets it on stderr, because pi keeps stdout for the model's answer there.

## The list

```
── Tools   all 142   active 31   inactive 111  ───────────── ~11.8k tok active · 1.2% of 1M ──
  TOOL                      STATE       TOKENS  DESCRIPTION
  built-in  7 tools · 4 active · ~836 of ~1.4k tok
▌ bash                      ● active      ~160  Execute a bash command in the current working…
  grep                      ○ off         ~288  Search file contents for a pattern. Returns m…
  mcp · linear  84 tools · none active · ~29.3k tok if loaded
  mcp__linear__save_issue   ○ deferred   ~2.3k  Create or update a Linear issue. If `id` is p…
```

| State | Meaning |
|---|---|
| `● active` | In pi's active tool set: declared to the model, from the next request on if it was just loaded. |
| `◐ indirect` | Active, but another tool keeps its declaration out of requests (pi's `hiddenDeclarations`). Not counted in the totals. |
| `○ deferred` | Registered, not declared; the model can load it with `tool_search`. |
| `○ codemode` | Registered, not declared; callable from codemode scripts. |
| `○ off` | A directly exposed tool that is not active, such as `grep` by default. |
| `– hidden` | Registered with exposure `hidden`: pi never activates it. |

A source is pi itself (`built-in`), an extension (its file or directory name),
a package, or an MCP server (`mcp · <server>`). The title counts the active
tools and gives their share of the current model's context window.

- `↑↓`, `PgUp/PgDn`, Home/End and the wheel move the selection; `⏎` opens the tool.
- `tab` cycles all, active and inactive tools.
- `s` cycles the order: by source (with a heading and subtotal per source), by
  estimated tokens, by name.
- `/` filters while you type: every word has to occur in the name, the source
  or the description. `⏎` keeps the filter; `esc` clears it and then closes.
- `l` loads the selected tool, `u` unloads it.

A pane too narrow for all columns drops the description, then the source,
then the estimate, and names what it dropped.

## One tool

The detail view states whether the model has the tool, where it comes from
(with the path pi recorded), the estimate and its two parts, and the hints its
author declared (read-only, destructive, idempotent, open world; unverified).
Below that are the description, the lines the tool adds to the system prompt,
and its parameters with type, description and a `*` for required ones.
Parameters that are a union of object shapes are listed shape by shape.
`v` switches to the declaration as JSON, the text the estimate measures. `←→`
step to the previous or next tool of the list.

A tool that is declared is shown as the model has it. When that differs from
the registered definition (a tool's `prepareLoadout` can rewrite
descriptions), the view says so.

## Loading and unloading

`l` adds the tool to pi's active set and `u` removes it, with the call
`tool_search` uses to load a deferred tool (`pi.setActiveTools`). Any tool can
be switched except a hidden one. The change takes effect with the next
request, which also records it in the transcript; a resumed session starts
with the tools its transcript declares (observed with `pi --continue`).

pi ignores an activation it does not allow, for example an MCP tool that the
session's `--tools` list does not match. The pane reads the result back and
says when nothing changed. Tools that `--tools` or `--exclude-tools` keep out
of the session are not registered and therefore not listed.

Measured with pi 1.5.2 and claude-haiku-5-5: loading or unloading a tool
between two requests left the 22k-token prefix in the provider's prompt cache;
only the change was written anew. With gpt-6.2 the provider reported no cache
reads even for an unchanged conversation, so the same check says nothing
there.

## Token estimates

pi has no tokenizer and no per-tool token count. The explorer estimates a
tool's cost as the characters of its declaration (`name`, `description` and
`parameters` as JSON) plus the characters of the lines it adds to the system
prompt, each divided by a characters-per-token ratio. Figures carry a `~`.

Providers count the same declarations very differently: Claude models report
about twice as many tokens for them as GPT models. `src/tokens.ts` holds
ratios for these two model families, recognized by the model's id under any
provider, and falls back to pi's own rule of 4 characters per token for every
other model. The detail view and the text summary say which basis is in use.

| Model family | Declarations | Prompt lines | Measured on |
|---|---|---|---|
| Claude (`claude-*`) | 2.7 (2.64 to 2.77) | 3.1 (3.06 to 3.10) | claude-haiku-5-5, claude-fable-5-2 |
| GPT (`gpt-<digit>*`) | 5.4 (5.30 to 5.48) | 5.0 (4.97 to 5.00) | gpt-6.2 |
| any other | 4 | 4 | pi's rule, not measured |

The ranges are what different samples of real declarations gave on 2026-11-27
with pi 1.5.2: four samples for Claude and three for GPT, of 35 to 160 tools
(48,000 to 242,000 characters) each. Other Claude and GPT models use their
family's ratios without having been measured.

To measure a model again:

```sh
node nix/pkg/pi-extensions/ponygirls-tools-explorer/calibration/live-calibration.ts \
  --model ai-gateway-anthropic/claude-haiku-5-5
```

```
Model: ai-gateway-anthropic/claude-haiku-5-5 (anthropic-messages)

              characters  tokens  chars/token  in use  difference
declarations      62,300  23,629         2.64     2.7       -2.3%
prompt lines       4,075   1,331         3.06     3.1       -1.2%

The request without the sample cost the same before and after.
src/tokens.ts has these ratios for Claude models.
```

The script runs `pi` four times with the same one-word request: without the
sample in `calibration/corpus.json`, with its 55 tools declared, with its
prompt lines appended to the system prompt, and without it again. The
differences in the prompt tokens the provider reports are the sample's cost.
It refuses to report when the runs were answered by different models or when
the request without the sample did not cost the same before and after. The
runs use your pi configuration without its MCP servers and send the sample
(tool definitions of pi and of this repository) to the model's provider, up to
about 30,000 tokens in total. `--json` prints the result for programs;
`--pi <path>` names another pi executable.

## Limits

- The estimates are sizes to compare and to plan with, not what a provider
  bills. One tool can be further off than the sample average.
- The estimate is what a tool adds to every request while it is declared.
  Switching a tool that has prompt lines also makes pi send the changed
  `tools` and `rules` sections of the system prompt once more, which the
  estimate does not include.
- The pane reads pi's registry again once a second, so tools of MCP servers
  that connect late appear by themselves. The text summary is taken once and
  can miss them when it runs right after start.
- Unloading a tool in a resumed session, while MCP servers are still
  connecting, also drops the tools pi had yet to restore: pi treats a set that
  deactivates a tool as replacing the restored one (read in pi 1.5.2's
  `setActiveToolsByName`, not tested).
- Tool names, descriptions and schemas are untrusted text. Control and
  bidirectional characters in them are shown as `\uXXXX` escapes.

## Layout and checks

`src/registry.ts` is the port the explorer reads a session through.
`src/pi-registry.ts` implements it over pi's extension API; the tests use an
in-memory registry, and one contract (`tests/registry-contract.ts`) runs
against both, the pi side in a real session of the pinned SDK with a scripted
model. That is where the assumptions about pi are checked: a tool activated
between two requests is declared by the next one and a deactivated one is
dropped, pi's own estimate equals the explorer's under pi's rule, and the
prompt lines are the lines pi renders.

```sh
nix build .#checks.x86_64-linux.ponygirls-tools-explorer -L
```

Home Manager (`nix/hm/pi.nix`) loads the extension. For a local trial,
`./pi-test` runs pi with this checkout's copy.
