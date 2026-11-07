# Validation — 2026-11-07

## Current follow-up: tier groups and querying-policy explanation

- Source Git tree (`src/`): `f808fd607e431ff6e1a1e953992407ad97d82a1d`.
- All 66 tracked source files byte-match Nix input
  `/nix/store/8c241mbv0j1kbj9hmmf33d64bd1qall3-source`.
- Tested package: `/nix/store/247wn1nvvhjf6x28q78nj9xv0icqb0pb-pi-search-hub-2.8.0-ponygirls.1`.
- Package NAR hash: `sha256-ozB1cvShxxtw4p39lIDposVov21Kz6825121e3tP5LA=`.

Fresh command:

```bash
nix build .#pi-search-hub .#checks.x86_64-linux.pi-search-hub-eval \
  .#checks.x86_64-linux.subagents-policy-shape .#checks.x86_64-linux.ponygirls-pi-ui \
  --no-link --print-out-paths -L
```

Strict pinned-SDK typecheck and **18 Vitest files / 325 cases passed**, with
0 failures/errors/skips (including 40 view cases and 19 service cases). The fresh
evaluation check passed **37 Python cases**, reproduced both benchmark reports
and verified installed RRF60 parity on all 10 frozen live pools. Current module
assertions evaluated successfully; unchanged module/shared-UI artifacts were
reused, not fresh executions of the shared UI's 32 cases. No ranking policy or
native request/retrieval logic changed; native deadline constants are now shared
with display metadata. No fresh live-provider acceptance is claimed.

Service cases bind displayed defaults to actual first/targeted/all requests,
fallback limits and caller overrides/forced combine. They check safe detached
snapshots, invalid mode reporting, and no inference, random sampling or round-robin
advancement on inspection. View cases cover tier/history separation, original
deduplicated-rank RRF explanations, deadlines/caps, policy variants, sanitization,
display bounds, scrolling, resizing, tab segregation and existing test interactions.

Fresh controlled Pi 1.4.0 / tmux 3.8 PTY journeys passed in **regular and fullscreen**
modes, at 120×40 → 80×24 → 120×40 for policy inspection and again for test results.
An environment allowlist and disposable HOME excluded personal credentials. The
three tiers used loopback fastCRW, loopback SearXNG and an in-memory native stream.
Observed rules included the actual 4-result Main request, fallback cap/deadline,
native deadline/settlement grace and RRF60; opening, scrolling and resizing made
no search requests. Both journeys also checked completion counters for all three
tiers, ignored statistics-tab input, preserved query/result/scroll positions,
cancellation from statistics, redacted failure, Escape, no status-bar entries and
normal exit 0. Fullscreen additionally checked mouse tab switching. Private tmux
servers and owned scratch directories were removed; socket control then failed.
These establish terminal-cell behavior, not font pixels, IME or live entitlement.

One retained initial PTY run incorrectly expected the result heading after returning
to a deliberately scrolled result. The capture showed correct viewport preservation;
the harness was corrected, without application changes, and both final journeys
used fresh reporting directories. A worker's first unisolated full test run also
encountered two inherited-configuration failures; its clean-environment rerun and
the parent's local/Nix runs passed without altering host configuration.

Independent read-only source review found no actionable introduced defects; it did
not execute tests or establish PTY acceptance. Evidence is retained under
`debug/websearch-tiers-f808fd60/`. No activation, deployment or push was performed.

## Historical follow-up: fusion, live native search, and pane tabs

- Source Git tree (`src/`): `e97f68a6adf80c41b089d707f79ad57b4ad3f550`.
- All 65 tracked source files byte-match final Nix source
  `/nix/store/0d9zq0cr8v51rl8jm4vx7b0q20rdcc4g-source`.
