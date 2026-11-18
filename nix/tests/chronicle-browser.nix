# Chronicle dashboard browser scenarios: the tests-browser/run-all.mjs pool with pinned Chromium, no backend.
{ lib, callPackage, buildNpmPackage, nodejs_24, python3, playwright-driver, makeFontsConf, dejavu_fonts }:
let
  sources = callPackage ../pkg/chronicle/source.nix { };
in buildNpmPackage {
  pname = "chronicle-browser";
  version = "0.1.0";
  src = sources.webBrowserTests;
  nodejs = nodejs_24;
  npmRoot = "web";
  npmDeps = callPackage ../pkg/chronicle/web-dependencies.nix { };
  nativeBuildInputs = [ python3 ];
  PLAYWRIGHT_BROWSERS_PATH = playwright-driver.browsers;
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  FONTCONFIG_FILE = makeFontsConf { fontDirectories = [ dejavu_fonts ]; };
  ACCOUNT_WEB_ROOT = lib.fileset.toSource {
    root = ../../shared/account-web;
    fileset = lib.fileset.unions [ ../../shared/account-web/account.js ../../shared/account-web/account-client.js ../../shared/account-web/account.css ];
  };
  UI_WEB_ROOT = callPackage ../pkg/ui-web.nix { };
  buildPhase = ''
    runHook preBuild
    export HOME="$TMPDIR"
    status=0
    (cd web && CHRONICLE_BROWSER_JUNIT_DIR="$out" node tests-browser/run-all.mjs) || status=$?
    python3 ${../../scripts/junit-gate.py} --counts "$out/counts.json" "$out"
    if (( status != 0 )); then exit "$status"; fi
    runHook postBuild
  '';
  installPhase = "runHook preInstall; runHook postInstall";
  dontFixup = true;
}
