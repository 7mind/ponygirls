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
  patchShebangs scripts chronicle/scripts
  ${environment.setup}
  bash chronicle/scripts/test-fast.sh
  cd chronicle
  # One gate directory per selected suite: a suite that sbt testOnly silently skipped (a misspelt or deleted name)
  # leaves its directory without test cases, which the gate rejects.
  mkdir -p "$out/test-reports" gate
  while IFS= read -r suite; do
    mkdir "gate/$suite"
    if [[ -f "target/test-reports/TEST-$suite.xml" ]]; then cp "target/test-reports/TEST-$suite.xml" "gate/$suite/"; fi
  done < scripts/fast-suites.txt
  python3 ${../../../scripts/junit-gate.py} --counts "$out/counts.json" gate/*
  cp target/test-reports/*.xml "$out/test-reports/"
''
