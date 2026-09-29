{ lib, python3, python3Packages }:
let
  testPython = python3.withPackages (p: [ p.rich ]);
in
python3Packages.buildPythonApplication {
  pname = "tokemon";
  version = "0.1.0";
  pyproject = true;
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [
      ./pyproject.toml
      ./src
      ./tests
    ];
  };

  build-system = [ python3Packages.setuptools ];
  dependencies = [ python3Packages.rich ];

  # Live-endpoint tests skip unless TOKEMON_LIVE=1 (never set in the build).
  checkPhase = ''
    runHook preCheck
    PYTHONPATH=$PWD/src:$PWD/tests ${testPython}/bin/python -m unittest discover -s tests -v
    runHook postCheck
  '';
  pythonImportsCheck = [ "tokemon" ];

  meta = {
    description = "Token quota dashboard for yolo codex/claude profiles and pi provider credentials";
    mainProgram = "tokemon";
  };
}
