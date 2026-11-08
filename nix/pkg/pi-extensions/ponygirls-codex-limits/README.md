# Codex maximum context

Loaded by `nix/hm/pi.nix`. Decorates only `openai-codex`, retaining Pi's built-in authentication and streaming implementation. It does not affect the separate `openai` provider or OpenAI-compatible third-party endpoints.

At session startup and subsequent Pi model-catalog refreshes, query Codex's authenticated model catalog. Match exact model slugs already known to Pi; select `max_context_window` when present, otherwise `context_window`. Missing metadata leaves Pi's catalog value unchanged. New model IDs are not fabricated: they require Pi's remaining model/transport metadata.

**Output limits remain Pi's catalog values.** The inspected Codex discovery contract has no output-token maximum; neither its context window nor its truncation policy is an output limit.

- `/codex-limits`: show discovery state and selected limits.
- `/codex-limits refresh`: retry discovery and synchronize the selected model.
- Network access obeys Pi's offline setting. No persistent cache, credentials, or provider responses are written by this extension.
- Discovery failures produce a warning at startup/manual refresh; Pi's picker reports failures during its own refresh. Same-account/endpoint last-known limits remain usable after a failure. Account or endpoint changes invalidate discovered limits even during offline refresh. Missing limits for the selected model produce a warning.
- Discovery has a 10-second deadline, a 2-MiB response bound, and no redirects. Nonstandard provider endpoints disable discovery rather than sending credentials to a different endpoint.
- Active metadata is synchronized on startup, selection, input (before prompt compaction), and before agent start. Authentication acquired after startup can trigger deferred discovery on the next prompt.

The discovery request's `client_version=0.165.0` matches this repository's pinned Codex version at implementation time. It identifies the catalog protocol/client compatibility, not per-model configuration.

## Contract evidence

Inspected upstream OpenAI Codex `main` on 2026-11-08:

- [`codex-rs/codex-api/src/endpoint/models.rs`](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/models.rs): GET `models?client_version=...`, `{models: [...]}` response.
- [`codex-rs/protocol/src/openai_models.rs`](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/openai_models.rs): `context_window`, `max_context_window` (maximum permitted configuration override), no output maximum.
- [`codex-rs/model-provider/src/bearer_auth_provider.rs`](https://github.com/openai/codex/blob/main/codex-rs/model-provider/src/bearer_auth_provider.rs): bearer authentication and optional account header.

This opts into the advertised maximum override, not Codex CLI's default context policy. Metadata discovery does not prove that a full-window inference succeeds for every model/account.

## Validation

From the repository root:

```bash
nix build .#checks.x86_64-linux.ponygirls-codex-limits --no-link -L
```

For a separate, metadata-only live acceptance check (uses configured Codex OAuth, may refresh it, prints only model IDs/limits):

```bash
PI_PACKAGE_ROOT=/path/to/installed/pi-monorepo PI_OFFLINE=1 PI_TELEMETRY=0 \
  node nix/pkg/pi-extensions/ponygirls-codex-limits/live-check.mjs
```

`PI_OFFLINE=1` disables unrelated Pi catalog traffic; the script explicitly enables only the Codex discovery refresh. It fails when Codex is unconfigured or no known model receives live limits. It sends no prompts or repository contents.

The Nix check performs strict TypeScript checking, parser/provider tests, the same provider contract against memory and real local HTTP adapters, transport boundary checks, lifecycle checks, and actual Pi extension-loader/model-runtime checks. External OpenAI availability is not a CI dependency.
