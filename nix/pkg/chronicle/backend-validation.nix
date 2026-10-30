{ runCommand, callPackage, python3, squishLib }:
let
  sources = callPackage ./source.nix { };
  environment = callPackage ./sbt-environment.nix { inherit squishLib; };
in runCommand "chronicle-fast-backend-validation" {
  nativeBuildInputs = [ environment.tools.graal python3 ];
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
  passthru = { runtimeSource = sources.server; testSource = sources.backendTests; };
} ''
  cp -r ${sources.backendTests} source
  chmod -R u+w source
  cd source
  patchShebangs scripts
  ${environment.setup}
  bash scripts/test-fast.sh
  mkdir -p "$out"
  python3 scripts/validation-report.py --inventory target/validation-inventory.txt \
    --selected-suites scripts/fast-suites.txt --reports target/test-reports --runtime-source ${sources.server} \
    --test-source ${sources.backendTests} --output "$out/backend.json"
  cp -r target/test-reports "$out/"
  cp target/validation-inventory.txt scripts/fast-suites.txt "$out/"
''
