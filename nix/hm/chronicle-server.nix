{ mkChroniclePackage }:
{ config, lib, pkgs, ... }:
let
  cfg = config.smind.hm.services.chronicle;
  json = pkgs.formats.json { };
  state = cfg.stateDirectory;
  credentials = "${state}/credentials";
  unit = suffix: "${cfg.unitPrefix}${suffix}.service";
  restartOn = units: map (name: config.xdg.configFile."systemd/user/${name}".source) units;
  settings = cfg.settings // {
    jdbcUrl = "jdbc:postgresql://127.0.0.1:${toString cfg.database.port}/${cfg.database.name}";
    databaseUser = cfg.database.user;
    databasePasswordFile = cfg.database.passwordFile;
  };
  serverConfig = json.generate "chronicle-server.json" settings;
  proxyHeaders = ''
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_buffering off;
    proxy_cache off;
  '';
  proxyTarget = "http://${if cfg.settings.listenHost == "::1" then "[::1]" else cfg.settings.listenHost}:${toString cfg.settings.listenPort}";
  proxyLocations = ''
    client_max_body_size 8m;
    location = /api/ingest {
      client_max_body_size ${toString cfg.settings.maxBodyBytes};
      proxy_pass ${proxyTarget};
      ${proxyHeaders}
      proxy_request_buffering off;
      proxy_read_timeout 300s;
      proxy_send_timeout 300s;
    }
    location = /mcp {
      client_max_body_size 64k;
      proxy_pass ${proxyTarget};
      ${proxyHeaders}
      proxy_read_timeout 300s;
    }
    location = /api/collector/progress {
      client_max_body_size 64k;
      proxy_pass ${proxyTarget};
      ${proxyHeaders}
    }
    location = /api/login {
      client_max_body_size 16k;
      limit_req zone=chronicle_login burst=5 nodelay;
      proxy_pass ${proxyTarget};
      ${proxyHeaders}
    }
    location / { proxy_pass ${proxyTarget}; ${proxyHeaders} proxy_read_timeout 300s; }
  '';
  setup = pkgs.writeShellScript "chronicle-setup" ''
    set -euo pipefail
    umask 077
    mkdir -p ${lib.escapeShellArg state}/{credentials,postgres-socket,backups}
    ${lib.concatStrings (lib.mapAttrsToList (name: password: ''
      fingerprint="$(${pkgs.coreutils}/bin/sha256sum < ${lib.escapeShellArg password.revisionFile})"
      if [ ! -f ${lib.escapeShellArg "${credentials}/${name}.pbkdf2"} ] || [ ! -f ${lib.escapeShellArg "${credentials}/${name}.sha256"} ] || [ "$(<${lib.escapeShellArg "${credentials}/${name}.sha256"})" != "$fingerprint" ]; then
        ${cfg.package}/bin/chronicle-server password-hash < ${lib.escapeShellArg password.passwordFile} > ${lib.escapeShellArg "${credentials}/${name}.pbkdf2.tmp"}
        mv ${lib.escapeShellArg "${credentials}/${name}.pbkdf2.tmp"} ${lib.escapeShellArg "${credentials}/${name}.pbkdf2"}
        printf '%s\n' "$fingerprint" > ${lib.escapeShellArg "${credentials}/${name}.sha256"}
      fi
    '') cfg.passwords)}
  '';
  postgres = pkgs.writeShellScript "chronicle-postgres" ''
    set -euo pipefail
    umask 077
    if [ ! -e ${lib.escapeShellArg "${state}/postgres/PG_VERSION"} ]; then
      ${cfg.database.package}/bin/initdb -D ${lib.escapeShellArg "${state}/postgres"} --auth-local=peer --auth-host=scram-sha-256 --encoding=UTF8 --locale=C.UTF-8
    fi
    test "$(<${lib.escapeShellArg "${state}/postgres/PG_VERSION"})" = ${lib.escapeShellArg (lib.versions.major cfg.database.package.version)}
    exec ${cfg.database.package}/bin/postgres -D ${lib.escapeShellArg "${state}/postgres"} -k ${lib.escapeShellArg "${state}/postgres-socket"} \
      -p ${toString cfg.database.port} -c listen_addresses=127.0.0.1 -c unix_socket_permissions=0700 \
      -c random_page_cost=1.1 -c effective_io_concurrency=200 -c maintenance_io_concurrency=100
  '';
  database = pkgs.writeShellScript "chronicle-database" ''
    set -euo pipefail
    ready=0
    for _ in {1..60}; do
      if ${cfg.database.package}/bin/pg_isready -h ${lib.escapeShellArg "${state}/postgres-socket"} -p ${toString cfg.database.port} -d postgres; then ready=1; break; fi
      sleep 1
    done
    test "$ready" = 1
    export CHRONICLE_DB_PASSWORD
    CHRONICLE_DB_PASSWORD="$(<${lib.escapeShellArg cfg.database.passwordFile})"
    test -n "$CHRONICLE_DB_PASSWORD"
    ${cfg.database.package}/bin/psql -X -v ON_ERROR_STOP=1 -h ${lib.escapeShellArg "${state}/postgres-socket"} -p ${toString cfg.database.port} -d postgres <<'SQL'
    SELECT 'CREATE ROLE "${cfg.database.user}" LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${cfg.database.user}')\gexec
    \getenv password CHRONICLE_DB_PASSWORD
    ALTER ROLE "${cfg.database.user}" PASSWORD :'password';
    SELECT 'CREATE DATABASE "${cfg.database.name}" OWNER "${cfg.database.user}"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${cfg.database.name}')\gexec
    SQL
    unset CHRONICLE_DB_PASSWORD
    ${cfg.database.package}/bin/psql -X -v ON_ERROR_STOP=1 -h ${lib.escapeShellArg "${state}/postgres-socket"} -p ${toString cfg.database.port} -d ${lib.escapeShellArg cfg.database.name} -c 'CREATE EXTENSION IF NOT EXISTS vector;'
  '';
  service = description: dependencies: command: {
    Unit = { Description = description; After = dependencies; Requires = dependencies; X-Restart-Triggers = restartOn dependencies; };
    Service = { ExecStart = command; Restart = "on-failure"; RestartSec = 10; UMask = "0077"; NoNewPrivileges = true; };
    Install.WantedBy = [ "default.target" ];
  };
  databaseUnit = unit "-database";
  serverDependencies = [ databaseUnit ] ++ cfg.serverDependencies;
  runtimePath = path: lib.hasPrefix "/" path && path != builtins.storeDir && !(lib.hasPrefix "${builtins.storeDir}/" path);
