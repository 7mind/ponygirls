{ buildNpmPackage, callPackage }:
let web = callPackage ./web.nix { };
in buildNpmPackage {
  pname = "haystack-locked-test-dependencies";
  version = "0.1.0";
  inherit (web) src;
  npmDepsHash = "sha256-WlhsXvvdzXnucSg0stQCCbL3u4ZqBauo3h4LMMBjPKE=";
  dontNpmBuild = true;
  installPhase = ''
    mkdir -p "$out/lib"
    cp -r node_modules "$out/lib/"
    # Workspace aliases are source-relative, not packaged test dependencies.
    rm "$out/lib/node_modules/@haystack/web" "$out/lib/node_modules/@haystack/server"
  '';
}
