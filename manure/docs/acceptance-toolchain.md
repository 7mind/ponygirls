# Explicit full-acceptance tools (Linux x86_64)

`../scripts/acceptance-tools-x86_64-linux.json` contains **public tool paths**,
not credentials: the exact values the `manure-native` check exports (Chromium
157.0.8103.38, `playwright-core` 1.64.1, the official `@modelcontextprotocol/sdk`
1.32.2 from `nix/pkg/manure/test-dependencies.nix`, OpenSSL and a DejaVu
`fonts.conf`). `.#chronicle` alone does **not** export them. After a nixpkgs or
dependency update, regenerate the file from the check's derivation:

```sh
nix derivation show "$(nix eval --raw .#checks.x86_64-linux.manure-native.drvPath)" | python3 -c '
import json, sys
env = next(iter(json.load(sys.stdin)["derivations"].values()))["env"]
keys = ["MANURE_PLAYWRIGHT_CORE_PATH", "MANURE_CHROMIUM_BIN", "MANURE_MCP_SDK_PATH", "MANURE_OPENSSL_BIN", "FONTCONFIG_FILE"]
print(json.dumps({key: env[key] for key in keys}, indent=2))'
```

and realize the paths (`nix build .#checks.x86_64-linux.manure-native` does).

Run in the pinned development environment, with an **explicit** tools descriptor
and immutable copies of the three owned PostgreSQL provider inputs:

```sh
nix develop .#chronicle --command env \
  MANURE_ACCEPTANCE_TOOLS_JSON="$PWD/manure/scripts/acceptance-tools-x86_64-linux.json" \
  bash manure/scripts/run-owned-target.sh \
  /absolute/public-provider-env.json \
  /absolute/with-owned-postgres.py \
  /absolute/provision-owned-database.py jvm
```

The provider descriptor has exactly `PG_BIN`, `PG_CONFIGURATION`, `PG_HBA`,
`PG_POLICY`, `PG_PROVIDER`; its provider implementation must also be immutable.
Missing browser/SDK inputs fail; no ambient/default SDK or live endpoint is used.
Whole-run deadline: 1800 seconds. Test names after the mode select a diagnostic
subset. For native mode replace `jvm` with `native /absolute/ELF`. The run fails
on any failure, error, skip or empty run; this tool descriptor is not an
acceptance result.
