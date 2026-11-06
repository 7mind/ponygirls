# Manure check migration (current implementation)

The retired Python **server/storage implementation is not packaged or executed**
as a production adapter or acceptance oracle. Existing public Nix check names
remain, but their executable dependencies are explicit:

| Check | Current actual coverage / authority |
|---|---|
| `manure-backend` | All sbt-discovered `manureServer` and `manureStorage` suites; positive per-suite/per-case XML inventory. Domain contracts run against the hand-written in-memory repository and owned real PostgreSQL adapter; physical-root/descriptor/JNI filesystem behavior executes, with no skips. Fixture administrator creates per-test databases; this leg does **not** establish runtime role least privilege. |
| `manure-posix-acceptance` | Complete service-owned filesystem probe on JVM JNI and the actual statically linked musl probe ELF; exact artifact/source binding. No complete publishing/recovery claim from this primitive check alone. |
| `manure-client` | Installed portable CLI and stdio MCP clients against the installed Scala native server and independent, least-privileged shared-provider database. Manual MCP exchange, official Python MCP SDK, CLI cache precedence, killed-process resume and binary fetch verification. No Python backend fallback. |
| `manure-native` | Actual static-musl service ELF; canonical pre-compilation input manifest must match the test source. Service-owned `target-suite.py --scope full` discovers a positive current target/browser inventory, rejects failures/errors/skips/expected-failures and requires exact execution equality. Runtime connections use the bounded owned admin provisioning seam, never application CREATEDB. |
| `manure-browser` | **Exactly the same derivation as `manure-native`**, not a diagnostic subset or new summary. Full target/browser work is executed once. |
| `manure-portable-root` | Linux contained VM executes the source-bound static-musl ELF with owned PG, controlled TLS authority and a guest-owned private whole ext4 volume: explicit migration/replay, V2 startup/auth/content, cross-network-namespace held-root denial, wrong-volume/marker/inode and TLS denials, restoration/reopening. No host mounts, certificates or network interfaces; not real Kubernetes authentication, CSI fencing or node handoff. `portable_root_probe.py` is executed by this gate, not by Python unittest discovery. |
| `manure-unittests` | Historical public Linux name now composes `manure-backend`, `manure-client`, `manure-native` **and** `manure-portable-root`; it verifies exact artifact/runtime/test-source equality and actual ELF SHA plus the complete portable-check result set. It cannot pass until all actual replacements pass. It does not import retired Python server/storage modules or silently count their old tests as current. |
| `manure-nixos-eval`, `manure-hm-eval`, `shared-services-modules` | Current actual module/credential/proxy/client/provider composition. Evaluation is not runtime acceptance. |
| `manure-vm` | Existing real-VM/TLS/nginx/sandbox acceptance boundary. Explicit shared provider connection is wired; historical route/body assertions still require owner migration to the current protocol before this gate can pass. It is not silently removed or substituted with evaluation. |
| `shared-postgres` | Actual provider isolation/privileges/effective settings/privacy/timeouts/restart/backup/restore and matched payload snapshot rehearsals. Not a substitute for domain migration/recovery gates. |

This remaps **executable gates**, not evidence that every historical Python case
has been preserved. The service owner's invariant/behavior register at
`manure/docs/behavior-inventory.md` must map/reproduce/replace or explicitly retire
architecture-only cases (SQLite/Python internals/removed wire contracts). Full
completion requires that register and the final positive current inventory;
summary-only receipts, filtered stale XML or silently omitted mandatory behavior
are not acceptance. `core`/`focused` target runs are iterative diagnostics only.
