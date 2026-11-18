# Shared account web UI in pinned Chromium. Contract: the single entry shared/account-web/tests/browser.mjs (README
# "Verification"); it loads playwright-core from the Chronicle dashboard's locked dependencies.
{ callPackage, buildNpmPackage, nodejs_24, python3, playwright-driver, makeFontsConf, dejavu_fonts }:
let
  sources = callPackage ../pkg/chronicle/source.nix { };
  entry = "shared/account-web/tests/browser.mjs";
in buildNpmPackage {
  pname = "account-web-browser";
  version = "0.1.0";
  src = sources.accountWebBrowserTests;
  nodejs = nodejs_24;
  npmRoot = "chronicle/web";
  npmDeps = callPackage ../pkg/chronicle/web-dependencies.nix { };
  nativeBuildInputs = [ python3 ];
  PLAYWRIGHT_BROWSERS_PATH = playwright-driver.browsers;
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  FONTCONFIG_FILE = makeFontsConf { fontDirectories = [ dejavu_fonts ]; };
  # The entry is one script, not a node:test file: it is recorded as one JUnit case.
  buildPhase = ''
    runHook preBuild
    export HOME="$TMPDIR"
    started=$SECONDS
    status=0
    node ${entry} || status=$?
    outcome=""
    if (( status != 0 )); then outcome="<failure message=\"exit $status\"/>"; fi
    mkdir -p "$out"
    printf '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="account-web-browser" tests="1">\n  <testcase classname="shared.account-web" name="%s" time="%s">%s</testcase>\n</testsuite>\n' \
      ${entry} "$((SECONDS - started))" "$outcome" > "$out/account-web-browser.xml"
    python3 ${../../scripts/junit-gate.py} "$out"
    runHook postBuild
  '';
  installPhase = "runHook preInstall; runHook postInstall";
  dontFixup = true;
}
