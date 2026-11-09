{ lib, buildNpmPackage, fetchNpmDeps, nodejs_24, typescript, playwright-driver, makeFontsConf, dejavu_fonts }:
let
  root = ../../../rites;
  src = lib.cleanSourceWith {
    src = root;
    filter = path: type:
      let relative = lib.removePrefix "${toString root}/" (toString path);
          selected = entry: relative == entry || lib.hasPrefix "${entry}/" relative
            || (type == "directory" && lib.hasPrefix "${relative}/" entry);
      in toString path == toString root ||
        (lib.cleanSourceFilter path type && !(builtins.elem (baseNameOf path) [ "target" "node_modules" "test-results" "playwright-report" ])
          && lib.any selected [ "package.json" "web" "generated/typescript" ]);
  };
in buildNpmPackage {
  pname = "rites-browser-validation";
  version = "0.1.0";
  inherit src;
  nodejs = nodejs_24;
  npmRoot = "web/tests";
  npmDeps = fetchNpmDeps {
    name = "rites-browser-test-npm-dependencies";
    src = lib.fileset.toSource {
      root = ../../../rites/web/tests;
      fileset = lib.fileset.unions [ ../../../rites/web/tests/package.json ../../../rites/web/tests/package-lock.json ];
    };
    hash = "sha256-TjOFkbsbs3i4akrAC++8MsCcjDKG0j/CYurHHHA6aC8=";
  };
  nativeBuildInputs = [ typescript ];
  PLAYWRIGHT_BROWSERS_PATH = playwright-driver.browsers;
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  FONTCONFIG_FILE = makeFontsConf { fontDirectories = [ dejavu_fonts ]; };
  buildPhase = ''
    runHook preBuild
    mkdir -p node_modules/.bin
    ln -s ${typescript}/bin/tsc node_modules/.bin/tsc
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    set -o pipefail
    cd web/tests
    npm test 2>&1 | tee ../../browser-validation.log
    cd ../..
    runHook postCheck
  '';
  installPhase = ''
    mkdir -p "$out"
    cp browser-validation.log "$out/run.log"
  '';
  meta = {
    description = "Complete Rites Chromium interactions against a synthetic API fixture";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
  };
}
