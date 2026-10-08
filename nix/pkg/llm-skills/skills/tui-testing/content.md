# TUI Testing

Drive the actual interactive executable through a PTY. Observe the rendered
terminal screen, decide the next action, send input, and verify its visible
postcondition. A successful send proves only that input was issued.

## Establish the Scenario

Before launching, record the executable/version, argv, working directory,
configuration/extensions, terminal dimensions, and observable acceptance
criteria. Test the requested configuration, not an arbitrarily stripped-down
replacement. Define a short user journey: open a selector, move focus, choose
an item, dismiss an overlay, edit/paste a multiline prompt, cancel a running
request, resize, scroll, or exit. Read this version's help and keybindings;
Pi, Claude Code, and Codex do not share flags or shortcuts.

Use disposable project/config/session directories by default. A temporary
HOME is not a security boundary: inherited credentials, application-specific
config roots, keychains, network access, and tool permissions remain relevant.
For isolated UI tests, start the child with an explicit environment allowlist
(`env -i`), point its config roots at the fixture, and omit real credentials.
For reproduction with existing config or authenticated/live inference, scope
those capabilities deliberately and protect the resulting artifacts. Do not
log keys, dump the environment, auto-approve tool execution, bypass permission
prompts, or send arbitrary tasks to a nested coding agent. Follow the
`environment` skill before accessing paths outside sandbox grants.

`--help` verifies CLI availability, not the TUI. Pi's `--offline` suppresses
startup network activity; it does not prohibit inference or tool network
access. Inventing a dummy API key does not create a dummy provider. Use a
controlled backend when the scenario requires deterministic streaming or tool
results; explicitly distinguish live-provider failures from UI failures.

## Tool and Isolation Boundary

Home Manager supplies `tui-tmux`, a thin entry point to pinned nixpkgs tmux.
It requires `-S /absolute/socket`, ignores personal tmux configuration on
server startup, and unsets inherited `TMUX`/`TMUX_PANE` for the client. The
child receives the coordinates of its own private server normally.

Inside yolo, `tmux` on PATH may be the clipboard-only proxy. Do not change
that shim, connect to its socket, or expose the host tmux server. Use
`tui-tmux` for every control command. Never issue unqualified `kill-server`,
attach to the user's session, or kill processes by executable name. If the
entry point is missing, build this repository's `tui-tmux` package and invoke
its absolute `bin/tui-tmux` path for this run, or report the missing dependency;
do not scan the Nix store or silently fall back to ambient tmux.

`bash` tool calls do not themselves provide an interactive terminal, and a
background-task PTY is insufficient if its API has no stdin injection. A
private tmux daemon holds the PTY between tool calls; no attached client or
extra MCP server is required. Do not use `--print`, `codex exec`, JSON mode,
RPC, or SDK calls as evidence of interactive behavior.

## Start a Private Terminal

Run setup in Bash. Keep the printed absolute run directory and source its
`control.sh` in **each subsequent tool call**: shell variables/functions do
not persist between calls. The initial sleeping process is only a bootstrap;
configure the terminal and logging before replacing it with the application.
Keep the socket path short: deeply nested TMPDIR paths can exceed the
platform's UNIX-domain socket length limit; use a shorter scratch root then.

```bash
umask 077
run=$(mktemp -d "${TMPDIR:-/tmp}/tui-test.XXXXXX")
printf 'run=%q\n' "$run" > "$run/control.sh"
cat >> "$run/control.sh" <<'BASH'
tm() { tui-tmux -S "$run/server.sock" "$@"; }
wait_screen() {
  local expected=$1 timeout=$2 deadline=$((SECONDS + $2))
  while (( SECONDS < deadline )); do
    tm capture-pane -p -t tui:0.0 > "$run/current.txt" || return 1
    if [[ $(tm display-message -p -t tui:0.0 '#{pane_dead}') == 1 ]]; then
      echo "Application exited; inspect $run/current.txt and pane_dead_status" >&2
      return 1
    fi
    if grep -Fq -- "$expected" "$run/current.txt"; then return 0; fi
    sleep 0.1
  done
  cp "$run/current.txt" "$run/timeout.txt"
  echo "Timeout (${timeout}s) waiting for '$expected'; inspect $run/timeout.txt" >&2
  return 1
}
BASH
source "$run/control.sh"
work=$PWD                         # use the chosen disposable working directory
# Multiple command arguments avoid shell interpolation of application argv.
tm new-session -d -s tui -x 120 -y 40 -c "$work" sleep 86400
tm set-option -g status off
tm set-option -g default-terminal tmux-256color
tm set-option -g extended-keys on
tm set-option -g extended-keys-format csi-u
tm set-option -g remain-on-exit on
tm set-option -g history-limit 10000
tm resize-window -t tui:0 -x 120 -y 40
tm pipe-pane -O -t tui:0.0 "cat >> $(printf '%q' "$run/output.ansi")"
printf '%s\n' "$run"
```

