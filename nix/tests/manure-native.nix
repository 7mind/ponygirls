# Complete service-owned target suite against the native ELF.
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
  MANURE_TEST_VIEWER_DIR = "${manurePackage}/share/manure/web/viewer";
  FONTCONFIG_FILE = pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; };
} // (import ./owned-postgres-environment.nix { inherit pkgs; })) ''
  cp -r ${sources.manureTargetTests} source
  chmod -R u+w source
  cd source
  readelf -lW ${native}/libexec/manure-server > headers.txt
  readelf -dW ${native}/libexec/manure-server > dynamic.txt
  if grep -q INTERP headers.txt; then echo 'unexpected: INTERP program header in headers.txt (dynamically linked server)' >&2; exit 1; fi
  if grep -q NEEDED dynamic.txt; then echo 'unexpected: NEEDED entry in dynamic.txt (dynamically linked server)' >&2; exit 1; fi
  mkdir "$out"
  export REPORT="$out"
  cat > run-target.sh <<'SH'
  set -euo pipefail
  unset MANURE_URL MANURE_URL_FILE MANURE_TOKEN MANURE_TOKEN_FILE MANURE_CACHE_DIR MANURE_ALLOW_INSECURE_HTTP MANURE_POSIX_LIBRARY
  export MANURE_TEST_ALLOW_CREATEDB=1
  jdbc_url=$(python3 -c 'import json,os;print(json.loads(os.environ["PONYGIRLS_TEST_DATABASE_MANURE"])["jdbcUrl"])')
  test -n "$jdbc_url"
  export MANURE_TEST_JDBC_URL=$jdbc_url
  export MANURE_TEST_JDBC_USER=manure
  password_file=$(python3 -c 'import json,os;print(json.loads(os.environ["PONYGIRLS_TEST_DATABASE_MANURE"])["passwordFile"])')
  test -n "$password_file"
  export MANURE_TEST_JDBC_PASSWORD_FILE=$password_file
  export PYTHONPATH="$PWD/manure:$PWD/manure/tests"
  # Class shards in NIX_BUILD_CORES (at most 8) worker processes against the one
  # owned cluster. Measured under load 150-190: serial 659 s; the isolated viewer
  # class 131-145 s; the other ~80 % of the serial work splits over shards-1.
  # Deadline ~2.3x that estimate (serial 1500 s), at least 420 s (~3x the viewer).
  cores=''${NIX_BUILD_CORES:-0}; (( cores > 0 )) || cores=$(nproc)
  shards=$(( cores < 8 ? cores : 8 ))
  if (( shards == 1 )); then deadline=1500; else deadline=$(( 1200 / (shards - 1) )); (( deadline > 420 )) || deadline=420; fi
  timeout --signal=TERM --kill-after=15s "$deadline" python3 manure/scripts/target-suite.py --report "$REPORT" --shards "$shards" > "$REPORT/run.log" 2>&1
  SH
  python3 ${./with-owned-postgres.py} ${pkgs.runtimeShell} run-target.sh || { cat "$out/run.log"; exit 1; }
''
