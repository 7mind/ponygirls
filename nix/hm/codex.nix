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

  # Codex derives an MCP server's transport from `command` (stdio) or `url`
  # (streamable HTTP) and refuses the whole config when a table has neither
  # ("invalid transport"). home-manager merges settings.mcp_servers.<name>
  # over the registry-derived entry wholesale (per server, not per field),
  # so a partial settings override silently drops the transport. Mirror that
  # merge here and refuse to generate a table codex would reject.
  registryMcpServers = lib.optionalAttrs
    (config.programs.codex.enableMcpIntegration && (config.programs.mcp.enable or false))
    (lib.mapAttrs (
      _: server: server // { url = server.url or (server.serverUrl or null); }
    ) (config.programs.mcp.servers or { }));
  effectiveMcpServers = registryMcpServers // (config.programs.codex.settings.mcp_servers or { });
  transportlessMcpServers = lib.filterAttrs (
    _: server: (server.command or null) == null && (server.url or null) == null
  ) effectiveMcpServers;
in
{
  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = transportlessMcpServers == { };
        message =
          "programs.codex: mcp_servers table(s) without a transport (no `command`, no `url`): "
          + lib.concatStringsSep ", " (builtins.attrNames transportlessMcpServers)
          + ". Codex derives stdio from `command` or streamable HTTP from `url` and rejects the whole config otherwise (\"invalid transport\"); note that settings.mcp_servers.<name> replaces the programs.mcp registry-derived table wholesale, so an override must repeat command/args or url.";
      }
    ];

    programs.codex = sharedAgentWiring // {
      package = lib.mkDefault codexPkg;
      settings = {
        model = cfg.models.codex.model;
        model_reasoning_effort = cfg.models.codex.reasoningEffort;
        tui.status_line = [
          "model-with-reasoning"
          "current-dir"
          "git-branch"
          "thread-name"
          "context-used"
          "five-hour-limit"
          "weekly-limit"
          "used-tokens"
          "total-input-tokens"
          "total-output-tokens"
          "thread-id"
          "task-progress"
        ];
        project_doc_fallback_filenames = [ "CLAUDE.md" ];
        features.apps = false;
        features.multi_agent = true;
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
