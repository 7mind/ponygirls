{ lib, callPackage, buildNpmPackage, fetchNpmDeps, nodejs_24, python3 }:
let
  sources = callPackage ./source.nix { };
  hashes = import ./hashes.nix;
in buildNpmPackage {
  pname = "chronicle-protocol-validation";
  version = "0.1.0";
  src = sources.protocol;
  nodejs = nodejs_24;
  npmRoot = "web";
  nativeBuildInputs = [ python3 ];
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
    python3 - <<'PY'
    import json,re
    from pathlib import Path
    match=re.fullmatch(r'(\d+) generated TypeScript fixture groups passed; 1 API version \(([^)]+)\); no conversion chain\n',Path('protocol.log').read_text())
    if match is None or int(match[1]) != 14: raise SystemExit('missing complete single-version codec result')
    Path('protocol.json').write_text(json.dumps({'schemaVersion':2,'status':'passed','versions':1,'apiVersion':match[2],'fixtureGroups':int(match[1]),'protocolSource':'${sources.protocol}'})+'\n')
    PY
    runHook postCheck
  '';
  installPhase = ''
    mkdir -p "$out"
    cp protocol.json protocol.log "$out/"
  '';
  passthru = { protocolSource = sources.protocol; };
}