in {
  options.smind.hm.services.chronicle = {
    enable = lib.mkEnableOption "a user-owned Chronicle server, PostgreSQL cluster and backups";
    package = lib.mkOption { type = lib.types.package; default = mkChroniclePackage { inherit pkgs; }; };
    stateDirectory = lib.mkOption { type = lib.types.str; default = "${config.xdg.stateHome}/chronicle"; };
    unitPrefix = lib.mkOption { type = lib.types.strMatching "[a-zA-Z0-9_-]+"; default = "chronicle"; };
    setupDependencies = lib.mkOption { type = lib.types.listOf lib.types.str; default = [ ]; description = "External units that provision runtime credentials; wanted, not required."; };
    serverDependencies = lib.mkOption { type = lib.types.listOf lib.types.str; default = [ ]; description = "Additional managed user units, for example an independently configured embedding server."; };
    restartTriggers = lib.mkOption { type = lib.types.listOf lib.types.str; default = [ ]; description = "Nonsecret revision files whose changes require a server restart."; };
    settings = lib.mkOption { type = lib.types.attrsOf json.type; description = "Chronicle server settings, excluding the database connection supplied below. All credentials must be runtime file references."; };
    passwords = lib.mkOption {
      default = { };
      type = lib.types.attrsOf (lib.types.submodule {
        options = {
          passwordFile = lib.mkOption { type = lib.types.str; description = "Runtime plaintext password file; only its path enters the store."; };
          revisionFile = lib.mkOption { type = lib.types.str; description = "Nonsecret revision source, such as encrypted ciphertext; change triggers password hash regeneration."; };
        };
      });
      description = "Passwords hashed to credentials/NAME.pbkdf2 during setup; settings.users selects these files explicitly.";
    };
    database = {
      package = lib.mkOption { type = lib.types.package; default = pkgs.postgresql_18.withPackages (p: [ p.pgvector ]); };
      port = lib.mkOption { type = lib.types.port; default = 15433; };
      name = lib.mkOption { type = lib.types.strMatching "[a-z_][a-z0-9_]*"; default = "chronicle"; };
      user = lib.mkOption { type = lib.types.strMatching "[a-z_][a-z0-9_]*"; default = "chronicle"; };
      passwordFile = lib.mkOption { type = lib.types.str; };
      restartTriggers = lib.mkOption { type = lib.types.listOf lib.types.str; default = [ ]; };
    };
  };
  config = lib.mkIf cfg.enable {
    assertions = [
      { assertion = pkgs.stdenv.hostPlatform.isLinux; message = "Chronicle user hosting requires Linux systemd."; }
      { assertion = builtins.elem cfg.settings.listenHost [ "127.0.0.1" "::1" ]; message = "Chronicle user hosting requires a loopback backend; expose it through the reverse proxy."; }
      { assertion = runtimePath state && runtimePath cfg.database.passwordFile; message = "Chronicle state and database credentials require absolute runtime paths outside the store."; }
      { assertion = lib.all (name: builtins.match "[a-zA-Z0-9_-]+" name != null && runtimePath cfg.passwords.${name}.passwordFile && lib.hasPrefix "/" cfg.passwords.${name}.revisionFile) (builtins.attrNames cfg.passwords); message = "Chronicle password names must be safe path components, password files must be runtime paths and revision files must be absolute."; }
      { assertion = !(cfg.settings ? jdbcUrl || cfg.settings ? databaseUser || cfg.settings ? databasePasswordFile); message = "Chronicle database settings are supplied by the database options, not settings."; }
    ];
    lib.ponygirls.chronicleServer = {
      inherit serverConfig proxyLocations;
      proxyHttpConfig = "limit_req_zone $binary_remote_addr zone=chronicle_login:1m rate=5r/m;";
    };
    systemd.user.services = {
      "${cfg.unitPrefix}-setup" = {
        Unit = { Description = "Prepare Chronicle credentials"; After = cfg.setupDependencies; Wants = cfg.setupDependencies; };
        Service = { Type = "oneshot"; ExecStart = setup; RemainAfterExit = true; UMask = "0077"; };
        Install.WantedBy = [ "default.target" ];
      };
      "${cfg.unitPrefix}-postgres" = (service "Chronicle isolated PostgreSQL ${lib.versions.major cfg.database.package.version} + pgvector" [ (unit "-setup") ] postgres) // {
        Service = { ExecStart = postgres; Restart = "on-failure"; RestartSec = 5; UMask = "0077"; KillSignal = "SIGINT"; TimeoutStopSec = 120; NoNewPrivileges = true; };
      };
      "${cfg.unitPrefix}-database" = {
        Unit = { Description = "Prepare Chronicle database"; After = [ (unit "-postgres") ]; Requires = [ (unit "-postgres") ]; X-Restart-Triggers = cfg.database.restartTriggers ++ restartOn [ (unit "-postgres") ]; };
        Service = { Type = "oneshot"; ExecStart = database; RemainAfterExit = true; UMask = "0077"; };
      };
      "${cfg.unitPrefix}" = (service "Chronicle session archive" serverDependencies "${cfg.package}/bin/chronicle-server serve ${serverConfig}") // {
        Unit = { Description = "Chronicle session archive"; PartOf = [ (unit "-postgres") ]; After = serverDependencies; Requires = serverDependencies; X-Restart-Triggers = cfg.restartTriggers ++ restartOn serverDependencies; };
        Service = { ExecStart = "${cfg.package}/bin/chronicle-server serve ${serverConfig}"; Restart = "on-failure"; RestartSec = 10; TimeoutStopSec = 60; SuccessExitStatus = [ 143 ]; UMask = "0077"; NoNewPrivileges = true; };
      };
      "${cfg.unitPrefix}-backup" = {
        Unit = { Description = "Back up Chronicle database"; After = [ databaseUnit ]; Requires = [ databaseUnit ]; };
        Service = { Type = "oneshot"; UMask = "0077"; ExecStart = pkgs.writeShellScript "chronicle-backup" ''
          set -euo pipefail
          file=${lib.escapeShellArg "${state}/backups"}/chronicle-$(${pkgs.coreutils}/bin/date -u +%Y%m%dT%H%M%SZ).dump
          ${cfg.database.package}/bin/pg_dump -h ${lib.escapeShellArg "${state}/postgres-socket"} -p ${toString cfg.database.port} -Fc ${lib.escapeShellArg cfg.database.name} > "$file.partial"
          mv "$file.partial" "$file"
          ${pkgs.findutils}/bin/find ${lib.escapeShellArg "${state}/backups"} -name 'chronicle-*.dump' -mtime +14 -delete
        ''; };
      };
    };
    systemd.user.timers."${cfg.unitPrefix}-backup" = { Unit.Description = "Daily Chronicle backup"; Timer = { OnCalendar = "daily"; Persistent = true; }; Install.WantedBy = [ "timers.target" ]; };
  };
}
