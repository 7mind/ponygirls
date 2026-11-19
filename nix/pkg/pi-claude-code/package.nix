{ lib, stdenvNoCC, fetchFromGitHub, nodejs, typescript, pi-coding-agent }:
let
  sdk = "${pi-coding-agent}/lib/node_modules/pi-monorepo";
in
stdenvNoCC.mkDerivation {
  pname = "pi-claude-code";
  version = "0.1.0-unstable-2026-11-05";

  src = fetchFromGitHub {
    owner = "earendil-works";
    repo = "pi-claude-code";
    rev = "d5b5e04c314d3452d357174d16d10dda34daa2d2";
    hash = "sha256-86zfGr9YoM+I/PmWHDJb8AbcxhYC1m8aOeghJjvN414=";
  };

  patches = [ ./execution.patch ];

  postPatch = ''
    substituteInPlace tests/{billing,claude-cli,model-discovery,stream}.test.ts \
      --replace-fail '#!/usr/bin/env node' '#!${nodejs}/bin/node'
  '';

  dontBuild = true;
  doCheck = true;
  __darwinAllowLocalNetworking = true;
  nativeCheckInputs = [ nodejs typescript ];

  checkPhase = ''
    runHook preCheck
    cmp src/claude-cli.ts "$src/src/claude-cli.ts"
    cmp src/turn-relay.ts "$src/src/turn-relay.ts"
    cmp src/model-catalog.ts "$src/src/model-catalog.ts"
    cp ${./execution.test.ts} tests/execution.test.ts
    export HOME=$TMPDIR/claude-code-test-home
    mkdir -p "$HOME" node_modules/@earendil-works
    ln -s ${sdk} node_modules/@earendil-works/pi-coding-agent
    ln -s ${sdk}/node_modules/@earendil-works/pi-ai node_modules/@earendil-works/pi-ai
    ln -s ${sdk}/node_modules/@types node_modules/@types
    tsc --noEmit
    node --experimental-transform-types --test tests/*.test.ts
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -r src package.json LICENSE README.md ARCHITECTURE.md "$out/"
    runHook postInstall
  '';

  meta = {
    description = "Pi provider using the authenticated Claude Code CLI";
    homepage = "https://github.com/earendil-works/pi-claude-code";
    license = lib.licenses.mit;
    platforms = lib.platforms.unix;
  };
}
