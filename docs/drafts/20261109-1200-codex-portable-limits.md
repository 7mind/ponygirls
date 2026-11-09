# Portable Codex context discovery

## Scope and reproduction

Base: ponygirls `412f7f0e`. Pi pinned at 1.4.0. No deployment or upstream filing requested.

The new `ponygirls-codex-limits/subagents.test.mjs` failed before the fix against
`/nix/store/z0whzcf3qadlbapf48whxgdq2p5l4aaw-pi-coding-agent-1.4.0/lib/node_modules/pi-monorepo`:

```text
PI_PACKAGE_ROOT=<above> PI_OFFLINE=1 PI_TELEMETRY=0 node --test nix/pkg/pi-extensions/ponygirls-codex-limits/subagents.test.mjs
1 test, 0 pass, 1 fail
MODEL_UNAVAILABLE: native extension providers cannot be transferred to a worker
GoverningModels.describeReference (parent-models.ts:132)
```

Synthetic discovery and in-memory stores; no real credentials, external network,
or inference needed. Native registration was the failing classification, not
context arithmetic. Codegraph could not query this checkout (foreign/unknown PID
namespace ownership); direct source inspection used instead. A read-only subagent
attempt failed with the same MODEL_UNAVAILABLE error; no delegated review occurred.

## Correction

- Patch packaged Pi with configuration-form `modelMetadata`: synchronous published
  token-limit overrides plus a refresh hook using Pi's existing publication contract.
- Limit overrides to positive safe-integer context/output limits of existing chat
  models; preserve identity, endpoints, auth, streaming, configured model additions,
  and other operation types. Explicit user `models.json` overrides remain topmost.
- Register Codex discovery as metadata, not a native provider. Preserve existing
  discovery lifecycle and scope invalidation behavior.
- Leave all subagent admission/transport guards unchanged. The existing public
  descriptor path carries the discovered limits instead of falling back to the
  worker's bundled catalog.

## Validation status

First candidate: Nix subagents passed all 779 tests (zero failures/cancellations/skips).
Codex limits ran 22 tests, with 19 passes and 3 failures. The composition regression
passed. Two new test assertions incorrectly compared composed metadata/auth objects
against unnormalized inputs; corrected to compare against Pi's unoverlaid composition.
The host runtime refresh reported one error without detail; detailed error assertions
were added. The same full extension tests and strengthened worker composition passed
locally afterward (18 tests). These are intermediate results, not final acceptance.

Second candidate: Pi's selected 20 source suites passed 333 cases; its selected TUI
suite passed 260 cases; subagents passed all 779 cases. Codex passed 21/23. The detailed
error was `fetch failed: getaddrinfo EAI_AGAIN pi.dev`: preserving the built-in provider
also preserved its remote catalog refresh. The tests now inject a real local catalog
server returning 404 rather than depending on external Pi availability. Unlike the
initial direct-metadata reproduction, intermediate runtime tests could attempt pi.dev.

A new fail-first test also demonstrated that base refresh failure suppressed metadata
publication (272000 observed vs 1234567 expected). The composer now attempts metadata
refresh after a base failure and rethrows the failure, aggregating when both fail.
This preserves scope invalidation/discovery without hiding partial errors. Eighteen
extension/composition tests passed locally with the local catalog fixture.

Final validation succeeded:

```bash
nix build .#checks.x86_64-linux.ponygirls-codex-limits \
  .#checks.x86_64-linux.ponygirls-subagents --no-link --print-out-paths -L
```

- Codex: all 24 tests passed, zero failures/cancellations/skips/todos; strict TypeScript passed.
- Subagents: all 779 tests passed, zero failures/cancellations/skips/todos; strict TypeScript passed.
- Pi package: 20 selected source suites / 333 tests passed, including provider/runtime
  regressions; 28 selected TUI suites / 260 tests passed, zero failures/cancellations/skips/todos.
  These are selected package suites, not a claim that all upstream Pi tests ran.
- Final confirmation freshly reran Codex after the README change and reused the identical
  Nix derivations for Pi and subagents; their source/artifact bindings were unchanged.

Artifact bindings (logs available with `nix log <drv>`):

| Artifact | Derivation / output |
|---|---|
| Pi | `/nix/store/zij922l7lhdczf8k8ls56j5w4sfxwzzy-pi-coding-agent-1.4.0.drv` |
| Pi output | `/nix/store/6n91g593zarljx02kgb7ddvmdajcqi5n-pi-coding-agent-1.4.0` |
| Codex final | `/nix/store/yx4sx3qf7bnflyyslq2m9jxjf5b46cvl-ponygirls-codex-limits-test.drv` |
| Codex output | `/nix/store/fwjllw4vrhb9nm50xhfr4nif2r4m575y-ponygirls-codex-limits-test` |
| Subagents | `/nix/store/8zrpm4x98rrhvr9raadalagnd6jmn761-ponygirls-subagents-test.drv` |
| Subagents output | `/nix/store/88kx4l8115rdympiy8xzmkcf91r8p0iv-ponygirls-subagents-test` |

Source identity: base `412f7f0eb39299f9f83fad289fa0346753e56c7f` plus the task diff
for `flake.nix`, `nix/pkg/pi-coding-agent`, and `nix/pkg/pi-extensions/ponygirls-codex-limits`,
whose SHA-256 (`git diff HEAD -- <paths> | sha256sum` before commit) was
`14466aa3b686c0b2a5d9d39375009a9ce053e78a6cceee408e2756aeb8cd95cb`.

Earlier failing derivation logs remain separate:
`69zkdh5hl42qy624i5a7i4sqy9mmhwv7-ponygirls-codex-limits-test.drv` and
`pgn3bbsklwpvkb4mgccqaf5mb8kdd9jj-ponygirls-codex-limits-test.drv` under `/nix/store`.

## Reuse assessment

Direct analysis only: delegated review was unavailable. The reusable lesson is to test
producer/consumer composition and separate portable metadata from executable provider
behavior. The installed constructive-test-taxonomy already covers Blackbox-Group
regression contracts. Haystack draft search and a full read of
`corporate-activity:skill-draft-brokered-agent-credential-boundary` r1 found adjacent
composition-wide authority guidance, not a missing broadly reusable procedure proven
by this one defect. No new skill draft was manufactured.

No live-provider acceptance or deployment is claimed. Q46 (pilot model choice)
remains pending and is independent of this repository correction.
