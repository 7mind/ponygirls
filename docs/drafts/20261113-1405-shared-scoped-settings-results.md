# Shared scoped settings — implementation and validation

## Delivered behavior

Cuckoo, Decisions, Context Archive, Fast mode and Historian now use a common scoped
settings controller and terminal dialog. Open it with `/cuckoo settings`,
`/decisions settings`, `/context-archive settings`, `/fast settings` or
`/historian settings`.

- Session → trusted project → global → managed/builtin resolution, with truthful
  origins and independent per-scope drafts.
- Explicit Apply, inherit/reset and cancellation. Editing one field does not pin
  unrelated inherited defaults. Nullable values are not generic reset markers.
- Shared settings logic lives in `ponygirls-pi-settings`; rendering and bounded,
  Cancel-default operator review live in `ponygirls-pi-ui`.
- Domain codecs, compatibility, lifecycle effects and approval remain with each
  extension. Read-only managed settings are not rewritten.
- Defaults remain Cuckoo OFF, Archive OFF at 70/50, Decisions ON, Fast ON and
  Historian OFF. Legacy Fast ON/OFF remain global; bare Historian remains status.
- Existing supported formats remain readable. Sparse writes preserve field absence:
  toggle globals v2, Archive globals v3, Historian globals v2; project files v1.
  Reads do not rewrite valid legacy documents.

Historian project configuration is intent only. Separate confirmation creates a
runtime-local grant bound to the effective configuration/model. Repository data
and native audit receipts cannot mint or restore that grant. Restart and observed
OFF/trust/configuration/read-fault intervals revoke it and establish fresh capture
boundaries; already captured pending evidence remains. Global/session textual ON
retain their existing explicit approval semantics, now through the guarded domain
mutation path. Transactional global settings/approval commit under the required
locks; native multi-entry session failures may leave a prefix and do not imply rollback.

Decisions' manual inbox remains available while automation is OFF, and its settings
work independently of question-store project binding. Archive preserves the complete
threshold-pair invariant and retained-history recovery. Cuckoo's task consent,
transfer approval, reports, recall and inquiry behavior remain domain-owned.

## Source and artifact binding

Validated application subtree (`nix/pkg/pi-extensions`):
`e59840cfc081a4590c7706c65bf4beedd9c5ec93`.

Validated `flake.nix` blob: `2fb5aefe53d91c9e1f5d819cc8d8811ca63a2229`.
Validated `nix/hm/pi.nix` blob: `b2e3d527651d9c19bcf266cbbf2c5dd786fd7645`.
Pre-report staged tree: `14af0fa4bc1248c24c6d10d7a3fad93ef8a7e2e0`.

Built package:
`/nix/store/mfsm6p3pxnh7k7m2f0z5ryl6qgc9iz5v-ponygirls-pi-extensions`.
Tools: pinned Pi 1.5.2, Node 24.22.2 and TypeScript 7.0.2.
Delivery is local repository integration only: no push, host activation or deployment.

## Complete validation

All 20 requested Nix targets succeeded. The final checks report zero failures,
errors or skips. Cached Nix results were reused where exact derivation inputs were
unchanged; they are not described as fresh executions.

| Migrated component/library | Passing cases |
|---|---:|
| Shared settings | 23 |
| Shared UI | 41 |
| Fast | 20 |
| Context Archive | 85 |
| Decisions | 130 |
| Cuckoo | 505 |
| Historian | 121 |

Historian additionally reran its three native-host cases against the built package;
these are artifact-specific reruns, not three additional unique test definitions.
All affected TypeScript checks passed.

| Downstream check | Passing cases |
|---|---:|
| Subagents | 781 |
| Codegraph extension | 61 |
| Codex limits | 24 |
| Model statistics | 30 |
| Model picker | 60 |
| Usage | 17 |
| Codex goals | 110, plus 17 native-host cases |
| Token monitor | 95 |
| Background tasks | 131 |
| Search hub | 580 across 33 files |

Package assembly, subagent policy shape and the development-module boundary check
also passed. No Chronicle code or validation policy was changed.

Equivalent final build command (the retained runner constructs the same argument list):

```bash
nix build --no-link -L --option builders '' --json \
  .#ponygirls-pi-extensions \
  .#checks.x86_64-linux.{ponygirls-pi-settings,ponygirls-pi-ui,ponygirls-cuckoo,ponygirls-context-archive,ponygirls-decisions,ponygirls-openai-fast,ponygirls-historian,ponygirls-subagents,ponygirls-codegraph,ponygirls-codex-limits,ponygirls-model-stats,ponygirls-model-picker,ponygirls-usage,ponygirls-codex-goals,ponygirls-tokemon,ponygirls-bg-tasks,pi-search-hub,subagents-policy-shape,dev-llm-module-boundary}
```

Commands, immutable build outputs, source bindings, iteration failures and passing
logs are retained under `.local/shared-scoped-settings/validation/`; final receipts
are `final-r3.json`, `final-r3.log` and `final-r3-input-tree.txt`.

## Real terminal acceptance

Used a private tmux server, environment allowlist, disposable configuration/session
roots and an owned scripted provider. No credentials or production conversations
were supplied; no external provider was contacted by these terminal fixtures.

Both regular and fullscreen modes exercised the settings dialogs. Packaged checks
covered all five dialogs at 80×24; selected multi-row dialogs and resize journeys
also covered 120×40. Observed outcomes included:

- Correct defaults, inherited/project/global origins and saved-versus-draft state.
- Complete Archive pair editing to 80/30, project Apply and session inherit/reset.
- Fast global reset producing sparse `{"version":2}`, not a pinned default.
- Cuckoo reader intent persisted independently while the master remained OFF;
  policy-editor cancellation and bounded scrolling retained state.
- Historian separate Cancel-default approval, explicit approval, restart without
  grant resurrection, unchanged project-ON approval and read-only managed metadata.
- Decisions settings after a deliberate missing-Git binding failure, and the manual
  inbox while project automation was OFF.
- Real SGR press/release routing in fullscreen and in regular mode with
  `regularMouse` enabled, including after resize and with allocated history above.

All terminal runs were closed normally with exit 0 after setup was corrected; the
owned server was then stopped and verified unreachable. Captures, action records,
configuration and cleanup evidence remain under `.local/shared-scoped-settings/pty/`.
Injected SGR input establishes application/PTY routing, not physical mouse hardware,
font rasterization, IME or human comprehension.

Initial fixture mistakes were retained rather than counted as passes: an unsupported
trust flag, missing Git in the allowlisted PATH, and mouse input before regular-mode
mouse reporting was enabled. Some waits expected the wrong UI wording or needed the
normal second Enter after command completion; named successful postcondition captures
supersede those attempts without deleting their logs.

## Reproduced corrections and review

Fail-first evidence covered stale layout hit geometry, reentrant controller creation,
disposal before abort observers, Cuckoo's final write boundary, unrelated-default
materialization, Historian's invalid-read backfill, callback cancellation/target drift,
audit-time revocation epochs, stale owner reads and legacy ON suffix writes after
owner retirement. Corrected reproductions and complete suites passed. Read-only
cross-reviews supplied actionable findings; parent execution verified them rather
than treating reviewer reports as runtime evidence.

The reusable inheritance-preserving edit procedure was reviewed and saved as an inert,
human-review-required skill draft. It was not installed. These checks establish local
configuration, lifecycle and interaction contracts—not model quality, production
acceptance, universal cancellation or arbitrary external filesystem atomicity.
