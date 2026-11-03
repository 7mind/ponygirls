# Generic provider policy shared by both lifecycle adapters. No app package is an
# input: changing a UI/ELF cannot restart PostgreSQL or another application.
{ lib, pkgs, cfg }:
let
  hbaText = (''
    local all ${cfg.adminRole} peer
    local all all reject
  '' + lib.concatMapStrings (d: ''
    host ${d.name} ${d.user} 127.0.0.1/32 scram-sha-256
  '') (builtins.attrValues cfg.databases) + ''
    host all all 0.0.0.0/0 reject
    host all all ::/0 reject
  '');
  hba = pkgs.writeText "ponygirls-pg_hba.conf" hbaText;
  settings = {
    listen_addresses = "127.0.0.1";
    port = cfg.port;
    unix_socket_directories = "${cfg.stateDirectory}/socket";
    unix_socket_permissions = "0700";
    hba_file = toString hba;
    password_encryption = "scram-sha-256";
    max_connections = cfg.maxConnections;
    superuser_reserved_connections = cfg.adminReserve;
    shared_buffers = cfg.sharedBuffers;
    work_mem = "4MB";
    maintenance_work_mem = "64MB";
    max_parallel_maintenance_workers = 1;
    max_parallel_workers_per_gather = 0;
    autovacuum_max_workers = 3;
    fsync = true;
    full_page_writes = true;
    synchronous_commit = "on";
    wal_level = "replica";
    # No SSD/planner claims without deployment measurements.
    log_statement = "none";
    log_min_error_statement = "panic";
  };
  configuration = pkgs.writeText "ponygirls-postgresql.conf" (lib.concatStringsSep "\n" (lib.mapAttrsToList (k: v: "${k} = ${if builtins.isBool v then (if v then "on" else "off") else if builtins.isInt v then toString v else "'${v}'"}") settings) + "\n");
  manifest = pkgs.writeText "ponygirls-postgres.json" (builtins.toJSON {
    inherit (cfg) stateDirectory adminRole port databases adminReserve;
    postgresBin = "${cfg.package}/bin";
  });
  run = command: "${pkgs.python3}/bin/python3 ${./provider.py} ${command} ${manifest}";
in {
  inherit hba hbaText settings configuration manifest run;
  provision = key: pkgs.writeShellScript "ponygirls-database-${key}" ''
    set -euo pipefail
    umask 077
    exec ${run "provision"} ${lib.escapeShellArg key}
  '';
  init = pkgs.writeShellScript "ponygirls-postgres-init" ''
    set -euo pipefail
    umask 077
    exec ${run "init"}
  '';
  start = pkgs.writeShellScript "ponygirls-postgres" ''
    set -euo pipefail
    umask 077
    ${run "init"}
    exec ${cfg.package}/bin/postgres -D ${lib.escapeShellArg "${cfg.stateDirectory}/data"} -c config_file=${configuration}
  '';
}
