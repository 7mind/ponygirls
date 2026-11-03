# Connection consumer, never cluster ownership. Keep limits complete and finite.
{ lib, name }:
let inherit (lib) mkOption types;
in mkOption {
  type = types.submodule { options = {
    jdbcUrl = mkOption { type = types.str; description = "Explicit credential-free JDBC TCP URL; provision separately with ponygirls.servicePostgres."; };
    user = mkOption { type = types.strMatching "[a-z_][a-z0-9_]*"; default = name; };
    passwordFile = mkOption { type = types.str; description = "Absolute private runtime database credential, never Nix store contents."; };
    readinessUnit = mkOption { type = types.nullOr types.str; default = null; description = "Independent database/extension readiness unit (not a daemon or another app). null only for independently provisioned external databases."; };
    limits = mkOption {
      default = { };
      type = types.submodule { options = builtins.mapAttrs (_: default: mkOption { type = if default == 32 then types.ints.unsigned else types.ints.positive; inherit default; }) {
        maxConnections = 8; maxQueued = 32; queueTimeoutMs = 5000;
        connectTimeoutMs = 5000; statementTimeoutMs = 30000; lockTimeoutMs = 5000;
        idleTransactionTimeoutMs = 30000; socketTimeoutMs = 40000;
      }; };
    };
  }; };
  default = { };
}
