# Haystack server + bundled UI (Step 1 scaffold; service arrives Steps 2-7).
{ lib, buildNpmPackage, nodejs, makeBinaryWrapper }:
buildNpmPackage (finalAttrs: {
  pname = "haystack";
  version = "0.1.0";

  src = lib.cleanSourceWith {
    src = ../../../haystack;
    filter =
      path: type:
      let
        base = baseNameOf path;
      in
      base != "node_modules" && base != "dist";
  };

  npmDepsHash = "sha256-tKOmzZPpSCLSqg561033hO9+6VtRh+M3qxmSm8zbMFg=";

  nativeBuildInputs = [ makeBinaryWrapper ];

  # Root `npm run build` builds server (tsc) then web (vite).
  # Web output lands in web/dist next to server/dist, which is how the
  # server locates its bundled UI at runtime (no network, no npm).
  buildPhase = ''
    runHook preBuild
    npm run build
    runHook postBuild
  '';

  postInstall = ''
    makeWrapper ${nodejs}/bin/node "$out/bin/haystack-server" \
      --add-flags "$out/lib/node_modules/haystack/server/dist/index.js"
  '';

  meta = {
    description = "Haystack structured agent-memory service";
    mainProgram = "haystack-server";
  };
})
