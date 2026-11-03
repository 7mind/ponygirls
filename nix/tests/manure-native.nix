# Complete service-owned target-process inventory, not legacy Python server tests.
# Full browser run is intentionally long; do not replace it with diagnostic core.
{ pkgs, manurePackage }:
let
  sources = pkgs.callPackage ../pkg/chronicle/source.nix { };
  native = manurePackage.nativeArtifact;
  sdk = pkgs.callPackage ../pkg/manure/test-dependencies.nix { };
  postgres = pkgs.postgresql_18.withPackages (p: [ p.pgvector ]);
in pkgs.runCommand "manure-native-full-target" ({
  nativeBuildInputs = [ pkgs.python3 pkgs.nodejs pkgs.chromium pkgs.playwright-driver pkgs.openssl pkgs.coreutils pkgs.binutils postgres ];
  MANURE_TEST_SERVER_COMMAND_JSON = builtins.toJSON [ "${native}/libexec/manure-server" ];
  MANURE_TEST_PROVISION_COMMAND = pkgs.writeShellScript "provision-owned-manure-database" ''exec ${pkgs.python3}/bin/python3 ${./provision-owned-database.py} "$@"'';
  PONYGIRLS_TEST_PROVISION_SERVICE = "manure";
  MANURE_PLAYWRIGHT_CORE_PATH = pkgs.playwright-driver;
  MANURE_CHROMIUM_BIN = "${pkgs.chromium}/bin/chromium";
  MANURE_OPENSSL_BIN = "${pkgs.openssl}/bin/openssl";
  MANURE_MCP_SDK_PATH = "${sdk}/lib/node_modules/@modelcontextprotocol/sdk";
  FONTCONFIG_FILE = pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; };
} // (import ./owned-postgres-environment.nix { inherit pkgs; })) ''
  cp -r ${sources.manureTargetTests} source
  chmod -R u+w source
  cd source
  # Binding is calculated in the ACTUAL filtered build before compilation, not
  # manufactured now from test input. Any affected source difference fails closed.
  python3 manure/scripts/artifact-source.py > current-artifact-source.sha256
  cmp current-artifact-source.sha256 ${native}/share/manure/compiled-inputs.sha256
  readelf -lW ${native}/libexec/manure-server > headers.txt
  readelf -dW ${native}/libexec/manure-server > dynamic.txt
  ! grep -q INTERP headers.txt
  ! grep -q NEEDED dynamic.txt
  mkdir "$out"
  export REPORT="$out"
  cat > run-target.sh <<'SH'
  set -euo pipefail
  unset MANURE_URL MANURE_URL_FILE MANURE_TOKEN MANURE_TOKEN_FILE MANURE_CACHE_DIR MANURE_ALLOW_INSECURE_HTTP MANURE_POSIX_LIBRARY
  export MANURE_TEST_ALLOW_CREATEDB=1
  export MANURE_TEST_JDBC_URL=$(python3 -c 'import json,os;print(json.loads(os.environ["PONYGIRLS_TEST_DATABASE_MANURE"])["jdbcUrl"])')
  export MANURE_TEST_JDBC_USER=manure
  export MANURE_TEST_JDBC_PASSWORD_FILE=$(python3 -c 'import json,os;print(json.loads(os.environ["PONYGIRLS_TEST_DATABASE_MANURE"])["passwordFile"])')
  export PYTHONPATH="$PWD/manure:$PWD/manure/tests"
  timeout --signal=TERM --kill-after=15s 1800s python3 manure/scripts/target-suite.py --scope full --report "$REPORT" > "$REPORT/run.log" 2>&1
  SH
  python3 ${./with-owned-postgres.py} ${pkgs.runtimeShell} run-target.sh || { cat "$out/run.log"; exit 1; }
  cp current-artifact-source.sha256 headers.txt dynamic.txt "$out/"
  sha256sum ${native}/libexec/manure-server > "$out/artifact.sha256"
  python3 - "$out" <<'PY'
  import json,pathlib,sys
  root=pathlib.Path(sys.argv[1]); summary=json.loads((root/'summary.json').read_text()); inventory=json.loads((root/'inventory.json').read_text())
  assert summary['scope']=='full' and summary['tests']>0 and summary['tests']==summary['expected']==len(inventory['tests']) and summary['inventoryMatches']
  assert all(summary[k]==0 for k in ['failures','errors','skipped','expectedFailures','unexpectedSuccesses'])
  summary.update(runtimeSource='${sources.manureServer}',testSource='${sources.manureTargetTests}',artifact='${native}/libexec/manure-server',scope='complete-service-owned-full-target-native-inventory; not deployment acceptance')
  (root/'receipt.json').write_text(json.dumps(summary,indent=2)+'\n')
  PY
''
