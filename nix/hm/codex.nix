# Codex configuration for the LLM coding-agent harness. The shared asset
# bundles / MCP registry / merged views come from tools.nix. Integrations can
# override the package, extend settings, and contribute additional home files
# through ordinary Home Manager module composition.
{ config
, lib
, pkgs
, ...
}:
let
  cfg = config.smind.hm.dev.llm;
  codexPkg = pkgs.callPackage ../pkg/codex/package.nix { };
  commandKeyToStem = key: lib.replaceStrings [ "/" ] [ ":" ] key;
  sharedAgentWiring = {
    enable = true;
    enableMcpIntegration = true;
    skills = cfg.merged.skills;
    context = cfg.merged.memoryText;
  };
in
{
  config = lib.mkIf cfg.enable {
    programs.codex = sharedAgentWiring // {
      package = lib.mkDefault codexPkg;
      settings = {
        model = cfg.models.codex.model;
        model_reasoning_effort = cfg.models.codex.reasoningEffort;
        project_doc_fallback_filenames = [ "CLAUDE.md" ];
        features.apps = false;
        features.multi_agent = true;
        features.fast_mode = false;
        features.steer = true;
        # 0.147+ tool/code-mode path spawns the sibling host binary; without
        # this flag Codex fail-closes code mode even when the binary exists.
        features.code_mode_host = true;
      };
    };

    home.file = {
      ".codex/config.toml".force = true;
    } // lib.mapAttrs' (
      key: body:
      lib.nameValuePair ".codex/prompts/${commandKeyToStem key}.md" { text = body; }
    ) cfg.merged.commands;
  };
}
