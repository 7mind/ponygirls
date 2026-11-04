# OCI image contract checks (Behavioral/Active, Effectual, Atomic): stub
# service binaries, so no service closure, daemon or network is involved.
# Real container startup is a deployment-level check and is not claimed here.
{ pkgs, oci }:
let
  stub = pkgs.runCommand "oci-stub-service" { } ''
    mkdir -p "$out/bin" "$out/libexec"
    for name in haystack-server manure-server crawl4ai-server postgres initdb redis-server; do
      cp ${./oci-stub-server.sh} "$out/bin/$name"
      chmod +x "$out/bin/$name"
    done
    cp ${./oci-stub-server.sh} "$out/libexec/chronicle-server"
    chmod +x "$out/libexec/chronicle-server"
  '';

  images = {
    haystack = oci.haystack { package = stub; };
    manure = oci.manure { package = stub; };
    # Mirrors a first deployment wrapping an exact native artifact: the
    # executable and web assets live outside the package's bin/.
    chronicle = oci.chronicle { package = stub; executable = "/libexec/chronicle-server"; };
    crawl4ai = oci.crawl4ai { package = stub; browsers = stub; };
    postgres = oci.postgres { package = stub; };
    redis = oci.redis { package = stub; };
  };

  expectations = pkgs.writeText "oci-image-expectations.json" (builtins.toJSON {
    haystack = {
      image = "${images.haystack}";
      user = "10001:10001";
      workingDir = "/data";
      entrypoint = [ "/bin/haystack-server" ];
      cmd = [ "serve" "/config/server.json" ];
      env = { };
      uid = 10001;
      gid = 10001;
      userName = "app";
      subdirs = [ ];
    };
    manure = {
      image = "${images.manure}";
      user = "10001:10001";
      workingDir = "/data";
      entrypoint = [ "/bin/manure-server" ];
      cmd = [ "serve" "/config/server.json" ];
      env = { };
      uid = 10001;
      gid = 10001;
      userName = "app";
      subdirs = [ ];
    };
    chronicle = {
      image = "${images.chronicle}";
      user = "10001:10001";
      workingDir = "/data";
      entrypoint = [ "/libexec/chronicle-server" ];
      cmd = [ "serve" "/config/server.json" ];
      env = { CHRONICLE_WEB_ROOT = "/share/chronicle/web"; };
      uid = 10001;
      gid = 10001;
      userName = "app";
      subdirs = [ ];
    };
    crawl4ai = {
      image = "${images.crawl4ai}";
      user = "10001:10001";
      workingDir = "/data";
      entrypoint = [ "/bin/crawl4ai-server" ];
      cmd = [ ];
      env = {
        CRAWL4AI_ARTIFACT_DIR = "/data/outputs";
        GUNICORN_BIND = "0.0.0.0:11235";
        HOME = "/tmp";
      };
      uid = 10001;
      gid = 10001;
      userName = "app";
      subdirs = [ "outputs" ];
    };
    postgres = {
      image = "${images.postgres}";
      user = "10001:10001";
      workingDir = "/data";
      entrypoint = [ "/bin/sh" ];
      cmd = [ "/config/postgres.sh" ];
      env = { PGDATA = "/data/pgdata"; };
      uid = 10001;
      gid = 10001;
      userName = "postgres";
      subdirs = [ "pgdata" ];
    };
    redis = {
      image = "${images.redis}";
      user = "10001:10001";
      workingDir = "/data";
      entrypoint = [ "/bin/redis-entrypoint" ];
      cmd = [ ];
      env = { REDIS_PASSWORD_FILE = "/etc/redis/password"; };
      uid = 10001;
      gid = 10001;
      userName = "app";
      subdirs = [ "redis" ];
    };
  });
in
pkgs.runCommand "oci-images-test" {
  nativeBuildInputs = [ pkgs.coreutils pkgs.gnugrep pkgs.python3 ];
} ''
  mkdir "$out"
  python3 ${./oci-image-layout.py} ${expectations} | tee "$out/layout.txt"
  grep -qx '6 image layouts ok' "$out/layout.txt"

  # Redis entrypoint: the password never appears in argv (process-list
  # exposure); it reaches the server through a private config file.
  export PATH=${stub}/bin:$PATH
  export STUB_LOG="$out/redis-invocations.txt"
  : > "$STUB_LOG"
  printf 's3cret\n' > "$TMPDIR/redis-password"
  REDIS_PASSWORD_FILE="$TMPDIR/redis-password" REDIS_DATA_DIR="$TMPDIR/redis-data" \
    REDIS_CONFIG_PATH="$TMPDIR/redis-run/redis.conf" \
    ${images.redis.passthru.entrypointScript}/bin/redis-entrypoint --maxmemory 128mb
  grep -Fx "redis-server $TMPDIR/redis-run/redis.conf --maxmemory 128mb" "$STUB_LOG"
  if grep -q 's3cret' "$STUB_LOG"; then
    echo "redis-entrypoint exposed the password in argv" >&2
    exit 1
  fi
  test "$(stat -c %a "$TMPDIR/redis-run/redis.conf")" = 600
  test "$(stat -c %a "$TMPDIR/redis-run")" = 700
  grep -Fx 'requirepass s3cret' "$TMPDIR/redis-run/redis.conf"
  grep -Fx "dir $TMPDIR/redis-data" "$TMPDIR/redis-run/redis.conf"
  test -d "$TMPDIR/redis-data"

  : > "$STUB_LOG"
  if REDIS_PASSWORD_FILE="$TMPDIR/absent-password" REDIS_DATA_DIR="$TMPDIR/redis-data" \
      REDIS_CONFIG_PATH="$TMPDIR/redis-run-2/redis.conf" \
      ${images.redis.passthru.entrypointScript}/bin/redis-entrypoint; then
    echo "redis-entrypoint accepted a missing password file" >&2
    exit 1
  fi
  test ! -s "$STUB_LOG"
''
