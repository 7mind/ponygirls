# Explicit full-acceptance tools (Linux x86_64)

`../scripts/acceptance-tools-x86_64-linux.json` contains **public tool paths**,
not credentials. They were evaluated from the locked nixpkgs
`31ecbaca1bdefa45dffc409f0250bd8039ea0010` and realized/verified on
2026-11-03 at 10:48:59 UTC. `.#chronicle` alone does **not** export them.

- `pkgs.playwright-driver`: `playwright-core` 1.64.1, package JSON SHA256
  `8aa1c9863fa8dea324e674254158cdc79440f4124ef2d84d38053013541cb7d6`.
- `pkgs.chromium`: 156.0.8078.47, executable wrapper SHA256
  `1bce62b4c2608cd75e6baf01d12506ecda642acbe72e5a6e4217a64eca259274`.
- Official `@modelcontextprotocol/sdk` 1.32.1: evaluated from the **actual**
  `nix/tests/manure-unittests.nix` build-command dependency context, then built
  `/nix/store/73f5rsh13vi2bhbcwg8k30yvs51qwaan-manure-mcp-sdk-vendor-1.32.1.drv^out`.
  Package JSON SHA256 `0216319ea53177f7ed419d660b2f52ccc7e3327e57f9ee2ef03225ff543aeae4`;
  source `nix/tests/manure-sdk/package-lock.json` SHA256
  `9703cd0c579c6a7838ec032feee7cf19655bebfa3c8246fa3c4d4101bd8390be`;
  recipe npm dependency hash `sha256-ehsj472Bpd0FAec5WtNKa0aUX/vePHVaqoMQ7ljwl2U=`.
- `pkgs.openssl` and `pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; }`
  supply the remaining two explicit paths.

Run in the pinned development environment, with an **explicit** tools descriptor
and immutable copies of the three owned PostgreSQL provider inputs:

```sh
nix develop .#chronicle --command env \
  MANURE_ACCEPTANCE_TOOLS_JSON="$PWD/manure/scripts/acceptance-tools-x86_64-linux.json" \
  bash manure/scripts/run-owned-target.sh \
  /absolute/public-provider-env.json \
  /absolute/with-owned-postgres.py \
  /absolute/provision-owned-database.py jvm full
```

The provider descriptor has exactly `PG_BIN`, `PG_CONFIGURATION`, `PG_HBA`,
`PG_POLICY`, `PG_PROVIDER`; its provider implementation must also be immutable.
The launcher logs input hashes and observation time, not their contents. Missing
browser/SDK inputs fail; no ambient/default SDK or live endpoint is used. The
parent must supervise background execution and preserve the authoritative exit
status. Whole-test deadline remains 1800 seconds. `focused`/`core` are diagnostic.

For native mode replace `jvm full` with
`native /absolute/ELF /absolute/actual-build-source-manifest full`. Manifest
comparison must succeed; never manufacture a manifest from a different source
snapshot after the build. Tests, Node checks, codec checks and declared invariant
gaps remain strict; this tool descriptor is not an acceptance result.
