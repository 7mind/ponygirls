# @ponygirls/pi-ui

Reusable Pi terminal UI components. `ScopedSettingsPanel` and `ScopedSettingsView`
render the structural controller port from `@ponygirls/pi-settings`; domain codecs,
persistence, permissions and disclosure approval stay with each extension.

Layout, wording, key-hint and command-line rules shared by all tools are in
[CONVENTIONS.md](CONVENTIONS.md).

## Scoped settings interaction

- Up/Down selects a field; Tab/Left/Right switches session, project or global scope.
- Space/Enter activates a field; `e` opens its complete-value editor.
- `r` stages inheritance, Ctrl-S applies the selected scope, `l` reloads, and Esc
  cancels unsaved drafts. Other scopes' drafts survive a successful scope Apply.
- The panel shows explicit overrides, inherited values and effective origins.
  Untrusted project scope cannot be changed.
- Mouse handling uses allocated layout height and current scroll position, including
  the first frame and resize. It participates in the host's press/release/click flow.

The view closes the pane before awaiting editors or persistence and reopens the
same live controller afterward. Closure disposes the controller before notifying
abort observers. Reentrant closure during controller creation disposes the returned
controller rather than leaking it. Errors explicitly avoid claiming rollback.

`previewOperatorText` and `confirmOperatorAction` provide bounded, scrollable,
lossless escaped text with fixed controls. Confirmation defaults to Cancel and
requires explicit selection of Approve. They render a decision; the calling domain
still owns approval scope, freshness, revocation and authoritative effects.

## Facts view

`FactsView` is the structured sibling of `StatusView`: a read-only pane that
answers "is it on, is it working" before anything else.

- The title carries the thing's name and, on the right, a short state coloured
  by its `UiState` (`── Historian ──── off · global ──`).
- The body is groups of facts. A fact is a label and a value of one or more
  segments joined with ` · `; a segment may carry a `UiState` that colours it.
  Labels are dim and padded to the longest one; a value that does not fit wraps
  under the value column, whole segments first. Groups are separated by a blank
  line. Below 16 columns of value width each value moves under its label.
- `details`, when not `null`, is the complete text behind `d` (`d details` /
  `d facts`); without it the key is unbound and not advertised.
- `facts` and `details` receive the pane width and are read again after a
  resize or `invalidate()`.
- Scrolling and closing match `StatusView`: ↑↓, PgUp/PgDn, Home/End, the wheel,
  `esc`; `q` stays bound.

```ts
new FactsView({
  title: "Historian", state: { text: "off · global", state: "settled" },
  facts: () => [[{ label: "State", value: [{ text: "off (global setting)", state: "settled" }, { text: "not capturing this session" }] }]],
  details: () => completeStatusText,
  theme, keys, rows: () => tui.terminal.rows, requestRender: () => tui.requestRender(), close: done,
});
```

Tests cover controller interaction, actual layout allocation, scrolling, pointer
routing, asynchronous closure and synchronous reentrancy. Real PTY acceptance is
separate from component tests.
