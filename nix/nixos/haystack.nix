# Haystack NixOS server module (Step 8): static identities, hash
# credentials, local PostgreSQL with peer auth, migrations/hardening,
# tuning, TLS proxy, backups, and per-account client mappings.
{ config, lib, pkgs, ... }:
let
  cfg = config.smind.services.haystack;

  # Credential names are fixed derivations of user/token ids (no secrets in
  # the store; systemd loads the digest files listed here).
  credName = userId: tokenId: "haystack-hash-${userId}-${tokenId}";

  authJson = pkgs.writeText "haystack-auth.json" (builtins.toJSON {
    activityProjectId = cfg.activityProjectId;
    users = lib.mapAttrsToList
      (userId: user: {
        id = userId;
        type = user.type;
        displayName = user.displayName;
        tokens = lib.mapAttrsToList (tokenId: token: {
          id = tokenId;
          hashFile = "$CREDENTIALS_DIRECTORY/${credName userId tokenId}";
        }) user.tokens;
      })
      cfg.users;
    cookieSecure = true;
    allowedHosts = lib.unique ([ "127.0.0.1" "localhost" ] ++ lib.optional (cfg.publicUrl != null) cfg.publicUrlHost);
    allowedOrigins = lib.optional (cfg.publicUrl != null) cfg.publicUrl;
    rateLimit = { windowMs = 60000; max = 600; };
  });

  dbUrl = "postgresql://${cfg.database.user}@/${cfg.database.name}?host=${cfg.database.socketDir}";
  backendLocation = {
    proxyPass = "http://${cfg.listenAddress}:${toString cfg.port}";
    proxyWebsockets = true;
    extraConfig = ''
      proxy_cache off;
      proxy_buffering off;
      client_max_body_size 2m;
      proxy_intercept_errors on;
      error_page 502 504 =503 @haystack_unavailable;
    '';
  };
