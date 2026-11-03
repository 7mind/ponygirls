#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${POSTGRES_HOME:?use pinned nix develop .#chronicle}"
mkdir -p shared/retrieval-postgres/target/validation-runs
report=$(mktemp -d "$PWD/shared/retrieval-postgres/target/validation-runs/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
for module in retrieval-core model-http retrieval-postgres; do
  mkdir -p "$report/$module"
  if [[ -d shared/$module/target/test-reports ]]; then mv "shared/$module/target/test-reports" "$report/$module/previous-test-reports"; fi
  if [[ -f shared/$module/target/validation-inventory.txt ]]; then mv "shared/$module/target/validation-inventory.txt" "$report/$module/previous-inventory.txt"; fi
done
find build.sbt project shared/retrieval-core shared/model-http shared/retrieval-postgres shared/service-runtime -type f \( -name '*.scala' -o -name '*.sbt' -o -name '*.properties' -o -name '*.sh' \) ! -path '*/target/*' ! -path 'project/project/*' -print0 | sort -z | xargs -0 sha256sum > "$report/source.sha256"
git rev-parse HEAD > "$report/git-head"
"$POSTGRES_HOME/bin/postgres" --version > "$report/postgres-version"
echo "Retrieval validation receipt: $report"
base=$(mktemp -d "${TMPDIR:-/tmp}/retrieval-pg.XXXXXX")
port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
trap '"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$base"' EXIT
"$POSTGRES_HOME/bin/initdb" -D "$base/data" -U postgres -A trust --no-locale --encoding=UTF8 > "$base/init.log"
"$POSTGRES_HOME/bin/pg_ctl" -D "$base/data" -l "$base/server.log" -o "-h 127.0.0.1 -p $port -k $base" -w start
export CHRONICLE_TEST_JDBC="jdbc:postgresql://127.0.0.1:$port/postgres"
export RETRIEVAL_DIAGNOSTIC_DIR="$report/retrieval-postgres/diagnostics"
set +e
bash scripts/backend-sbt.sh 'retrievalCore/Test/validationInventory' 'modelHttp/Test/validationInventory' 'retrievalPostgres/Test/validationInventory' 'retrievalCore/test' 'modelHttp/test' 'retrievalPostgres/test' 2>&1 | tee "$report/run.log"
status=${PIPESTATUS[0]}
set -e
printf '%s\n' "$status" > "$report/exit-status"
for module in retrieval-core model-http retrieval-postgres; do
  if [[ -d shared/$module/target/test-reports ]]; then cp -r "shared/$module/target/test-reports" "$report/$module/test-reports"; fi
  if [[ -f shared/$module/target/validation-inventory.txt ]]; then cp "shared/$module/target/validation-inventory.txt" "$report/$module/inventory.txt"; fi
done
if [[ "$status" != 0 ]]; then exit "$status"; fi
python3 - "$report" <<'PYTHON'
import json,pathlib,sys,xml.etree.ElementTree as ET
root=pathlib.Path(sys.argv[1]); summary={}
for name in ('retrieval-core','model-http','retrieval-postgres'):
 p=root/name; expected=p.joinpath('inventory.txt').read_text().splitlines()
 reports=[ET.parse(f).getroot() for f in p.joinpath('test-reports').glob('*.xml')]
 actual=[r.attrib['name'] for r in reports]
 assert expected and len(set(expected))==len(expected)
 assert sorted(actual)==sorted(expected),(actual,expected)
 counts={k:sum(int(r.attrib.get(k,'0')) for r in reports) for k in ('tests','failures','errors','skipped')}; counts['suites']=len(reports)
 assert counts['tests']>0 and counts['failures']==counts['errors']==counts['skipped']==0,counts
 summary[name]=counts
root.joinpath('summary.json').write_text(json.dumps(summary,indent=2)+'\n'); print(summary)
PYTHON