- Tested package: `/nix/store/yawh5kb0349whypp5s230mf213ngngw2-pi-search-hub-2.8.0-ponygirls.1`.
- NAR hash: `sha256-XSJD7jpRknElLxbCN29gwrAIn6T+iXmE5Jeb5JhBVk4=`.
- Tested evaluation check: `/nix/store/dvn9wapvs17kr1ick77mkzq6p4mxr29j-pi-search-hub-fusion-evaluation`.
- Native adapter SHA256: `db21d9a92dc4654a0746ad74b58ca0312ecf54f8ddb3ec26ed1cc2b123d03a44`.

Fresh command:

```bash
nix build .#pi-search-hub .#checks.x86_64-linux.pi-search-hub-eval --no-link --print-out-paths -L
```

Result: strict pinned-SDK typecheck; **18 Vitest files / 302 cases passed**,
0 failures/errors/skips. The evaluation check passed **37 Python tests**,
reproduced both calibrated public benchmark reports byte-for-byte, replayed the
10 frozen live pools and verified the installed TypeScript/Python RRF60 orders.
See [the research report](eval/REPORT.md), [protocol](eval/PLAN.md) and
[reproduction commands](eval/README.md) for hashes, formulas and limitations.
RRF k=60 and tier policy remain unchanged; correctness corrections are distinct
from relevance improvements.

Additional command:

```bash
nix build .#checks.x86_64-linux.subagents-policy-shape .#checks.x86_64-linux.ponygirls-pi-ui --no-link --print-out-paths
```

Current module assertions evaluated successfully; exact-input existing artifacts
were reused, including the unchanged shared-UI 32-test result. This is not claimed
as a fresh shared-UI test execution.

### Real credentials and real terminal acceptance

With explicit user authorization, the parent used Pi's stored credentials via
ModelRuntime/ModelRegistry, not copied tokens or independently constructed HTTP
authentication. Actual models/authentication modes:

- `openai-codex/gpt-6.1-sol`, subscription OAuth;
- `anthropic/claude-sonnet-4-6`, subscription OAuth.

The exact query `bullshit` failed on both original adapters. Required tool choice
alone improved Anthropic but left repeated Codex clarification/no-source failures,
sometimes despite a completed hosted tool block. Generic literal query-data framing
plus required tool choice then succeeded on the final source without prototype
overrides for `bullshit` and `test` on both providers. The same native bytes also
succeeded for both providers on all 10 frozen public documentation queries.
These 24 sourced successes establish those observed calls, not universal entitlement
or semantic quality. No credential values or authorization headers were recorded;
only sanitized diagnostics, public results and usage counts were retained locally.

Fresh controlled Pi 1.4.0 / tmux 3.8 PTY journeys passed in **regular and fullscreen**
modes at 120×40 → 80×24 → 120×40. Explicit environment allowlist, disposable
HOME/agent state, no personal credentials or live-model inference in the UI fixture.
Both verified:

- Search engines / Fetchers / Test search segregation;
- ignored query input on statistics tabs, Tab/Shift+Tab switching;
- actual query submission only in Test search, in-flight completion while viewing
  engine statistics, and preserved query/result on return;
- resize, Ctrl+PageDown scrolling, cancellation, redacted failure and Escape closure;
- no search/fetch status-bar entries and normal Pi exit 0;
- private-server shutdown, rejected socket control afterward, and owned scratch cleanup.

Fullscreen additionally verified an SGR mouse click switching tabs. Default regular
mode leaves mouse to the terminal; a first test incorrectly expected mouse capture
there and failed without any implementation correction. A second test's close
predicate accidentally matched `websearch` in the temporary working-directory name;
the screen already showed the closed pane. Both diagnostic attempts were retained;
final journeys used fresh reporting directories and correct explicit postconditions.
Terminal cells establish PTY/key/layout behavior, not font pixels, IME or physical
mouse transport. No Home Manager activation, deployment or push was performed.

---

## Historical initial vendoring acceptance (16c65271)

The following is retained evidence for the earlier source/artifact, not current
source acceptance or a claim that the current suite still contains only 253 cases.

