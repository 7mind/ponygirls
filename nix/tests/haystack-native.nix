# Behavioral-Active/Blackbox-GoodCommunication. Full discovered executable
# suites with the actual static ELF and least-privileged shared provider role.
{ pkgs, haystackPackage }:
let
  sources = pkgs.callPackage ../pkg/chronicle/source.nix { };
  dependencies = pkgs.callPackage ../pkg/haystack/test-dependencies.nix { };
  native = haystackPackage.nativeArtifact;
in pkgs.runCommand "haystack-native-current-transport" ({
  nativeBuildInputs = [ pkgs.python3 pkgs.nodejs pkgs.coreutils pkgs.binutils ];
  HAYSTACK_SERVER_COMMAND = "${native}/libexec/haystack-server";
  HAYSTACK_ARTIFACT_KIND = "native";
  HAYSTACK_TEST_PROVISION_COMMAND = pkgs.writeShellScript "provision-owned-haystack-database" ''exec ${pkgs.python3}/bin/python3 ${./provision-owned-database.py} "$@"'';
  PONYGIRLS_TEST_PROVISION_SERVICE = "haystack";
} // (import ./owned-postgres-environment.nix { inherit pkgs; })) ''
  cp -r ${sources.haystackTests} source
  chmod -R u+w source
  cd source
  ln -s ${dependencies}/lib/node_modules haystack/node_modules
  # Toolchain-only adaptation: sandbox has no /bin/sh. Preserve all assertions.
  substituteInPlace haystack/server/tests-current/fixture.mjs \
    --replace-fail "'/bin/sh'" "'${pkgs.runtimeShell}'"
  readelf -lW ${native}/libexec/haystack-server > headers.txt
  readelf -dW ${native}/libexec/haystack-server > dynamic.txt
  ! grep -q INTERP headers.txt
  ! grep -q NEEDED dynamic.txt
  mkdir "$out"
  export RECEIPT_DIR="$out"
  cat > run-transport.sh <<'SH'
  set -euo pipefail
  export HAYSTACK_OWNED_TEST_DB=1
  export HAYSTACK_TEST_JDBC=$(python3 -c 'import json,os;print(json.loads(os.environ["PONYGIRLS_TEST_DATABASE_HAYSTACK"])["jdbcUrl"])')
  export HAYSTACK_TEST_DB_USER=haystack
  export HAYSTACK_TEST_DB_PASSWORD_FILE=$(python3 -c 'import json,os;print(json.loads(os.environ["PONYGIRLS_TEST_DATABASE_HAYSTACK"])["passwordFile"])')
  cd haystack
  timeout --signal=TERM --kill-after=10s 240s node --import ./scripts/register-generated.mjs --test --test-timeout=60000 --test-concurrency=1 \
    --test-reporter=tap --test-reporter-destination="$RECEIPT_DIR/transport.tap" \
    --test-reporter=junit --test-reporter-destination="$RECEIPT_DIR/transport.xml" \
    server/tests-current/*.test.mjs
  SH
  python3 ${./with-owned-postgres.py} ${pkgs.runtimeShell} run-transport.sh || { cat "$out/transport.tap"; exit 1; }
  python3 ${./native-receipt.py} --service haystack \
    --artifact ${native}/libexec/haystack-server --runtime-source ${sources.haystackServer} \
    --test-source ${sources.haystackTests} --inventory haystack/server/tests-current/inventory.json --xml "$out/transport.xml" --output "$out/receipt.json"
  cp headers.txt dynamic.txt "$out/"
  cp ${native}/share/haystack/compiled-inputs.sha256 "$out/"
''
