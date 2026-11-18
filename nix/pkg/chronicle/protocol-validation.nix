{ lib, callPackage, buildNpmPackage, fetchNpmDeps, nodejs_24 }:
let
  sources = callPackage ./source.nix { };
  hashes = import ./hashes.nix;
in buildNpmPackage {
  pname = "chronicle-protocol-validation";
  version = "0.1.0";
  src = sources.protocol;
  nodejs = nodejs_24;
  npmRoot = "web";
  npmDeps = fetchNpmDeps {
    name = "chronicle-web-npm-dependencies";
    src = lib.fileset.toSource {
      root = ../../../chronicle/web;
      fileset = lib.fileset.unions [ ../../../chronicle/web/package.json ../../../chronicle/web/package-lock.json ];
    };
    hash = hashes.web;
  };
  buildPhase = ''
    runHook preBuild
    cd web
    node_modules/.bin/tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck \
      --rootDir .. --outDir ../target/codec-js ../generated/typescript/chronicle/api/index.ts
    cd ..
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    set -o pipefail
    node scripts/codec-fixtures.mjs | tee protocol.log
    runHook postCheck
  '';
  installPhase = ''
    mkdir -p "$out"
    cp protocol.log "$out/"
  '';
  passthru = { protocolSource = sources.protocol; };
}
