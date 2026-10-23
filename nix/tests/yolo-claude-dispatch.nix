# Behavioral / Effectual / Good-Communication; specified-origin check of the
# installed dispatcher using executable fixtures, without invoking Claude.
{ pkgs, nixpkgs }:
let
  lib = nixpkgs.lib;
  base = pkgs.writeShellScriptBin "claude" ''
    printf 'native'
    printf ' <%s>' "$@"
    printf '\n'
  '';
  managed = pkgs.writeShellScriptBin "claude" ''
    printf 'managed-mcp-plugins'
    printf ' <%s>' "$@"
    printf '\n'
  '';
  evaluate = enable: configureDefaultProfile: package: (lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      (import ../hm/claude.nix { inputs = { }; })
      ({ lib, ... }: {
        options = {
          smind.hm.dev.llm.merged.skills = lib.mkOption { type = lib.types.attrs; default = { }; };
          smind.hm.dev.llm.merged.memoryText = lib.mkOption { type = lib.types.str; default = ""; };
          smind.hm.dev.llm.fullscreenTui.enable = lib.mkOption { type = lib.types.bool; default = false; };
          smind.hm.dev.llm.coAuthored.enable = lib.mkOption { type = lib.types.bool; default = false; };
          smind.hm.dev.llm.models.claude.effort = lib.mkOption { type = lib.types.str; default = "high"; };
          smind.hm.dev.llm.models.claude.model = lib.mkOption { type = lib.types.str; default = "fixture"; };
          smind.hm.dev.llm.enable = lib.mkOption { type = lib.types.bool; default = false; };
          smind.hm.dev.llm.yolo.configureDefaultProfile = lib.mkOption { type = lib.types.bool; };
          programs.claude-code.package = lib.mkOption { type = lib.types.nullOr lib.types.package; };
          programs.claude-code.finalPackage = lib.mkOption { type = lib.types.package; readOnly = true; };
          programs.claude-code.context = lib.mkOption { type = lib.types.anything; };
          programs.claude-code.skills = lib.mkOption { type = lib.types.anything; };
          programs.claude-code.plugins = lib.mkOption { type = lib.types.anything; };
          programs.claude-code.settings = lib.mkOption { type = lib.types.anything; };
          programs.claude-code.enableMcpIntegration = lib.mkOption { type = lib.types.bool; default = false; };
          programs.claude-code.enable = lib.mkOption { type = lib.types.bool; default = false; };
        };
        config = {
          smind.hm.dev.llm = {
            inherit enable;
            yolo = { inherit configureDefaultProfile; };
          };
          programs.claude-code = { inherit package; finalPackage = managed; };
        };
      })
    ];
  }).config.programs.claude-code.finalPackage;
  isolated = evaluate true false base;
in
assert evaluate true true base == managed;
assert evaluate true false null == managed;
assert evaluate false false base == managed;
pkgs.runCommand "yolo-claude-dispatch-test" { } ''
  test "$(env -u YOLO_NAMED_PROFILE ${isolated}/bin/claude 'a b' '--flag')" = 'native <a b> <--flag>'
  test "$(YOLO_NAMED_PROFILE=0 ${isolated}/bin/claude 'a b')" = 'native <a b>'
  test "$(YOLO_NAMED_PROFILE=1 ${isolated}/bin/claude 'a b')" = 'managed-mcp-plugins <a b>'
  touch $out
''
