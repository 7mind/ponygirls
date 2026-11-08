# Codex maximum-context extension

Task: automatically select advertised maximum context for `openai-codex`; retain catalog output limits unless an authoritative output limit is available. Preserve Pi authentication and streaming. Do not activate Home Manager.

Source baseline: d72b4695 (main). Work branch: task/codex-limits.

Plan: verify upstream discovery contract; implement native provider metadata decorator plus lifecycle integration; validate parser/transport/provider/host behavior and Nix wiring; review; commit, integrate and remove task worktree.

## Verified evidence (2026-11-08)

Pinned Pi: 1.4.0 at `/nix/store/z0whzcf3qadlbapf48whxgdq2p5l4aaw-pi-coding-agent-1.4.0/lib/node_modules/pi-monorepo`.

Final application-source SHA-256:

| File (under `nix/pkg/pi-extensions/ponygirls-codex-limits/`) | SHA-256 |
|---|---|
| `index.ts` | `17569f44727d5476d2d8a3192c1dea330158c209a5f39ae6bffd9ffa0318a587` |
| `provider.ts` | `d1caab01354cab8d77ccd7999e6380ecdbc5c02e4653c927cb0174390df5159c` |
| `catalog.ts` | `78ba1033be94b704de7b8635aef31409512b142724d7672a1e0b7355b9f2b774` |
| `tests.mjs` | `90dcba75171f819c8784693cf821397d6adcff76a56e57322a5b8f53940560d6` |
| `live-check.mjs` | `baf307411945ba57f6c77405527c666330c6b5bd4934c74a1ceda29b08c389a9` |

From the task worktree root:

```bash
nix build .#checks.x86_64-linux.ponygirls-codex-limits \
  .#checks.x86_64-linux.dev-llm-module-boundary \
  .#checks.x86_64-linux.ponygirls-openai-fast --no-link -L

PI_PACKAGE_ROOT=/nix/store/z0whzcf3qadlbapf48whxgdq2p5l4aaw-pi-coding-agent-1.4.0/lib/node_modules/pi-monorepo \
  PI_OFFLINE=1 PI_TELEMETRY=0 \
  node nix/pkg/pi-extensions/ponygirls-codex-limits/live-check.mjs

git diff HEAD --check
```

- Codex limits: strict TypeScript check plus **17/17 tests passed**, 0 failures/errors/skips/cancellations. Both memory and real loopback HTTP provider contracts executed; stalled-body test exercised the real 10-second deadline. Actual Pi loader and model-runtime checks executed. Final check derivation: `/nix/store/q4dyvzsb80c2k8lqi41vkrm1jfv93wj9-ponygirls-codex-limits-test.drv`.
- OpenAI fast-mode regression: **18/18 tests passed**, 0 failures/errors/skips/cancellations. Final check derivation: `/nix/store/9w3g87mm0s8g4h2jpg1jxhi7b4fx0w0q-ponygirls-openai-fast-test.drv`.
- Module-boundary check: passed via exact-input Nix cached evidence (not a fresh execution).
- Extension package built, and the check verified that its installed tree contains the new entry point.
- Live authenticated metadata discovery: **7/7 Pi catalog models matched**; all effective context windows were **872000**, output remained **128000**. The six older entries previously had 272000 context; `gpt-6.1-sol` had 500000. Live metadata check sent no prompts or repository contents; no credentials or raw provider response were printed/persisted by it.
- Whitespace validation: passed.

This is live discovery/metadata acceptance, **not** successful full-window inference, TUI interaction acceptance, Home Manager activation, or deployment. Home Manager was not activated.

## Review and reproduced corrections

Read-only subagent `b52fd4a1-6302-4fad-b5f8-f7df58e450ac` researched upstream discovery and reviewed the implementation. Initial tests reproduced stale-generation diagnostic overwrite, fetching after rejected scope publication, offline account-scope retention, and missing input-time active-model synchronization; these failed before their corrections and subsequently passed. A later review reproduced official limits retained after switching to a proxy; the new regression failed with 1000000 vs expected 272000 before endpoint scoping fixed it.

Final review reported no substantive findings and independently reran all 17 tests successfully (task run `b71322b9-d1cc-4523-8948-40ae5d9bf95d`). The separate live-check script was subsequently retained for reproducibility and executed successfully; no provider implementation changed after that review.

The subagent also analyzed reusable patterns and checked installed skills. No novel skill draft was warranted: shared adapter contracts overlap with `dual-tests`, evidence distinctions with `constructive-test-taxonomy`, and sandbox boundaries with `environment`. Haystack overlap was not checked; no candidate or memory write is claimed.
