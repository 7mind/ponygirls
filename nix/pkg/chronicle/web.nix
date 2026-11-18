{ lib, callPackage, buildNpmPackage, fetchNpmDeps, nodejs_24 }:
let
  src = (callPackage ./source.nix { }).web;
  hashes = import ./hashes.nix;
  accountWeb = lib.fileset.toSource {
    root = ../../../shared/account-web;
    fileset = lib.fileset.unions [ ../../../shared/account-web/account.js ../../../shared/account-web/account.css ];
  };
  uiWeb = callPackage ../ui-web.nix { };
in
buildNpmPackage {
  pname = "chronicle-web";
  version = "0.1.0";
  inherit src;
  nodejs = nodejs_24;
  npmRoot = "web";
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
    ACCOUNT_WEB_ROOT=${accountWeb} UI_WEB_ROOT=${uiWeb} npm run build
    cd ..
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    cd web
    UI_WEB_ROOT=${uiWeb} npm test
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
