# On-demand check (`nix build .#onDemand.legacy-retirement-scripts`): the shell fixture suites of the one-off
# legacy-retirement scripts (scripts/one-off/legacy-retirement: argument validation, the operator wrapper against a
# stand-in kubectl, the drop tool's guard, the predicates shared with the retained check-legacy-free.sql files, test
# isolation), each on its own owned PostgreSQL cluster in the sandbox. The JVM cases of the same scripts run in the
# Chronicle and Haystack full suites. Deleted together with the one-off scripts.
{ runCommand, callPackage, python3, squishLib }:
let
  sources = callPackage ../pkg/chronicle/source.nix { };
  environment = callPackage ../pkg/chronicle/sbt-environment.nix { inherit squishLib; };
in runCommand "legacy-retirement-scripts" {
  nativeBuildInputs = [ python3 ];
  POSTGRES_HOME = environment.tools.postgres;
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
} ''
  cp -r ${sources.legacyRetirementScripts} source
  chmod -R u+w source
  cd source
  patchShebangs scripts/one-off/legacy-retirement
  bash scripts/one-off/legacy-retirement/test-drop-databases.sh
  bash scripts/one-off/legacy-retirement/test-scripts.sh
  touch "$out"
''
