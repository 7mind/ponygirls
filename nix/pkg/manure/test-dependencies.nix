{ buildNpmPackage }:
buildNpmPackage {
  pname = "manure-official-mcp-sdk-test-dependencies";
  version = "1.32.1";
  src = ../../tests/manure-sdk;
  npmDepsHash = "sha256-ehsj472Bpd0FAec5WtNKa0aUX/vePHVaqoMQ7ljwl2U=";
  dontNpmBuild = true;
  installPhase = ''mkdir -p "$out/lib"; cp -r node_modules "$out/lib/"'';
}
