{ pkgs }:
let
  lib = pkgs.lib;
  evaluate = servers: integration: (lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      ../hm/pi.nix
      ({ lib, ... }: {
        options = {
          assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
          home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
          home.file = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
          home.sessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
          home.username = lib.mkOption { type = lib.types.str; default = "alice"; };
          home.homeDirectory = lib.mkOption { type = lib.types.str; default = "/home/alice"; };
          programs.mcp.servers = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
          smind.hm.dev.llm.enable = lib.mkOption { type = lib.types.bool; default = true; };
          smind.hm.dev.llm.merged.skills = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
          smind.hm.dev.llm.merged.commands = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
          smind.hm.dev.llm.merged.memoryText = lib.mkOption { type = lib.types.str; default = ""; };
          smind.hm.dev.llm.models.pi.provider = lib.mkOption { type = lib.types.str; default = "x"; };
          smind.hm.dev.llm.models.pi.model = lib.mkOption { type = lib.types.str; default = "x"; };
          smind.hm.dev.llm.models.pi.thinkingLevel = lib.mkOption { type = lib.types.str; default = "x"; };
          smind.hm.dev.llm.fullscreenTui.enable = lib.mkOption { type = lib.types.bool; default = false; };
        };
        config.programs.mcp.servers = servers;
        config.programs.pi.enableMcpIntegration = lib.mkForce integration;
      })
    ];
  }).config;
  hasExtension = config: builtins.any (p: lib.hasSuffix "-ponygirls-codegraph" p) config.programs.pi.settings.extensions;
  local = evaluate { codegraph.command = "/bin/codegraph"; } true;
  absent = evaluate { } true;
  remote = evaluate { codegraph.url = "https://example.invalid/mcp"; } true;
  disabled = evaluate { codegraph = { command = "/bin/codegraph"; enabled = false; }; } true;
  noMcp = evaluate { codegraph.command = "/bin/codegraph"; } false;
in
assert hasExtension local;
assert !(hasExtension absent);
assert !(hasExtension remote);
assert !(hasExtension disabled);
assert !(hasExtension noMcp);
pkgs.runCommandLocal "pi-codegraph-wiring-test" { } ''
  grep -F 'PONYGIRLS_CODEGRAPH_BIN' ${local.programs.pi.package}/bin/pi | grep -F '/bin/codegraph'
  grep -F 'PONYGIRLS_CODEGRAPH_FLOCK_BIN' ${local.programs.pi.package}/bin/pi | grep -F '${pkgs.flock}/bin/flock'
  touch $out
''
