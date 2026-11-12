{ lib, callPackage, buildNpmPackage, fetchNpmDeps, nodejs_24 }:
let
  src = (callPackage ../chronicle/source.nix { }).ontologyWeb;
in buildNpmPackage {
  pname = "ontology-web";
  version = "0.1.0";
  inherit src;
  nodejs = nodejs_24;
  npmRoot = "web";
  npmDeps = fetchNpmDeps {
    name = "ontology-web-npm-dependencies";
    src = lib.fileset.toSource {
      root = ../../../ontology/web;
      fileset = lib.fileset.unions [ ../../../ontology/web/package.json ../../../ontology/web/package-lock.json ];
    };
    hash = "sha256-1I6f8qeJab/OWNI0NLLoBlOxJiQbivWN7Rzucs22658=";
  };
  buildPhase = ''
    runHook preBuild
    cd web
    npm run typecheck
    npm run build
    cd ..
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    cd web
    npm test
    cd ..
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/share/ontology/web"
    cp -r web/dist/. "$out/share/ontology/web/"
    runHook postInstall
  '';
  meta = {
    description = "Ontology Human review dashboard assets";
    license = lib.licenses.mit;
  };
}
