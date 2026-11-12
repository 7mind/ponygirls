{ lib, callPackage, buildNpmPackage, fetchNpmDeps, nodejs_24, pi-coding-agent }:
let
  src = (callPackage ../chronicle/source.nix { }).ontologyWorker;
  sdkRoot = "${pi-coding-agent}/lib/node_modules/pi-monorepo";
in buildNpmPackage {
  pname = "ontology-worker";
  version = "0.1.0";
  inherit src;
  nodejs = nodejs_24;
  npmRoot = "worker";
  npmFlags = [ "--legacy-peer-deps" "--ignore-scripts" ];
  npmDeps = fetchNpmDeps {
    name = "ontology-worker-npm-dependencies";
    src = lib.fileset.toSource {
      root = ../../../ontology/worker;
      fileset = lib.fileset.unions [ ../../../ontology/worker/package.json ../../../ontology/worker/package-lock.json ];
    };
    hash = "sha256-RaXvykSmZpq6bLTGae4deIhXT6fXBMbkLvvKE14YCs0=";
  };
  ONTOLOGY_PI_SDK_ROOT = sdkRoot;
  buildPhase = ''
    runHook preBuild
    find . -type f -not -path '*/node_modules/*' -print0 | sort -z | xargs -0 sha256sum > ../worker-inputs.sha256
    cd worker
    npm run typecheck
    node scripts/compile.mjs
    cd ..
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    (cd worker && npm test)
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    (cd worker && npm prune --omit=dev --ignore-scripts --legacy-peer-deps --offline)
    destination="$out/share/ontology/worker"
    mkdir -p "$destination"
    cp -r worker/.cache/worker worker/.cache/generated worker/.cache/web "$destination/"
    cp -r worker/node_modules "$destination/"
    node --input-type=module - "$destination" <<'JS'
    import { readFileSync, writeFileSync } from 'node:fs';
    const source = JSON.parse(readFileSync('worker/package.json', 'utf8'));
    const manifest = { name: source.name, version: source.version, private: true, type: 'module',
      pi: { extensions: ['worker/src/extension.js'] }, dependencies: source.dependencies, peerDependencies: source.peerDependencies };
    writeFileSync(process.argv[2] + '/package.json', JSON.stringify(manifest, null, 2) + '\n');
    JS
    cp ../worker-inputs.sha256 "$destination/source-inputs.sha256"
    printf '%s\n' '${src}' > "$destination/runtime-source"
    printf '%s\n' '${sdkRoot}' > "$destination/typechecked-sdk"
    runHook postInstall
  '';
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    test ! -e "$out/share/ontology/worker/node_modules/@earendil-works/pi-coding-agent"
    node --input-type=module - "$out/share/ontology/worker" <<'JS'
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { pathToFileURL } from 'node:url';
    const root = process.argv[2];
    const manifest = JSON.parse(readFileSync(root + '/package.json', 'utf8'));
    const extension = await import(pathToFileURL(root + '/' + manifest.pi.extensions[0]).href);
    const events = [];
    extension.default({ registerFlag() {}, on(name) { events.push(name); } });
    assert.equal(events.filter(name => name === 'context_with_system').length, 2);
    JS
    runHook postInstallCheck
  '';
  passthru = { runtimeSource = src; inherit sdkRoot; };
  meta = {
    description = "Opt-in ontology Pi sidecar with qualified capture and context delivery";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
  };
}
