{ runCommand, callPackage, squishLib }:
let
  sources = callPackage ../pkg/chronicle/source.nix { };
  environment = callPackage ../pkg/chronicle/sbt-environment.nix { inherit squishLib; };
in runCommand "backend-filtered-contract-coassembly" {
  nativeBuildInputs = [ environment.tools.graal ];
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
} ''
  cp -r ${sources.backendDevelopment} source
  chmod -R u+w source
  cd source
  ${environment.setup}
  set -o pipefail
  bash scripts/backend-sbt.sh contractCoassembly 2>&1 | tee coassembly.log
  mkdir -p "$out"
  cp target/contracts-coassembly.jar "$out/"
  cp coassembly.log "$out/"
  printf '%s\n' '${sources.backendDevelopment}' > "$out/source-path"
  sha256sum "$out/contracts-coassembly.jar" > "$out/artifact.sha256"
''
