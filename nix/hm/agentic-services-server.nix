{ inputs }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.smind.hm.services.agentic;
  host = cfg.host;
  endpoints = {
    inherit (host) hostname address;
    inherit (cfg) ports urls;
  };
  privateHttp = host.scheme == "http";
  stores = cfg;
  # State is an explicit deployment binding: source/module renames must not
  # create a replacement tree or rotate existing operator credentials.
  state = cfg.stateDirectory;
  shellState = lib.escapeShellArg state;
  credentials = "${state}/credentials";
  shellCredentials = lib.escapeShellArg credentials;
  hasPublishToken = cfg.static.enable && cfg.static.publishTokenFile != null;
  crawl4ai = cfg.crawl4ai.package;
  pg = pkgs.postgresql_18;
  pgSocket = "${state}/postgres-socket";
  json = pkgs.formats.json { };
  haystackAuth = json.generate "agentic-services-haystack-auth.json" {
    inherit (cfg.haystack) activityProjectId;
    users =
      map
        (user: {
          id = user.id;
          type = user.type;
          tokens = [
            {
              id = "default";
              hashFile = "${credentials}/haystack-${user.id}.sha256";
            }
          ];
        })
        [
          {
            id = "agent";
            type = "agent";
          }
          {
            id = "operator";
            type = "human";
          }
        ];
    cookieSecure = !privateHttp;
    allowedHosts = [
      endpoints.hostname
    ]
    ++ cfg.haystack.legacyHosts
    ++ [
      "localhost"
      "127.0.0.1"
    ];
    allowedOrigins = [ endpoints.urls.haystack ] ++ cfg.haystack.legacyOrigins;
    insecureHttpOrigins =
      lib.optional privateHttp endpoints.urls.haystack ++ cfg.haystack.insecureHttpOrigins;
    rateLimit = {
      windowMs = 60000;
      max = 600;
    };
  };
  manureConfig = json.generate "agentic-services-manure.json" {
    listen_address = cfg.manure.listenAddress;
    port = cfg.manure.port;
    data_dir = "${state}/manure";
    api_origin = endpoints.urls.manure;
    allow_insecure_http = cfg.manure.allowInsecureHttp;
    allowed_api_origins = cfg.manure.legacyOrigins;
    # Path hosting shares the API origin; never use this for untrusted HTML.
    content_mode = "path";
    loopback_dev = false;
    trusted_proxies = [ "127.0.0.1/32" ];
    users =
      map
        (user: {
          id = user.id;
          type = user.type;
          tokens = [
            {
              id = "default";
              hashFile = "${credentials}/manure-${user.id}.sha256";
            }
          ];
        })
        [
          {
            id = "agent";
            type = "agent";
          }
          {
            id = "operator";
            type = "human";
          }
        ];
  };
  setup = pkgs.writeShellScript "agentic-services-setup" ''
    set -euo pipefail
    umask 077
    ${pkgs.coreutils}/bin/mkdir -p ${shellState}/{credentials,nginx,crawl4ai/{home,cache,outputs}}
    ${lib.optionalString cfg.static.enable "${pkgs.coreutils}/bin/mkdir -p ${lib.escapeShellArg cfg.static.root}"}
    ${lib.optionalString stores.haystack.enable ''
      ${pkgs.coreutils}/bin/mkdir -p ${shellState}/{postgres-socket,backups}
    ''}
    # nginx recreates its request-body/proxy temp dirs on start; drop any left
    # non-user-owned (e.g. by a root `nginx -t`, which chowns absolute *_temp_path
    # dirs to nginx's compiled-in user) so the user worker can write them.
    for d in ${shellState}/nginx/body ${shellState}/nginx/proxy; do
      if [ -e "$d" ] && [ ! -O "$d" ]; then ${pkgs.coreutils}/bin/rm -rf "$d"; fi
    done
    ${pkgs.python3}/bin/python3 ${./agentic-services-credentials.py} ${shellCredentials} \
      ${lib.optionalString stores.haystack.enable "--haystack-agent-file ${lib.escapeShellArg cfg.haystack.agentTokenFile}"} \
      ${lib.optionalString stores.manure.enable "--manure-agent-file ${lib.escapeShellArg cfg.manure.agentTokenFile}"}
    ${lib.optionalString hasPublishToken ''
      # Generate the nginx basic-auth file for static publishing from the runtime token.
      if [ -r ${lib.escapeShellArg cfg.static.publishTokenFile} ]; then
        hash="$(${pkgs.openssl}/bin/openssl passwd -apr1 -stdin <<<"$(<${lib.escapeShellArg cfg.static.publishTokenFile})")"
        ${pkgs.coreutils}/bin/printf 'publish:%s\n' "$hash" > ${shellCredentials}/static.htpasswd.tmp
        ${pkgs.coreutils}/bin/mv -f ${shellCredentials}/static.htpasswd.tmp ${shellCredentials}/static.htpasswd
      fi
    ''}
  '';
  redisStart = pkgs.writeShellScript "agentic-services-crawl4ai-redis" ''
    set -euo pipefail
    umask 077
    config_file=${shellState}/crawl4ai/redis.conf
    printf 'bind 127.0.0.1\nport ${toString cfg.crawl4ai.redisPort}\nprotected-mode yes\nsave ""\nappendonly no\nrequirepass %s\n' \
      "$(<${shellCredentials}/redis-password)" > "$config_file"
    exec ${pkgs.redis}/bin/redis-server "$config_file"
  '';
  crawlStart = pkgs.writeShellScript "agentic-services-crawl4ai" ''
    set -euo pipefail
    export REDIS_PASSWORD="$(<${shellCredentials}/redis-password)"
    export REDISCLI_AUTH="$REDIS_PASSWORD"
    ready=0
    for _ in {1..60}; do
      if ${pkgs.redis}/bin/redis-cli -h 127.0.0.1 -p ${toString cfg.crawl4ai.redisPort} ping | ${pkgs.gnugrep}/bin/grep -qx PONG; then ready=1; break; fi
      ${pkgs.coreutils}/bin/sleep 1
    done
    test "$ready" = 1
    export CRAWL4AI_API_TOKEN="$(<${lib.escapeShellArg cfg.crawl4ai.tokenFile})"
    test -n "$CRAWL4AI_API_TOKEN"
    export REDIS_HOST=127.0.0.1 REDIS_PORT=${toString cfg.crawl4ai.redisPort}
    export CRAWL4AI_ARTIFACT_DIR=${shellState}/crawl4ai/outputs
    export HOME=${shellState}/crawl4ai/home CRAWL4_AI_BASE_DIRECTORY=${shellState}/crawl4ai/home
    export XDG_CACHE_HOME=${shellState}/crawl4ai/cache
    export GUNICORN_BIND=${cfg.crawl4ai.listenAddress}:${toString cfg.crawl4ai.port}
    export CRAWL4AI_HOOKS_ENABLED=false CRAWL4AI_EXECUTE_JS_ENABLED=false
    exec ${crawl4ai}/bin/crawl4ai-server
  '';
  pgStart = pkgs.writeShellScript "agentic-services-postgres" ''
    set -euo pipefail
    umask 077
    if [ ! -e ${shellState}/postgres/PG_VERSION ]; then
      ${pg}/bin/initdb -D ${shellState}/postgres --auth-local=peer --auth-host=reject --encoding=UTF8 --locale=C.UTF-8
    fi
    test "$(<${shellState}/postgres/PG_VERSION)" = 18
    exec ${pg}/bin/postgres -D ${shellState}/postgres -k ${lib.escapeShellArg pgSocket} -c listen_addresses= -c unix_socket_permissions=0700
  '';
  pgSetup = pkgs.writeShellScript "agentic-services-haystack-database" ''
    set -euo pipefail
    ready=0
    for _ in {1..60}; do
      if ${pg}/bin/pg_isready -h ${lib.escapeShellArg pgSocket}; then ready=1; break; fi
      ${pkgs.coreutils}/bin/sleep 1
    done
    test "$ready" = 1
    if [ "$(${pg}/bin/psql -h ${lib.escapeShellArg pgSocket} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'haystack'")" != 1 ]; then
      ${pg}/bin/createdb -h ${lib.escapeShellArg pgSocket} haystack
    fi
  '';
  searxSettings = (pkgs.formats.yaml { }).generate "agentic-services-searx-settings.yml" (
    lib.recursiveUpdate ({ use_default_settings = true; } // cfg.searxng.settings) {
      server = {
        bind_address = cfg.searxng.listenAddress;
        port = cfg.searxng.port;
        secret_key = "__AGENTIC_SERVICES_SEARX_SECRET__";
        limiter = false;
        image_proxy = false;
      };
      general.instance_name = "Agentic services private search";
    }
  );
  searxPackage = cfg.searxng.package;
  searxPython = pkgs.python3.withPackages (ps: [
    searxPackage
    ps.gunicorn
  ]);
  searxStart = pkgs.writeShellScript "agentic-services-searxng" ''
    set -euo pipefail
    umask 077
    ${pkgs.coreutils}/bin/mkdir -p ${shellState}/searxng
    ${pkgs.gnused}/bin/sed "s/__AGENTIC_SERVICES_SEARX_SECRET__/$(<${shellCredentials}/searx-secret)/" ${searxSettings} > ${shellState}/searxng/settings.yml
    export SEARXNG_SETTINGS_PATH=${shellState}/searxng/settings.yml
    exec ${searxPython}/bin/gunicorn --bind ${cfg.searxng.listenAddress}:${toString cfg.searxng.port} --workers 2 --timeout 120 searx.webapp:app
  '';
  proxyHeaders = ''
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_buffering off;
    proxy_cache off;
  '';
  # Certificate provisioning and renewal belong to the caller.
  tls = ''
    ssl_certificate ${cfg.tls.certificateFile};
    ssl_certificate_key ${cfg.tls.keyFile};
    ssl_protocols TLSv1.2 TLSv1.3;
  '';
  server = name: body: ''
    server {
      listen ${endpoints.address}:${toString endpoints.ports.${name}}${
        lib.optionalString (!privateHttp) " ssl"
      };
      ${lib.optionalString host.loopbackAlias "listen 127.0.1.1:${toString endpoints.ports.${name}}${
        lib.optionalString (!privateHttp) " ssl"
      };"}
      server_name ${endpoints.hostname};
      ${lib.optionalString (!privateHttp) tls}
      if ($http_host !~* "^${lib.replaceStrings [ "." ] [ "\\." ] endpoints.hostname}(:${
        toString endpoints.ports.${name}
      })?$") { return 421; }
      ${body}
    }
  '';
  crawl4aiLocations = ''
    client_max_body_size 16m;
    location / { proxy_pass http://${cfg.crawl4ai.listenAddress}:${toString cfg.crawl4ai.port}; ${proxyHeaders} proxy_read_timeout 1800s; }
  '';
  haystackLocations = ''
    root ${cfg.haystack.package}/lib/node_modules/haystack/web/dist;
    location / { try_files $uri $uri/ =404; add_header Cache-Control no-cache; add_header Referrer-Policy no-referrer always; add_header X-Content-Type-Options nosniff always; }
    location /api/ { proxy_pass http://${cfg.haystack.listenAddress}:${toString cfg.haystack.port}; ${proxyHeaders} client_max_body_size 2m; proxy_intercept_errors on; error_page 502 504 =503 @unavailable; }
    location /mcp { proxy_pass http://${cfg.haystack.listenAddress}:${toString cfg.haystack.port}; ${proxyHeaders} proxy_read_timeout 300s; proxy_intercept_errors on; error_page 502 504 =503 @unavailable; }
    location @unavailable { default_type application/json; add_header Cache-Control no-store always; return 503 '{"error":{"code":"unavailable","message":"service unavailable"}}'; }
  '';
  manureLocations = ''
    # Suppress native request-line errors, which can contain capability URLs.
    error_log /dev/null;
    client_max_body_size 4m;
    client_header_buffer_size 4k;
    large_client_header_buffers 4 8k;
    location / { proxy_pass http://${cfg.manure.listenAddress}:${toString cfg.manure.port}; ${proxyHeaders} proxy_request_buffering off; proxy_read_timeout 30s; proxy_send_timeout 30s; }
  '';
  nginxConfig = pkgs.writeText "agentic-services-nginx.conf" ''
    pid ${state}/nginx/nginx.pid;
    error_log stderr warn;
    events { worker_connections 1024; }
    http {
      include ${pkgs.nginx}/conf/mime.types;
      access_log off;
      map $http_upgrade $connection_upgrade { default upgrade; "" close; }
      ${cfg.proxy.extraHttpConfig}
      client_body_temp_path ${state}/nginx/body;
      proxy_temp_path ${state}/nginx/proxy;
      ${server "searxng" "location / { proxy_pass http://${cfg.searxng.listenAddress}:${toString cfg.searxng.port}; ${proxyHeaders} }"}
      ${server "crawl4ai" crawl4aiLocations}
      ${lib.optionalString stores.haystack.enable (server "haystack" haystackLocations)}
      ${lib.optionalString stores.manure.enable (server "manure" manureLocations)}
      ${cfg.proxy.extraServerConfig}
      ${lib.optionalString cfg.static.enable (
        server "static" ''
          # Trusted-private-network static hosting. Reads (GET/HEAD) are open on the
          # private network; writes (PUT/DELETE/MKCOL) require the publish token via basic auth.
          # Before the token is provisioned the htpasswd file is absent and nginx fails
          # writes closed (403).
          root ${cfg.static.root};
          autoindex on;
          autoindex_format json;
          client_max_body_size ${cfg.static.maxBodySize};
          location / {
            dav_methods PUT DELETE MKCOL;
            create_full_put_path on;
            limit_except GET HEAD {
              auth_basic "${cfg.static.authRealm}";
              auth_basic_user_file ${credentials}/static.htpasswd;
            }
          }
          # Read-only JSON directory listing that ignores index.html, for publishing clients.
          location ${cfg.static.listingPath} {
            alias ${cfg.static.root}/;
            index ___none___;
            autoindex on;
            autoindex_format json;
          }
        ''
      )}
    }
  '';
  # Wants (not Requires): an external secret provisioner can re-run on each
  # home-manager switch. Requires would stop-propagate that restart to the whole
  # stack and leave it down, since nothing re-pulls the units afterwards.
  unit = description: dependencies: start: {
    Unit = {
      Description = description;
      After = dependencies;
      Wants = dependencies;
    };
    Service = {
      ExecStart = start;
      Restart = "on-failure";
      RestartSec = 5;
      UMask = "0077";
      NoNewPrivileges = true;
    };
    Install.WantedBy = [ "default.target" ];
  };
  setupDeps = [ "${cfg.unitPrefix}-services-setup.service" ];
in
{
  imports = [ (import ./agentic-services-server-options.nix { inherit inputs; }) ];
  config = lib.mkIf cfg.enable {
    assertions = import ./agentic-services-server-assertions.nix { inherit cfg lib pkgs; };
    # Retain the actual renderer records for no-build configuration checks.
    lib.ponygirls.agenticServices = {
      proxyConfig = nginxConfig;
      inherit manureConfig haystackAuth searxSettings;
    };
    fonts.fontconfig.enable = true;
    home.packages = [ pkgs.dejavu_fonts ];
    # Stable deployed unit IDs: external root helpers reload the proxy by name.
    # Changing logical module/options names must not rename these runtime units.
    systemd.user.services = {
      "${cfg.unitPrefix}-services-setup" = {
        Unit = {
          Description = "Provision private agentic services state and credentials";
          After = cfg.setupDependencies;
          Wants = cfg.setupDependencies;
        };
        Service = {
          Type = "oneshot";
          ExecStart = setup;
          RemainAfterExit = true;
          UMask = "0077";
        };
        Install.WantedBy = [ "default.target" ];
      };
      "${cfg.unitPrefix}-searxng" = unit "Agentic services private SearXNG" setupDeps searxStart;
      "${cfg.unitPrefix}-crawl4ai-redis" =
        unit "Agentic services private crawler Redis" setupDeps
          redisStart;
      "${cfg.unitPrefix}-crawl4ai" = unit "Agentic services private Crawl4AI" (
        setupDeps ++ cfg.setupDependencies ++ [ "${cfg.unitPrefix}-crawl4ai-redis.service" ]
      ) crawlStart;
      "${cfg.unitPrefix}-services-proxy" =
        let
          base =
            unit "Private agentic service proxy" setupDeps
              "${pkgs.nginx}/bin/nginx -e stderr -p ${state}/nginx/ -c ${nginxConfig} -g 'daemon off;'";
        in
        base
        // {
          Service = base.Service // {
            ExecReload = "${pkgs.nginx}/bin/nginx -e stderr -p ${state}/nginx/ -c ${nginxConfig} -s reload";
          };
        };
    }
    // lib.optionalAttrs stores.haystack.enable {
      "${cfg.unitPrefix}-postgres" =
        (unit "Agentic services private PostgreSQL 18" setupDeps pgStart)
        // {
          Service = {
            ExecStart = pgStart;
            Restart = "on-failure";
            RestartSec = 5;
            UMask = "0077";
            NoNewPrivileges = true;
            KillSignal = "SIGINT";
            TimeoutStopSec = 120;
          };
        };
      "${cfg.unitPrefix}-haystack-database" = {
        Unit = {
          Description = "Ensure private Haystack database";
          After = [ "${cfg.unitPrefix}-postgres.service" ];
          Requires = [ "${cfg.unitPrefix}-postgres.service" ];
        };
        Service = {
          Type = "oneshot";
          ExecStart = pgSetup;
          RemainAfterExit = true;
        };
      };
      "${cfg.unitPrefix}-haystack" =
        (unit "Agentic services private Haystack" [
          "${cfg.unitPrefix}-haystack-database.service"
        ] "${cfg.haystack.package}/bin/haystack-server")
        // {
          Service = {
            ExecStart = "${cfg.haystack.package}/bin/haystack-server";
            Restart = "on-failure";
            RestartSec = 5;
            UMask = "0077";
            NoNewPrivileges = true;
            Environment = [
              "HAYSTACK_AUTH_JSON=${haystackAuth}"
              "HAYSTACK_DATABASE_URL=postgresql://${config.home.username}@/haystack?host=${pgSocket}"
              "HAYSTACK_LISTEN=${cfg.haystack.listenAddress}"
              "HAYSTACK_PORT=${toString cfg.haystack.port}"
              "HAYSTACK_POOL_MAX=8"
            ];
          };
        };
      "${cfg.unitPrefix}-haystack-backup" = {
        Unit = {
          Description = "Back up private Haystack";
          After = [ "${cfg.unitPrefix}-haystack-database.service" ];
          Requires = [ "${cfg.unitPrefix}-haystack-database.service" ];
        };
        Service = {
          Type = "oneshot";
          UMask = "0077";
          ExecStart = pkgs.writeShellScript "agentic-services-haystack-backup" ''
            set -euo pipefail
            file=${shellState}/backups/haystack-$(${pkgs.coreutils}/bin/date -u +%Y%m%dT%H%M%SZ).dump
            ${pg}/bin/pg_dump -h ${lib.escapeShellArg pgSocket} -Fc haystack > "$file.partial"
            ${pkgs.coreutils}/bin/mv "$file.partial" "$file"
            ${pkgs.findutils}/bin/find ${shellState}/backups -name 'haystack-*.dump' -mtime +14 -delete
          '';
        };
      };
    }
    // lib.optionalAttrs stores.manure.enable {
      "${cfg.unitPrefix}-manure" =
        unit "Agentic services private Manure (low-security path hosting)" setupDeps
          "${cfg.manure.package}/bin/manure-server --config ${manureConfig}";
    };
    systemd.user.timers = lib.optionalAttrs stores.haystack.enable {
      "${cfg.unitPrefix}-haystack-backup" = {
        Unit.Description = "Daily private Haystack backup";
        Timer = {
          OnCalendar = "daily";
          Persistent = true;
        };
        Install.WantedBy = [ "timers.target" ];
      };
    };
  };
}
