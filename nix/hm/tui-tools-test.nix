{ pkgs, inputs }:
let
  inherit (pkgs) lib;
  checkSystem = system:
    let
      realPkgs = import inputs.nixpkgs { inherit system; config.allowUnfree = true; };
      # Inspect the wrapper's package arguments without building platform-specific sandboxes.
      testPkgs = realPkgs // {
        callPackage = path: args:
          if builtins.elem path [ ../pkg/yolo/default.nix ../pkg/yolo-darwin/default.nix ] then
            realPkgs.runCommand "yolo" { passthru.sandboxPackages = args.sandboxPackages; } "touch $out"
          else
            realPkgs.callPackage path args;
      };
      eval = enable: (lib.evalModules {
        specialArgs.pkgs = testPkgs;
        modules = [
          (import ./tools.nix { inherit inputs; })
          (import ./yolo.nix { inherit inputs; })
          ({ lib, ... }: {
            options = {
              assertions = lib.mkOption { type = lib.types.listOf lib.types.attrs; default = [ ]; };
              home.packages = lib.mkOption { type = lib.types.listOf lib.types.package; default = [ ]; };
              programs.mcp = lib.mkOption { type = lib.types.attrs; default = { }; };
              xdg.stateHome = lib.mkOption { type = lib.types.str; default = "/fixture/state"; };
            };
            config.smind.hm.dev.llm = {
              inherit enable;
              yolo.codegraph = null;
              yolo.vm.enable = false;
            };
          })
        ];
      }).config;
      enabled = eval true;
      disabled = eval false;
      named = name: packages: builtins.filter (p: lib.getName p == name) packages;
      hostTools = named "tui-tmux" enabled.home.packages;
      sandboxes = named "yolo" enabled.home.packages;
      sandboxTools = named "tui-tmux" (builtins.head sandboxes).sandboxPackages;
    in
    assert builtins.length hostTools == 1;
    assert builtins.length sandboxes == 1;
    assert builtins.length sandboxTools == 1;
    assert (builtins.head hostTools).outPath == (builtins.head sandboxTools).outPath;
    assert named "tui-tmux" disabled.home.packages == [ ];
    assert named "yolo" disabled.home.packages == [ ];
    assert builtins.hasAttr "tui-testing" enabled.smind.hm.dev.llm.merged.skills;
    assert lib.hasPrefix "---\nname: tui-testing\n" enabled.smind.hm.dev.llm.merged.skills.tui-testing;
    assert lib.all (a: a.assertion) enabled.assertions;
    true;
in
assert checkSystem "x86_64-linux";
assert checkSystem "aarch64-darwin";
pkgs.runCommand "tui-tools-hm-test" { } "touch $out"
