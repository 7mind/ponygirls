# @ponygirls/pi-ui

Reusable Pi terminal UI components. `ScopedSettingsPanel` and `ScopedSettingsView`
render the structural controller port from `@ponygirls/pi-settings`; domain codecs,
persistence, permissions and disclosure approval stay with each extension.

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

Tests cover controller interaction, actual layout allocation, scrolling, pointer
routing, asynchronous closure and synchronous reentrancy. Real PTY acceptance is
separate from component tests.