## Input/artifact binding

- Vendored source Git tree (`src/`): `6909e1bd8e512682062acc4f47a549f20fd76e2f`.
- All 64 tracked source files were byte-compared with the final derivation's
  source, `/nix/store/bc92h9kipkp6j48n550y5glbrj9v6jvl-source`; all matched.
- Tested package:
  `/nix/store/7zcnnq88q3255vy3v6jabpn8rdmpiqxf-pi-search-hub-2.8.0-ponygirls.1`.
- Package NAR hash: `sha256-TRQvgkDutyUnINfdYh37No08fn5ojeU+UjOq6qpp1TM=`.
- Pinned SDK: Pi 1.4.0; Nix package test runtime: Node 24.21.0.

## Checks

| Command/check | Result |
|---|---|
| `nix build .#pi-search-hub .#checks.x86_64-linux.pi-search-hub --no-link --print-out-paths -L` | Fresh package build; strict `tsc --noEmit`; all 17 Vitest files / 253 cases passed, 0 failures/errors/skips. Package and check targets share this one derivation/run. |
| `nix build .#checks.x86_64-linux.subagents-policy-shape .#checks.x86_64-linux.ponygirls-pi-ui --no-link --print-out-paths -L` | Current Pi Home Manager assertions evaluated successfully (existing assertion-check artifact reused); shared UI rebuilt/tested: 32 passed, 0 failed/cancelled/skipped. |
| `git diff --cached --check` | Passed. |
| Controlled real-PTY journeys, regular and fullscreen | Both passed, Pi exit 0; private tmux servers stopped and socket unavailability verified. |

PTY configuration: Pi 1.4.0, tmux 3.8, explicit environment allowlist and disposable
HOME/agent/session state, `--offline --no-session --no-extensions --no-skills
--no-context-files --no-prompt-templates --no-mcp`, loading only the installed
search extension and a controlled provider fixture. Search used a local fixture
SearXNG server and a registered in-memory OpenAI stream, with no personal
credentials or live model calls. Dimensions: 120×40 → 80×24 → 120×40.

Both journeys opened `/websearch` without search requests, observed unknown
health before attempts, submitted a query, displayed native and fallback results
and counters, scrolled with Ctrl+PageDown, preserved the query through resize,
cancelled a test with Ctrl+C, displayed a redacted failure with no fixture-secret
leak, closed with Escape, checked absence of search/fetch status-bar entries,
and exited normally. Captured terminal cells establish keyboard/layout behavior,
not emulator pixels, fonts, IME or physical mouse transport.

## Reproductions and review

Retained fail-first checks established:

- Reader cancellation incorrectly advanced to another reader and returned success.
- Native deadline racing lost terminal inference usage.
- Partial successful search exposed another engine's raw credential-bearing error.
- Uncooperative native streams remained pending beyond deadline plus settlement
  grace (worker-observed reproduction; corrected adapter tests independently ran
  in the final package suite).
- Fullscreen bare PageDown was consumed by Pi's transcript binding; explicit
  Ctrl+PageUp/PageDown pane handling was added and verified through the real PTY.

An independent read-only source reviewer identified the usage/redaction defects;
a follow-up review reported no new substantive findings. Runtime acceptance above
was performed by the parent, not inferred from that source review.

The imported baseline passed 195 cases with isolated configuration. An initial
nonisolated run failed its default-config expectation because the real HOME had
an Exa default; personal configuration was then excluded from fixture runs, not
edited or used to claim a pass. Obsolete ambient declarations also exposed SDK
API incompatibilities; final checking uses the actual pinned SDK.

No live-provider entitlement, semantic search-quality, Google/Vertex grounding,
macOS runtime acceptance, or Home Manager deployment/activation is claimed.
Command-pane query testing is not transcript tool-result usage accounting; see
[VENDOR.md](VENDOR.md) for the behavior and limitations.
