{ runCommand, callPackage, python3, squishLib }:
let
  sources = callPackage ./source.nix { };
  environment = callPackage ./sbt-environment.nix { inherit squishLib; };
in runCommand "chronicle-full-backend-validation" {
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
  export POSTGRES_HOME=${environment.tools.postgres}
  bash scripts/test-postgres.sh
  mkdir -p "$out"
  python3 scripts/validation-report.py --inventory target/validation-inventory.txt \
    --reports target/test-reports --runtime-source ${sources.server} \
    --test-source ${sources.backendTests} --output "$out/backend.json"
  cp -r target/test-reports "$out/"
  cp target/validation-inventory.txt "$out/"
''
