# Haystack port acceptance — 2026-11-03

Service-owned implementation and owned-client acceptance are complete for the
Scala/distage/cats-effect/http4s/JDBC/current Baboon port. This is not a deployment,
activation, downstream pin, production migration, or wider Home Manager claim.
All database/model fixtures were owned and synthetic. No Node backend fallback
or legacy wire/cursor/digest interpretation is part of the current service.

## Final positive gates

All gates below were full, nonempty and unfiltered, with zero failures, errors
and skips. Earlier failing/invalid fixture attempts remain separate evidence;
they are not counted as acceptance.

| Gate | Result | Exact receipt/report |
|---|---|---|
| Normal real-PG Scala suites | 701 cases / 30 suites | `/tmp/nix-shell.gGnG7D/haystack-scala-report.cZR5Q7` |
| JVM executable HTTP/MCP/WS/provider/ownership | 34 cases | `/tmp/haystack-jvm34-final-admitted-20261103T1052/receipt.json` |
| JVM full owned browser, actual evaluated NixOS proxy and installed assets | 61 atomic XML leaf cases (62 Node including group), 36 browser journeys, 1 SSR check; three exit statuses0 | query worktree `haystack/web/target/browser-jvm-safe-current-proxy-ce7a111f-20261103T104645Z/receipt.json` |
| Actual static native executable, least-privilege owned PG | 34 cases | `/nix/store/ah48dnxccn30iqwxkvxhwp3k750d44fb-haystack-native-current-transport/receipt.json` |
| Actual native full owned browser, actual evaluated NixOS proxy and installed assets | 61 atomic XML leaf cases, 36 browser journeys, 1 SSR check; three exit statuses0 | `/nix/store/jl8sydy0d4vss5af8qqr1njx87v6fkjb-haystack-native-complete-browser/receipt.json` |

The36 browser journeys include all34 main journeys, actual HTTPS stop/refresh/
restart/logout, and the standalone quick-preview restart. Counts are inventories,
not interchangeable proof: native transport alone is not browser acceptance.
The native browser gate executes inside the Nix sandbox with declared provider
source closure and an owned private HOME/XDG environment, not a host-only probe.

## Artifact and source binding

- Final Scala-suite source: `d480071eab3475586587d55797b1d02a69c68062`, clean;
  input-manifest digest `f4c703fcbab76bf1f3f656f517247c16004ebfcc1ab1cd4ce5e16fb48275dc05`.
- JVM executable source includes published shared timeout-policy and retrieval
  recovery fixes. Final34-case fixture source:
  `6d0e7876e6f48e347d6da85a97e2c58b9c40e9bf`; subsequent owned changes are documentation.
- Frozen JVM JAR SHA256:
  `23ba65d47f3c581de36366346fdc3f57e2eeb680ed9de7208dc8000c1c568413`.
- Actual native ELF:
  `/nix/store/l549qf4k1ikhxqcajcvb8vxkvr0n5fki-haystack-native-artifact-0.1.0/libexec/haystack-server`;
  SHA256 `6d9df244606896b34508ad8c67e3c90f2882079197a7a3615f202c7d78a2eb76`.
- Native compiled-input manifest SHA256:
  `f3dcfce4a71a58e590cefc5cd1f56e5d2c2d6ec89a0ed4eaa12c5d3602337dfc`.
  Every listed input matches the final service worktree. The manifest contains105
  entries; earlier coordination shorthand saying107 was a counting error.
- Final native test/tooling source:
  `7f01b31d2e64ecac39d2c0b47e68069df1afd7d5`. Its receipt binds the unchanged
  ELF, exact source/inventory hashes, actual proxy JSON SHA256
  `bb42e2812bcc8a1de3ef1b38ec3afbc4b73076cc846df9e1e615ba30937757db`,
  and installed HTML/JS/CSS byte hashes.
- Host JVM actual proxy JSON SHA256:
  `e78b0c690b43c006fa6f61f81b0054fce8bcf1e99a6fc67269252e54b3b62e44`.
  Its actual installed root was not replaced with local build output.

Receipts include complete TAP/XML/logs, exact nonempty inventories and before/
after artifact/source/proxy verification where applicable. The outer coordinator
archives ephemeral host reports separately; immutable Nix receipts identify the
native evidence. The assertion register remains
[`port-contract-inventory.md`](port-contract-inventory.md).

## Preserved host evidence

The source-qualified host bundle is preserved under the service worktree's
ignored `debug/evidence/haystack-final-20261103/` (62 files including its relative
`SHA256SUMS`). It contains all30 fresh PG XML reports, the34-case JVM transport
XML/TAP,61-leaf browser XML/TAP and36-journey browser log, inventories, raw test/
build logs and source/artifact/proxy hash receipts. `summary.json` records exact
counts and immutable native receipt references. Configs, credentials, DB/server
logs and executable copies are deliberately excluded. Bundle manifest SHA256:
`762c0ceb19a68cf598569d9182818dcd492a7ece04e33a686b6afa36ad7fadbe`.
