# Connection consumer, never cluster ownership. Keep limits complete and finite.
{ lib, name }:
let inherit (lib) mkOption types;
in mkOption {
  type = types.submodule { options = {
    jdbcUrl = mkOption { type = types.str; description = "Explicit credential-free JDBC TCP URL; provision separately with ponygirls.servicePostgres."; };
    user = mkOption { type = types.strMatching "[a-z_][a-z0-9_]*"; default = name; };
    passwordFile = mkOption { type = types.str; description = "Absolute private runtime database credential, never Nix store contents."; };
    readinessUnit = mkOption { type = types.nullOr types.str; default = null; description = "Independent database/extension readiness unit (not a daemon or another app). null only for independently provisioned external databases."; };
    limits = import ./jdbc-limits-options.nix { inherit lib; };
  }; };
  default = { };
}
