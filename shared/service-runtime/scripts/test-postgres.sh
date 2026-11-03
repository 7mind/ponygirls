#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${POSTGRES_HOME:?use pinned nix develop .#chronicle}"
mkdir -p shared/service-runtime/target/validation-runs
report=$(mktemp -d "$PWD/shared/service-runtime/target/validation-runs/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
if [[ -d shared/service-runtime/target/test-reports ]]; then
  mv shared/service-runtime/target/test-reports "$report/previous-test-reports"
fi
if [[ -f shared/service-runtime/target/validation-inventory.txt ]]; then
  mv shared/service-runtime/target/validation-inventory.txt "$report/previous-inventory.txt"
fi
# Exact input binding includes uncommitted source bytes, not just HEAD.
find build.sbt project shared/service-runtime shared/baboon-runtime -type f \( -name '*.scala' -o -name '*.sbt' -o -name '*.properties' -o -name '*.sh' \) ! -path '*/target/*' ! -path 'project/project/*' -print0 | sort -z | xargs -0 sha256sum > "$report/source.sha256"
git rev-parse HEAD > "$report/git-head"
"$POSTGRES_HOME/bin/postgres" --version > "$report/postgres-version"
java -version 2> "$report/java-version"
echo "Runtime validation receipt: $report"
base=$(mktemp -d "${TMPDIR:-/tmp}/service-runtime-pg.XXXXXX")
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
trap '"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$base"' EXIT
# Owned disposable cluster with password auth exercises the credential-file boundary.
printf '%s\n' runtime-test-password > "$base/password"
chmod 600 "$base/password"
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A scram-sha-256 --pwfile="$base/password" --no-locale --encoding=UTF8 > "$base/init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-h 127.0.0.1 -p $port -k $base" -w start
export RUNTIME_TEST_JDBC="jdbc:postgresql://127.0.0.1:$port/postgres"
# No test filters/no database skips. Serial PostgreSQL suite execution in build.sbt.
exec_cmd=(bash scripts/backend-sbt.sh 'serviceRuntime/Test/validationInventory' 'serviceRuntime/test')
set +e
"${exec_cmd[@]}" 2>&1 | tee "$report/run.log"
status=${PIPESTATUS[0]}
set -e
printf '%s\n' "$status" > "$report/exit-status"
if [[ -d shared/service-runtime/target/test-reports ]]; then
  cp -r shared/service-runtime/target/test-reports "$report/test-reports"
fi
if [[ -f shared/service-runtime/target/validation-inventory.txt ]]; then
  cp shared/service-runtime/target/validation-inventory.txt "$report/inventory.txt"
fi
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
print('Verified unfiltered runtime inventory:', counts)
PYTHON
