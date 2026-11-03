# Haystack NixOS server module (Step 8): static identities, hash
# credentials, local PostgreSQL with peer auth, migrations/hardening,
# tuning, TLS proxy, backups, and per-account client mappings.
{ mkHaystackPackage }:
{ config, lib, pkgs, ... }:
let
  proxyFailure = (import ../lib/haystack-proxy.nix { }).unavailableJson;
  cfg = config.smind.services.haystack;

  # Credential names are fixed derivations of user/token ids (no secrets in
  # the store; systemd loads the digest files listed here).
  credName = userId: tokenId: "haystack-hash-${userId}-${tokenId}";

  authSettings = {
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
  };
  credentials = lib.flatten (lib.mapAttrsToList (userId: user: lib.mapAttrsToList
    (tokenId: token: "${credName userId tokenId}:${token.tokenHashFile}") user.tokens) cfg.users)
    ++ [ "database-password:${cfg.database.passwordFile}" ]
    ++ lib.optional (cfg.retrieval.embedding != null) "embedding-key:${cfg.retrieval.embedding.credentialFile}";
  serverConfig = pkgs.writeText "haystack-server.json" (builtins.toJSON {
    listenHost = cfg.listenAddress;
    listenPort = cfg.port;
    webRoot = "${cfg.package}/share/haystack/web";
    authReloadMs = 1000;
    auth = authSettings // { insecureHttpOrigins = [ ]; };
    database = {
      inherit (cfg.database) jdbcUrl user limits;
      passwordFile = "$CREDENTIALS_DIRECTORY/database-password";
    };
    retrieval = cfg.retrieval // { embedding = if cfg.retrieval.embedding == null then null else cfg.retrieval.embedding // { credentialFile = "$CREDENTIALS_DIRECTORY/embedding-key"; }; };
  });
  readiness = lib.optional (cfg.database.readinessUnit != null) cfg.database.readinessUnit;
  backendLocation = {
    proxyPass = "http://${cfg.listenAddress}:${toString cfg.port}";
    proxyWebsockets = true;
    extraConfig = ''
      # Native error/access logs can expose request-line credentials or query
      # values. The Scala service emits allowlisted structured request telemetry.
      error_log /dev/null;
      access_log off;
      proxy_cache off;
      proxy_buffering off;
      client_max_body_size 2m;
      proxy_intercept_errors on;
      error_page 502 504 =503 @haystack_unavailable;
    '';
  };
