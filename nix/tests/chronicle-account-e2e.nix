# Accounts end to end against a real Chronicle server: the shared scenario (shared/account-web/tests/e2e/flow.mjs)
# through chronicle/scripts/account-e2e.mjs, with the packaged native server in serve-standby mode, the packaged
# dashboard, an owned disposable PostgreSQL (with-service-postgres) and the pinned Chromium. One JUnit case.
{ lib, callPackage, buildNpmPackage, nodejs_24, python3, coreutils, playwright-driver, makeFontsConf, dejavu_fonts, chroniclePackage, fixtureTools }:
let
  entry = "chronicle/scripts/account-e2e.mjs";
in buildNpmPackage {
  pname = "chronicle-account-e2e";
  version = "0.1.0";
  # Exact inputs: the harness, the shared scenario and the dashboard lock that provides playwright-core.
  src = lib.fileset.toSource {
    root = ../..;
    fileset = lib.fileset.unions [ ../../chronicle/web/package.json ../../chronicle/web/package-lock.json
      ../../chronicle/scripts/account-e2e.mjs ../../shared/account-web/tests/e2e/flow.mjs ];
  };
  nodejs = nodejs_24;
  npmRoot = "chronicle/web";
  npmDeps = callPackage ../pkg/chronicle/web-dependencies.nix { };
  nativeBuildInputs = [ python3 coreutils ];
  PLAYWRIGHT_BROWSERS_PATH = playwright-driver.browsers;
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  FONTCONFIG_FILE = makeFontsConf { fontDirectories = [ dejavu_fonts ]; };
  CHRONICLE_SERVER = "${chroniclePackage.nativeArtifact}/libexec/chronicle-server";
  CHRONICLE_WEB_ROOT = "${chroniclePackage.web}/share/chronicle/web";
  buildPhase = ''
    runHook preBuild
    export HOME="$TMPDIR"
    mkdir -p "$out/e2e"
    started=$SECONDS
    status=0
    # The flow took 40-60 s under host load 110-120 (one TOTP step wait of up to 30 s included); about 4x that.
    timeout --signal=TERM --kill-after=10s 300s ${fixtureTools}/bin/with-service-postgres node ${entry} > "$out/e2e.log" 2>&1 || status=$?
    cat "$out/e2e.log"
    outcome=""
    if (( status != 0 )); then outcome="<failure message=\"exit $status\"/>"; fi
    printf '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="chronicle-account-e2e" tests="1">\n  <testcase classname="chronicle.accounts" name="%s" time="%s">%s</testcase>\n</testsuite>\n' \
      ${entry} "$((SECONDS - started))" "$outcome" > "$out/e2e/chronicle-account-e2e.xml"
    python3 ${../../scripts/junit-gate.py} --counts "$out/counts.json" "$out/e2e"
    if (( status != 0 )); then exit "$status"; fi
    runHook postBuild
  '';
  installPhase = "runHook preInstall; runHook postInstall";
  dontFixup = true;
}
