{ lib, buildNpmPackage, fetchNpmDeps, nodejs_24, makeWrapper }:
buildNpmPackage {
  pname = "haystack-cli";
  version = "0.1.0";
  nodejs = nodejs_24;
  src = lib.fileset.toSource {
    root = ../../../haystack;
    fileset = lib.fileset.unions [
      ../../../haystack/package.json
      ../../../haystack/cli/package.json
      ../../../haystack/cli/package-lock.json
      ../../../haystack/cli/tsconfig.json
      ../../../haystack/cli/src
      ../../../haystack/cli/tests
      ../../../haystack/cli/README.md
      ../../../haystack/generated/typescript
      ../../../haystack/web/src/lossless-json.ts
    ];
  };
  npmRoot = "cli";
  npmDeps = fetchNpmDeps {
    name = "haystack-cli-npm-dependencies";
    src = lib.fileset.toSource {
      root = ../../../haystack/cli;
      fileset = lib.fileset.unions [ ../../../haystack/cli/package.json ../../../haystack/cli/package-lock.json ];
    };
    hash = "sha256-rAS+EI1UMH5MPsYJwDJQXPS2G1wmc+BQ1Re1ZuH83HU=";
  };
  buildPhase = ''
    runHook preBuild
    (cd cli && npm run typecheck && npm run build)
    runHook postBuild
  '';
  nativeBuildInputs = [ makeWrapper ];
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    (cd cli && node --test --test-concurrency=1 tests/*.test.mjs)
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/haystack-cli" "$out/bin" "$out/share/doc/haystack-cli"
    (cd cli && npm prune --omit=dev --ignore-scripts --offline --no-audit --no-fund)
    cp -r cli/dist cli/node_modules cli/package.json "$out/lib/haystack-cli/"
    cp cli/README.md "$out/share/doc/haystack-cli/"
    makeWrapper ${nodejs_24}/bin/node "$out/bin/haystack" \
      --add-flags "$out/lib/haystack-cli/dist/cli/src/main.js"
    runHook postInstall
  '';
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    (cd cli && HAYSTACK_CLI_EXECUTABLE="$out/bin/haystack" node --test --test-concurrency=1 tests/cli.test.mjs)
    runHook postInstallCheck
  '';
  meta = {
    description = "Standalone Haystack application CLI (data, sessions, accounts and tokens)";
    mainProgram = "haystack";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
  };
}
