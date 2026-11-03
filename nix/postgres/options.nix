{ config, lib, pkgs, ... }:
let
  inherit (lib) mkOption types;
  cfg = config.ponygirls.servicePostgres;
  runtimePath = p: lib.hasPrefix "/" p && !(lib.hasPrefix "/nix/store/" p);
  identifier = types.strMatching "[a-z_][a-z0-9_]{0,62}";
in {
  options.ponygirls.servicePostgres = {
    enable = lib.mkEnableOption "the explicitly migrated shared PostgreSQL 18 provider (independent of application enable flags)";
    package = mkOption { type = types.package; default = pkgs.postgresql_18.withPackages (p: [ p.pgvector ]); };
    port = mkOption { type = types.port; default = 15434; };
    stateDirectory = mkOption { type = types.str; description = "NEW dedicated PostgreSQL 18 state root; never point at a legacy service cluster."; };
    adminRole = mkOption { type = identifier; description = "Peer-authenticated OS owner: HM user or NixOS postgres."; };
    maxConnections = mkOption { type = types.ints.between 16 1000; default = 64; };
    adminReserve = mkOption { type = types.ints.between 3 64; default = 8; };
    sharedBuffers = mkOption { type = types.strMatching "[0-9]+(MB|GB)"; default = "128MB"; description = "Conservative baseline, not host sizing. Budget model memory, workers, temp IO and disk independently."; };
    effectiveCacheSize = mkOption { type = types.strMatching "[0-9]+(MB|GB)"; default = "4GB"; description = "Planner estimate, not allocated memory or a deployment sizing claim."; };
    maintenanceWorkMem = mkOption { type = types.strMatching "[0-9]+(MB|GB)"; default = "64MB"; };
    trackIoTiming = mkOption { type = types.bool; default = false; };
    randomPageCost = mkOption { type = types.numbers.between 0.1 100; default = 4.0; description = "Host-specific planner/storage policy; set measured deployment overrides explicitly."; };
    effectiveIoConcurrency = mkOption { type = types.ints.between 0 1000; default = 1; };
    maintenanceIoConcurrency = mkOption { type = types.ints.between 0 1000; default = 10; };
    databases = mkOption {
      default = { };
      type = types.attrsOf (types.submodule ({ name, ... }: { options = {
        name = mkOption { type = identifier; default = name; };
        user = mkOption { type = identifier; default = name; };
        passwordFile = mkOption { type = types.str; description = "Private runtime file, never plaintext/store material. Existing contents are preserved."; };
        createPassword = mkOption { type = types.bool; default = false; description = "Explicit permission to create a missing random DB credential (never replace an existing one)."; };
        maxConnections = mkOption { type = types.ints.between 1 256; default = 12; };
        statementTimeoutMs = mkOption { type = types.ints.positive; default = 30000; };
        lockTimeoutMs = mkOption { type = types.ints.positive; default = 5000; };
        idleTransactionTimeoutMs = mkOption { type = types.ints.positive; default = 30000; };
        workMem = mkOption { type = types.strMatching "[0-9]+(kB|MB)"; default = "4MB"; };
      }; }));
      description = "Independent provisioned databases; do not derive this set from app enable flags. No automatic deletion/credential rotation.";
    };
    connections = mkOption { type = types.attrsOf types.anything; readOnly = true; description = "Explicit JDBC connection fields and database-scoped readiness units for service consumers."; };
  };
  config = lib.mkIf cfg.enable {
    assertions = [
      { assertion = lib.versions.major cfg.package.version == "18"; message = "Shared PostgreSQL is pinned to major 18; use logical migration into new state, not in-place reuse."; }
      { assertion = runtimePath cfg.stateDirectory && lib.all (d: runtimePath d.passwordFile) (builtins.attrValues cfg.databases); message = "PostgreSQL state/passwords must be absolute runtime paths outside the store."; }
      { assertion = cfg.maxConnections >= cfg.adminReserve + lib.foldl' (n: d: n + d.maxConnections) 0 (builtins.attrValues cfg.databases); message = "Shared PostgreSQL max_connections must cover every service limit plus adminReserve."; }
      { assertion = builtins.length (lib.unique (map (d: d.user) (builtins.attrValues cfg.databases))) == builtins.length (builtins.attrNames cfg.databases) && builtins.length (lib.unique (map (d: d.name) (builtins.attrValues cfg.databases))) == builtins.length (builtins.attrNames cfg.databases); message = "Shared PostgreSQL needs distinct databases AND distinct non-superuser roles."; }
      { assertion = lib.all (d: d.user != cfg.adminRole && !(builtins.elem d.user [ "postgres" "public" ]) && !(builtins.elem d.name [ "postgres" "template0" "template1" ])) (builtins.attrValues cfg.databases); message = "Application roles/databases cannot be administrative or reserved."; }
    ];
    ponygirls.servicePostgres.connections = lib.mapAttrs (key: d: {
      jdbcUrl = "jdbc:postgresql://127.0.0.1:${toString cfg.port}/${d.name}";
      databaseUser = d.user;
      databasePasswordFile = d.passwordFile;
      maxConnections = d.maxConnections;
      readinessUnit = "ponygirls-database-${key}.service";
    }) cfg.databases;
  };
}
