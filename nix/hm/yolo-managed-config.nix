# Redirect generated files instead of configDir: changing configDir also
# exports harness environment variables and redirects bare invocations.
{ config, lib, ... }:
let
  cfg = config.smind.hm.dev.llm;
  isHarnessPath = path:
    lib.any (root: path == root || lib.hasPrefix "${root}/" path) [
      ".claude"
      ".codex"
      ".pi/agent"
    ];
in
{
  config.assertions = lib.mkIf (cfg.enable && !cfg.yolo.configureDefaultProfile) [
    {
      assertion = !(config.programs.claude-code.mutableSettings or false);
      message = "smind.hm.dev.llm.yolo.configureDefaultProfile = false requires programs.claude-code.mutableSettings = false; mutable settings activation bypasses managed file routing.";
    }
    {
      assertion = !(config.programs.codex.mutableSettings or false);
      message = "smind.hm.dev.llm.yolo.configureDefaultProfile = false requires programs.codex.mutableSettings = false; mutable settings activation bypasses managed file routing.";
    }
  ];

  options.home.file = lib.mkOption {
    # Home Manager's file submodule has already normalized absolute targets
    # relative to HOME here. Keep keys and metadata, including disabled files.
    apply = files:
      if !cfg.enable || cfg.yolo.configureDefaultProfile then files
      else lib.mapAttrs (_: file:
        if isHarnessPath file.target then
          file // { target = ".config/yolo-managed-config/${file.target}"; }
        else file
      ) files;
  };
}
