{ lib, stdenvNoCC, nodejs, typescript, pi-coding-agent, pi-claude-code, ponygirls-pi-extensions }:
let
  sdk = "${pi-coding-agent}/lib/node_modules/pi-monorepo";
in
stdenvNoCC.mkDerivation {
  pname = "pi-claude-code-subagents";
  version = "0.1.0";
  src = lib.cleanSource ./.;
  nativeBuildInputs = [ nodejs typescript ];
  dontBuild = true;
  doCheck = true;

  postPatch = ''
    mkdir executor
    cp ${pi-claude-code.src}/src/{claude-cli.ts,turn-relay.ts,billing.ts,env.ts,native-types.ts,inert-mcp.mjs} executor/
    chmod -R u+w executor
    patch --batch -d executor -p2 < ${./execution.patch}
  '';

  checkPhase = ''
    runHook preCheck
    export HOME=$TMPDIR/addon-test-home
    export PI_OFFLINE=1 PI_TELEMETRY=0
    export PI_SUBAGENTS_SDK_ROOT=${sdk}
    export PI_SUBAGENTS_CLAUDE_PACKAGE=${pi-claude-code}
    export PI_SUBAGENTS_CLAUDE_FIXTURE=${../pi-claude-code/fake-cli.mjs}
    mkdir -p "$HOME" node_modules/@earendil-works
    cp -r ${ponygirls-pi-extensions} core-fixture
    chmod -R u+w core-fixture
    mkdir -p core-fixture/node_modules/@earendil-works
    ln -s ${sdk} core-fixture/node_modules/@earendil-works/pi-coding-agent
    ln -s ${sdk}/node_modules/@earendil-works/pi-ai core-fixture/node_modules/@earendil-works/pi-ai
    ln -s ${sdk}/node_modules/@earendil-works/pi-agent-core core-fixture/node_modules/@earendil-works/pi-agent-core
    ln -s ${sdk}/node_modules/@earendil-works/pi-tui core-fixture/node_modules/@earendil-works/pi-tui
    ln -s ${sdk}/node_modules/typebox core-fixture/node_modules/typebox
    ln -s ${sdk}/node_modules/@types core-fixture/node_modules/@types
    ln -s ../core-fixture/ponygirls-subagents node_modules/ponygirls-subagents
    ln -s ${sdk} node_modules/@earendil-works/pi-coding-agent
    ln -s ${sdk}/node_modules/@earendil-works/pi-ai node_modules/@earendil-works/pi-ai
    ln -s ${sdk}/node_modules/@types node_modules/@types
    tsc -p tsconfig.json
    node --experimental-transform-types --test tests/*.test.ts
    node ${./prepare-executor-tests.mjs} ${pi-claude-code.src} "$PWD" "$PWD/executor-suite"
    ln -s ../node_modules executor-suite/node_modules
    substituteInPlace executor-suite/tests/{billing,claude-cli,model-discovery,stream}.test.ts \
      --replace-fail '#!/usr/bin/env node' '#!${nodejs}/bin/node'
    tsc -p executor-suite/tsconfig.json
    node --experimental-transform-types --test executor-suite/tests/*.test.ts
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/executor"
    cp -r index.ts src package.json README.md "$out/"
    cp executor/{claude-cli.ts,turn-relay.ts,billing.ts,env.ts,native-types.ts,inert-mcp.mjs,catalog-types.ts,execution-types.ts} "$out/executor/"
    cp ${pi-claude-code.src}/LICENSE "$out/LICENSE"
    runHook postInstall
  '';

  meta = {
    description = "Additive Claude Code execution backend for ponygirls-subagents";
    license = lib.licenses.mit;
    platforms = [ "x86_64-linux" ];
  };
}
