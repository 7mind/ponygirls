{ lib, buildNpmPackage }:
buildNpmPackage {
  pname = "haystack-locked-test-dependencies";
  version = "0.1.0";
  # Keyed on the npm manifests only: web or server source edits do not change node_modules.
  src = lib.fileset.toSource {
    root = ../../../haystack;
    fileset = lib.fileset.unions [ ../../../haystack/package.json ../../../haystack/package-lock.json
      ../../../haystack/web/package.json ../../../haystack/server/package.json ];
  };
  npmDepsHash = "sha256-WlhsXvvdzXnucSg0stQCCbL3u4ZqBauo3h4LMMBjPKE=";
  dontNpmBuild = true;
  installPhase = ''
    mkdir -p "$out/lib"
    cp -r node_modules "$out/lib/"
    # Workspace aliases are source-relative, not packaged test dependencies.
    rm "$out/lib/node_modules/@haystack/web" "$out/lib/node_modules/@haystack/server"
  '';
}
