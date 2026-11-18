#!/usr/bin/env bash
# Browser legs against an owned disposable PostgreSQL. Run inside the pinned
# chronicle shell. Required: SERVER_COMMAND, CHROMIUM, NGINX (all prefixed
# HAYSTACK_); optional paired PROVISION_COMMAND and PROXY_CONFIG_FILE.
# Fails on any failing leg, a skip, or a run without a passing check.
set -euo pipefail
if [[ "${HAYSTACK_BROWSER_BOUNDED:-}" != 1 ]]; then
  exec timeout --signal=TERM --kill-after=10s 575s env HAYSTACK_BROWSER_BOUNDED=1 bash "$0" "$@"
fi
if [[ -n "${POSTGRES_HOME:-}" ]]; then export PATH="$POSTGRES_HOME/bin:$PATH"; fi
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
: "${HAYSTACK_SERVER_COMMAND:?explicit Scala JVM/native executable command required}"
: "${HAYSTACK_CHROMIUM:?absolute Chromium executable required}"
: "${HAYSTACK_NGINX:?absolute nginx executable required}"
[[ "$HAYSTACK_CHROMIUM" == /* && -x "$HAYSTACK_CHROMIUM" && "$HAYSTACK_NGINX" == /* && -x "$HAYSTACK_NGINX" ]]
for command in node npm initdb pg_ctl psql python3 timeout bash curl openssl; do command -v "$command" >/dev/null; done
if [[ "${HAYSTACK_PROXY_CONFIG_FILE+x}" != x ]]; then command -v nix >/dev/null; fi
report="${HAYSTACK_REPORT_DIR:-$root/haystack/web/target/browser-report-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
[[ "$report" == /* ]] || { echo 'HAYSTACK_REPORT_DIR must be absolute' >&2; exit 2; }
if [[ -e "$report" && -n "$(ls -A "$report")" ]]; then echo "refusing to overwrite an existing report: $report" >&2; exit 2; fi
mkdir -p "$report/artifacts"
export HAYSTACK_UI_ARTIFACTS="$report/artifacts"
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
npm run build -w web > "$report/build.log" 2>&1
cd web
status=0
npm run test:browser > "$report/browser.log" 2>&1 || status=$?
cat "$report/browser.log"
if grep -q '# SKIP' "$report/browser.log" || ! grep -q '^ok - ' "$report/browser.log"; then
  echo 'browser legs skipped a check or passed none' >&2; status=1
fi
echo "Browser report: $report"
exit "$status"