Create an explicit launch script with the chosen environment, argv, and
configuration, then replace the bootstrap:

```bash
source /absolute/run/directory/control.sh
# launch.sh should finish with shell exec so pane exit status is the app's.
tm respawn-pane -k -t tui:0.0 bash --noprofile --norc "$run/launch.sh"
wait_screen 'an app-specific ready indicator' 20
```

Record `tui-tmux -S "$run/server.sock" -V`, the application version, actual
`#{pane_width}x#{pane_height}`, `#{pane_current_command}`, and
`#{pane_key_mode}`. Let tmux set the child's TERM; do not label a tmux PTY as
Kitty/xterm or advertise unsupported graphical capabilities. Use a UTF-8
locale available on the target platform. If a launch step fails, inspect the
retained pane/log, then clean up the private server rather than leaving the
bootstrap alive. Detached servers can survive the calling tool's exit.

## Observe, Act, Verify

Take a fresh capture before each decision and after each transition:

```bash
tm capture-pane -p -t tui:0.0                   # current visible screen
# Preserve rows and trailing spaces for geometry assertions; do not use -J.
tm capture-pane -p -N -t tui:0.0 > "$run/screen.txt"
tm capture-pane -p -e -t tui:0.0 > "$run/screen.ansi"
tm display-message -p -t tui:0.0 \
  'size=#{pane_width}x#{pane_height} cursor=#{cursor_x},#{cursor_y} dead=#{pane_dead} status=#{pane_dead_status} keymode=#{pane_key_mode}'
```

Cursor coordinates are zero-based. `capture-pane` returns the currently
rendered screen even while the application is in the alternate screen.
Do not routinely add `-a`: it selects the *other* screen buffer, not
"the fullscreen screenshot". `-S -` includes tmux history for diagnostics,
but application-owned fullscreen scrollback must be scrolled through the UI.
Text capture already interprets cursor movement and erase sequences;
stripping ANSI from a raw log does not reconstruct a screen. `-e` is a styled
screen serialization, not the original byte stream. `output.ansi` records
child output from the pipe's installation, not your input actions; keep a
separate action transcript.

### Input

```bash
tm send-keys -t tui:0.0 -l -- 'literal text, not key names'
tm send-keys -t tui:0.0 Enter
tm send-keys -t tui:0.0 Down              # similarly Up, Left, Right
tm send-keys -t tui:0.0 Tab               # BTab for Shift+Tab
tm send-keys -t tui:0.0 Escape
tm send-keys -t tui:0.0 C-c               # app-specific cancel semantics
tm send-keys -t tui:0.0 S-Enter           # verify negotiated extended keys
tm send-keys -t tui:0.0 M-Enter           # Alt+Enter, if bound by this app
```

Keep text and named keys in separate commands. `-l` disables key-name lookup;
it does not provide bracketed-paste semantics. Wait for and inspect the
result of each meaningful action; do not queue a blind chain of keystrokes.
In particular, verify an overlay closed after Escape before sending text:
immediate Escape+text can be parsed as an Alt-modified key.
Sending `S-Enter` successfully is not proof it differed from Enter: verify
that a newline appeared without submission. CSI-u requires appropriate
application negotiation (`extended-keys on`, `extended-keys-format csi-u`).

For multiline/large input, write a fixture file, load a named buffer on the
private server, and paste without submitting:

```bash
tm load-buffer -b test-input "$run/input.txt"
tm paste-buffer -p -r -d -b test-input -t tui:0.0
# Inspect the editor contents before a separate Enter to submit.
```

`-p` wraps the payload in bracketed-paste codes **only if the app requested
that mode**. `-r` preserves LF rather than converting it to CR. Check the
visible result; if the app has not enabled bracketed paste, multiline input
may trigger actions. Do not use paste to test individual typing events.

For a protocol-specific test, `send-keys -H` can inject exact bytes. This
bypasses terminal negotiation/translation: label it an app-parser test, not
proof that a physical terminal produces those bytes. Example SGR mouse press
and release at column 10, row 5 (coordinates one-based) after verifying the
app enabled SGR mouse reporting:

```bash
tm send-keys -t tui:0.0 -H 1b 5b 3c 30 3b 31 30 3b 35 4d
tm send-keys -t tui:0.0 -H 1b 5b 3c 30 3b 31 30 3b 35 6d
# Wheel-up at the same position uses button 64: ESC [ < 64 ; 10 ; 5 M.
```

Use coordinates from a fresh capture. Clicks, focus-in/out sequences, and
wheel events must be asserted by their visible effects, not merely accepted
input. Do not confuse tmux copy-mode scrolling with application scrolling.

### Wait for a Postcondition, Not Silence

