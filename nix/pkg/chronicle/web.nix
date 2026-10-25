{ lib, stdenv, callPackage, buildNpmPackage, fetchNpmDeps, nodejs_24, playwright-driver, makeFontsConf, dejavu_fonts }:
let
  src = callPackage ./source.nix { };
  hashes = import ./hashes.nix;
in
buildNpmPackage {
  pname = "chronicle-web";
  version = "0.1.0";
  inherit src;
  nodejs = nodejs_24;
  npmRoot = "web";
  FONTCONFIG_FILE = makeFontsConf { fontDirectories = [ dejavu_fonts ]; };
  npmDeps = fetchNpmDeps {
    name = "chronicle-web-npm-dependencies";
    src = lib.fileset.toSource {
      root = ../../../chronicle/web;
      fileset = lib.fileset.unions [ ../../../chronicle/web/package.json ../../../chronicle/web/package-lock.json ];
    };
    hash = hashes.web;
  };
  buildPhase = ''
    runHook preBuild
    cd web
    npm run typecheck
    npm run build
    cd ..
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    cd web
    npm test
    ${lib.optionalString stdenv.hostPlatform.isLinux ''
      PLAYWRIGHT_BROWSERS_PATH=${playwright-driver.browsers} npm run test:browser
    ''}
    cd ..
    runHook postCheck
  '';
  installPhase = ''
    mkdir -p "$out/share/chronicle/web"
    cp -r web/dist/. "$out/share/chronicle/web/"
  '';
  meta = {
    description = "Chronicle session archive WebSocket dashboard";
    license = lib.licenses.mit;
  };
}
