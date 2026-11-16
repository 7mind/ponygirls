{ lib, buildNpmPackage, fetchNpmDeps, nodejs_24, makeWrapper }:
let
  root = ../../../chronicle;
  excluded = [ "node_modules" "dist" "artifacts" ];
  src = lib.cleanSourceWith {
    name = "chronicle-cli-source";
    src = root;
    filter = path: type:
      let relative = lib.removePrefix "${toString root}/" (toString path);
      in lib.cleanSourceFilter path type
        && !(builtins.elem (baseNameOf path) excluded)
        && (toString path == toString root
          || lib.any (entry: relative == entry || lib.hasPrefix "${entry}/" relative
            || (type == "directory" && lib.hasPrefix "${relative}/" entry))
            [ "cli" "generated/typescript" "models/chronicle.baboon" "package.json" ]);
  };
in
buildNpmPackage {
  pname = "chronicle-cli";
  version = "0.1.0";
  inherit src;
  nodejs = nodejs_24;
  npmRoot = "cli";
  nativeBuildInputs = [ makeWrapper ];
  npmDeps = fetchNpmDeps {
    name = "chronicle-cli-npm-dependencies";
    src = lib.fileset.toSource {
      root = ../../../chronicle/cli;
      fileset = lib.fileset.unions [ ../../../chronicle/cli/package.json ../../../chronicle/cli/package-lock.json ];
    };
    hash = "sha256-zjCGbVOzxj/umplgnaNrKg1untnclZ+UDaW14bwEE64=";
  };
  buildPhase = ''
    runHook preBuild
    cd cli
    npm run build
    cd ..
    runHook postBuild
  '';
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    cd cli
    npm test
    cd ..
    runHook postCheck
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/chronicle-cli"
    cp -r cli/dist "$out/lib/chronicle-cli/"
    install -m644 cli/package.json "$out/lib/chronicle-cli/package.json"
    makeWrapper ${nodejs_24}/bin/node "$out/bin/chronicle" \
      --add-flags "$out/lib/chronicle-cli/dist/cli/src/main.js"
    install -Dm644 cli/README.md "$out/share/doc/chronicle-cli/README.md"
    runHook postInstall
  '';
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    cd cli
    CHRONICLE_CLI_EXECUTABLE="$out/bin/chronicle" node --test dist/cli/test/cli.test.js dist/cli/test/transport.test.js dist/cli/test/presentation.test.js
    cd ..
    runHook postInstallCheck
  '';
  meta = {
    description = "Chronicle application CLI with independent human sessions and bearer ingestion/read tools";
    license = lib.licenses.mit;
    mainProgram = "chronicle";
  };
}
