# Full JVM domain/PG/FS leg. BackendFixture's administrator is ONLY the disposable
# fixture provider; no deployment service role gains CREATEDB or DB-wide CREATE.
{ pkgs, squishLib }:
let
  sources=pkgs.callPackage ../pkg/chronicle/source.nix {};
  source=sources.manureTargetTests;
  environment=pkgs.callPackage ../pkg/chronicle/sbt-environment.nix {inherit squishLib;};
  bridge=pkgs.callPackage ../pkg/manure/posix.nix {};
  postgres=pkgs.postgresql_18.withPackages (p:[p.pgvector]);
in pkgs.runCommand "manure-complete-jvm-backend-filesystem" {
  nativeBuildInputs=[environment.tools.graal pkgs.python3 postgres pkgs.coreutils];
  LANG="C.UTF-8";LC_ALL="C.UTF-8";
  MANURE_POSIX_LIBRARY="${bridge.shared}/lib/libmanure_posix.so";
} ''
  set -euo pipefail
  umask 077
  cp -r ${source} source
  chmod -R u+w source
  cd source
  cmp manure/migration/schema.sql manure/backend/src/main/resources/manure-schema.sql
  mkdir "$out"
  find . -type f -print0 | sort -z | xargs -0 sha256sum > "$out/source.sha256"
  export JAVA_TOOL_OPTIONS="''${JAVA_TOOL_OPTIONS:-}" SBT_OPTS="''${SBT_OPTS:-}"
  ${environment.setup}
  export JAVA_TOOL_OPTIONS="''${JAVA_TOOL_OPTIONS:-} -Xmx4g -XX:ActiveProcessorCount=4"
  export MANURE_SOURCE_ROOT="$PWD"
  base=$(mktemp -d "$TMPDIR/manure-jvm-owned.XXXXXXXX")
  port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
  python3 - "$base/password" <<'PY'
  import os,secrets,sys
  fd=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'w') as f:f.write(secrets.token_urlsafe(48)+'\n')
  PY
  initdb -D "$base/data" -U postgres -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 > "$base/init.log"
  trap 'pg_ctl -D "$base/data" -m fast -w -t 30 stop >/dev/null 2>&1 || true' EXIT
  pg_ctl -D "$base/data" -l "$base/server.log" -o "-h 127.0.0.1 -p $port -k $base" -w -t 30 start >/dev/null
  export MANURE_TEST_JDBC_URL="jdbc:postgresql://127.0.0.1:$port/postgres"
  export MANURE_TEST_JDBC_USER=postgres MANURE_TEST_JDBC_PASSWORD_FILE="$base/password" MANURE_TEST_ALLOW_CREATEDB=1
  timeout --signal=TERM --kill-after=15s 600s bash scripts/backend-sbt.sh \
    'manureStorage/Test/validationInventory' 'manureStorage/testFull' \
    'manureServer/Test/validationInventory' 'manureServer/testFull' > "$out/run.log" 2>&1 || { cat "$out/run.log"; exit 1; }
  python3 ${./jvm-inventory-receipt.py} --module manure/server --module manure/backend --source ${source} --output "$out/receipt.json"
  for module in backend server; do
    mkdir "$out/$module"
    cp -r manure/$module/target/test-reports manure/$module/target/validation-inventory.txt "$out/$module/"
  done
  sha256sum "$MANURE_POSIX_LIBRARY" > "$out/jni.sha256"
''
