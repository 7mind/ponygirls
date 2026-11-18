# One complete current browser leg, actual packaged assets/actual NixOS proxy,
# real selected native ELF and true non-superuser shared-provider fixtures.
{ pkgs, haystackPackage, proxyFixture, fixtureTools }:
let
  sources=pkgs.callPackage ../pkg/chronicle/source.nix {};
  dependencies=pkgs.callPackage ../pkg/haystack/test-dependencies.nix {};
  native=haystackPackage.nativeArtifact;
in pkgs.runCommand "haystack-native-complete-browser" {
  nativeBuildInputs=[pkgs.coreutils];
} ''
  cp -r ${sources.haystackBrowserTests} source
  chmod -R u+w source
  cd source
  ln -s ${dependencies}/lib/node_modules haystack/node_modules
  mkdir -p haystack/web/dist
  cp -r ${haystackPackage}/share/haystack/web/. haystack/web/dist/
  # Do not nest the service runner that owns a separate cluster. This wrapper
  # owns exactly the declared provider fixture; preview tests explicitly own
  # their additional disposable standalone-launcher fixture as characterized.
  # The serial legs took 150-172 s under host load 147-167; about 2x that.
  timeout --signal=TERM --kill-after=10s 360s \
    ${fixtureTools}/bin/with-service-postgres \
    ${fixtureTools}/bin/with-browser-environment \
    ${fixtureTools}/bin/validate-haystack-native \
      ${native}/libexec/haystack-server "$out" ${proxyFixture} || {
        for log in "$out"/*.log; do [ ! -f "$log" ] || cat "$log"; done
        exit 1
      }
''
