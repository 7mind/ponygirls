# Shared account web UI: the pure Node client cases (shared/account-web/tests/account-client.test.mjs) and the browser
# entry shared/account-web/tests/browser.mjs in pinned Chromium (README "Verification"); the browser entry loads
# playwright-core from the Chronicle dashboard's locked dependencies.
{ callPackage, buildNpmPackage, nodejs_24, python3, playwright-driver, makeFontsConf, dejavu_fonts }:
let
  sources = callPackage ../pkg/chronicle/source.nix { };
  entry = "shared/account-web/tests/browser.mjs";
  clientTests = "shared/account-web/tests/account-client.test.mjs";
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
  # The browser entry is one script, not a node:test file: it is recorded as one JUnit case. Each part is gated on
  # its own directory, so one part's empty run cannot hide behind the other.
  buildPhase = ''
    runHook preBuild
    export HOME="$TMPDIR"
    mkdir -p "$out/client" "$out/browser"
    status=0
    node --test --test-reporter=spec --test-reporter-destination=stdout \
      --test-reporter=junit --test-reporter-destination="$out/client/account-client.xml" ${clientTests} || status=$?
    started=$SECONDS
    browser=0
    node ${entry} || browser=$?
    outcome=""
    if (( browser != 0 )); then outcome="<failure message=\"exit $browser\"/>"; status=$browser; fi
    printf '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="account-web-browser" tests="1">\n  <testcase classname="shared.account-web" name="%s" time="%s">%s</testcase>\n</testsuite>\n' \
      ${entry} "$((SECONDS - started))" "$outcome" > "$out/browser/account-web-browser.xml"
    python3 ${../../scripts/junit-gate.py} --counts "$out/counts.json" "$out/client" "$out/browser"
    if (( status != 0 )); then exit "$status"; fi
    runHook postBuild
  '';
  installPhase = "runHook preInstall; runHook postInstall";
  dontFixup = true;
}
