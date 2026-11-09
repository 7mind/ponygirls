{ runCommand, callPackage, python3, git, squishLib }:
let
  sources = callPackage ../chronicle/source.nix { };
  environment = callPackage ../chronicle/sbt-environment.nix { inherit squishLib; };
in runCommand "rites-backend-validation" {
  nativeBuildInputs = [ environment.tools.graal environment.tools.postgres python3 git ];
  POSTGRES_HOME = environment.tools.postgres;
  RITES_SOURCE_IDENTITY = toString sources.ritesTests;
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
  passthru = { testSource = sources.ritesTests; };
} ''
  cp -r ${sources.ritesTests} source
  chmod -R u+w source
  cd source
  ${environment.setup}
  bash rites/scripts/test-postgres.sh
  mkdir -p "$out"
  cp -r rites/server/target/validation-runs "$out/"
''
