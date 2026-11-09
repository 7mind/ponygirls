{ buildNpmPackage }:
buildNpmPackage {
  pname = "manure-official-mcp-sdk-test-dependencies";
  version = "1.32.2";
  src = ../../tests/manure-sdk;
  npmDepsHash = "sha256-ambUZKVpKRTm/MWTq4A59MLSsEjLNMormWcHbQlaSuU=";
  dontNpmBuild = true;
  installPhase = ''mkdir -p "$out/lib"; cp -r node_modules "$out/lib/"'';
}
