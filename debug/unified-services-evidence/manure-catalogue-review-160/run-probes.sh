#!/usr/bin/env bash
set -euo pipefail
cd /home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-retrieval-shared
r="$PWD/shared/retrieval-postgres/target/review-manure-160"
label="${1:?explicit fresh receipt label required}"
for artifact in "$r/probes-$label.log" "$r/probe-source-$label.sha256" "$r/postgres-$label.log"; do
  [[ ! -e "$artifact" ]] || { echo "receipt exists: refusing overwrite" >&2; exit 64; }
done
pg="$POSTGRES_HOME"
while IFS='=' read -r name _; do
  case "$name" in PG*|MANURE*|HAYSTACK*|CHRONICLE*|*JDBC*|*MODEL*|*TOKEN*|*CREDENTIAL*|*API_KEY*|OPENAI*|ANTHROPIC*|HF_*|AZURE*|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS) unset "$name";; esac
done < <(env)
export POSTGRES_HOME="$pg" SBT_JAVA_OPTS="-XX:ActiveProcessorCount=2 -Xmx1536m -Dsbt.task.cpus=1"
export MANURE_REVIEW_ORACLE="$r/legacy-oracle-v1.json" REVIEW_RECEIPT_LABEL="$label"
gcc -shared -fPIC -O2 -Wall -Wextra -I"$JAVA_HOME/include" -I"$JAVA_HOME/include/linux" -o "$r/libmanure-review.so" "$r/manure/server/src/main/c/posix_native.c"
find "$r/manure/backend" "$r/manure/server/src/main" "$r/manure/generated/scala/manure" "$r/manure/migration" "$r/manure/manure" "$r/shared/service-runtime/src/main" "$r/shared/baboon-runtime/src/main" "$r/shared/retrieval-core/src/main" "$r/shared/retrieval-postgres/src/main" "$r/shared/model-http/src/main" "$r/probes" "$r/legacy-oracle-v1.json" "$r/run-probes.sh" -type f ! -path '*/__pycache__/*' -print0 | sort -z | xargs -0 sha256sum > "$r/probe-source-$label.sha256"
git rev-parse HEAD > "$r/harness-head-$label"
base=$(mktemp -d /tmp/manure-review-160-pg.XXXXXX)
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
trap '"$pg/bin/pg_ctl" -D "$base/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$base"' EXIT
printf '%s\n' controlled-review-password > "$base/password"; chmod 600 "$base/password"
"$pg/bin/initdb" -D "$base/data" -U postgres -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 > "$r/init-$label.log"
"$pg/bin/pg_ctl" -D "$base/data" -l "$r/postgres-$label.log" -o "-h 127.0.0.1 -p $port -k $base" -w start
export MANURE_TEST_ALLOW_CREATEDB=1 MANURE_TEST_JDBC_URL="jdbc:postgresql://127.0.0.1:$port/postgres" MANURE_TEST_JDBC_PASSWORD_FILE="$base/password" MANURE_TEST_JDBC_USER=postgres
export MANURE_SOURCE_ROOT="$r" MANURE_POSIX_LIBRARY="$r/libmanure-review.so"
set +e
scripts/backend-sbt.sh "set retrievalCore / Compile / unmanagedSourceDirectories := Seq(file(\"$r/shared/retrieval-core/src/main/scala\"))" "set retrievalPostgres / Compile / unmanagedSourceDirectories := Seq(file(\"$r/shared/retrieval-postgres/src/main/scala\"))" "set modelHttp / Compile / unmanagedSourceDirectories := Seq(file(\"$r/shared/model-http/src/main/scala\"))" "set baboonRuntime / Compile / unmanagedSourceDirectories := Seq(file(\"$r/shared/baboon-runtime/src/main/scala\"))" "set serviceRuntime / Compile / unmanagedSourceDirectories := Seq(file(\"$r/shared/service-runtime/src/main/scala\"))" "set manureContracts / Compile / unmanagedSourceDirectories := Seq(file(\"$r/manure/generated/scala/manure\"))" "set manureStorage / Compile / unmanagedSourceDirectories := Seq(file(\"$r/manure/server/src/main/scala\"),file(\"$r/manure/server/src/main/java\"))" "set manureServer / Compile / unmanagedSourceDirectories := Seq(file(\"$r/manure/backend/src/main/scala\"))" "set manureServer / Compile / unmanagedResourceDirectories := Seq(file(\"$r/manure/backend/src/main/resources\"))" "set manureServer / Test / sources := Seq(file(\"$r/manure/backend/src/test/scala/manure/BackendFixture.scala\"),file(\"$r/manure/backend/src/test/scala/manure/MemoryMetadata.scala\"),file(\"$r/probes/IndependentCatalogueSuite.scala\"),file(\"$r/probes/ConverterAdoptionSuite.scala\"))" "set manureServer / Test / parallelExecution := false" "set manureServer / Test / javaOptions ++= Seq(\"-XX:ActiveProcessorCount=2\",\"-Xmx1024m\")" "manureServer/testOnly manure.IndependentMemoryCatalogueSuite manure.IndependentPostgresCatalogueSuite manure.IndependentCatalogueBoundarySuite manure.ConverterAdoptionSuite" > "$r/probes-$label.log" 2>&1
status=$?
set -e
printf '%s\n' "$status" > "$r/probe-$label-exit-status"
for suite in IndependentMemoryCatalogueSuite IndependentPostgresCatalogueSuite IndependentCatalogueBoundarySuite ConverterAdoptionSuite; do
  if [[ -f manure/backend/target/test-reports/TEST-manure.$suite.xml ]]; then cp "manure/backend/target/test-reports/TEST-manure.$suite.xml" "$r/TEST-manure.$suite-$label.xml"; fi
done
tail -100 "$r/probes-$label.log"
exit "$status"
