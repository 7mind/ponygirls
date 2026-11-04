# OCI image specs for the ponygirls service executables.
#
# Every spec is a function of an already-selectable artifact, so a deployment
# can wrap this flake's packages or, for a first deployment, exact store paths
# that were built earlier:
#
#   (self.lib.oci { inherit pkgs; }).chronicle {
#     package = "/nix/store/<hash>-chronicle-native-development-artifact-0.1.0";
#     webPackage = "/nix/store/<hash>-chronicle-web-0.1.0";
#     executable = "/libexec/chronicle-server";
#   }
#
# Runtime contract: uid/gid 10001, PATH=/bin, /bin/sh (busybox), writable /tmp,
# owned /data (working directory). The native servers take the config path as
# an argument and default to `serve /config/server.json`; each also accepts
# `migrate <config>` as a command override.
#
# Mounted-config contracts (images supply packaged web assets only, the
# deployment supplies everything else):
#   haystack  server JSON with webRoot "/share/haystack/web"
#   manure    server JSON with dashboard_dir "/share/manure/web/dashboard" and
#             unlock_shell_dir "/share/manure/web/unlock"
#   chronicle server JSON; CHRONICLE_WEB_ROOT is baked in as the in-image
#             /share/chronicle/web (webPackage supplies those assets)
#   crawl4ai  no config file; CRAWL4AI_API_TOKEN and REDIS_PASSWORD come from
#             the deployment's Secret
#   postgres  /bin/sh + /config/postgres.sh supplied by the deployment; PGDATA
#             under /data; postgresql_18 with pgvector is on PATH
#   redis     REDIS_PASSWORD_FILE; data under /data/redis
{ lib, pkgs }:
let
  mkServiceImage = pkgs.callPackage ./image.nix { };
in
{
  inherit mkServiceImage;

  haystack = { package, tag ? "latest" }: mkServiceImage {
    inherit tag;
    name = "ponygirls/haystack";
    contents = [ package ];
    entrypoint = [ "/bin/haystack-server" ];
    cmd = [ "serve" "/config/server.json" ];
    meta.description = "Haystack structured-memory server image (nonroot, no embedded config)";
  };

  manure = { package, tag ? "latest" }: mkServiceImage {
    inherit tag;
    name = "ponygirls/manure";
    contents = [ package ];
    entrypoint = [ "/bin/manure-server" ];
    cmd = [ "serve" "/config/server.json" ];
    meta.description = "Manure file/directory hosting server image (nonroot, no embedded config)";
  };

  # The default `package` (mkChroniclePackage) is a wrapper whose
  # bin/chronicle-server sets CHRONICLE_WEB_ROOT to its own store path; the
  # image overrides it with the merged in-image /share/chronicle/web. A bare
  # native artifact has no wrapper and no web assets, so pass `executable`
  # (its in-image path, e.g. "/libexec/chronicle-server") and `webPackage`
  # (the top-level chronicle-web store path) explicitly.
  chronicle = {
    package,
    webPackage ? null,
    executable ? "/bin/chronicle-server",
    tag ? "latest",
  }: mkServiceImage {
    inherit tag;
    name = "ponygirls/chronicle";
    contents = [ package ] ++ lib.optional (webPackage != null) webPackage;
    entrypoint = [ executable ];
    cmd = [ "serve" "/config/server.json" ];
    env.CHRONICLE_WEB_ROOT = "/share/chronicle/web";
    meta.description = "Chronicle archive server image (nonroot, no embedded config)";
  };

  crawl4ai = {
    package,
    browsers,
    fontsConf ? pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; },
    bind ? "0.0.0.0:11235",
    tag ? "latest",
  }: mkServiceImage {
    inherit tag;
    name = "ponygirls/crawl4ai";
    contents = [ package browsers ];
    entrypoint = [ "/bin/crawl4ai-server" ];
    workingSubdirs = [ "outputs" ];
    env = {
      CRAWL4AI_ARTIFACT_DIR = "/data/outputs";
      CRAWL4_AI_BASE_DIRECTORY = "/tmp";
      FONTCONFIG_FILE = fontsConf;
      GUNICORN_BIND = bind;
      HOME = "/tmp";
      PLAYWRIGHT_BROWSERS_PATH = browsers;
      PYTHONDONTWRITEBYTECODE = "1";
      PYTHONUNBUFFERED = "1";
      XDG_CACHE_HOME = "/tmp/cache";
    };
    meta.description = "Crawl4AI API/MCP server image with pinned Playwright Chromium (nonroot)";
  };

  postgres = {
    # Same package shape as smind.services.servicePostgres: postgresql_18
    # with the pgvector extension available for CREATE EXTENSION.
    package ? pkgs.postgresql_18.withPackages (p: [ p.pgvector ]),
    tag ? "latest",
  }: mkServiceImage {
    inherit tag;
    name = "ponygirls/postgres";
    userName = "postgres";
    contents = [ package ];
    # The deployment supplies /config/postgres.sh; pg binaries and busybox
    # tools resolve from PATH=/bin.
    entrypoint = [ "/bin/sh" ];
    cmd = [ "/config/postgres.sh" ];
    workingSubdirs = [ "pgdata" ];
    env.PGDATA = "/data/pgdata";
    meta.description = "PostgreSQL 18 with pgvector image (nonroot, entrypoint is the deployment script)";
  };

  redis = {
    package ? pkgs.redis,
    port ? 6379,
    tag ? "latest",
  }:
    let
      entrypointScript = pkgs.writeShellScriptBin "redis-entrypoint" ''
      set -euo pipefail
      password_file="''${REDIS_PASSWORD_FILE:-/etc/redis/password}"
      if [ ! -s "$password_file" ]; then
        printf 'redis-entrypoint: %s is missing or empty\n' "$password_file" >&2
        exit 1
      fi
      password="$(tr -d ' \r\n' < "$password_file")"
      if [ -z "$password" ]; then
        printf 'redis-entrypoint: %s holds an empty password\n' "$password_file" >&2
        exit 1
      fi
      data_dir="''${REDIS_DATA_DIR:-/data/redis}"
      mkdir -p "$data_dir"
      exec redis-server \
        --bind "''${REDIS_BIND_IP:-0.0.0.0}" \
        --port "${toString port}" \
        --protected-mode yes \
        --requirepass "$password" \
        --dir "$data_dir" \
        --save "" \
        --appendonly no \
        --daemonize no \
        "$@"
      '';
    in
    mkServiceImage {
      inherit tag;
      name = "ponygirls/redis";
      contents = [ package entrypointScript ];
      entrypoint = [ "/bin/redis-entrypoint" ];
      workingSubdirs = [ "redis" ];
      env.REDIS_PASSWORD_FILE = "/etc/redis/password";
      passthru.entrypointScript = entrypointScript;
      meta.description = "Redis image with a password file and /data/redis persistence (nonroot)";
    };
}
