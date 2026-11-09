{ runCommand, callPackage, python3, squishLib }:
let
  source = (callPackage ./chronicle/source.nix { }).foundation;
  bridge = callPackage ./manure/posix.nix { };
  environment = callPackage ./chronicle/sbt-environment.nix { inherit squishLib; };
in runCommand "backend-foundation-validation" {
  nativeBuildInputs = [ environment.tools.graal python3 ];
  MANURE_POSIX_LIBRARY = "${bridge.shared}/lib/libmanure_posix.so";
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
  passthru = { foundationSource = source; posixLibrary = bridge.shared; };
} ''
  cp -r ${source} source
  chmod -R u+w source
  cd source
  ${environment.setup}
  # Separate from Chronicle's fixed fast allowlist; these are complete module
  # suites. Fresh filtered source means no stale inventory or XML can survive.
  bash scripts/backend-sbt.sh 'losslessJson / Test / validationInventory' 'losslessJson / testFull' \
    'manureStorage / Test / validationInventory' 'manureStorage / testFull'
  mkdir -p "$out"
  python3 scripts/backend-foundation-report.py --source ${source} --output "$out/foundation.json"
  printf '%s\n' "$MANURE_POSIX_LIBRARY" > "$out/posix-library"
  sha256sum "$MANURE_POSIX_LIBRARY" > "$out/posix-library.sha256"
  for module in shared/lossless-json manure/server; do
    mkdir -p "$out/$module"
    cp -r "$module/target/test-reports" "$module/target/validation-inventory.txt" "$out/$module/"
  done
''
