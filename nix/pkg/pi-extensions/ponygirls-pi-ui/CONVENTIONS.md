# Interface conventions

Rules for every pane, badge, transcript line and command-line tool in this
repository. They exist so the tools read as one product. `@ponygirls/pi-ui`
implements the pane parts; use it instead of formatting by hand.

## Panes

- **Identity survives narrowing.** When the terminal is too narrow, drop or
  shrink secondary columns. Never drop or squeeze the column that says *which*
  row this is (provider, model, agent, task) or *how it is doing* (state).
- **Never clip a column.** A cell is shown whole or its column is dropped; no
  `│...`. Name what was dropped on a dim line: `hidden at this width: Login, Plan`.
- **State before provenance.** First line or column answers "is it on, is it
  working". Where a value comes from (default, global, file path) follows.
- **Zeros stay quiet.** Zero in a table is a dim `·`. A status line lists what
  is non-zero; "none this session" replaces a row of `x: 0`.
- **Colour means state, nothing else**: `stateColor` — ok, running, attention
  (needs the user), error, settled. Secondary text is `muted`; structure
  (rules, headers, separators) is `dim`.
- **Numbers**: counts `formatCount` (`115,173`); token and other large amounts
  `formatCompact` (`12.3k`, `8.7M`, `1.24B`); money with thousands separators
  (`$12,840`); durations `3s`, `2m14s`, `1h05m`; past times relative
  (`formatAgo`: `2m ago`, `3h 5m ago`) with the absolute time in the detail;
  sizes `formatBytes` (`307 MiB`); paths `homeRelative` (`~/…`); long ids
  `shortId` (8 characters) unless the user has to copy them.
- **No standing disclaimers.** Explain a limitation where it applies (an
  untrusted project, a failed write), not on every render.
- **Empty state**: one sentence that says how to get content
  (`No goal. /goal <objective> sets one.`).

## Key hints

- Built with `keyHints` from `KEY`, `HINT` and `ctrlKey`: `esc`, `tab`,
  `space`, `⏎`, `↑↓`, `←→`, `PgUp/PgDn`, `^S`.
- `esc` closes a pane or goes back one level, everywhere.
- The action names what pressing the key does (`m hide models`), not the mode
  the pane is in.
- Show only keys that apply to the current selection and state.
- Aliases (`q`, `j`/`k`, Home/End) may stay bound; they are not advertised.

## Commands

- Description: what the command is for, at most 60 characters, no syntax.
- Syntax lives in argument completion (`completeArgument`).
- A command with no arguments shows its pane or status, not its help.

## Badges

- One place per badge: `BORDER_ORDER`, passed as `setWidget`'s `order`.
- Use `borderBadge` for the padded form. At 120 editor columns or more it
  uses a theme background and can show extra detail and an existing shortcut.
  Below that width it keeps the plain form. Provide `borderBadgeCompact` for
  tight slots at any width; Pi can then drop wide details instead of clipping
  a label or key hint.

## Transcript

- One line per event the user cares about; detail expands with ctrl+o.
- Bookkeeping that changes nothing visible is not rendered.
- A notice starts a model turn only when the model can act on it.

## Command-line tools

- `--help` and `-h` print to stdout and exit 0 before any credential,
  network or environment check.
- Usage errors: exit 2, one stderr line `tool: what is wrong`, then
  `Try 'tool --help'.`
- Arguments are validated before any side effect.
- Text for people by default; `--json` for programs; diagnostics on stderr.
- Tables follow the pane rules above: identity and state columns stay.
