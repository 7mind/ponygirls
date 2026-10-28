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
      --outDir ../target/codec-js ../generated/typescript/chronicle/api/index.ts \
      ../generated/typescript/chronicle/api/v1_{0,1,2,3,4,5,6}_0/index.ts
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
    match=re.fullmatch(r'(\d+) generated TypeScript fixture groups passed; eight API versions, frozen1.0–1.6 contracts,1.7 rebuild/stage/context;(\d+) retained-version branch rejections\n',Path('protocol.log').read_text())
    if match is None: raise SystemExit('missing complete retained-version codec result')
    Path('protocol.json').write_text(json.dumps({'schemaVersion':1,'status':'passed','versions':8,'fixtureGroups':int(match[1]),'retainedBranchRejections':int(match[2]),'protocolSource':'${sources.protocol}'})+'\n')
    PY
    runHook postCheck
  '';
  installPhase = ''
    mkdir -p "$out"
    cp protocol.json protocol.log "$out/"
  '';
  passthru = { protocolSource = sources.protocol; };
}
