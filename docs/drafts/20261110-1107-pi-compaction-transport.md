# Pi compaction transport backport validation

## Scope and provenance

Parent checkout: `816ed97d` (15-minute idle policy). Pi remains **1.5.0** with the existing local patches and locked npm dependencies. No Home Manager activation or live OpenAI request was performed.

Backported relevant portions of:

- [Pi #10781](https://github.com/earendil-works/pi/issues/10781): transport inheritance, originally [ioki-smore/pi@61577508ae95de8a88e029fc9387f5b6ccd960b7](https://github.com/ioki-smore/pi/commit/61577508ae95de8a88e029fc9387f5b6ccd960b7).
- [Pi #11202](https://github.com/earendil-works/pi/issues/11202): operation-local SSE recovery, from [denispol/pi@04bab8e2cdfd54d6bd09eda1be97c25562725c31](https://github.com/denispol/pi/commit/04bab8e2cdfd54d6bd09eda1be97c25562725c31). This variant inherits the effective `agent.transport`, preserving runtime transport changes, rather than re-reading only the initial settings default.

The latter commit's endpoint-affinity/provider-source and auth-test changes were **not** imported. Regression tests were extended locally.

Placement: the SDK request-options builder owns default transport inheritance. `completeSummarization` owns operation-local retry selection; the existing retry helper continues to own budgets, backoff and cancellation. No session-global socket/cache state was changed.

## Fail-first evidence

Against Pi 1.5.0 plus the existing local patches, before either production fix:

```bash
cd packages/coding-agent
../../node_modules/.bin/vitest run test/sdk-stream-options.test.ts test/compaction-codex-transport.test.ts --reporter=verbose
```

Result: **34 cases, 11 failed / 23 passed**. Failures showed omitted SDK transport, repeated WebSocket attempts instead of SSE recovery, incorrect transport counts and resulting recovery/cancellation assertions. Dependencies were built before counting these failures; an earlier missing-build import error was not counted as a reproduction.

The packaged-runtime harness also fails against the old installed package `/nix/store/2dmnp9hwki45w9vndj7y401f9k2bl84r-pi-coding-agent-1.5.0`: the first configured-SSE manual compaction makes **0 HTTP requests instead of 1**.

## Final verification

Fresh Nix build on 2026-11-10, using pinned Node **24.22.2**:

```bash
nix build --no-link --print-out-paths -L .#pi-coding-agent
nix build --no-link -L .#checks.x86_64-linux.subagents-policy-shape .#checks.x86_64-linux.pi-codegraph-wiring
```

Package derivation: `/nix/store/3avzbhq3j3r9d4yzy9k759nwc42myf28-pi-coding-agent-1.5.0.drv`.
Output: `/nix/store/q2z72lxazkfa0y8b16468h26687wfbx2-pi-coding-agent-1.5.0`.

| Check | Cases | Passed | Failed/errors | Skipped |
|---|---:|---:|---:|---:|
| Codex stream/OAuth and shared retry tests, 3 files | 90 | 90 | 0 | 0 |
| Coding-agent package selection, 35 files | 521 | 511 | 0 | 10 |
| Existing TUI package tests, 29 suites | 261 | 261 | 0 | 0 |
| Installed SDK loopback acceptance | 4 | 4 | 0 | 0 |

The 10 skipped package cases require external credentials; they are not successful live-provider evidence. Additional development regression runs covered 189 coding-agent cases (176 passed, 13 credential-dependent skips, including three branching cases) and 90 provider cases. These overlap the package checks and must not be added as independent coverage.

Focused TypeScript checking of all package sources and the three affected regression test files passes in the Nix build. Biome checks pass for the six changed upstream source/test files. The exploratory **full monorepo** `tsc --noEmit` did not pass: it reports 13 diagnostics in unmodified Fireworks/model-runtime, chat-viewport and extensions-runner tests. This task does not claim a clean full Pi monorepo check or full suite.

The guarded cases verify configured/current transport inheritance, explicit request precedence, manual and automatic compaction, split-turn summaries, post-start disconnect and idle-timeout recovery, partial-text discard, failure/cancellation checkpoint preservation, no new attempts when retries are disabled/exhausted, refusal and diagnostic negative controls, and ordinary cached-socket isolation.

The real loopback wire tests preserve `auto`, `sse`, and explicit `websocket` behavior. The **installed SDK** acceptance runs after npm pruning and fixup, with synthetic credentials and actual loopback WebSocket/HTTP servers:

| Compaction | Transport | HTTP requests | WS requests | Checkpoints |
|---|---|---:|---:|---:|
| Manual | sse | 1 | 0 | 1 |
| Manual | auto | 1 | 1 | 1 |
| Automatic | sse | 2 | 0 | 1 |
| Automatic | auto | 1 | 2 | 1 |

Automatic counts include the ordinary continuation request. All four pass. The runtime harness is retained at `nix/pkg/pi-coding-agent/tests/compaction-transport-runtime.mjs` and invoked by `installCheckPhase`. An independent read-only review found no substantive defects after the missing negative-control coverage was added.

## Artifact binding

SHA-256:

- `compaction-transport-setting.patch`: `85eaf7d7f454391291a258db214ab1819bc378c822f2fbbd3d8f89565d540d6c`
- `compaction-codex-sse-recovery.patch`: `abc08523258473cc5fef11fe36abfc4420b9262faf7a5affef0d60f64484df0a`
- `tests/compaction-transport-runtime.mjs`: `13a23a5809ea8be4c1c2819938739c66c9a61565923c206b4f15de5e25947903`

## Limits and retirement

This establishes the two transport/recovery corrections on the pinned package using controlled traffic. It does not establish a successful full-context Astra run, diagnose the separate HTTP 400, or guarantee recovery when both transports fail. The timeout and retry budgets remain finite and unchanged by these patches. Activate the rebuilt package through the normal downstream Home Manager workflow and restart Pi before evaluating live behavior. Remove each patch when an upstream release contains its equivalent fix.
