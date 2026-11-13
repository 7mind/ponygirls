# Cuckoo feature controls — implementation contract

## Outcome

Normal Cuckoo loading includes all seven capabilities. New switches default OFF.
A master switch gates automatic checkpoints and the new capabilities; passive
reflection recall/history and explicit manual inquiries remain available while OFF.
Reports retain v4 and the checkpoint response remains JSON-only, with all tools
blocked. No model-quality gain is inferred from adding these controls.

## Settings ownership and placement

`src/preferences.ts` owns validation, legacy migration, per-field precedence and
persistence. Session overrides precede trusted project overrides, then global
settings, then built-in defaults. Project files are under Pi's `CONFIG_DIR_NAME`
in the session's cwd, not a discovered Git ancestor. Untrusted project files are
neither read nor written. Global/project writes are sparse version-3 documents;
reads of v1/v2 preserve their existing meaning without rewriting them.

One settings application changes only explicitly edited fields after rereading
current storage. A native session batch is one metadata entry. File replacement
is atomic using the existing shared helper; it is not a cross-process transaction.
Session resets do not revive earlier session overrides, and copied settings do
not configure a different session ID.

Do not implement layering separately in command parsing and UI callbacks. A shared
`CuckooPreferences` owner serves both. The UI is local to Cuckoo because the shared
library provides chrome/layout but no scoped checkbox model; generalizing a new
framework for hypothetical users is not warranted.

## Checkbox semantics

Eight checkbox rows: master, evidence, corrections, verifiers, reader, transfer,
vectors, critic. Policy kind/value remains one atomic setting.

- Corrections, verifiers and critic additionally require evidence.
- Vectors additionally require reader.
- Reader and transfer can inspect existing records without enabling new evidence
  creation.
- Checked intent is preserved when master/dependencies are off. Show an inactive
  reason; do not silently enable dependencies.
- Disabling correction creation never disables projection of existing corrections.
- Reader controls expanded enumeration/inspection; evidence retains basic public
  source enumeration/text needed for exact snapshot capture.

The settings panel uses the existing theme, `frameTitle`, `keyHints` and
`PanelLayout`. It stages edits by scope, applies the selected scope explicitly,
and discards remaining drafts on close. Show local overrides and effective
value/source separately. Toggling at a lower scope uses that scope's resolved
value, not a higher scope's override. Keyboard, mouse, resize and disposal must
preserve those semantics.

## Runtime ownership

A feature runtime owns tool exposure, execution-time gates, lifecycle epochs,
operation cancellation, grants and deferred advice. Register inactive tools and
apply changes to Cuckoo's tools only. Do not override unrelated tool choices or
re-enable a user-deselected tool at every refresh.

Configuration is eligibility, not authority. No network work starts from a
checkbox change or extension factory. Transfer reads require exact manifest and
destination approval; imported records remain qualified external history, never
new native evidence. Branch scope uses a navigation epoch stable across ordinary
appends, not the ever-changing native leaf ID.

Vector encoding needs a real bounded transport, fresh authority at actual handoff,
current projection rather than cached row status, and no silent fallback. Critic
SDK binding must use public ModelRegistry APIs, no second ambient runtime or
private registry fields. Critic output may be delivered only at an already
continuing ordinary-work boundary; neither completion nor agent_settled may
restart finished work. Journal callbacks are owner-fenced across replacement.

Disabling revokes approvals and pending delivery, not just local waiting. Late
provider work remains unknown; re-enabling cannot resurrect old grants or advice.
The synthetic-only experimental critic policy cannot be relabeled as production
consent. A new explicit versioned policy is required.

Q63 asks whether networked disclosure should be approved for each operation or for
a selected task including later records/queries. Until answered, do not implement
an inferred broad disclosure grant. Settings/local behavior and transport mechanics
can be verified independently using owned synthetic fixtures.

## Verification

Baseline: 249 package tests and pinned TypeScript passed before changes.

Use black-box preference/activation contracts with real filesystem and native
session adapters; preserve all candidate invariant tests. Add actual SDK workflows
for switching, reload, persistence and inquiry blocking, plus owned HTTP tests for
runtime adapters. A fake-only port test is not adapter acceptance.

Exercise actual Pi PTYs in regular/fullscreen at 80×24 and 120×40: all switches,
source precedence, inheritance reset, cancel/apply, lower-scope shadowing,
dependency reasons, keyboard/mouse, resize and disposed-callback fencing. No real
credentials/private data or Anthropic inference in tests.

Run unfiltered tests, strict typecheck, Nix package and policy checks on final
source; integrate locally only after review. Keep Q61's older worktree untouched.
