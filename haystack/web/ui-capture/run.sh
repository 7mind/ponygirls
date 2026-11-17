#!/usr/bin/env bash
# Re-runnable screenshot harness for the Haystack dashboard. NOT part of any test/check.
#   nix develop .#chronicle --command bash haystack/web/ui-capture/run.sh OUT_DIR
# Starts a private PostgreSQL cluster + the selected Haystack server on ephemeral
# ports, seeds synthetic data through the public API, drives pinned Chromium.
set -euo pipefail
OUT="${1:?usage: run.sh OUT_DIR (absolute path; created if missing)}"
[[ "$OUT" == /* ]] || { echo 'OUT_DIR must be absolute' >&2; exit 2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HAYSTACK="$(cd "$HERE/../.." && pwd -P)"
REPO="$(cd "$HAYSTACK/.." && pwd -P)"
if [[ -n "${POSTGRES_HOME:-}" ]]; then export PATH="$POSTGRES_HOME/bin:$PATH"; fi
for tool in node npm initdb pg_ctl psql; do command -v "$tool" >/dev/null || { echo "missing $tool: run inside 'nix develop .#chronicle'" >&2; exit 2; }; done
[[ -d "$HAYSTACK/node_modules/playwright-core" ]] || { echo "provision deps first: (cd haystack && npm ci --offline --no-audit --no-fund)" >&2; exit 2; }

# Server: an already built native ELF/JAR; never built here.
if [[ -z "${HAYSTACK_SERVER_COMMAND:-}" ]]; then
  pkg="$(nix eval --raw "$REPO#packages.x86_64-linux.haystack.outPath")"
  [[ -x "$pkg/bin/haystack-server" ]] || { echo "build it first: nix build $REPO#haystack --no-link" >&2; exit 2; }
  export HAYSTACK_SERVER_COMMAND="$pkg/bin/haystack-server"
fi
# Browser: the Chromium pinned by the dev shell's Playwright browser bundle.
if [[ -z "${HAYSTACK_CHROMIUM:-}" ]]; then
  : "${PLAYWRIGHT_BROWSERS_PATH:?PLAYWRIGHT_BROWSERS_PATH unset (use the chronicle dev shell)}"
  export HAYSTACK_CHROMIUM="$(ls -d "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux*/chrome | head -1)"
fi
[[ -x "$HAYSTACK_CHROMIUM" ]] || { echo "chromium not executable: $HAYSTACK_CHROMIUM" >&2; exit 2; }

# The captured UI is always the working tree's source, built into web/dist (git-ignored).
if [[ "${HAYSTACK_UI_CAPTURE_SKIP_BUILD:-}" != 1 ]]; then (cd "$HAYSTACK" && npm run build -w web >&2); fi

mkdir -p "$OUT"
work="$(mktemp -d "${TMPDIR:-/tmp}/haystack-ui-capture.XXXXXX")"
cleanup() { chmod -R go+rX "$OUT" 2>/dev/null || true; pg_ctl -D "$work/pg" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
pgport="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
initdb -D "$work/pg" -U postgres --auth=trust >/dev/null
pg_ctl -D "$work/pg" -l "$work/postgres.log" -o "-k $work -p $pgport -h 127.0.0.1" -w start >/dev/null
psql -h 127.0.0.1 -p "$pgport" -U postgres -c 'CREATE DATABASE haystack_capture_admin' >/dev/null
umask 077
printf 'synthetic-owned-capture-password\n' > "$work/database-password"
export HAYSTACK_OWNED_TEST_DB=1 HAYSTACK_TEST_JDBC="jdbc:postgresql://127.0.0.1:$pgport/haystack_capture_admin"
export HAYSTACK_TEST_DB_USER=postgres HAYSTACK_TEST_DB_PASSWORD_FILE="$work/database-password"
export HAYSTACK_FIXTURE_WORK_DIR="$work" HAYSTACK_FIXTURE_ADMIN_AUTHORIZED=1
export HAYSTACK_TEST_PG="postgresql://postgres@127.0.0.1:$pgport/haystack_capture_admin"
export HAYSTACK_CAPTURE_WORK="$work"
cd "$HAYSTACK/web"
node --import ../scripts/register-generated.mjs ui-capture/capture.mjs "$OUT"
