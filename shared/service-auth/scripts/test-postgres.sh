#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${POSTGRES_HOME:?use pinned nix develop .#backend}"
mkdir -p shared/service-auth/target/validation-runs
report=$(mktemp -d "$PWD/shared/service-auth/target/validation-runs/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
if [[ -d shared/service-auth/target/test-reports ]]; then
  mv shared/service-auth/target/test-reports "$report/previous-test-reports"
fi
find shared/service-auth/src shared/service-runtime/src/main project -type f ! -path '*/target/*' ! -path 'project/project/*' -print0 | sort -z | xargs -0 sha256sum > "$report/source.sha256"
sha256sum build.sbt scripts/backend-sbt.sh shared/service-auth/scripts/test-postgres.sh >> "$report/source.sha256"
git rev-parse HEAD > "$report/git-head"
base=$(mktemp -d "${TMPDIR:-/tmp}/service-auth-pg.XXXXXX")
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
cleanup() {
  "$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop > "$report/stop.log" 2>&1 || true
  rm -rf "$base"
}
trap cleanup EXIT
printf '%s\n' synthetic-test-password > "$base/password"
chmod 600 "$base/password"
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U account_test -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 > "$report/init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$report/server.log" -o "-h 127.0.0.1 -p $port -k $base" -w start
export ACCOUNT_TEST_JDBC="jdbc:postgresql://127.0.0.1:$port/postgres"
export ACCOUNT_REQUIRE_POSTGRES=1
printf 'Shared account validation receipt: %s\n' "$report"
set +e
bash scripts/backend-sbt.sh 'serviceAuth/Test/validationInventory' 'serviceAuth/testFull' 2>&1 | tee "$report/run.log"
status=${PIPESTATUS[0]}
set -e
printf '%s\n' "$status" > "$report/exit-status"
if [[ -d shared/service-auth/target/test-reports ]]; then cp -r shared/service-auth/target/test-reports "$report/test-reports"; fi
if [[ -f shared/service-auth/target/validation-inventory.txt ]]; then cp shared/service-auth/target/validation-inventory.txt "$report/inventory.txt"; fi
if [[ "$status" != 0 ]]; then exit "$status"; fi
python3 - "$report" <<'PY'
import json, pathlib, sys, xml.etree.ElementTree as ET
root = pathlib.Path(sys.argv[1])
expected = root.joinpath('inventory.txt').read_text().splitlines()
reports = [ET.parse(p).getroot() for p in root.joinpath('test-reports').glob('*.xml')]
assert expected and sorted(r.attrib['name'] for r in reports) == sorted(expected)
counts = {name: sum(int(r.attrib.get(name, '0')) for r in reports) for name in ('tests', 'failures', 'errors', 'skipped')}
counts['suites'] = len(reports)
assert counts['tests'] > 0 and counts['failures'] == counts['errors'] == counts['skipped'] == 0, counts
root.joinpath('summary.json').write_text(json.dumps(counts, indent=2) + '\n')
print('Verified full shared account inventory:', counts)
PY