in
{
  imports = [ ./service-postgres.nix ];
  options.smind.services.haystack = {
    enable = lib.mkEnableOption "Haystack structured agent-memory service";
    package = lib.mkOption {
      type = lib.types.package;
      default = mkHaystackPackage { inherit pkgs; };
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
      description = "Public base URL (drives allowedOrigins/Hosts and, unless proxy.enable is false, the host-local nginx virtual host). Null disables both.";
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
                type = lib.types.str;
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
          tokenFile = lib.mkOption { type = lib.types.str; description = "Runtime file with the raw bearer token."; };
        };
      });
      default = { };
      description = "Unix-account → agent-credential mapping (not a second user registry).";
    };
    database = import ../lib/service-database-options.nix { inherit lib; name = "haystack"; };
    retrieval = {
      policy = lib.mkOption { type = lib.types.str; default = "operator-approved-metadata-v1"; };
      includeMetadata = lib.mkOption { type = lib.types.bool; default = true; };
      approvedFieldPrefixes = lib.mkOption { type = lib.types.listOf lib.types.str; default = [ ]; };
      maxChunkBytes = lib.mkOption { type = lib.types.ints.positive; default = 8192; };
      embedding = import ../lib/embedding-options.nix { inherit lib; };
      maxConcurrent = lib.mkOption { type = lib.types.ints.positive; default = 2; };
      maxQueued = lib.mkOption { type = lib.types.ints.unsigned; default = 8; };
      batchSize = lib.mkOption { type = lib.types.ints.positive; default = 4; };
    };
    backup = {
      enable = lib.mkOption { type = lib.types.bool; default = true; description = "Automated pg_dump backups with retention."; };
      directory = lib.mkOption { type = lib.types.str; default = "/var/lib/haystack-backups"; description = "Backup directory."; };
      schedule = lib.mkOption { type = lib.types.str; default = "daily"; description = "systemd OnCalendar schedule."; };
      retentionDays = lib.mkOption { type = lib.types.ints.positive; default = 14; description = "Retain backups this long."; };
    };
    proxy = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = ''
          Manage the host-local nginx virtual host (UI shell + /api/ + /mcp
          policy). Disable when TLS terminates on an external edge that
          forwards Host-intact and serves the UI shell from this package's
          web dist itself; publicUrl still drives the server's Host/Origin
          allowlists in that case.
        '';
      };
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
        { assertion = lib.all (p: lib.hasPrefix "/" p && !(lib.hasPrefix "/nix/store/" p)) ([ cfg.database.passwordFile ] ++ lib.concatMap (u: map (t: t.tokenHashFile) (builtins.attrValues u.tokens)) (builtins.attrValues cfg.users) ++ lib.optional (cfg.retrieval.embedding != null) cfg.retrieval.embedding.credentialFile); message = "smind.services.haystack: credentials must be absolute runtime paths, never source/store files."; }

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
        {
          assertion = cfg.proxy.enable || !cfg.proxy.openFirewall;
          message = "smind.services.haystack: proxy.openFirewall without proxy.enable opens ports for no virtual host.";
        }
      ];

      systemd.services.haystack-setup = {
        description = "Haystack database-scoped authoritative migrations";
        wantedBy = [ "multi-user.target" ];
        before = [ "haystack.service" ];
        after = readiness;
        requires = readiness;
        serviceConfig = {
          Type = "oneshot";
          User = "haystack";
          DynamicUser = true;
          RemainAfterExit = true;
          ExecStart = "${cfg.package}/bin/haystack-server migrate ${serverConfig}";
          LoadCredential = credentials;
        };
      };
      systemd.services.haystack = {
        description = "Haystack native Scala structured memory";
        wantedBy = [ "multi-user.target" ];
        after = [ "network.target" "haystack-setup.service" ];
        requires = [ "haystack-setup.service" ];
        serviceConfig = {
          ExecStart = "${cfg.package}/bin/haystack-server serve ${serverConfig}";
          User = "haystack";
          DynamicUser = true;
          Restart = "on-failure";
          TimeoutStopSec = 60;
          UMask = "0077";
          NoNewPrivileges = true;
          ProtectSystem = "strict";
          ProtectHome = true;
          PrivateTmp = true;
          CapabilityBoundingSet = "";
          LoadCredential = credentials;
        };
      };

      systemd.services.haystack-backup = lib.mkIf cfg.backup.enable {
        description = "Haystack database backup (pg_dump, retention)";
        path = [ pkgs.postgresql_18 ];
        script = ''
          set -euo pipefail
          mkdir -p ${lib.escapeShellArg cfg.backup.directory}
          out=${lib.escapeShellArg cfg.backup.directory}/haystack-$(date -u +%Y%m%dT%H%M%SZ).dump
          export PGPASSWORD="$(<"$CREDENTIALS_DIRECTORY/database-password")" PGCONNECT_TIMEOUT=5
          pg_dump --no-password -d ${lib.escapeShellArg (lib.removePrefix "jdbc:" cfg.database.jdbcUrl)} -U ${lib.escapeShellArg cfg.database.user} -Fc -f "$out"
          chmod 600 "$out"
          find ${lib.escapeShellArg cfg.backup.directory} -name 'haystack-*.dump' -mtime +${toString cfg.backup.retentionDays} -delete
        '';
        serviceConfig = {
          Type = "oneshot";
          User = "haystack";
          DynamicUser = true;
          LoadCredential = [ "database-password:${cfg.database.passwordFile}" ];
          UMask = "0077";
          StateDirectory = "haystack-backups";
        };
        startAt = cfg.backup.schedule;
      };

      services.nginx = lib.mkIf (cfg.publicUrl != null && cfg.proxy.enable) {
        enable = true;
        recommendedProxySettings = true;
        virtualHosts.${cfg.publicUrlHost} = {
          forceSSL = cfg.proxy.acmeHost != null;
          useACMEHost = cfg.proxy.acmeHost;
          root = "${cfg.package}/share/haystack/web";
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
            return 503 '${proxyFailure}';
          '';
        };
      };
      networking.firewall.allowedTCPPorts = lib.mkIf (cfg.publicUrl != null && cfg.proxy.openFirewall) (
        [ 80 ] ++ lib.optional (cfg.proxy.acmeHost != null) 443
      );
    })
  ];
}
