{ pkgs }:
let
  lib = pkgs.lib;
  evaluate = providers: (lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      ../hm/pi.nix
      ({ lib, ... }: {
        options.assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
        options.home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
        options.home.file = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.home.sessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
        options.home.username = lib.mkOption { type = lib.types.str; default = "alice"; };
        options.home.homeDirectory = lib.mkOption { type = lib.types.str; default = "/home/alice"; };
        options.programs.mcp.servers = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.smind.hm.dev.llm.enable = lib.mkOption { type = lib.types.bool; default = true; };
        options.smind.hm.dev.llm.merged.skills = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.smind.hm.dev.llm.merged.commands = lib.mkOption { type = lib.types.attrsOf lib.types.anything; default = { }; };
        options.smind.hm.dev.llm.merged.memoryText = lib.mkOption { type = lib.types.str; default = ""; };
        options.smind.hm.dev.llm.models.pi.provider = lib.mkOption { type = lib.types.str; default = "fixture"; };
        options.smind.hm.dev.llm.models.pi.model = lib.mkOption { type = lib.types.str; default = "fixture"; };
        options.smind.hm.dev.llm.models.pi.thinkingLevel = lib.mkOption { type = lib.types.str; default = "off"; };
        options.smind.hm.dev.llm.fullscreenTui.enable = lib.mkOption { type = lib.types.bool; default = false; };
        config.smind.hm.dev.llm.pi = { inherit providers; };
      })
    ];
  }).config;
  disabled = evaluate { };
  enabled = evaluate { claude-code.enable = true; };
  mixed = evaluate { claude-code.enable = true; xai.enable = true; ollama.enable = true; };
  package = pkgs.callPackage ../pkg/pi-claude-code/package.nix {
    pi-coding-agent = pkgs.callPackage ../pkg/pi-coding-agent/package.nix { };
  };
  disabledPackages = disabled.programs.pi.settings.packages;
  enabledPackages = enabled.programs.pi.settings.packages;
  isRemoteClaude = spec: lib.hasInfix "pi-claude-code" spec && !(lib.hasPrefix builtins.storeDir spec);
in
assert lib.assertMsg (disabled.smind.hm.dev.llm.pi.providers ? claude-code) "Claude Code provider option is missing";
assert !disabled.smind.hm.dev.llm.pi.providers.claude-code.enable;
assert !(builtins.elem (toString package) disabledPackages);
assert enabledPackages == disabledPackages ++ [ (toString package) ];
assert !(builtins.any isRemoteClaude enabledPackages);
assert builtins.elem "npm:pi-xai@0.18.0" mixed.programs.pi.settings.packages;
assert builtins.elem "npm:pi-ollama-cloud@0.13.1" mixed.programs.pi.settings.packages;
pkgs.runCommand "pi-providers-hm-eval" { } "touch $out"
