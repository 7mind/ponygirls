# Behavioral / Blackbox / Group; specified-origin checks of the file routing
# contract, composed with the real first-party harness generator. The narrow
# Home Manager file stub includes upstream path normalization.
{ pkgs, nixpkgs }:
let
  lib = nixpkgs.lib;
  home = "/home/alice";
  managedRoot = ".config/yolo-managed-config";
  fileStub = { lib, ... }: {
    options = {
      programs.claude-code.mutableSettings = lib.mkOption { type = lib.types.bool; default = false; };
      programs.codex.mutableSettings = lib.mkOption { type = lib.types.bool; default = false; };
      assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
      home.homeDirectory = lib.mkOption { type = lib.types.str; default = home; };
      home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
      home.sessionVariables = lib.mkOption { type = lib.types.attrsOf lib.types.str; default = { }; };
      smind.hm.dev.llm.enable = lib.mkOption { type = lib.types.bool; default = true; };
      smind.hm.dev.llm.yolo.configureDefaultProfile = lib.mkOption { type = lib.types.bool; default = true; };
      home.file = lib.mkOption {
        default = { };
        type = lib.types.attrsOf (lib.types.submodule ({ name, ... }: {
          options = {
            enable = lib.mkOption { type = lib.types.bool; default = true; };
            target = lib.mkOption {
              type = lib.types.str;
              apply = path: lib.removePrefix "${home}/" (if lib.hasPrefix "/" path then path else "${home}/${path}");
            };
            text = lib.mkOption { type = lib.types.nullOr lib.types.str; default = null; };
            source = lib.mkOption { type = lib.types.nullOr lib.types.path; default = null; };
            recursive = lib.mkOption { type = lib.types.bool; default = false; };
          };
          config.target = lib.mkDefault name;
        }));
      };
    };
  };
  fixture = {
    programs.pi = {
      enable = true;
      settings.fixture = true;
      context = "fixture context";
      skills.fixture = "fixture skill";
      promptTemplates."plan/advance" = "fixture prompt";
    };
    home.file = {
      "${home}/.claude/settings.json".text = "settings";
      "${home}/.claude/CLAUDE.md".text = "context";
      "${home}/.claude/skills/fixture/SKILL.md".text = "skill";
      ".claude/plugins/fixture" = { source = ../pkg/llm-skills; recursive = true; };
      ".codex/config.toml".text = "settings and MCP";
      ".codex/prompts/plan:advance.md".text = "prompt";
      ".pi/agent/mcp.json".text = "MCP";
      ".pi/agent/extensions/search.json".text = "search";
      ".pi/agent/extensions/fixture" = { source = ../pkg/pi-extensions; recursive = true; };
      ".pi/agent/subagents-policy.json".text = "policy";
      ".pi/agent/APPEND_SYSTEM.md".text = "append";
      ".pi/agent/disabled" = { enable = false; text = "disabled"; };
      "alias" = { target = "${home}/.claude/alias"; text = "alias"; };
      ".claude/outside" = { target = ".config/outside"; text = "outside"; };
      ".pi/unrelated".text = "unrelated";
      ".claude-other/file".text = "unrelated";
      ".config/other/file".text = "unrelated";
    };
  };
  evaluate = extra: (lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      fileStub
      ../hm/yolo-managed-config.nix
      (import ../lib/mk-agent-harness.nix {
        name = "pi";
        prettyName = "Pi";
        defaultConfigDir = ".pi/agent";
        configDirEnv = "PI_CODING_AGENT_DIR";
        settingsFile = "settings.json";
        contextFile = "AGENTS.md";
        skillsSubdir = "skills";
        promptTemplatesSubdir = "prompts";
      })
      fixture
      extra
    ];
  }).config;
  native = evaluate { };
  isolated = evaluate { smind.hm.dev.llm.yolo.configureDefaultProfile = false; };
  disabled = evaluate {
    smind.hm.dev.llm.enable = false;
    smind.hm.dev.llm.yolo.configureDefaultProfile = false;
  };
  assertionsPass = evaluated: lib.all (entry: entry.assertion) evaluated.assertions;
  mutableConfig = harness: {
    programs.${harness}.mutableSettings = true;
  };
  nativeFiles = native.home.file;
  isolatedFiles = isolated.home.file;
  harnessPath = path: lib.any (root: path == root || lib.hasPrefix "${root}/" path) [ ".claude" ".codex" ".pi/agent" ];
  targets = lib.mapAttrs (_: file: file.target);
in
assert native.smind.hm.dev.llm.yolo.configureDefaultProfile;
assert assertionsPass native;
assert assertionsPass isolated;
assert lib.all (harness:
  !(assertionsPass (evaluate (lib.recursiveUpdate (mutableConfig harness) {
    smind.hm.dev.llm.yolo.configureDefaultProfile = false;
  })))
  && assertionsPass (evaluate (mutableConfig harness))
  && assertionsPass (evaluate (lib.recursiveUpdate (mutableConfig harness) {
    smind.hm.dev.llm = {
      enable = false;
      yolo.configureDefaultProfile = false;
    };
  }))
) [ "claude-code" "codex" ];
assert !isolatedFiles.".pi/agent/disabled".enable;
assert builtins.attrNames nativeFiles == builtins.attrNames isolatedFiles;
assert lib.all (name:
  let
    before = nativeFiles.${name};
    after = isolatedFiles.${name};
  in
    after.target == (if harnessPath before.target then "${managedRoot}/${before.target}" else before.target)
    && after.source == before.source
    && after.text == before.text
    && after.recursive == before.recursive
) (builtins.attrNames nativeFiles);
assert targets disabled.home.file == targets nativeFiles;
assert isolated.programs.pi.configDir == "${home}/.pi/agent";
assert isolated.home.sessionVariables == { };
pkgs.runCommandLocal "yolo-managed-config-eval-test" { } "touch $out"