in
{
  options.smind.services.haystack = {
    enable = lib.mkEnableOption "Haystack structured agent-memory service";
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ../pkg/haystack/package.nix { };
      description = "Haystack server package (bundles the web UI).";
    };
    listenAddress = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Listen address. Non-loopback requires allowPublicListen.";
    };
    allowPublicListen = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Acknowledge exposing the service socket beyond loopback (TLS proxy still required outside loopback development).";
    };
    port = lib.mkOption {
      type = lib.types.port;
      default = 47328;
      description = "Local port for the Haystack HTTP endpoint.";
    };
    publicUrl = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "https://memory.example.net";
      description = "Public base URL (drives allowedOrigins/Hosts and the proxy). Null disables the proxy.";
    };
    publicUrlHost = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Hostname of publicUrl (Host allowlist entry). Set automatically from publicUrl when null.";
    };
    activityProjectId = lib.mkOption {
      type = lib.types.str;
      default = "agent-activity";
      description = "Authoritative shared namespace (persisted in store_metadata, propagated to clients).";
    };
    users = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule {
        options = {
          type = lib.mkOption { type = lib.types.enum [ "human" "agent" ]; description = "Attribution only, never authorization."; };
          displayName = lib.mkOption { type = lib.types.str; default = ""; description = "Display name."; };
          tokens = lib.mkOption {
            type = lib.types.attrsOf (lib.types.submodule {
              options.tokenHashFile = lib.mkOption {
                type = lib.types.path;
                description = "Runtime file with the token's SHA-256 hex digest (secret-manager path, never store material).";
              };
            });
            default = { };
            description = "Token IDs to digest files (multiple IDs allow rotation overlap).";
          };
        };
      });
      default = { };
      description = "Static users and their token digests.";
    };
    clients = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule {
        options = {
          userId = lib.mkOption { type = lib.types.str; description = "Agent user ID for this Unix account."; };
          tokenId = lib.mkOption { type = lib.types.str; description = "Token ID for this Unix account."; };
          tokenFile = lib.mkOption { type = lib.types.path; description = "Runtime file with the raw bearer token."; };
        };
      });
      default = { };
      description = "Unix-account → agent-credential mapping (not a second user registry).";
    };
    database = {
      manageLocal = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Manage the local PostgreSQL database/role via the NixOS postgresql service.";
      };
      name = lib.mkOption { type = lib.types.str; default = "haystack"; description = "Database name."; };
      user = lib.mkOption { type = lib.types.str; default = "haystack"; description = "Database role (service peer-authenticates as this user)."; };
      socketDir = lib.mkOption { type = lib.types.str; default = "/run/postgresql"; description = "Unix socket directory."; };
      poolMax = lib.mkOption { type = lib.types.ints.positive; default = 8; description = "Bounded service connection pool."; };
    };
    tuning = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = {
        seq_page_cost = "1.0";
        random_page_cost = "1.1";
        work_mem = "16MB";
        statement_timeout = "30000";
        lock_timeout = "5000";
        idle_in_transaction_session_timeout = "60000";
        jit = "off";
      };
      description = ''
        Role/database-scoped PostgreSQL settings (ALTER ROLE ... IN DATABASE),
        applied by the setup service. Never touches unrelated databases;
        cluster-wide settings (shared_buffers et al.) are out of scope here
        and need an explicit operator-approved cluster profile.
      '';
    };
    backup = {
      enable = lib.mkOption { type = lib.types.bool; default = true; description = "Automated pg_dump backups with retention."; };
      directory = lib.mkOption { type = lib.types.str; default = "/var/backups/haystack"; description = "Backup directory."; };
      schedule = lib.mkOption { type = lib.types.str; default = "daily"; description = "systemd OnCalendar schedule."; };
      retentionDays = lib.mkOption { type = lib.types.ints.positive; default = 14; description = "Retain backups this long."; };
    };
    proxy = {
      acmeHost = lib.mkOption { type = lib.types.nullOr lib.types.str; default = null; description = "Use this ACME host's certificate (null: plain HTTP proxy, loopback development only)."; };
      openFirewall = lib.mkOption { type = lib.types.bool; default = false; description = "Open firewall for HTTP/HTTPS (never by default)."; };
    };
  };

  config = lib.mkMerge [
    {
      smind.services.haystack.publicUrlHost = lib.mkDefault (
        if cfg.publicUrl == null then null
        else
          let
            noScheme = lib.removePrefix "https://" (lib.removePrefix "http://" cfg.publicUrl);
            noPath = builtins.head (builtins.split "/" noScheme);
            noPort = builtins.head (builtins.split ":" noPath);
          in
          noPort
      );
    }
    (lib.mkIf cfg.enable {
      assertions = [
        {
          assertion = cfg.listenAddress == "127.0.0.1" || cfg.listenAddress == "::1" || cfg.allowPublicListen;
          message = "smind.services.haystack: non-loopback listenAddress requires allowPublicListen.";
        }
        {
          assertion = cfg.users != { };
          message = "smind.services.haystack: configure at least one user (human browser token + agent tokens).";
        }
        {
          assertion = lib.all (u: u.tokens != { }) (lib.attrValues cfg.users);
          message = "smind.services.haystack: every user needs at least one token.";
        }
        {
          assertion =
            let
              maps = lib.mapAttrsToList (account: c: c // { inherit account; }) cfg.clients;
            in
            lib.all
              (m:
                (cfg.users.${m.userId} or null) != null
                && (cfg.users.${m.userId}.type or "") == "agent"
                && ((cfg.users.${m.userId}.tokens or { }).${m.tokenId} or null) != null)
              maps;
          message = "smind.services.haystack: every clients.<account> mapping must reference an existing agent userId and one of its tokenIds (never a human credential, never an implicit identity).";
        }
        {
          assertion = cfg.publicUrl == null || cfg.publicUrlHost != null;
          message = "smind.services.haystack: publicUrl requires a derivable publicUrlHost.";
        }
      ];

      services.postgresql = lib.mkIf cfg.database.manageLocal {
        enable = true;
        ensureDatabases = [ cfg.database.name ];
        ensureUsers = [{ name = cfg.database.user; ensureDBOwnership = true; }];
        authentication = lib.mkAfter "local ${cfg.database.name} ${cfg.database.user} peer";
      };

      systemd.services.haystack-setup = lib.mkIf cfg.database.manageLocal {
        description = "Haystack database setup (tuning, readiness)";
        wantedBy = [ "multi-user.target" ];
        before = [ "haystack.service" ];
        after = [ "postgresql.service" ];
        requires = [ "postgresql.service" ];
        path = [ config.services.postgresql.package ];
        script =
          let
            alters = lib.concatStringsSep "\n" (lib.mapAttrsToList
              (k: v: "psql -h ${cfg.database.socketDir} -U postgres -d ${cfg.database.name} -c \"ALTER ROLE \\\"${cfg.database.user}\\\" IN DATABASE \\\"${cfg.database.name}\\\" SET ${k} = '${v}';\"")
              cfg.tuning);
          in
          ''
            set -euo pipefail
            for i in $(seq 1 30); do
              pg_isready -h ${cfg.database.socketDir} && break
              sleep 1
            done
            ${alters}
          '';
        serviceConfig = {
          Type = "oneshot";
          User = "postgres";
          RemainAfterExit = true;
        };
      };

      systemd.services.haystack = {
        description = "Haystack structured agent-memory service";
        wantedBy = [ "multi-user.target" ];
        after = [ "network.target" "haystack-setup.service" ];
        requires = [ "haystack-setup.service" ];
        environment = {
          HAYSTACK_AUTH_JSON = "${authJson}";
          HAYSTACK_DATABASE_URL = dbUrl;
          HAYSTACK_LISTEN = cfg.listenAddress;
          HAYSTACK_PORT = toString cfg.port;
          HAYSTACK_POOL_MAX = toString cfg.database.poolMax;
        };
        serviceConfig = {
          ExecStart = "${cfg.package}/bin/haystack-server";
          User = cfg.database.user;
          DynamicUser = true;
          Restart = "on-failure";
          NoNewPrivileges = true;
          ProtectSystem = "strict";
          ProtectHome = true;
          PrivateTmp = true;
          CapabilityBoundingSet = "";
        } // {
          LoadCredential = lib.flatten (lib.mapAttrsToList
            (userId: user: lib.mapAttrsToList
              (tokenId: token: "${credName userId tokenId}:${token.tokenHashFile}")
              user.tokens)
            cfg.users);
        };
      };

      systemd.services.haystack-backup = lib.mkIf cfg.backup.enable {
        description = "Haystack database backup (pg_dump, retention)";
        path = [ config.services.postgresql.package ];
        script = ''
          set -euo pipefail
          mkdir -p ${lib.escapeShellArg cfg.backup.directory}
          out=${lib.escapeShellArg cfg.backup.directory}/haystack-$(date -u +%Y%m%dT%H%M%SZ).dump
          pg_dump -h ${cfg.database.socketDir} -U ${cfg.database.user} -Fc -f "$out" ${cfg.database.name}
          chmod 600 "$out"
          find ${lib.escapeShellArg cfg.backup.directory} -name 'haystack-*.dump' -mtime +${toString cfg.backup.retentionDays} -delete
        '';
        serviceConfig = {
          Type = "oneshot";
          User = cfg.database.user;
          DynamicUser = true;
        };
        startAt = cfg.backup.schedule;
      };

      services.nginx = lib.mkIf (cfg.publicUrl != null) {
        enable = true;
        recommendedProxySettings = true;
        virtualHosts.${cfg.publicUrlHost} = {
          forceSSL = cfg.proxy.acmeHost != null;
          useACMEHost = cfg.proxy.acmeHost;
          root = "${cfg.package}/lib/node_modules/haystack/web/dist";
          locations."/" = {
            tryFiles = "$uri $uri/ =404";
            extraConfig = ''
              add_header Cache-Control "no-cache";
              add_header Referrer-Policy "no-referrer" always;
              add_header X-Content-Type-Options "nosniff" always;
            '';
          };
          locations."/api/" = backendLocation;
          locations."/mcp" = backendLocation;
          locations."@haystack_unavailable".extraConfig = ''
            default_type application/json;
            add_header Cache-Control "no-store" always;
            add_header Referrer-Policy "no-referrer" always;
            return 503 '{"error":{"code":"unavailable","message":"service unavailable"}}';
          '';
        };
      };
      networking.firewall.allowedTCPPorts = lib.mkIf (cfg.publicUrl != null && cfg.proxy.openFirewall) (
        [ 80 ] ++ lib.optional (cfg.proxy.acmeHost != null) 443
      );
    })
  ];
}
