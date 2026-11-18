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
  HAYSTACK_TEST_PROVISION_COMMAND = pkgs.writeShellScript "provision-owned-haystack-database" ''exec ${pkgs.python3}/bin/python3 ${./provision-owned-database.py} "$@"'';
  PONYGIRLS_TEST_PROVISION_SERVICE = "haystack";
} // (import ./owned-postgres-environment.nix { inherit pkgs; })) ''
  cp -r ${sources.haystackTests} source
  chmod -R u+w source
  cd source
  ln -s ${dependencies}/lib/node_modules haystack/node_modules
  cp ${../../scripts/junit-gate.py} scripts/junit-gate.py
  # Toolchain-only adaptation: the sandbox has no /bin/sh.
  substituteInPlace haystack/server/tests-current/fixture.mjs \
    --replace-fail "'/bin/sh'" "'${pkgs.runtimeShell}'"
  readelf -lW ${native}/libexec/haystack-server > headers.txt
  readelf -dW ${native}/libexec/haystack-server > dynamic.txt
  ! grep -q INTERP headers.txt
  ! grep -q NEEDED dynamic.txt
  HAYSTACK_REPORT_DIR="$out" python3 ${./with-owned-postgres.py} ${pkgs.runtimeShell} haystack/scripts/test-current.sh
''
