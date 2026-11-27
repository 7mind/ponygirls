{ mkChroniclePackage }:
{ config, lib, pkgs, ... }:
let
  cfg = config.smind.services.chronicle;
  credentialDir = "/run/credentials/chronicle.service";
  staticTokenName = id: "static-token-${builtins.hashString "sha256" id}";
  maximumBodyBytes = 512 * 1024 * 1024;
  passwordName = id: "user-password-${builtins.hashString "sha256" id}";
  accounts = import ../lib/service-account-options.nix { inherit lib; };
  indexingPolicy = import ../lib/service-indexing-options.nix { inherit lib; };
  accountsKeyName = "accounts-key";
  endpointOptions = {
    endpoint = lib.mkOption { type = lib.types.str; description = "Full OpenAI-compatible operation URL: /v1/chat/completions for annotation, /v1/embeddings for embedding."; };
    model = lib.mkOption { type = lib.types.str; description = "Served model name."; };
    revision = lib.mkOption { type = lib.types.str; description = "Operator-pinned deployment/model revision; changes require explicit maintenance reindex."; };
    credentialFile = lib.mkOption { type = lib.types.str; description = "Runtime API credential file; an explicitly empty file means no Authorization header."; };
    timeoutSeconds = lib.mkOption { type = lib.types.ints.positive; default = 60; };
    maxResponseBytes = lib.mkOption { type = lib.types.ints.positive; default = 4194304; };
  };
  endpointJson = name: endpoint: {
    inherit (endpoint) endpoint model revision timeoutSeconds maxResponseBytes;
    credentialFile = "${credentialDir}/${name}-key";
  };
  serverSettings = {
    listenHost = cfg.listenAddress;
    listenPort = cfg.port;
    allowedOrigin = if cfg.publicUrl == null then "configuration-required" else cfg.publicUrl;
    secureCookies = !(cfg.loopbackDevelopment || (cfg.allowInsecureHttp && cfg.publicUrl != null && lib.hasPrefix "http://" cfg.publicUrl));
    inherit (cfg) allowInsecureHttp;
    jdbcUrl = cfg.database.jdbcUrl;
    databaseUser = cfg.database.user;
    databasePasswordFile = "${credentialDir}/database-password";
    databaseLimits = cfg.database.limits;
    users = lib.mapAttrsToList (id: user: {
      inherit id;
      inherit (user) login enabled;
      passwordHashFile = "${credentialDir}/${passwordName id}";
    } // accounts.renderAdmin cfg.accounts user) cfg.users;
    staticTokens = map (token: {
      inherit (token) id userId name scopes;
      tokenFile = "${credentialDir}/${staticTokenName token.id}";
    }) cfg.staticTokens;
    # Retain the capacity settings and write the switches only when nondefault (the claim order and its bulk lanes only
    # with the waiting order), so a default configuration renders as before.
    indexing = builtins.removeAttrs cfg.indexing (builtins.attrNames indexingPolicy.options
      ++ lib.optional (!cfg.indexing.annotationContinuations) "annotationContinuations"
      ++ lib.optional (!cfg.indexing.providerBackoff) "providerBackoff"
      ++ lib.optionals (cfg.indexing.claimOrder == "source-id") [ "claimOrder" "bulkLanes" ])
      // indexingPolicy.renderFlags cfg.indexing;
    inherit (cfg.limits) maxBodyBytes maxFiles maxFileBytes maxMessages sessionTtlSeconds;
    annotation = endpointJson "annotation" cfg.annotation // { inherit (cfg.annotation) requestPolicy; };
    embedding = endpointJson "embedding" cfg.embedding // {
      inherit (cfg.embedding) dimensions sendDimensions queryPrefix documentPrefix;
    };
  } // accounts.renderAccounts accounts.accountsJsonKeys.camel cfg.accounts "${credentialDir}/${accountsKeyName}";
  serverConfig = pkgs.writeText "chronicle-server.json" (builtins.toJSON serverSettings);
  migrationConfig = pkgs.writeText "chronicle-migrate.json" (builtins.replaceStrings [ credentialDir ] [ "/run/credentials/chronicle-migrate.service" ] (builtins.toJSON serverSettings));
  runtimeFiles = [ cfg.database.passwordFile cfg.annotation.credentialFile cfg.embedding.credentialFile ]
    ++ map (u: u.passwordHashFile) (builtins.attrValues cfg.users)
    ++ map (t: t.tokenFile) cfg.staticTokens;
  loginList = map (u: u.login) (builtins.attrValues cfg.users);
  host = if cfg.publicUrl == null then "configuration-required" else
    builtins.head (lib.splitString "/" (lib.removePrefix "https://" (lib.removePrefix "http://" cfg.publicUrl)));

