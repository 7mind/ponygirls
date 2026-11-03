{ config, lib, pkgs, ... }:
let
  cfg = config.ponygirls.servicePostgres;
  policy = import ../postgres/policy.nix { inherit lib pkgs cfg; };
in {
  imports = [ ../postgres/options.nix ];
  config = lib.mkMerge [
    { ponygirls.servicePostgres = {
      stateDirectory = lib.mkDefault "${config.xdg.stateHome}/ponygirls-postgres-18";
      adminRole = lib.mkDefault config.home.username;
    }; }
    (lib.mkIf cfg.enable {
      assertions = [{ assertion = pkgs.stdenv.hostPlatform.isLinux; message = "The HM shared PostgreSQL adapter requires Linux/systemd. All HM services share the Unix owner's trust boundary: role ACLs do NOT isolate secrets from same-UID processes."; }];
      systemd.user.services = {
        ponygirls-postgres = {
          Unit.Description = "Shared PostgreSQL 18 + pgvector (HM common-UID trust boundary)";
          Service = {
            ExecStart = policy.start;
            Restart = "on-failure";
            RestartSec = 5;
            UMask = "0077";
            KillSignal = "SIGINT";
            TimeoutStopSec = 120;
            NoNewPrivileges = true;
          };
          Install.WantedBy = [ "default.target" ];
        };
      } // lib.mapAttrs' (key: _: lib.nameValuePair "ponygirls-database-${key}" {
        Unit = {
          Description = "Provision isolated ${key} database/extensions (not app startup)";
          After = [ "ponygirls-postgres.service" ];
          Requires = [ "ponygirls-postgres.service" ];
        };
        Service = { Type = "oneshot"; ExecStart = policy.provision key; RemainAfterExit = true; UMask = "0077"; TimeoutStartSec = 180; };
        Install.WantedBy = [ "default.target" ];
      }) cfg.databases;
    })
  ];
}
