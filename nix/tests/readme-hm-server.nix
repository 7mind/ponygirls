# Exact README consumer example snapshot, tested against actual exported module.
# This checks options/default constructors/graph, not live activation/runtime.
{ pkgs, inputs, ponygirls }:
let
  lib=pkgs.lib;
  fixture=./fixtures/readme-hm-server.nix;
  config=(lib.evalModules {
    specialArgs={inherit pkgs;inputs=inputs//{inherit ponygirls;};};
    modules=[./user-services-stub.nix fixture];
  }).config;
  services=config.systemd.user.services;
in
assert lib.all (a: a.assertion) config.assertions;
assert lib.filter (name: lib.hasSuffix "-postgres" name) (builtins.attrNames services)==["ponygirls-postgres"];
assert config.ponygirls.servicePostgres.databases.manure.schemas==["public" "manure"];
assert config.smind.hm.services.agentic.haystack.database.limits.maxConnections==config.ponygirls.servicePostgres.databases.haystack.maxConnections;
assert config.lib.ponygirls.agenticServices.haystackConfig.value.database.jdbcUrl=="jdbc:postgresql://127.0.0.1:15434/haystack";
assert config.lib.ponygirls.agenticServices.manureConfig.value.database.jdbcUrl=="jdbc:postgresql://127.0.0.1:15434/manure";
assert services.agentic-manure-migrate.Unit.Requires==["ponygirls-database-manure.service"];
assert services.agentic-haystack-migrate.Unit.Requires==["ponygirls-database-haystack.service"];
pkgs.runCommand "readme-home-manager-server-consumer-example" {} ''
  mkdir "$out"
  printf '%s\n' '${builtins.hashString "sha256" (builtins.readFile fixture)}' > "$out/snippet.sha256"
  cp ${fixture} "$out/example.nix"
  printf '%s\n' 'Exact documented example: all module assertions/default constructors and independent provider/migration graph evaluated. No deployment/runtime credential access.' > "$out/scope"
''
