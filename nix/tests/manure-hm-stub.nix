# Shared narrow stubs for Home Manager evaluations WITHOUT a full Home
# Manager installation (no home-manager input in this flake) and WITHOUT
# the dev-llm aggregator (tools.nix needs flake `self`).
#
# Owned helper shared by nix/tests/manure-hm-eval.nix (pure eval checks)
# and nix/tests/manure-vm.nix (guest HM adapter acceptance). Compositions
# import the REAL manure, yolo and podman HM modules, so this file stubs
# ONLY downstream LEAF options those modules write to but nobody here
# owns: the MCP server registry, the master enable switch, asset bundles,
# home session state and xdg base dirs (yolo's vm.stateDirectory default
# reads xdg.stateHome). It deliberately declares NO yolo.* options —
# those come from the real yolo module (duplicate declarations would
# fail evaluation).
{ lib, ... }:
{
  options.assertions = lib.mkOption {
    type = lib.types.listOf lib.types.attrs;
    default = [ ];
  };
  # Minimal stand-ins for the real HM options the composed modules
  # contribute to.
  options.programs.mcp.servers = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
  options.smind.hm.dev.llm.enable = lib.mkOption { type = lib.types.bool; default = false; };
  options.smind.hm.dev.llm.assetBundles = lib.mkOption { type = lib.types.listOf lib.types.anything; default = [ ]; };
  options.smind.hm.dev.llm.memorySections = lib.mkOption { type = lib.types.listOf lib.types.str; default = [ ]; };
  options.home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
  options.home.sessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
  options.home.username = lib.mkOption { type = lib.types.str; default = "alice"; };
  options.home.homeDirectory = lib.mkOption { type = lib.types.str; default = "/home/alice"; };
  options.xdg.stateHome = lib.mkOption { type = lib.types.str; default = "/home/alice/.local/state"; };
  options.xdg.configHome = lib.mkOption { type = lib.types.str; default = "/home/alice/.config"; };
}
