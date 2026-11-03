{ lib }:
let inherit (lib) mkOption types;
in mkOption {
  default = { };
  type = types.submodule { options = {
    maxConnections = mkOption { type = types.ints.between 1 256; default = 8; };
    maxQueued = mkOption { type = types.ints.between 0 1024; default = 32; };
  } // builtins.mapAttrs (_: default: mkOption { type = types.ints.between 1 3600000; inherit default; }) {
    queueTimeoutMs = 5000; connectTimeoutMs = 5000; statementTimeoutMs = 30000;
    lockTimeoutMs = 5000; idleTransactionTimeoutMs = 30000; socketTimeoutMs = 40000;
  }; };
}
