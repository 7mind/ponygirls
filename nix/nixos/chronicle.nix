{ config, lib, pkgs, ... }:
let
  cfg = config.smind.services.chronicle;
  credentialDir = "/run/credentials/chronicle.service";
  passwordName = id: "user-password-${builtins.hashString "sha256" id}";
  endpointOptions = {
    endpoint = lib.mkOption { type = lib.types.str; description = "Full OpenAI-compatible operation URL: /v1/chat/completions for annotation, /v1/embeddings for embedding."; };
    model = lib.mkOption { type = lib.types.str; description = "Served model name."; };
    revision = lib.mkOption { type = lib.types.str; description = "Operator-pinned deployment/model revision; changes require explicit maintenance reindex."; };
    credentialFile = lib.mkOption { type = lib.types.path; description = "Runtime API credential file; an explicitly empty file means no Authorization header."; };
    timeoutSeconds = lib.mkOption { type = lib.types.ints.positive; default = 60; };
    maxResponseBytes = lib.mkOption { type = lib.types.ints.positive; default = 4194304; };
  };
  endpointJson = name: endpoint: {
    inherit (endpoint) endpoint model revision timeoutSeconds maxResponseBytes;
    credentialFile = "${credentialDir}/${name}-key";
  };
  serverConfig = pkgs.writeText "chronicle-server.json" (builtins.toJSON {
    listenHost = cfg.listenAddress;
    listenPort = cfg.port;
    allowedOrigin = if cfg.publicUrl == null then "configuration-required" else cfg.publicUrl;
    secureCookies = !cfg.loopbackDevelopment;
    jdbcUrl = if cfg.database.manageLocal then "jdbc:postgresql://127.0.0.1:5432/${cfg.database.name}" else cfg.database.jdbcUrl;
    databaseUser = cfg.database.user;
    databasePasswordFile = "${credentialDir}/database-password";
    users = lib.mapAttrsToList (id: user: {
      inherit id;
      inherit (user) login enabled;
      passwordHashFile = "${credentialDir}/${passwordName id}";
    }) cfg.users;
    inherit (cfg.limits) maxBodyBytes maxFiles maxFileBytes maxMessages sessionTtlSeconds;
    annotation = endpointJson "annotation" cfg.annotation;
    embedding = endpointJson "embedding" cfg.embedding // {
      inherit (cfg.embedding) dimensions sendDimensions queryPrefix documentPrefix;
    };
  });
  runtimeFiles = [ cfg.database.passwordFile cfg.annotation.credentialFile cfg.embedding.credentialFile ]
    ++ map (u: u.passwordHashFile) (builtins.attrValues cfg.users);
  loginList = map (u: u.login) (builtins.attrValues cfg.users);
  host = if cfg.publicUrl == null then "configuration-required" else
    builtins.head (lib.splitString "/" (lib.removePrefix "https://" (lib.removePrefix "http://" cfg.publicUrl)));
  setupDatabase = pkgs.writeShellScript "chronicle-database-setup" ''
    set -euo pipefail
    export CHRONICLE_DB_PASSWORD
    CHRONICLE_DB_PASSWORD="$(<"$CREDENTIALS_DIRECTORY/database-password")"
    if [[ -z "$CHRONICLE_DB_PASSWORD" || "$CHRONICLE_DB_PASSWORD" == *$'\n'* || "$CHRONICLE_DB_PASSWORD" == *$'\r'* ]]; then
      echo 'Chronicle: database password must be a nonempty single line' >&2
      exit 1
    fi
    ${config.services.postgresql.package}/bin/psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname postgres <<'SQL'
    \getenv chronicle_password CHRONICLE_DB_PASSWORD
    ALTER ROLE "${cfg.database.user}" WITH LOGIN PASSWORD :'chronicle_password';
    SQL
    unset CHRONICLE_DB_PASSWORD
    ${config.services.postgresql.package}/bin/psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname ${lib.escapeShellArg cfg.database.name} \
      --command 'CREATE EXTENSION IF NOT EXISTS vector;'
  '';
