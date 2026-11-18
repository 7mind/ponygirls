# Full JVM domain/PG/FS leg. BackendFixture's administrator is ONLY the disposable
# fixture provider; no deployment service role gains CREATEDB or DB-wide CREATE.
{ pkgs, squishLib }:
let
  sources=pkgs.callPackage ../pkg/chronicle/source.nix {};
  source=sources.manureJvmTests;
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
  # Suites run in groups: one forked test JVM and one owned PostgreSQL cluster per group, one group per
  # NIX_BUILD_CORES core (at most 16). Measured under load 150-190 (sbt start and compile aside): serial tests
  # 163 s; grouped, the slowest suite (HttpSuite, ~30 s) plus the CheckConfigSuite group, which runs alone after
  # the others (~20 s). Deadline: 2.5x (sbt start and compile 80 s + max(slowest suite 30 s, 165 s serial work /
  # groups) + that tail 20 s); the serial case (1 core) gets ~660 s.
  cores=''${NIX_BUILD_CORES:-0}; (( cores > 0 )) || cores=$(nproc)
  groups=$(( cores < 16 ? cores : 16 ))
  tests=$(( 165 / groups )); (( tests > 30 )) || tests=30
  deadline=$(( (80 + tests + 20) * 5 / 2 ))
  base=$(mktemp -d "$TMPDIR/manure-jvm-owned.XXXXXXXX")
  read -r -a ports <<<"$(python3 -c 'import socket,sys
  s=[socket.socket() for _ in range(int(sys.argv[1]))]
  for x in s: x.bind(("127.0.0.1",0))
  print(" ".join(str(x.getsockname()[1]) for x in s))' "$groups")"
  python3 - "$base/password" <<'PY'
  import os,secrets,sys
  fd=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'w') as f:f.write(secrets.token_urlsafe(48)+'\n')
  PY
  starts=()
  stop_clusters() {
    for start in "''${starts[@]}"; do wait "$start" 2>/dev/null || true; done
    for data in "$base"/data*; do pg_ctl -D "$data" -m immediate -w -t 30 stop >/dev/null 2>&1 || true; done
  }
  trap stop_clusters EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  # One initdb, copied per group. The clusters are discarded with the sandbox, so they skip crash durability;
  # scram_iterations=1 keeps the verifiers of the per-case runtime roles cheap.
  fixture_settings='-c fsync=off -c synchronous_commit=off -c full_page_writes=off -c scram_iterations=1'
  initdb -D "$base/data" -U postgres -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 > "$base/init.log"
  urls=()
  for (( i = 0; i < groups; i++ )); do
    (
      cp -a "$base/data" "$base/data$i"
      pg_ctl -D "$base/data$i" -l "$base/server$i.log" -o "-h 127.0.0.1 -p ''${ports[i]} -k $base $fixture_settings" -w -t 30 start >/dev/null
    ) &
    starts+=($!)
    urls+=("jdbc:postgresql://127.0.0.1:''${ports[i]}/postgres")
  done
  startup_failed=0
  for start in "''${starts[@]}"; do wait "$start" || startup_failed=1; done
  if (( startup_failed )); then echo 'PostgreSQL cluster startup failed' >&2; exit 1; fi
  # Every group JVM receives its own MANURE_TEST_JDBC_URL from the sbt grouping.
  export MANURE_TEST_GROUP_JDBC="''${urls[*]}"
  export MANURE_TEST_JDBC_USER=postgres MANURE_TEST_JDBC_PASSWORD_FILE="$base/password" MANURE_TEST_ALLOW_CREATEDB=1
  echo "MANURE JVM SUITES: $groups test groups, one PostgreSQL cluster each, deadline $deadline s."
  timeout --signal=TERM --kill-after=15s "$deadline" bash scripts/backend-sbt.sh \
    'manureStorage/Test/validationInventory' 'manureStorage/testFull' \
    'manureServer/Test/validationInventory' 'manureServer/testFull' > "$out/run.log" 2>&1 || { cat "$out/run.log"; exit 1; }
  python3 ${./jvm-inventory-receipt.py} --module manure/server --module manure/backend --source ${source} --output "$out/receipt.json"
  for module in backend server; do
    mkdir "$out/$module"
    cp -r manure/$module/target/test-reports manure/$module/target/validation-inventory.txt "$out/$module/"
  done
  sha256sum "$MANURE_POSIX_LIBRARY" > "$out/jni.sha256"
''
