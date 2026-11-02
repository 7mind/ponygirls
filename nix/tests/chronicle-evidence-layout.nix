# Regression: receipt creation must read the real filtered repository-root test
# layout, not a synthetic Chronicle-root layout. Synthetic artifacts are never
# executed or presented as actual Chronicle validation.
{ pkgs }:
let
  sources = pkgs.callPackage ../pkg/chronicle/source.nix { };
  native = pkgs.runCommand "chronicle-layout-fixture-native" { } ''
    mkdir -p "$out/libexec"
    printf '\177ELFsynthetic-not-executed' > "$out/libexec/chronicle-server"
  '';
  backend = pkgs.runCommand "chronicle-layout-fixture-backend" { nativeBuildInputs = [ pkgs.python3 ]; } ''
    mkdir -p "$out"
    python3 - "$out" <<'PY'
    import json,sys
    from pathlib import Path
    output = Path(sys.argv[1])
    selected = Path('${sources.backendTests}/chronicle/scripts/fast-suites.txt').read_text().splitlines()
    assert selected and len(selected) == len(set(selected))
    (output/'validation-inventory.txt').write_text('\n'.join(sorted(selected))+'\n')
    (output/'backend.json').write_text(json.dumps({
        'schemaVersion': 2, 'status': 'passed', 'scope': 'fast-explicit-suite-subset',
        'runtimeSource': '${sources.server}', 'testSource': '${sources.backendTests}',
        'tests': len(selected), 'suites': len(selected), 'failed': 0, 'errors': 0, 'skipped': 0,
        'suiteCounts': {name: 1 for name in selected},
        'selectedSuites': selected, 'discoveredSuites': len(selected)
    }))
    PY
  '';
  protocol = pkgs.writeTextDir "protocol.json" (builtins.toJSON {
    schemaVersion = 2; status = "passed"; versions = 1; apiVersion = "1.9.0";
    fixtureGroups = 16; protocolSource = toString sources.protocol;
  });
  inputs = pkgs.writeText "chronicle-layout-fixture-inputs.json" (builtins.toJSON {
    nativeArtifact = toString native;
    nativeDerivation = builtins.unsafeDiscardOutputDependency native.drvPath;
    runtimeSource = toString sources.server;
    testSource = toString sources.backendTests;
    backendValidation = toString backend;
    backendDerivation = builtins.unsafeDiscardOutputDependency backend.drvPath;
    protocolValidation = toString protocol;
    protocolDerivation = builtins.unsafeDiscardOutputDependency protocol.drvPath;
    protocolSource = toString sources.protocol;
  });
in pkgs.runCommand "chronicle-evidence-layout-regression" { nativeBuildInputs = [ pkgs.python3 ]; } ''
  mkdir -p "$out"
  test -f ${sources.backendTests}/chronicle/scripts/fast-suites.txt
  test ! -e ${sources.backendTests}/scripts/fast-suites.txt
  python3 ${../pkg/chronicle/validation-evidence.py} create --inputs ${inputs} --receipt "$out/synthetic-validation.json"
  python3 ${../pkg/chronicle/validation-evidence.py} verify --inputs ${inputs} --receipt "$out/synthetic-validation.json"
''
