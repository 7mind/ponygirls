# pi-claude-code-subagents

An **additive**, opt-in backend for `ponygirls-subagents`. Load all three original
entrypoints: `pi-claude-code`, `ponygirls-subagents`, and this package. Load order
is irrelevant. This package registers no provider, tools, or replacement entrypoint.

Home Manager:

```nix
smind.hm.dev.llm.pi.providers.claude-code.enable = true;
smind.hm.dev.llm.pi.claudeCodeSubagents.enable = true;
```

The addon defaults to false. Enabling it appends a package, preserves the original
provider and static subagents extension, and asserts that the managed provider is
enabled. It does not enable that provider implicitly or modify profiles or locks.
Standalone Pi settings can list the original provider and this package under
`packages`, with the original subagents directory under `extensions`:

```json
{
  "packages": ["/path/to/pi-claude-code", "/path/to/pi-claude-code-subagents"],
  "extensions": ["/path/to/ponygirls-subagents"]
}
```

The supplied packages target pinned Pi SDK 1.5.2 and provider revision
`d5b5e04c314d3452d357174d16d10dda34daa2d2`. The provider requires its versioned
`pi-claude-code.execution.v1` execution seam. Missing/incompatible dependencies
are reported at session startup, and selected Claude requests fail closed. Other
providers remain usable. Duplicate backend identities and multiple claimants are
explicit conflicts, never replacement or fallback.

Loading the addon does not discover models, run CLI commands, create transport
files or start processes/timers. Unselected stock APIs and original governor
requests without explicit execution context keep their original SDK/provider
paths. The original registered provider owns private catalog routes, adaptive
thinking and native tool changes, transcript preparation and response translation.
The addon calls public `modelRegistry.streamSimple`, preserving SDK authentication
and configured-provider composition; credentials and executable callbacks never
cross worker IPC. Parent request hooks are not serialized or replayed.

The private executor is generated from the same pinned upstream CLI/relay source,
not a second provider/catalog. Its process/status/cache ownership is instance-local.
The addon owns acquisition, active one-shots, warm processes, relays and cleanup.
Entry authority is checked after auth/acquisition/replay/body awaits immediately
before spawn, frame writes and relay forwarding. No bridge retries are added.
Usage-credit rejection and original request/auth identity are preserved.

Canonical JSON has a **64 MiB serialized UTF-8 limit**, not a token guarantee.
Ordered, digested, acknowledged frames carry at most 128 KiB raw bytes under the
core 256 KiB envelope bound. Channels admit four transfers per direction and eight
invocations. The parent event queue is bounded by 64 MiB and 1024 events; overflow
fails visibly without truncation. Oversized input is rejected before inference.

`captureOriginal` returns the single-iterator observation wrapper exposed to the
SDK. Bare original EOF fails promptly even if SDK composition synthesizes a result.
The genuine raw result remains an independent usage witness, including late usage
after public failure. The parent commits invocation-identified original receipts
exactly once; worker totals remain progress/transcript statistics, not duplicate
billing. Missing or unsettled originals record sticky uncertainty. Persistence
faults hold admission and cannot acknowledge successful completion. Hard parent
crashes cannot guarantee capture of externally billed usage.

Shutdown/reload/removal revokes new entry synchronously, cancels invocations,
joins pending acquisitions and attempts every owned cleanup before propagating
aggregate failures. Retained workers rebind to fresh registrations after reload;
removing the addon makes further retained Claude requests visibly unavailable.
Old capabilities remain only for outstanding completion/accounting/cleanup.
Stock workers retain core's bounded reload handoff and continue independently.

Verification is controlled-CLI/local-server acceptance, not Anthropic acceptance:

```bash
nix build --builders '' --no-link .#checks.x86_64-linux.ponygirls-subagents
nix build --builders '' --no-link .#packages.x86_64-linux.pi-claude-code .#checks.x86_64-linux.pi-claude-code
nix build --builders '' --no-link .#packages.x86_64-linux.pi-claude-code-subagents .#checks.x86_64-linux.pi-claude-code-subagents
```

The checks run full typechecking and unfiltered addon/upstream suites, immutable
three-entrypoint SDK composition and lifecycle tests, and process-ownership
regressions. Windows-only upstream cases remain platform skips on Linux.
