{ lib, callPackage, buildNpmPackage, fetchNpmDeps, nodejs_24, makeWrapper, gitMinimal }:
let
  src = callPackage ./source.nix { };
  hashes = import ./hashes.nix;
in
buildNpmPackage {
  pname = "chronicle-collector";
  version = "0.1.0";
  inherit src;
  nodejs = nodejs_24;
  npmRoot = "collector";
  nativeBuildInputs = [ makeWrapper gitMinimal ];
  npmDeps = fetchNpmDeps {
    name = "chronicle-collector-npm-dependencies";
    src = lib.fileset.toSource {
      root = ../../../chronicle/collector;
      fileset = lib.fileset.unions [ ../../../chronicle/collector/package.json ../../../chronicle/collector/package-lock.json ];
    };
    hash = hashes.collector;
  };
  buildPhase = ''
    runHook preBuild
    cd collector
    npm run build
    cd ..
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    cd collector
    npm test
    cd ..
    runHook postCheck
  '';
  installPhase = ''
    mkdir -p "$out/lib/chronicle/collector"
    cp -r collector/dist "$out/lib/chronicle/collector/"
    install -m644 collector/package.json "$out/lib/chronicle/collector/package.json"
    makeWrapper ${nodejs_24}/bin/node "$out/bin/chronicle-collector" \
      --add-flags "$out/lib/chronicle/collector/dist/collector/src/cli.js" \
      --prefix PATH : ${lib.makeBinPath [ gitMinimal ]}
    install -Dm644 collector/README.md "$out/share/doc/chronicle-collector/README.md"
  '';
  meta = {
    description = "Private per-user Claude/Codex/Pi session archive collector";
    license = lib.licenses.mit;
    mainProgram = "chronicle-collector";
  };
}
