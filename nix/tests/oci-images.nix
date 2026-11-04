# OCI image contract checks.
#
# Classification: Behavioral + Active / Effectual (reads the built image
# tarball: docker config, layer modes and ownership, /bin/sh and entrypoint
# presence) / Atomic (stub service binaries, so no service closure, no docker
# daemon and no network are involved).
#
# Not covered here: starting the real service processes inside a container.
# That is a deployment-level check performed in the cluster, so this test only
# asserts the packaging contract the deployment relies on.
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

  stubImage = { package ? stub }: package;

  images = {
    haystack = oci.haystack { package = stub; };
    manure = oci.manure { package = stub; };
    # Mirrors a first deployment wrapping an exact native artifact: the
    # executable and web assets live outside the package's bin/.
    chronicle = oci.chronicle { package = stub; executable = "/libexec/chronicle-server"; };
    crawl4ai = oci.crawl4ai { package = stub; browsers = stubImage { }; };
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
  nativeBuildInputs = [ pkgs.gnugrep pkgs.python3 ];
} ''
  mkdir "$out"
  python3 ${./oci-image-layout.py} ${expectations} | tee "$out/layout.txt"
  grep -qx '6 image layouts ok' "$out/layout.txt"

  # Redis entrypoint contract: password read from the file, fails closed
  # without one, and execs the server with the persisted data directory.
  export PATH=${stub}/bin:$PATH
  export STUB_LOG="$out/redis-invocations.txt"
  : > "$STUB_LOG"
  printf 's3cret\n' > "$TMPDIR/redis-password"
  REDIS_PASSWORD_FILE="$TMPDIR/redis-password" REDIS_DATA_DIR="$TMPDIR/redis-data" \
    ${images.redis.passthru.entrypointScript}/bin/redis-entrypoint --maxmemory 128mb
  grep -Fx "redis-server --bind 0.0.0.0 --port 6379 --protected-mode yes --requirepass s3cret --dir $TMPDIR/redis-data --save  --appendonly no --daemonize no --maxmemory 128mb" "$STUB_LOG"
  test -d "$TMPDIR/redis-data"

  : > "$STUB_LOG"
  if REDIS_PASSWORD_FILE="$TMPDIR/absent-password" REDIS_DATA_DIR="$TMPDIR/redis-data" \
      ${images.redis.passthru.entrypointScript}/bin/redis-entrypoint; then
    echo "redis-entrypoint accepted a missing password file" >&2
    exit 1
  fi
  test ! -s "$STUB_LOG"
''
