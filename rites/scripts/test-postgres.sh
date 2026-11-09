#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${POSTGRES_HOME:?use pinned nix develop .#backend}"
mkdir -p rites/server/target/validation-runs
report=$(mktemp -d "$PWD/rites/server/target/validation-runs/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
if [[ -d rites/server/target/test-reports ]]; then mv rites/server/target/test-reports "$report/previous-test-reports"; fi
if [[ -f rites/server/target/validation-inventory.txt ]]; then mv rites/server/target/validation-inventory.txt "$report/previous-inventory.txt"; fi
find build.sbt project shared/service-runtime shared/baboon-runtime rites/models rites/generated/scala rites/migrations rites/server rites/scripts -type f \( -name '*.scala' -o -name '*.sbt' -o -name '*.properties' -o -name '*.sh' -o -name '*.baboon' -o -name '*.sql' \) ! -path '*/target/*' ! -path 'project/project/*' -print0 | sort -z | xargs -0 sha256sum > "$report/source.sha256"
if head=$(git rev-parse HEAD 2>/dev/null); then
  printf '%s\n' "$head" > "$report/git-head"
elif [[ -n "${RITES_SOURCE_IDENTITY:-}" ]]; then
  printf '%s\n' "$RITES_SOURCE_IDENTITY" > "$report/source-identity"
else
  echo 'no Git worktree; set RITES_SOURCE_IDENTITY to the explicit immutable source path' >&2
  exit 2
fi
"$POSTGRES_HOME/bin/postgres" --version > "$report/postgres-version"
java -version 2> "$report/java-version"
echo "Rites validation receipt: $report"
base=$(mktemp -d "${TMPDIR:-/tmp}/rites-pg.XXXXXX")
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
trap '"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$base"' EXIT
printf '%s\n' rites-fixture-password > "$base/password"
chmod 600 "$base/password"
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 > "$base/init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-h 127.0.0.1 -p $port -k $base" -w start
export RITES_TEST_JDBC_URL="jdbc:postgresql://127.0.0.1:$port/postgres"
export RITES_TEST_DATABASE_USER=postgres
export RITES_TEST_DATABASE_PASSWORD=rites-fixture-password
set +e
bash scripts/backend-sbt.sh 'ritesServer/Test/validationInventory' 'ritesServer/test' 2>&1 | tee "$report/run.log"
status=${PIPESTATUS[0]}
set -e
printf '%s\n' "$status" > "$report/exit-status"
if [[ -d rites/server/target/test-reports ]]; then cp -r rites/server/target/test-reports "$report/test-reports"; fi
if [[ -f rites/server/target/validation-inventory.txt ]]; then cp rites/server/target/validation-inventory.txt "$report/inventory.txt"; fi
if [[ "$status" != 0 ]]; then exit "$status"; fi
python3 - "$report" <<'PYTHON'
import json, pathlib, sys, xml.etree.ElementTree as ET
root = pathlib.Path(sys.argv[1])
expected = root.joinpath('inventory.txt').read_text().splitlines()
reports = [ET.parse(p).getroot() for p in root.joinpath('test-reports').glob('*.xml')]
actual = [r.attrib['name'] for r in reports]
assert expected and len(set(expected)) == len(expected)
assert sorted(actual) == sorted(expected), (actual, expected)
counts = {name: sum(int(r.attrib.get(name, '0')) for r in reports) for name in ('tests', 'failures', 'errors', 'skipped')}
counts['suites'] = len(reports)
assert counts['tests'] > 0 and counts['failures'] == counts['errors'] == counts['skipped'] == 0, counts
root.joinpath('summary.json').write_text(json.dumps(counts, indent=2) + '\n')
print('Verified unfiltered Rites inventory:', counts)
PYTHON
