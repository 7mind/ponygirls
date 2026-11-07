# Validation — 2026-11-07

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