in
{
  imports = [ ./chronicle-models.nix ./service-postgres.nix ];
  options.smind.services.chronicle = {
    enable = lib.mkEnableOption "Chronicle semi-structured agent session archive";
    package = lib.mkOption { type = lib.types.package; default = mkChroniclePackage { inherit pkgs; }; };
    listenAddress = lib.mkOption { type = lib.types.str; default = "127.0.0.1"; description = "Backend binds loopback; use the TLS reverse proxy for remote access."; };
    port = lib.mkOption { type = lib.types.port; default = 47330; };
    publicUrl = lib.mkOption { type = lib.types.nullOr lib.types.str; default = null; example = "https://chronicle.example.net"; description = "Exact browser Origin (no trailing slash or path)."; };
    allowInsecureHttp = lib.mkOption { type = lib.types.bool; default = false; description = "Allow plaintext HTTP and non-Secure cookies on a trusted private network. Credentials and archived data are exposed to network observers; prefer HTTPS. Does not open firewall ports or relax loopbackDevelopment rules."; };
    loopbackDevelopment = lib.mkOption { type = lib.types.bool; default = false; description = "Explicitly allow loopback HTTP and insecure cookies for local development only."; };
    users = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule {
        options = {
          login = lib.mkOption { type = lib.types.str; description = "Unique login; attribute name is the stable user ID."; };
          passwordHashFile = lib.mkOption { type = lib.types.str; description = "Runtime PBKDF2 password hash file produced by chronicle-server password-hash."; };
          enabled = lib.mkOption { type = lib.types.bool; default = true; };
          inherit (accounts.browserOptions) admin;
        };
      });
      default = { };
    };
    accounts = accounts.accountsOptions { serviceName = "Chronicle"; host = if cfg.publicUrl == null then null else builtins.head (lib.splitString ":" host); };
    staticTokens = lib.mkOption {
      default = [ ];
      description = "Immutable config-managed bearer mappings. Token values are loaded only from private runtime files; metadata is visible to the owner.";
      type = lib.types.listOf (lib.types.submodule {
        options = {
          id = lib.mkOption { type = lib.types.strMatching "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"; description = "Stable token UUID."; };
          userId = lib.mkOption { type = lib.types.str; description = "Existing configured owner ID."; };
          name = lib.mkOption { type = lib.types.str; };
          scopes = lib.mkOption { type = lib.types.listOf (lib.types.enum [ "Ingest" "Read" "Raw" "OperateJobs" ]); description = "OperateJobs (requires Read) lets the token list the owner's indexing jobs, retry one and run Retry failed through /api/jobs/v1; nothing else."; };
          tokenFile = lib.mkOption { type = lib.types.str; description = "Private runtime file containing a random strong bearer token, never a Nix store file."; };
        };
      });
    };
    indexing = {
      annotationSessions = lib.mkOption { type = lib.types.ints.between 1 8; default = 4; description = "Concurrent indexing sessions and maximum concurrent annotation-model requests (including MCP testing). Execution capacity does not change semantic profile identity."; };
      embeddingRequests = lib.mkOption { type = lib.types.ints.between 1 32; default = 8; description = "Shared concurrent embedding requests across indexing and search, independent of annotation-session admission."; };
      embeddingBatchSize = lib.mkOption { type = lib.types.ints.between 1 16; default = 16; description = "Maximum source pieces in each indexing embedding request."; };
      annotationContinuations = lib.mkOption { type = lib.types.bool; default = false; description = "Keep an annotation answer that stops at a fragment boundary and ask only the rest of its window (migration 031); off, such an answer is rejected and the whole window asked again. Read at start; not part of the profile identity."; };
      claimOrder = lib.mkOption { type = lib.types.enum [ "source-id" "waiting" ]; default = "source-id"; description = "Order in which indexing lanes claim jobs (read at start). source-id: owner, then source id, the large-job permit taken by whichever lane loops first. waiting: oldest waiting job first within its class (bulk retry-failed and rebuilds versus everything else); lane 0 owns the large-job permit and takes deferred large jobs first; needs annotationSessions >= 3."; };
      bulkLanes = lib.mkOption { type = lib.types.ints.positive; default = 1; description = "With claimOrder waiting: lanes that prefer bulk work (1..annotationSessions-2); the others after lane 0 prefer fresh work. A lane takes the other class when its own has no candidate."; };
      providerBackoff = lib.mkOption { type = lib.types.bool; default = false; description = "Back off after model-provider failures (read at start): a job answered HTTP 429/503/529 is held with its attempt refunded, one answered 500/502/504/408 or failing by deadline or transport is held with its attempt charged (1, 2, 4, 8, then 15 minutes; the tenth failure in a row without progress fails it), and the lane that ran it pauses 1, 2, 4, 8, then 15 minutes before its next claim. Off, every provider failure is recorded as before."; };
    } // indexingPolicy.options;
    annotation = lib.mkOption { type = lib.types.submodule { options = endpointOptions // {
      requestPolicy = lib.mkOption { type = lib.types.enum [ "strict-json-schema" "strict-json-schema-32k" "glm-max-reasoning" ]; description = "Strict structured-output policy. strict-json-schema-32k raises the output cap to 32768 without provider-specific overrides. glm-max-reasoning enables the GLM-specific template extension. Changes require an explicit owner rebuild."; };
    }; }; description = "Annotation model endpoint and explicit profile identity."; };
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
      limits = import ../lib/jdbc-limits-options.nix { inherit lib; lockTimeoutMs = 35000; idleTransactionTimeoutMs = 60000; socketTimeoutMs = 35000; };
      manageLocal = lib.mkOption { type = lib.types.bool; default = false; description = "Retired: must remain false. Configure the explicitly migrated shared servicePostgres provider separately."; };
      readinessUnit = lib.mkOption { type = lib.types.nullOr lib.types.str; default = null; };
      ssdTuning = lib.mkOption { type = lib.types.bool; default = false; description = "Retired: must remain false. Select measured cluster policy explicitly on ponygirls.servicePostgres; this consumer never owns cluster tuning."; };
      name = lib.mkOption { type = lib.types.str; default = "chronicle"; };
      user = lib.mkOption { type = lib.types.str; default = "chronicle"; };
      passwordFile = lib.mkOption { type = lib.types.str; description = "Runtime database password file; never embed a password in jdbcUrl."; };
      jdbcUrl = lib.mkOption { type = lib.types.str; default = ""; description = "External JDBC URL when manageLocal=false; provision the vector extension there."; };
    };
    limits = {
      maxBodyBytes = lib.mkOption { type = lib.types.ints.between 1 maximumBodyBytes; default = 8388608; description = "Bounded ingest body size (maximum 512MiB); collector progress always has its own 64KiB cap."; };
      maxFiles = lib.mkOption { type = lib.types.ints.positive; default = 16; };
      maxFileBytes = lib.mkOption { type = lib.types.ints.positive; default = 4194304; };
      maxMessages = lib.mkOption { type = lib.types.ints.positive; default = 10000; };
      sessionTtlSeconds = lib.mkOption { type = lib.types.ints.positive; default = 30 * 24 * 60 * 60; description = "Compatibility-only setting retained in generated configuration. Browser sessions have no idle or absolute timeout; logout, revocation and account disabling still invalidate sessions."; };
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
        { assertion = cfg.publicUrl != null && (lib.hasPrefix "https://" cfg.publicUrl || (cfg.allowInsecureHttp && lib.hasPrefix "http://" cfg.publicUrl) || (cfg.loopbackDevelopment && (lib.hasPrefix "http://127.0.0.1:" cfg.publicUrl || lib.hasPrefix "http://localhost:" cfg.publicUrl))); message = "Chronicle: HTTPS publicUrl is required unless allowInsecureHttp or loopbackDevelopment is explicit."; }
        { assertion = cfg.publicUrl == null || !(lib.hasSuffix "/" cfg.publicUrl); message = "Chronicle: publicUrl must be the exact Origin without trailing slash."; }
        { assertion = cfg.indexing.claimOrder != "waiting" || (cfg.indexing.annotationSessions >= 3 && cfg.indexing.bulkLanes <= cfg.indexing.annotationSessions - 2); message = "Chronicle: indexing.claimOrder \"waiting\" needs annotationSessions >= 3 and bulkLanes 1..annotationSessions-2."; }
        { assertion = !cfg.loopbackDevelopment || (cfg.publicUrl != null && (lib.hasPrefix "http://127.0.0.1:" cfg.publicUrl || lib.hasPrefix "http://localhost:" cfg.publicUrl)); message = "Chronicle: loopbackDevelopment is only valid with a loopback HTTP Origin."; }
        { assertion = lib.any (u: u.enabled) (builtins.attrValues cfg.users); message = "Chronicle: configure at least one enabled static user."; }
        { assertion = builtins.length (map (t: lib.toLower t.id) cfg.staticTokens) == builtins.length (lib.unique (map (t: lib.toLower t.id) cfg.staticTokens)); message = "Chronicle: static token IDs must be distinct."; }
        { assertion = lib.all (t: builtins.hasAttr t.userId cfg.users && t.name != "" && builtins.stringLength t.name <= 128 && t.scopes != [ ] && builtins.length t.scopes == builtins.length (lib.unique t.scopes) && (!(builtins.elem "Raw" t.scopes) || builtins.elem "Read" t.scopes) && (!(builtins.elem "OperateJobs" t.scopes) || builtins.elem "Read" t.scopes)) cfg.staticTokens; message = "Chronicle: static tokens require configured owners, bounded names and nonempty distinct valid scopes (Raw and OperateJobs require Read)."; }
        { assertion = builtins.length loginList == builtins.length (lib.unique loginList); message = "Chronicle: logins must be unique."; }
        { assertion = lib.all (p: lib.hasPrefix "/" p && !(lib.hasPrefix builtins.storeDir p)) runtimeFiles; message = "Chronicle: all credential files must be runtime paths outside the Nix store."; }
        { assertion = !cfg.database.ssdTuning; message = "Chronicle: database.ssdTuning has been retired; configure measured ponygirls.servicePostgres.randomPageCost, effectiveIoConcurrency and maintenanceIoConcurrency explicitly. Chronicle no longer owns cluster tuning."; }
        { assertion = !cfg.database.manageLocal; message = "Chronicle: implicit manageLocal has been retired. Migrate logically into the explicit shared servicePostgres provider and supply its connection fields/readinessUnit."; }
        { assertion = cfg.database.manageLocal || cfg.database.jdbcUrl != ""; message = "Chronicle: external database requires jdbcUrl and a preinstalled vector extension."; }
      ] ++ accounts.accountsAssertions {
        context = "Chronicle";
        settings = cfg.accounts;
        users = cfg.users;
        keyFile = cfg.accounts.keyFile;
        origin = cfg.publicUrl;
      };
      users.groups.chronicle = { };
      users.users.chronicle = { isSystemUser = true; group = "chronicle"; };
      systemd.services.chronicle-migrate = {
        description = "Chronicle database-scoped migrations without HTTP/models";
        wantedBy = [ "multi-user.target" ];
        after = lib.optional (cfg.database.readinessUnit != null) cfg.database.readinessUnit;
        requires = lib.optional (cfg.database.readinessUnit != null) cfg.database.readinessUnit;
        serviceConfig = {
          Type = "oneshot"; User = "chronicle"; Group = "chronicle"; RemainAfterExit = true;
          ExecStart = "${cfg.package}/bin/chronicle-server migrate ${migrationConfig}";
          LoadCredential = config.systemd.services.chronicle.serviceConfig.LoadCredential;
          UMask = "0077"; TimeoutStartSec = 180;
        };
      };
      systemd.services.chronicle = {
        description = "Chronicle agent session archive and search";
        wantedBy = [ "multi-user.target" ];
        after = [ "network-online.target" "chronicle-migrate.service" ];
        requires = [ "chronicle-migrate.service" ];
        serviceConfig = {
          User = "chronicle";
          Group = "chronicle";
          ExecStart = "${cfg.package}/bin/chronicle-server serve ${serverConfig}";
          LoadCredential = [
            "database-password:${cfg.database.passwordFile}"
            "annotation-key:${cfg.annotation.credentialFile}"
            "embedding-key:${cfg.embedding.credentialFile}"
          ] ++ lib.mapAttrsToList (id: u: "${passwordName id}:${u.passwordHashFile}") cfg.users
            ++ map (t: "${staticTokenName t.id}:${t.tokenFile}") cfg.staticTokens
            ++ lib.optional cfg.accounts.enable "${accountsKeyName}:${cfg.accounts.keyFile}";
          # IOApp TERM runs shutdown hooks, then the native runtime exits 128 + SIGTERM.
          SuccessExitStatus = [ 143 ];
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
    (lib.mkIf cfg.proxy.enable {
      services.nginx.enable = true;
      services.nginx.virtualHosts.${host} = {
        forceSSL = cfg.proxy.acmeHost != null;
        useACMEHost = cfg.proxy.acmeHost;
        locations."/" = {
          proxyPass = "http://${if cfg.listenAddress == "::1" then "[::1]" else cfg.listenAddress}:${toString cfg.port}";
          proxyWebsockets = true;
          extraConfig = ''
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_buffering off;
            proxy_read_timeout 90s;
            client_max_body_size ${toString cfg.limits.maxBodyBytes};
          '';
        };
      };
    })
  ]);
}
