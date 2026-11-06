# Pi clicks with tmux selection: isolated prototype

## Result

Feasible on the tested Pi 1.4.0 and tmux 3.8: forward the original mouse press and ordinary clicks to Pi; on the first left-button drag, send focus-out (`ESC [ O`) to cancel Pi's pending renderer gesture, then enter tmux `copy-mode -M`. Wheel-up can similarly enter tmux history.

This is **tmux selection**, not native terminal selection. No Pi code, Home Manager default, live tmux server, or clipboard configuration was changed. `regularMouse` remains opt-in. These files are an experiment, not an enabled integration.

## Why cancellation is required

The regular renderer clears its retained press and multi-click state on focus-out. Forwarding the original press preserves Pi's existing registration, geometry and lifetime checks during a held gesture. Deferring the press until release would bypass those checks.

The negative control enters copy mode without sending focus-out. After a badge drag, an orphan release injected at the application boundary activates the badge. The candidate ignores that release, and the next genuine click works. This is deliberate fault injection, not a claim that tmux normally generates an extra release.

Cancellation does not undo an action already performed on press, and it does not send a component-level cancel callback. Arbitrary custom components with private press state still need assessment. The prototype reserves unmodified drags for selection, not application dragging.

## Binding scope

`candidate.conf` modifies only the isolated server. Its custom path requires all three:

- Explicit pane marker `@pi-selection-test=1`.
- Application mouse reporting active.
- Regular screen (`alternate_on=0`).

Other panes use the tmux 3.8 default bindings. Unmarked-Pi forwarding was exercised; fullscreen and multi-pane crossings were not.

**Do not install the marker globally or leave it on a reused shell pane.** It is not proof that Pi owns the foreground process. A deployable integration needs a Pi-lifetime-bound marker/launcher, preservation of existing user bindings, and tests for process replacement, abnormal exit and pane changes. This prototype deliberately supplies the marker only to its disposable Pi pane.

## Reproduce

The harness pins existing store paths for Pi, `tui-tmux`, and bubblewrap; it does not install dependencies or build Pi. Run from this directory with a fresh output directory each time:

```bash
python3 probe.py --config candidate.conf --out /absolute/project/debug/tmux-selection-new
```

Expected-failure controls (exit 1):

```bash
python3 probe.py --out /absolute/project/debug/tmux-selection-baseline
python3 probe.py --config negative-no-cancel.conf --out /absolute/project/debug/tmux-selection-no-cancel
python3 probe.py --scenario history-resize --out /absolute/project/debug/tmux-selection-history-resize
```

Use a path without shell metacharacters/spaces for these prototype output directories: the two `pipe-pane` commands currently interpolate the path into a shell command.

The harness starts two private tmux servers with disposable HOME, agent directory and working directory. Pi runs in bubblewrap with a private network namespace and an explicit environment allowlist. Its synthetic provider rejects inference. No real credentials or host clipboard are supplied. The existing Nix store and host filesystem are readable; this is network isolation, not a secret-filesystem isolation claim.

The outer server renders the inner attached client's actual visible screen and accepts injected SGR bytes. The inner server performs the routing under test. Sending mouse bytes directly into the Pi pane would bypass that routing and is used only for the explicitly labelled orphan-release fault injection.

Tmux 3.8's inner `capture-pane -M` did not show the scrolled copy-mode viewport in this experiment; the outer renderer avoids that observation error. Mouse actions use fresh rendered coordinates. Startup waits for the real cursor-position query/reply exchange, not merely a visible badge. The fixture's stdin observer only records bytes; it does not consume or modify them.

## Observed acceptance

The final candidate run (`candidate07`, exit 0) exercised:

| Check | Result |
|---|---|
| Normal and post-selection badge toggles | 12 accepted clicks, six open/close pairs |
| Ordinary text selection | Exact `Select this synthetic text` in tmux buffer |
| Clipboard transport | Matching OSC 52 payload captured at the private client boundary |
| Drag beginning on a badge, returning to its origin | No activation |
| Orphan release after takeover | No activation; subsequent genuine click works |
| Unmarked pane | Original application forwarding preserved |
| Registration replaced while press held, at unchanged coordinates | No activation on release |
| Wheel-up and selection from tmux history | Exact `History fixture 62` copied |
| Client resized from 100x30 to 48x18 during a press | Raw release received, no component release/click; subsequent toggles work |
| Unsent draft before the replacement test | Preserved through selection |
| Pi shutdown | Exit 0, alternate/mouse/SGR modes all off |
| Inference | No attempts observed |
| Cleanup | Both private servers no longer accepted connections |

These are one generic badge and synthetic ASCII text, not the seven-extension/native-timer suite. No physical mouse, native clipboard, Unicode-selection, vi-copy-mode, nested SSH, user-specific keybinding, fullscreen or arbitrary-component acceptance is claimed. The client exits with status 1 when its owned server is explicitly shut down; that is separate from Pi's clean exit 0.

Returning a drag to its origin also emitted an **empty OSC 52 clipboard payload**. The final decoder retains it. Badge activation was cancelled; clipboard preservation is not claimed. A terminal honoring the payload could clear its clipboard. No physical clipboard effect was tested.

Final controls used the same final harness and each failed for its expected reason:

- `baseline07`: drag goes to Pi; tmux never enters selection.
- `negative07`: copy-mode takeover without cancellation leaves a press that the injected orphan release activates.
- `history-resize07`: independent Pi scrollback erasure, below.

## Independent unresolved limitation: width resize erases history

With **mouse capture off and no candidate bindings**, Pi's width resize from 100x30 to 48x18 emits `CSI 3 J`. Tmux history falls from 61 lines to zero. The corresponding source path is the regular renderer's width-change full clear. This prototype does not correct that behavior or preserve erased history.

The final candidate tests copying existing history **before** the width resize, then tests gesture cancellation during resize. It records zero remaining history afterward. This ordering narrows the acceptance claim; it does not turn the failed post-resize-history assertion into a pass.

## Retained failures and evidence

Local raw evidence is retained under repository `debug/tmux-selection-20261106/` (not committed): source snapshots for every run, actions, application input observations, raw application/client output, plain/ANSI captures and results.

- `baseline01` and `baseline02`: initial click before the cursor-origin handshake completed; not a selection reproduction.
- `baseline03`: corrected startup observation reproduces drag forwarding.
- `candidate01`: selection endpoint was one cell short under tmux's default emacs copy semantics.
- `candidate02`: initial selection/cancellation journey passed.
- `negative01`: missing cancellation reproduced stale activation.
- `candidate03`: wheel still forwarded to Pi before the wheel binding existed.
- `candidate04`: post-resize history missing; a separate capture-off control confirmed erasure.
- `candidate05`: selected history did not match the incorrectly observed inner backing grid. The outer-renderer correction preserves the exact-content assertion.
- `candidate06`: bounded routing acceptance passed; review identified an under-specified resize assertion and omitted empty clipboard payloads.
- `candidate07`: same bindings and journey passed with raw-release/no-component-release assertions and empty-payload reporting.
- `baseline-final`, `negative-final`, `history-resize-final`, and the final `*07` controls: expected failures retained, not retried into success.

No application source was changed, so this task makes no new full-suite or Nix-build claim. Existing feature evidence and its limitations remain separate.
