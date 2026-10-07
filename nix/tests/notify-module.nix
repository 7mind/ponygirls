{ lib, pkgs }:
let
  tokenFile = "/run/agenix/matrix-notify";
  existingPath = "/srv/models";
  settings = {
    enable = true;
    yolo.extraReadOnlyPaths = [ existingPath ];
    notify = {
      enable = true;
      homeserver = "https://matrix.example.org";
      roomId = "!notifications:matrix.example.org";
      inherit tokenFile;
    };
  };
  evaluate = overrides: (lib.evalModules {
    specialArgs = { inherit pkgs; };
    modules = [
      ../hm/notify.nix
      ({ lib, ... }: {
        options = {
          smind.hm.dev.llm.enable = lib.mkEnableOption "coding-agent environment";
          smind.hm.dev.llm.yolo.extraReadOnlyPaths = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [ ];
          };
          assertions = lib.mkOption {
            type = lib.types.listOf lib.types.attrs;
            default = [ ];
          };
          home.packages = lib.mkOption {
            type = lib.types.listOf lib.types.package;
            default = [ ];
          };
          programs = lib.mkOption {
            type = lib.types.attrs;
            default = { };
          };
        };
      })
      { smind.hm.dev.llm = lib.recursiveUpdate settings overrides; }
    ];
  }).config;
  enabled = evaluate { };
  disabled = evaluate { notify.enable = false; };
  noToken = evaluate { notify.tokenFile = null; };
  noHarness = evaluate { enable = false; };
in
assert lib.all (assertion: assertion.assertion) enabled.assertions;
assert builtins.elem tokenFile enabled.smind.hm.dev.llm.yolo.extraReadOnlyPaths;
assert builtins.elem existingPath enabled.smind.hm.dev.llm.yolo.extraReadOnlyPaths;
assert disabled.smind.hm.dev.llm.yolo.extraReadOnlyPaths == [ existingPath ];
assert noToken.smind.hm.dev.llm.yolo.extraReadOnlyPaths == [ existingPath ];
assert !(lib.all (assertion: assertion.assertion) noToken.assertions);
assert noHarness.smind.hm.dev.llm.yolo.extraReadOnlyPaths == [ existingPath ];
pkgs.runCommandLocal "notify-module-test" { } "touch $out"
