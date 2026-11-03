{ pkgs, inputs, haystackPackage }:
let
  lib=pkgs.lib;
  cfg=(lib.evalModules {
    specialArgs={inherit pkgs;};
    modules=[ ./user-services-stub.nix ./agentic-services-legacy-config.nix
      (import ../hm/agentic-services-server.nix {inherit inputs;})
      { smind.hm.services.agentic.host.scheme=lib.mkForce "http"; smind.hm.services.agentic.haystack.package=lib.mkForce haystackPackage; }
    ];
  }).config;
  failure=pkgs.writeText "haystack-proxy-failure.json" (import ../lib/haystack-proxy.nix {}).unavailableJson;
  sources=pkgs.callPackage ../pkg/chronicle/source.nix {};
  dependencies=pkgs.callPackage ../pkg/haystack/test-dependencies.nix {};
in pkgs.runCommand "haystack-rendered-proxy-current-codec" {
  nativeBuildInputs=[pkgs.python3 pkgs.nodejs];
  NGINX="${pkgs.nginx}/bin/nginx";
} ''
  mkdir "$out"
  python3 ${./haystack-proxy-test.py} ${cfg.lib.ponygirls.agenticServices.proxyConfig} ${failure} "$out/proxy.json" ${haystackPackage}/share/haystack/web
  cp -r ${sources.haystackTests} source
  chmod -R u+w source
  cd source/haystack
  ln -s ${dependencies}/lib/node_modules node_modules
  export PROXY_FAILURE=${failure}
  node --import ./scripts/register-generated.mjs --input-type=module <<'JS'
  import assert from 'node:assert/strict';
  import {readFileSync} from 'node:fs';
  import {Failure} from './generated/typescript/haystack/api/index.ts';
  import {BaboonCodecContext} from './generated/typescript/BaboonSharedRuntime.ts';
  const codec=Failure.jsonCodec();const ctx=BaboonCodecContext.Default;
  const current=codec.decode(ctx,JSON.parse(readFileSync(process.env.PROXY_FAILURE,'utf8')));
  assert.equal(current.code,'unavailable');assert.deepEqual(current.spans,[]);
  assert.throws(()=>codec.decode(ctx,{error:{code:'unavailable',message:'service unavailable'}}));
  JS
  printf '%s\n' 'Current generated Failure codec accepted; retired Node envelope rejected. Actual rendered HM nginx /api/ and /mcp unavailable/private-log cases executed.' > "$out/codec-scope"
''