in
{
  imports = [ ./chronicle-models.nix ];
  options.smind.services.chronicle = {
    enable = lib.mkEnableOption "Chronicle semi-structured agent session archive";
    package = lib.mkOption { type = lib.types.package; default = pkgs.callPackage ../pkg/chronicle/server.nix { }; };
    listenAddress = lib.mkOption { type = lib.types.str; default = "127.0.0.1"; description = "Backend binds loopback; use the TLS reverse proxy for remote access."; };
    port = lib.mkOption { type = lib.types.port; default = 47330; };
    publicUrl = lib.mkOption { type = lib.types.nullOr lib.types.str; default = null; example = "https://chronicle.example.net"; description = "Exact browser Origin (no trailing slash or path)."; };
    loopbackDevelopment = lib.mkOption { type = lib.types.bool; default = false; description = "Explicitly allow loopback HTTP and insecure cookies for local development only."; };
    users = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule {
        options = {
          login = lib.mkOption { type = lib.types.str; description = "Unique login; attribute name is the stable user ID."; };
          passwordHashFile = lib.mkOption { type = lib.types.path; description = "Runtime PBKDF2 password hash file produced by chronicle-server password-hash."; };
          enabled = lib.mkOption { type = lib.types.bool; default = true; };
        };
      });
      default = { };
    };
    annotation = lib.mkOption { type = lib.types.submodule { options = endpointOptions; }; description = "Annotation model endpoint and explicit profile identity."; };
    embedding = lib.mkOption {
      type = lib.types.submodule {
        options = endpointOptions // {
          dimensions = lib.mkOption { type = lib.types.ints.positive; description = "Exact model output dimensions, validated at startup and indexing."; };
          sendDimensions = lib.mkOption { type = lib.types.bool; default = false; description = "Send the optional OpenAI dimensions request parameter only for models supporting output truncation. dimensions always validates the actual/stored vector length, even when this flag is false."; };
          queryPrefix = lib.mkOption { type = lib.types.str; description = "Model-specific query instruction prefix (explicitly empty if none)."; };
          documentPrefix = lib.mkOption { type = lib.types.str; description = "Model-specific document prefix, distinct from query prefix when required."; };
        };
      };
    };
    database = {
      manageLocal = lib.mkOption { type = lib.types.bool; default = true; };
      ssdTuning = lib.mkEnableOption "SSD-oriented planner and I/O concurrency defaults for the managed PostgreSQL cluster (cluster-wide, not a storage benchmark)" // { default = true; };
      name = lib.mkOption { type = lib.types.str; default = "chronicle"; };
      user = lib.mkOption { type = lib.types.str; default = "chronicle"; };
      passwordFile = lib.mkOption { type = lib.types.path; description = "Runtime database password file; never embed a password in jdbcUrl."; };
      jdbcUrl = lib.mkOption { type = lib.types.str; default = ""; description = "External JDBC URL when manageLocal=false; provision the vector extension there."; };
    };
    limits = {
      maxBodyBytes = lib.mkOption { type = lib.types.ints.positive; default = 8388608; };
      maxFiles = lib.mkOption { type = lib.types.ints.positive; default = 16; };
      maxFileBytes = lib.mkOption { type = lib.types.ints.positive; default = 4194304; };
      maxMessages = lib.mkOption { type = lib.types.ints.positive; default = 10000; };
      sessionTtlSeconds = lib.mkOption { type = lib.types.ints.positive; default = 43200; };
    };
    proxy = {
      enable = lib.mkOption { type = lib.types.bool; default = true; };
      acmeHost = lib.mkOption { type = lib.types.nullOr lib.types.str; default = null; description = "Existing ACME certificate name; null means TLS termination is managed separately."; };
    };
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    {
      assertions = [
        { assertion = cfg.listenAddress == "127.0.0.1" || cfg.listenAddress == "::1"; message = "Chronicle: bind the backend to loopback and expose it through a TLS proxy."; }
        { assertion = cfg.publicUrl != null && (lib.hasPrefix "https://" cfg.publicUrl || (cfg.loopbackDevelopment && (lib.hasPrefix "http://127.0.0.1:" cfg.publicUrl || lib.hasPrefix "http://localhost:" cfg.publicUrl))); message = "Chronicle: HTTPS publicUrl is required unless loopbackDevelopment is explicit."; }
        { assertion = cfg.publicUrl == null || !(lib.hasSuffix "/" cfg.publicUrl); message = "Chronicle: publicUrl must be the exact Origin without trailing slash."; }
        { assertion = !cfg.loopbackDevelopment || (cfg.publicUrl != null && (lib.hasPrefix "http://127.0.0.1:" cfg.publicUrl || lib.hasPrefix "http://localhost:" cfg.publicUrl)); message = "Chronicle: loopbackDevelopment is only valid with a loopback HTTP Origin."; }
        { assertion = lib.any (u: u.enabled) (builtins.attrValues cfg.users); message = "Chronicle: configure at least one enabled static user."; }
        { assertion = builtins.length loginList == builtins.length (lib.unique loginList); message = "Chronicle: logins must be unique."; }
        { assertion = lib.all (p: !(lib.hasPrefix builtins.storeDir (toString p))) runtimeFiles; message = "Chronicle: all credential files must be runtime paths outside the Nix store."; }
        { assertion = !cfg.database.manageLocal || (cfg.database.name == cfg.database.user && builtins.match "[a-z_][a-z0-9_]*" cfg.database.name != null); message = "Chronicle: managed database name and role must match and use lowercase SQL identifiers."; }
        { assertion = cfg.database.manageLocal || cfg.database.jdbcUrl != ""; message = "Chronicle: external database requires jdbcUrl and a preinstalled vector extension."; }
      ];
      users.groups.chronicle = { };
      users.users.chronicle = { isSystemUser = true; group = "chronicle"; };
      systemd.services.chronicle = {
        description = "Chronicle agent session archive and search";
        wantedBy = [ "multi-user.target" ];
        after = [ "network-online.target" ] ++ lib.optional cfg.database.manageLocal "chronicle-database.service";
        requires = lib.optional cfg.database.manageLocal "chronicle-database.service";
        serviceConfig = {
          User = "chronicle";
          Group = "chronicle";
          ExecStart = "${cfg.package}/bin/chronicle-server serve ${serverConfig}";
          LoadCredential = [
            "database-password:${cfg.database.passwordFile}"
            "annotation-key:${cfg.annotation.credentialFile}"
            "embedding-key:${cfg.embedding.credentialFile}"
          ] ++ lib.mapAttrsToList (id: u: "${passwordName id}:${u.passwordHashFile}") cfg.users;
          Restart = "on-failure";
          RestartSec = 5;
          TimeoutStopSec = 60;
          StateDirectory = "chronicle";
          WorkingDirectory = "/var/lib/chronicle";
          UMask = "0077";
          NoNewPrivileges = true;
          PrivateTmp = true;
          ProtectSystem = "strict";
          ProtectHome = true;
          RestrictSUIDSGID = true;
          CapabilityBoundingSet = "";
        };
      };
    }
    (lib.mkIf cfg.database.manageLocal {
      services.postgresql = {
        enable = true;
        extensions = p: [ p.pgvector ];
        settings = lib.mkIf cfg.database.ssdTuning {
          random_page_cost = lib.mkDefault 1.1;
          effective_io_concurrency = lib.mkDefault 200;
          maintenance_io_concurrency = lib.mkDefault 100;
        };
        ensureDatabases = [ cfg.database.name ];
        ensureUsers = [ { name = cfg.database.user; ensureDBOwnership = true; } ];
        authentication = lib.mkBefore ''
          host ${cfg.database.name} ${cfg.database.user} 127.0.0.1/32 scram-sha-256
        '';
      };
      systemd.services.chronicle-database = {
        description = "Chronicle database credentials and pgvector setup";
        requires = [ "postgresql.service" "postgresql-setup.service" ];
        after = [ "postgresql.service" "postgresql-setup.service" ];
        before = [ "chronicle.service" ];
        serviceConfig = {
          Type = "oneshot";
          User = "postgres";
          LoadCredential = [ "database-password:${cfg.database.passwordFile}" ];
          ExecStart = setupDatabase;
          RemainAfterExit = true;
          UMask = "0077";
        };
      };
    })
    (lib.mkIf cfg.proxy.enable {
      services.nginx.enable = true;
      services.nginx.virtualHosts.${host} = {
        forceSSL = cfg.proxy.acmeHost != null;
        useACMEHost = cfg.proxy.acmeHost;
        locations."/" = {
          proxyPass = "http://${if cfg.listenAddress == "::1" then "[::1]" else cfg.listenAddress}:${toString cfg.port}";
          proxyWebsockets = true;
          extraConfig = ''
            proxy_buffering off;
            proxy_read_timeout 90s;
            client_max_body_size ${toString cfg.limits.maxBodyBytes};
          '';
        };
      };
    })
  ]);
}
