{ runCommand, callPackage, python3, squishLib }:
let
  source = (callPackage ./chronicle/source.nix { }).foundation;
  environment = callPackage ./chronicle/sbt-environment.nix { inherit squishLib; };
in runCommand "backend-foundation-validation" {
  nativeBuildInputs = [ environment.tools.graal python3 ];
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
  passthru = { foundationSource = source; };
} ''
  cp -r ${source} source
  chmod -R u+w source
  cd source
  ${environment.setup}
  # Separate from Chronicle's fixed fast allowlist; these are complete module
  # suites. Fresh filtered source means no stale inventory or XML can survive.
  bash scripts/backend-sbt.sh 'losslessJson / Test / validationInventory' 'losslessJson / test' \
    'manureStorage / Test / validationInventory' 'manureStorage / test'
  mkdir -p "$out"
  python3 scripts/backend-foundation-report.py --source ${source} --output "$out/foundation.json"
  for module in shared/lossless-json manure/server; do
    mkdir -p "$out/$module"
    cp -r "$module/target/test-reports" "$module/target/validation-inventory.txt" "$out/$module/"
  done
''
