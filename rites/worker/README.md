# Rites worker

The Rites agent worker: a TypeScript Pi SDK host controller plus isolated
bubblewrap tool-runners, driven by the Baboon `RunRequest`/`RunResult`
protocol (`../models/worker.baboon`, `../protocol/protocol.ts`).

## Trust boundary

The Pi SDK session runs in a **trusted host controller** with the
operator-owned selected-provider model config in memory only. The model
credential is never mounted into, or otherwise visible to, repository code:
the tool-runner sandbox deliberately does not bind the model config, host
HOME, service state, other repositories or any ambient environment
(`--clearenv`).

Every tool the model can call is brokered:

- The controller registers exactly seven custom tools — `rites_read`,
  `rites_bash`, `rites_edit`, `rites_write`, `rites_grep`, `rites_find`,
  `rites_ls` — whose metadata (description, parameter schema, output schema,
  argument shim) is cloned from the pinned SDK's built-in tools. The session
  asserts `getActiveToolNames()` equals exactly this list before prompting;
  no unbrokered host tool is reachable.
- Each call spawns a fresh `bwrap` tool-runner
  (`worker/tool-runner.ts`) that executes the original built-in
  implementation against `/workspace`. Tool-runner packets carry only the
  tool name and validated parameters — never host SDK context, model
  runtime, credentials or configuration.
- Brokered tools are `sequential`, preserving the SDK's edit/write
  serialization across the per-call processes. A tool result is returned only
  after the tool-runner's namespace tree is reaped; per-tool PID-1 teardown
  means detached grandchildren cannot survive a tool call.
- Regular outbound networking is preserved: the host resolver files and a
  pinned CA bundle are bound read-only into the tool-runner sandbox
  (`SSL_CERT_FILE`), and no network namespace is unshared.

## CLI

```
run-worker.sh WORKSPACE MODEL_CONFIG TIMEOUT_SECONDS     # development
rites-worker   WORKSPACE MODEL_CONFIG TIMEOUT_SECONDS     # Nix package
```

- `WORKSPACE` — host path to the per-run repository workspace, bound
  read-write at `/workspace` in every tool-runner.
- `MODEL_CONFIG` — operator-owned private file with ONLY the selected
  provider (`{"provider", "modelsJson", "credential"}`; see
  `worker/model-config.ts` for the strict shape). Read once by the worker;
  the credential stays in memory.
- `TIMEOUT_SECONDS` — hard wall-clock deadline over the whole worker tree.

stdin: exactly one `RunRequest` frame (EOF-terminated, <= 1 MiB). The
supervisor validates it fully before launching anything; the worker
re-validates. stdout: exactly one `RunResult` frame bound to the request
`runId`. Exit 0 iff a bound frame was emitted.

Result selection (a bound frame is necessary, never sufficient): deadline
expiry before full tree reaping => `Cancelled/"deadline"` (overrides a
captured Completed frame); forced reaping of lingering children =>
`Failed/"sandbox-children"`; supervisor signal without a captured frame =>
`Cancelled/"aborted"`; crash/bad frame/mismatch => `Failed/"worker-protocol"`.
Machine failure codes only; provider text and configuration values never
reach output.

Worker-internal failure codes: `invalid-config`, `model-unavailable`,
`thinking-unsupported` (Pi silently clamps thinking levels; the worker rejects
that instead of changing requested behavior), `model-error`, `model-length`,
`aborted`, `deadline`, `worker-internal`.

## Environment (supervisor, worker and tool-runner)

`RITES_NODE`, `RITES_BWRAP`, `RITES_NIX_STORE`, `RITES_WORKER_RUNTIME` (dir
with `worker/` code and `node_modules/@earendil-works/*` SDK links),
`RITES_TOOLCHAIN_PATH` (colon-separated bin dirs inside the Nix store), and
optional `RITES_RESOLV_CONF`, `RITES_HOSTS`, `RITES_NSSWITCH_CONF`,
`RITES_CA_BUNDLE`. `scripts/run-worker.sh` resolves development defaults;
the Nix package pins store paths.

## Development

From the repository root, inside the pinned toolchain (bubblewrap must be on
PATH; `nix develop .#backend` provides the Nix-side tools):

```bash
nix develop .#backend --command bash -c 'cd rites && npm ci --ignore-scripts && npm test'
```

`npm test` builds both projects and runs the protocol, model-config, worker
and sandbox test suites. Sandbox tests hard-require bubblewrap and
unprivileged user namespaces and fail loudly when missing. Tests use a local
loopback scripted OpenAI-compatible provider with synthetic fixture names
only; no real provider identity, endpoint or credential appears in the
repository, and no real model is called.
