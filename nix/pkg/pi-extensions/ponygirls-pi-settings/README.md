# @ponygirls/pi-settings

Shared preference storage helpers and typed scoped-settings controller. This package
does not render a UI, infer consent, select models, or own extension lifecycle effects.

## Scoped controller

`ScopedSettingsSnapshot<V>` carries **unmerged** defaults, managed, global, project
and session layers, project trust, and exact mutation targets. Resolution is
session → trusted project → global → managed → default. Origins describe the
actual supplying layer, not a materialized effective value.

`ScopedSettingsController<V>` owns field validation, independent per-scope drafts,
set/inherit operations, editor/apply admission and reload/target checks.
`{ key, op: 'set', value: null }` is distinct from `{ key, op: 'inherit' }` for a
field whose domain permits null. Callers must not use null as a generic reset marker.

The structural controller port is rendered by `@ponygirls/pi-ui`. Its
`beginEdit()`/`beginApply()` actions run outside the pane. Disposing the controller
invalidates callbacks; asynchronous results cannot revive a disposed interaction.

Domain adapters own codecs, legacy migrations, authoritative persistence, current
target/trust checks and lifecycle effects. Recheck cancellation and target identity
**after** dependency callbacks and immediately before mutation. Generic controller
checks cannot replace this boundary. A failed or cancelled Apply does not prove
rollback; a domain operation may have persisted a prefix.

Approval is not a setting. Historian disclosure grants, Cuckoo task consent and
transfer confirmation remain domain operations outside generic checkbox logic.

## Boolean extensions

`SharedScopedToggleConfiguration` supplies the same layering and native session
records for simple boolean preferences. `FileTogglePreferenceStore` reads legacy
full v1 and writes sparse v2 overrides; `FileProjectTogglePreferenceStore` uses
sparse v1. Existing full read/write callers remain supported. The SDK project
configuration directory is explicitly injected rather than imported at runtime.

Tests include pure resolver/controller contracts and the same toggle behavior
against in-memory stores and real filesystem/native-session adapters.
