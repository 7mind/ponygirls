# Explicit test commands only; no production connection argument or live-system
# effects. The wrapper owns fresh marked PG state and always stops it afterward.
{ lib, pkgs, runCommand, makeWrapper, python3 }:
let environment=import ../../tests/owned-postgres-environment.nix {inherit pkgs;};
in runCommand "ponygirls-owned-service-test-tools" {
  nativeBuildInputs=[makeWrapper];
  meta={description="Owned disposable shared-provider fixtures; never application runtime dependencies";platforms=["x86_64-linux"];};
} ''
  mkdir -p "$out/bin"
  for service in haystack manure; do
    makeWrapper ${python3}/bin/python3 "$out/bin/provision-$service" \
      --add-flags ${../../tests/provision-owned-database.py} \
      --set PG_PROVIDER ${../../postgres/provider.py} \
      --set PONYGIRLS_TEST_PROVISION_SERVICE "$service"
  done
  makeWrapper ${pkgs.coreutils}/bin/env "$out/bin/with-browser-environment" \
    --set HAYSTACK_CHROMIUM ${pkgs.chromium}/bin/chromium \
    --set HAYSTACK_NGINX ${pkgs.nginx}/bin/nginx \
    --set FONTCONFIG_FILE ${pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; }} \
    --set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD 1 \
    --prefix PATH : ${environment.PG_BIN}:${lib.makeBinPath [pkgs.nodejs_24 pkgs.nix pkgs.openssl pkgs.curl pkgs.git pkgs.bash pkgs.coreutils python3]}
  makeWrapper ${python3}/bin/python3 "$out/bin/with-service-postgres" \
    --add-flags ${../../tests/with-owned-postgres.py} \
    ${lib.concatStringsSep " \\\n    " (lib.mapAttrsToList (key: value: "--set ${key} ${lib.escapeShellArg (toString value)}") environment)} \
    --set HAYSTACK_TEST_PROVISION_COMMAND "$out/bin/provision-haystack" \
    --set MANURE_TEST_PROVISION_COMMAND "$out/bin/provision-manure" \
    --prefix PATH : ${environment.PG_BIN}:${lib.makeBinPath [python3 pkgs.coreutils]}
''
