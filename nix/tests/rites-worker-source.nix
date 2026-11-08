{ pkgs }:
let
  worker = pkgs.callPackage ../pkg/rites/worker.nix {
    pi-coding-agent = pkgs.callPackage ../pkg/pi-coding-agent/package.nix { };
  };
  selected = path: type: worker.src.filter "${toString ../..}/${path}" type;
in
assert pkgs.lib.assertMsg (!(selected "rites/web/app.ts" "regular")) "worker source must exclude unrelated browser inputs";
assert pkgs.lib.assertMsg (!(selected "rites/server/target/private-config.json" "regular")) "worker source must exclude nested local build artifacts";
assert !(selected "rites/config.example.json" "regular");
assert !(selected "rites/worker/tests/worker.test.mjs" "regular");
assert !(selected "rites/target/worker/worker/main.js" "regular");
assert !(selected "rites/node_modules/typescript/package.json" "regular");
assert selected "rites/package.json" "regular";
assert selected "rites/tsconfig.json" "regular";
assert selected "rites/protocol/protocol.ts" "regular";
assert selected "rites/generated/typescript/rites/worker/RunRequest.ts" "regular";
assert selected "rites/worker/agent.ts" "regular";
assert selected "rites/worker/broker.ts" "regular";
assert selected "rites/worker/tool-runner.ts" "regular";
pkgs.runCommand "rites-worker-source-test" { } ''
  touch "$out"
''
