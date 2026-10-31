# Standalone HM consumer boundary for pure module evaluation. No downstream
# modules or production credentials; generated user-unit sources retain the
# service graph for restart/stop-propagation checks.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  inherit (lib) mkOption types;
  attrs =
    default:
    mkOption {
      type = types.attrsOf types.anything;
      inherit default;
    };
  generated = lib.mapAttrs' (
    name: value:
    lib.nameValuePair "systemd/user/${name}.service" {
      source = pkgs.writeText "${name}.service" (builtins.toJSON value);
    }
  ) config.systemd.user.services;
  timers = lib.mapAttrs' (
    name: value:
    lib.nameValuePair "systemd/user/${name}.timer" {
      source = pkgs.writeText "${name}.timer" (builtins.toJSON value);
    }
  ) config.systemd.user.timers;
in
{
  options = {
    assertions = mkOption {
      type = types.listOf types.attrs;
      default = [ ];
    };
    lib = attrs { };
    home = {
      username = mkOption {
        type = types.str;
        default = "alice";
      };
      homeDirectory = mkOption {
        type = types.str;
        default = "/home/alice";
      };
      packages = mkOption {
        type = types.listOf types.package;
        default = [ ];
      };
    };
    fonts.fontconfig.enable = mkOption {
      type = types.bool;
      default = false;
    };
    xdg = {
      stateHome = mkOption {
        type = types.str;
        default = "${config.home.homeDirectory}/.local/state";
      };
      configFile = attrs { };
    };
    systemd.user = {
      services = attrs { };
      timers = attrs { };
    };
  };
  config.xdg.configFile = generated // timers;
}
