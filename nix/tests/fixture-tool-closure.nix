# Deliberately does NOT depend on the whole flake source. The package must carry
# explicit leaf source references for provider, paired helper and validator.
{ pkgs, fixtureTools }:
pkgs.runCommand "owned-fixture-tool-real-sandbox-closure" {
  exportReferencesGraph=["fixture-closure" fixtureTools];
  UNDECLARED_ROOT_SNAPSHOT=builtins.unsafeDiscardStringContext (toString ../..);
  EXPECTED_PROVIDER_SHA256=builtins.hashFile "sha256" ../postgres/provider.py;
} ''
  ${fixtureTools}/bin/with-service-postgres \
    ${fixtureTools}/bin/with-browser-environment \
    python3 ${./fixture-tool-closure.py} "$out"
''
