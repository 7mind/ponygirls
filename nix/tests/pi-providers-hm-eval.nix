{ pkgs }:
let
  lib = pkgs.lib;
  evaluate = providers: addon: (lib.evalModules {
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
        config.smind.hm.dev.llm.pi = { inherit providers; } // lib.optionalAttrs (addon != null) { claudeCodeSubagents.enable = addon; };
      })
    ];
  }).config;
  disabled = evaluate { } null;
  enabled = evaluate { claude-code.enable = true; } false;
  mixed = evaluate { claude-code.enable = true; xai.enable = true; ollama.enable = true; } false;
  addon = evaluate { claude-code.enable = true; } true;
  missingProvider = evaluate { } true;
  package = pkgs.callPackage ../pkg/pi-claude-code/package.nix {
    pi-coding-agent = pkgs.callPackage ../pkg/pi-coding-agent/package.nix { };
  };
  piBase = pkgs.callPackage ../pkg/pi-coding-agent/package.nix { };
  piSettings = pkgs.callPackage ../pkg/pi-extensions/ponygirls-pi-settings/package.nix { pi-coding-agent = piBase; };
  piUi = pkgs.callPackage ../pkg/pi-extensions/ponygirls-pi-ui/package.nix { pi-coding-agent = piBase; ponygirls-pi-settings = piSettings; };
  extensions = pkgs.callPackage ../pkg/pi-extensions/package.nix { ponygirls-pi-settings = piSettings; ponygirls-pi-ui = piUi; };
  addonPackage = pkgs.callPackage ../pkg/pi-claude-code-subagents/package.nix {
    pi-coding-agent = piBase;
    pi-claude-code = package;
    ponygirls-pi-extensions = extensions;
  };
  disabledPackages = disabled.programs.pi.settings.packages;
  enabledPackages = enabled.programs.pi.settings.packages;
  isRemoteClaude = spec: lib.hasInfix "pi-claude-code" spec && !(lib.hasPrefix builtins.storeDir spec);
in
assert lib.assertMsg (disabled.smind.hm.dev.llm.pi.providers ? claude-code) "Claude Code provider option is missing";
assert !disabled.smind.hm.dev.llm.pi.providers.claude-code.enable;
assert !disabled.smind.hm.dev.llm.pi.claudeCodeSubagents.enable;
assert addon.programs.pi.settings.packages == enabledPackages ++ [ (toString addonPackage) ];
assert addon.programs.pi.settings.extensions == enabled.programs.pi.settings.extensions;
assert builtins.elem "${extensions}/ponygirls-subagents" addon.programs.pi.settings.extensions;
assert !(builtins.all (entry: entry.assertion) missingProvider.assertions);
assert !missingProvider.smind.hm.dev.llm.pi.providers.claude-code.enable;
assert builtins.all (entry: entry.assertion) addon.assertions;
assert !(builtins.elem (toString package) disabledPackages);
assert enabledPackages == disabledPackages ++ [ (toString package) ];
assert !(builtins.any isRemoteClaude enabledPackages);
assert builtins.elem "npm:pi-xai@0.18.0" mixed.programs.pi.settings.packages;
assert builtins.elem "npm:pi-ollama-cloud@0.13.1" mixed.programs.pi.settings.packages;
pkgs.runCommand "pi-providers-hm-eval" { } "touch $out"
