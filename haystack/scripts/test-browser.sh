#!/usr/bin/env bash
# Full owned-current browser acceptance. Run inside the pinned chronicle shell.
# Required: ARTIFACT_KIND=jvm|native, SERVER_ARTIFACT_FILE, SERVER_COMMAND,
# CHROMIUM, NGINX (all prefixed HAYSTACK_); optional paired PROVISION_COMMAND.
set -euo pipefail
if [[ "${HAYSTACK_BROWSER_BOUNDED:-}" != 1 ]]; then
  exec timeout --signal=TERM --kill-after=10s 575s env HAYSTACK_BROWSER_BOUNDED=1 bash "$0" "$@"
fi
if [[ -n "${POSTGRES_HOME:-}" ]]; then export PATH="$POSTGRES_HOME/bin:$PATH"; fi
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
: "${HAYSTACK_SERVER_COMMAND:?explicit Scala JVM/native executable command required}"
: "${HAYSTACK_ARTIFACT_KIND:?set jvm or native}"
: "${HAYSTACK_SERVER_ARTIFACT_FILE:?absolute exact JAR/ELF required}"
: "${HAYSTACK_CHROMIUM:?absolute Chromium executable required}"
: "${HAYSTACK_NGINX:?absolute nginx executable required}"
[[ "$HAYSTACK_ARTIFACT_KIND" == jvm || "$HAYSTACK_ARTIFACT_KIND" == native ]]
[[ "$HAYSTACK_SERVER_ARTIFACT_FILE" == /* && -f "$HAYSTACK_SERVER_ARTIFACT_FILE" ]]
[[ "$HAYSTACK_CHROMIUM" == /* && -x "$HAYSTACK_CHROMIUM" && "$HAYSTACK_NGINX" == /* && -x "$HAYSTACK_NGINX" ]]
for command in node npm initdb pg_ctl psql python3 timeout bash curl openssl sha256sum; do command -v "$command" >/dev/null; done
if [[ "${HAYSTACK_PROXY_CONFIG_FILE+x}" != x ]]; then command -v nix >/dev/null; fi
report="${HAYSTACK_REPORT_DIR:-$root/haystack/web/target/browser-report-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
[[ "$report" == /* ]] || { echo 'HAYSTACK_REPORT_DIR must be absolute' >&2; exit 2; }
if [[ -e "$report" && -n "$(ls -A "$report")" ]]; then echo "refusing to overwrite an existing report: $report" >&2; exit 2; fi
mkdir -p "$report/artifacts"
export HAYSTACK_UI_ARTIFACTS="$report/artifacts"
cp haystack/web/tests-browser/inventory.json "$report/inventory.json"
sha256sum "$HAYSTACK_SERVER_ARTIFACT_FILE" > "$report/artifact-before.sha256"
sha256sum "$report/inventory.json" > "$report/inventory.sha256"
python3 - "$HAYSTACK_ARTIFACT_KIND" "$HAYSTACK_SERVER_ARTIFACT_FILE" <<'PY'
import sys,zipfile,pathlib
kind,path=sys.argv[1:]
if kind=='native':
    with open(path,'rb') as f: assert f.read(4)==b'\x7fELF','native acceptance requires ELF bytes'
else: assert zipfile.is_zipfile(path),'JVM acceptance requires an assembly JAR'
PY
{
  if [[ -e .git ]]; then git rev-parse HEAD; git status --short;
  else
    : "${HAYSTACK_SOURCE_REVISION:?filtered source without .git requires explicit source commit identity}"
    [[ "$HAYSTACK_SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]] || exit 2
    printf '%s\nsource-mode=filtered-no-git\n' "$HAYSTACK_SOURCE_REVISION"
  fi
  printf 'artifact-kind=%s\n' "$HAYSTACK_ARTIFACT_KIND"
  printf '%s' "$HAYSTACK_SERVER_COMMAND" | sha256sum
  if [[ -n "${HAYSTACK_TEST_PROVISION_COMMAND:-}" ]]; then sha256sum "$HAYSTACK_TEST_PROVISION_COMMAND"; fi
  if [[ "${HAYSTACK_PROXY_CONFIG_FILE+x}" == x ]]; then sha256sum "$HAYSTACK_PROXY_CONFIG_FILE"; fi
  find haystack/web/src haystack/web/tests haystack/web/tests-browser haystack/generated/scala haystack/generated/typescript haystack/models haystack/migrations -type f -print0 | sort -z | xargs -0 sha256sum
  sha256sum haystack/quick-ui.sh haystack/package-lock.json haystack/web/package.json haystack/scripts/register-generated.mjs haystack/scripts/test-browser.sh nix/nixos/haystack.nix
} > "$report/source.txt"
{
  node --version; npm --version; initdb --version; psql --version; openssl version
  if [[ "${HAYSTACK_PROXY_CONFIG_FILE+x}" != x ]]; then nix --version; fi
  "$HAYSTACK_CHROMIUM" --version; "$HAYSTACK_NGINX" -v
  sha256sum "$HAYSTACK_CHROMIUM" "$HAYSTACK_NGINX"
} > "$report/dependencies.txt" 2>&1
if [[ "${HAYSTACK_PROXY_CONFIG_FILE+x}" == x ]]; then
  sha256sum "$HAYSTACK_PROXY_CONFIG_FILE" > "$report/proxy-before.sha256"
  cp "$HAYSTACK_PROXY_CONFIG_FILE" "$report/proxy-input.json"
fi
work="$(mktemp -d "${TMPDIR:-/tmp}/haystack-browser-pg.XXXXXX")"
cleanup() { pg_ctl -D "$work/pg" -m immediate stop >"$report/cleanup.log" 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
pgport="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
initdb -D "$work/pg" -U postgres --auth=trust > "$report/initdb.log"
pg_ctl -D "$work/pg" -l "$report/postgres.log" -o "-k $work -p $pgport -h 127.0.0.1" start > "$report/pg-start.log"
psql -h 127.0.0.1 -p "$pgport" -U postgres -c 'CREATE DATABASE haystack_browser_admin' > "$report/admin-init.log"
umask 077
printf 'synthetic-owned-test-password\n' > "$work/database-password"
export HAYSTACK_OWNED_TEST_DB=1 HAYSTACK_TEST_JDBC="jdbc:postgresql://127.0.0.1:$pgport/haystack_browser_admin"
export HAYSTACK_TEST_DB_USER=postgres HAYSTACK_TEST_DB_PASSWORD_FILE="$work/database-password"
export HAYSTACK_FIXTURE_WORK_DIR="$work" HAYSTACK_OWNED_PGDATA="$work/pg"
export HAYSTACK_TEST_PG="postgresql://postgres@127.0.0.1:$pgport/haystack_browser_admin"
if [[ "${HAYSTACK_TEST_PROVISION_COMMAND+x}" != x ]]; then export HAYSTACK_FIXTURE_ADMIN_AUTHORIZED=1; fi
cd haystack
npm ci --offline --no-audit --no-fund > "$report/npm-ci.log" 2>&1
npm run typecheck -w web > "$report/typecheck.log" 2>&1
npm run build -w web > "$report/build.log" 2>&1
cd web
set +e
node --import ../scripts/register-generated.mjs --test --test-concurrency=1 \
  --test-reporter=tap --test-reporter-destination="$report/atomic.tap" \
  --test-reporter=junit --test-reporter-destination="$report/atomic.xml" \
  tests/*.test.ts tests/*.test.mjs > "$report/atomic-runner.log" 2>&1
atomic_status=$?
node tests-browser/browse-markup.mjs > "$report/markup.log" 2>&1
markup_status=$?
npm run test:browser > "$report/browser.log" 2>&1
browser_status=$?
set -e
cat "$report/atomic.tap" "$report/atomic-runner.log" "$report/markup.log" "$report/browser.log"
sha256sum "$HAYSTACK_SERVER_ARTIFACT_FILE" > "$report/artifact-after.sha256"
cmp "$report/artifact-before.sha256" "$report/artifact-after.sha256"
if [[ "${HAYSTACK_PROXY_CONFIG_FILE+x}" == x ]]; then
  sha256sum "$HAYSTACK_PROXY_CONFIG_FILE" > "$report/proxy-after.sha256"
  cmp "$report/proxy-before.sha256" "$report/proxy-after.sha256"
fi
python3 - "$report" "$atomic_status" "$markup_status" "$browser_status" <<'PY'
import json,pathlib,sys,xml.etree.ElementTree as ET
report=pathlib.Path(sys.argv[1]); inventory=json.loads((report/'inventory.json').read_text())
assert all(inventory.values()),'empty acceptance inventory'
cases=list(ET.parse(report/'atomic.xml').iter('testcase')); names=[case.attrib['name'] for case in cases]
atomic_exact=sorted(names)==sorted(inventory['atomicLeafCases'])
failed=sum(len(c.findall('failure'))+len(c.findall('error')) for c in cases)
skipped=sum(len(c.findall('skipped')) for c in cases)
browser=(report/'browser.log').read_text(); actual=[line.removeprefix('ok - ') for line in browser.splitlines() if line.startswith('ok - ')]
markup=[line.removeprefix('ok - ') for line in (report/'markup.log').read_text().splitlines() if line.startswith('ok - ')]
browser_exact=sorted(actual)==sorted(inventory['browserCases'])
markup_exact=markup==inventory['markupCases']
no_skips='# SKIP' not in browser and '# 39 checks; 0 failures; 0 skipped' in browser
receipt={'artifactKind':next(line.split('=',1)[1] for line in (report/'source.txt').read_text().splitlines() if line.startswith('artifact-kind=')),
 'atomicLeafCases':len(cases),'browserCases':len(actual),'markupCases':len(markup),'failuresAndErrors':failed,'skipped':skipped,
 'inventoryExact':atomic_exact and browser_exact and markup_exact,'exitStatuses':list(map(int,sys.argv[2:])),'artifactUnchanged':True,
 'atomicInventoryExact':atomic_exact,'browserInventoryExact':browser_exact,'markupInventoryExact':markup_exact,
 'missingBrowserCases':sorted(set(inventory['browserCases'])-set(actual)),'browserNoSkips':no_skips}
(report/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
assert cases and actual and not failed and not skipped and no_skips and receipt['inventoryExact'] and receipt['exitStatuses']==[0,0,0],receipt
PY
printf 'atomic-status=%s\nmarkup-status=%s\nbrowser-status=%s\n' "$atomic_status" "$markup_status" "$browser_status" >> "$report/source.txt"
echo "Browser report: $report"
