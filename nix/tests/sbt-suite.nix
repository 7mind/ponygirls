# Exact-input JVM suite check: runs a suite runner on its filtered source with the offline sbt environment and keeps
# only the JUnit XML of the report directories and the gate's counts.json.
{ lib, runCommand, callPackage, python3, squishLib }:
let
  environment = callPackage ../pkg/chronicle/sbt-environment.nix { inherit squishLib; };
in { name, source, nativeBuildInputs, runner, reports }:
runCommand name {
  nativeBuildInputs = [ environment.tools.graal python3 ] ++ nativeBuildInputs;
  POSTGRES_HOME = environment.tools.postgres;
  LANG = "C.UTF-8";
  LC_ALL = "C.UTF-8";
} ''
  cp -r ${source} source
  chmod -R u+w source
  cd source
  for scripts in scripts */scripts; do if [[ -d "$scripts" ]]; then patchShebangs "$scripts"; fi; done
  ${environment.setup}
  status=0
  ${runner} || status=$?
  for report in ${lib.escapeShellArgs reports}; do
    if [[ -d "$report" ]]; then mkdir -p "$out/$report" && cp "$report"/*.xml "$out/$report/"; fi
  done
  python3 ${../../scripts/junit-gate.py} "$out"
  exit "$status"
''