Use bounded polling against an explicit visible state. `wait_screen` above
is a simple literal-text example, not a universal completion detector. Refine
it for the application and scenario: a selected row, overlay title plus
focus/highlight, error dialog, completed response with the editor ready, or
pane exit with a known status. Match a relevant screen region when text
already occurs in the transcript or editor. Typed/echoed prompts must not
satisfy response assertions.

An unchanged screen, two identical captures, an idle interval, or a missing
spinner is at most a heuristic. API waits can be silent and animations can
continue after completion. Short sleeps between bounded observations are
polling cadence, not evidence of readiness. On timeout or premature exit,
retain the last screen, cursor/status, log, and action transcript and report
exactly what was not observed. Do not retry an action that may already have
executed without checking current state.

### Resize and Layout

```bash
tm resize-window -t tui:0 -x 80 -y 24
# Wait for the app to redraw, then inspect screen and actual pane dimensions.
tm resize-window -t tui:0 -x 120 -y 40
```

Resizing the private window changes PTY size and delivers SIGWINCH. Do not
fake a resize by changing COLUMNS/LINES. Check prompt/focus preservation,
overlay clipping, selected item, wrapping, wide/combining Unicode, and cursor
placement after both shrinking and growing, as relevant to the requested
scenario. Report terminal cells, not string length, for geometry.

## Agent CLI Scenarios

For Pi, read the installed CLI/terminal/keybinding documentation. Use the
interactive mode, with `PI_CODING_AGENT_DIR` pointing at the chosen fixture;
`--no-session` avoids persistent conversations, and `--tui-mode fullscreen`
versus `regular` is a deliberate test dimension. `PI_TUI_WRITE_LOG` is an
optional Pi-specific raw-output diagnostic. `--no-extensions`, `--no-skills`,
and `--no-context-files` are isolation controls, not defaults when testing
those features. Exercise `/settings` or `/model` only after confirming that
this version offers them, then navigate and inspect the actual dialog.

For Claude Code and Codex, inspect the installed `--help` and current config
and shortcut documentation. Choose their supported config-root mechanisms
and sandbox/approval policy explicitly. Do not assume Pi's `--offline` or
`--no-session` flags exist. Authentication/onboarding and project-trust
prompts are observable states, not permission to dismiss them blindly. Test
editing/navigation without submitting an inference request when possible;
for generation, require an app-specific completion condition and a bounded
live-test scope. Do not replace the journey with `claude -p` or `codex exec`.

## Finish and Report

Try the app's normal quit action and wait for `#{pane_dead}=1`; inspect
`#{pane_dead_status}` (a signal may instead appear as `#{pane_dead_signal}`).
Retain screenshots before exit: leaving the alternate screen may restore the
bootstrap screen. A forced private-server teardown is cleanup, not a passing
clean-exit assertion. Then terminate **only this run's** server:

```bash
tm kill-server
```

For one-shot scripts use a trap; for multi-call exploration keep the daemon
alive until the journey finishes and clean it up explicitly on failure.
Verify the socket no longer accepts control commands. If an app leaves
background tools, track and clean up only run-owned processes; killing the
pane is not proof all descendants exited. Keep artifacts needed for a defect
report under a task-specific project `debug/` directory before sandbox
`/tmp` disappears; delete only this run's scratch directory when safe.

Report scenarios exercised, versions/config, input actions, observed versus
expected states, exit/cleanup results, and untested capabilities. tmux covers
real keyboard/PTY/cell rendering, not the user's font rasterization, IME,
clipboard integration, image protocols, physical mouse transport, or terminal
emulator-specific behavior. Use the target graphical terminal when those
are acceptance criteria; never claim pixel-level visual verification from a
text capture. Headless tests may complement this work but do not replace it.

## References

- Pinned tmux manual: `man tmux` (or the package's `share/man/man1/tmux.1.gz`);
  [upstream manual](https://github.com/tmux/tmux/blob/3.7c/tmux.1):
  `new-session`, `respawn-pane`, `capture-pane`, `send-keys`, `paste-buffer`,
  `pipe-pane`, `resize-window`, extended keys, and pane formats.
- [Pi terminal setup](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/terminal-setup.md)
  and [tmux keys](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tmux.md);
  prefer the installed version's docs and `/hotkeys`.
- [Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode)
  and [Codex CLI reference](https://developers.openai.com/codex/cli/reference).

Reviewed alternatives: [tui-use](https://github.com/onesuper/tui-use)
(node-pty/xterm plus a daemon), [agent-tui](https://github.com/ConductorOne/agent-tui)
(terminal engines, semantic adapters, snapshots/MCP), and
[mcp-tui-test](https://github.com/GeorgePearse/mcp-tui-test) (pexpect/pyte/MCP).
They can add higher-level APIs, but are not dependencies of this tmux workflow.
Screen-derived semantic adapters are still observations with version-specific
assumptions, not access to the application's internal truth.
