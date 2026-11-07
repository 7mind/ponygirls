# Vendored search hub

`src/` is maintained here directly, not as an upstream patchset. It was imported
from the previously packaged pi-search-hub output, based on ronnieops/pi-search-hub
commit `6dd5188` (Nix source hash
`sha256-3LcRegB1PkMjM9xEhZPk98h/2NrE0gFkgw0PaNMIwl0=`).
The former empty-reader-content, always-include-tier and source-provenance patches
and manifest correction are incorporated. Upstream declares MIT in package.json;
its CREDITS.md and historical documentation are retained.

## Automatic metasearch

Three tiers contribute original ranked lists to the same reciprocal-rank fusion
(k=60), URL deduplication and multi-engine source attribution:

- **Main:** existing selection strategy; first successful engine when combine is
  off, all engines for `combineMode: "all"`, or up to three nonempty engine lists
  with failure/empty top-ups for `combineMode: "targeted"`. Declarative
  `combine: true` still overrides a caller's `combine: false`.
- **Fallback:** engines named by `alwaysInclude`, with their existing per-engine
  `timeoutMs` and optional `maxResults`. They now run in **every automatic mode**,
  not only targeted combine, and never consume main-tier slots.
- **Native:** one engine per configured supported Pi provider, queried alongside
  the other tiers without consuming main-tier slots. No separate search API key
  or native-tier configuration is needed.

A named `backend` remains a single-engine request and bypasses other tiers.
All tiers' raw lists are fused together before the final `numResults` cutoff;
we do not fuse already-truncated tier pages. Each named engine contributes once
per distinct document, including in lone-engine searches. URL identity preserves
path/query case and slash semantics, removing fragments for page-level identity.
See [the ranking investigation](eval/REPORT.md) for evidence behind keeping k=60.

### Native provider support

Verified adapter registrations are `openai`, `openai-codex`, `anthropic`, `xai`
and the pinned pi-xai `grok-build` provider. Their explicit backend names are
`native:PROVIDER`. The old search backend `openai-codex` selects
`native:openai-codex`; it never substitutes API-key billing for a subscription.

This is an explicit adapter catalog, **not exhaustive detection of every
provider capable of search**. Google/Vertex grounding and arbitrary compatible
endpoints are not yet supported. Provider-native tool contracts, model support
and presentation requirements need separate adapters. Unsupported configured
models of supported providers remain visible as unsupported, not healthy.

Discovery and nested inference use Pi's configured registry: authentication,
OAuth refresh, endpoints and headers remain authoritative. A compatible current
model is preferred, otherwise a verified candidate from the configured catalog
is selected. Only the search query is sent, not the conversation history. It is
losslessly framed as literal query data rather than a chat message, and hosted tool
use is required. A completed tool call alone is not retrieval proof; structured
source evidence is still required. Configured credentials do not establish
server-tool entitlement; account/proxy
restrictions appear as engine failures.

Results come only from structured native search sources/citation events, never
URLs invented in model-generated JSON. Source provenance is not a guarantee of
factual accuracy or live search quality. Anthropic paused server-tool turns are
reported as failures because normalized messages omit their continuation state.

Native calls have a 45-second deadline and up to one second of abort-settlement
grace to recover terminal usage. An uncooperative stream produces an explicit
usage-unavailable report; returning does not prove transport cleanup. Settled
nested inference usage is included in tool results, including partial failure
and cancellation. SDK token-cost estimates do not include separate search-tool
fees. Query testing from the command pane is not a transcript tool execution and
does not add tool-result usage to session totals.

## `/websearch`

The pane uses the shared `@ponygirls/pi-ui` layout/toggle components. It shows
configured engines and in-memory, per-extension-instance observations: active,
nonempty success, empty, failed and cancelled operations, result counts and
latency. Unattempted engines have unknown health; configuration is not a probe.
Reader counts represent successful page fetches. Session replacement/reload
resets observations. No search queries, credentials or raw provider errors are
retained by the monitor.

The pane has separate **Search engines**, **Fetchers**, and **Test search** tabs.
Search engines groups the current main, fallback and native tiers separately from
historical observations. Its policy explanation reflects automatic-search defaults:
main selection and request budgets, always-included tiers, configured fallback
caps/deadlines, native timing, caller overrides and equal-weight RRF aggregation.
Configured preference is not presented as the next random, round-robin or scored
selection. Reading/rendering the policy neither sends a search nor advances selection.
Configuration still does not establish provider health or entitlement.

Tab/Shift+Tab switches views; mouse tabs work in fullscreen or regular mode with
Pi's `regularMouse` enabled. Default regular mode leaves mouse to the terminal.
Only Test search accepts query input; Enter tests the same metasearch as `web_search`.
Query/results and per-tab scrolling survive tab switches; an in-flight test may
finish while viewing statistics. Arrow keys and Ctrl+PageUp/PageDown scroll;
Ctrl+C cancels the owned test from any tab; Escape closes the pane and its work. Bare PageUp/PageDown also work in regular
mode, but Pi reserves them for transcript scrolling in fullscreen mode. Closing
or replacing a pane prevents late results from repainting it. Search output is
bounded and terminal-control sequences are removed before pane display.

Search and fetch no longer write status-bar entries, including at startup.
The former `showStatus` setting has no effect. `/search-setup` and the textual
`/search-status` remain available. The tool advertises configured engines directly;
the separate backend-rewriting extension has been removed.

## Validation

```bash
nix build .#pi-search-hub
nix build .#checks.x86_64-linux.pi-search-hub
nix build .#checks.x86_64-linux.pi-search-hub-eval
```

The package runs all vendored tests and strict typechecking against the pinned
Pi SDK, not ambient API stubs. npm dependencies are locked and fetched by Nix;
only the compiled shared UI library is linked into the installed package.
Local iteration uses that same SDK/shared UI and the package lock, with an
isolated HOME so personal search.json files cannot change fixture expectations.
Real-PTY acceptance must cover both regular and fullscreen modes; component
checks alone do not establish host-level keyboard routing or runtime loading.
The evaluation check additionally replays pinned public relevance data and frozen
live URL pools; see [eval/README.md](eval/README.md).
