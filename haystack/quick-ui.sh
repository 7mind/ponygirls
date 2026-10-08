#!/usr/bin/env bash
# Haystack quick UI test (no deployment): disposable PostgreSQL + server +
# seeded demo data in a temp dir, cleaned up on Ctrl-C. The per-port login
# token persists under the repository's ignored debug directory.
#
# Usage: ./quick-ui.sh [port] [bind]
#   ./quick-ui.sh                # local only (127.0.0.1)
#   ./quick-ui.sh 47328 0.0.0.0  # reachable from other LAN hosts (no TLS!)
# Then open the printed URL and paste the printed token.
# Requires: node, npm, and PostgreSQL tools (initdb/pg_ctl/psql) — via PATH
#   or `nix shell nixpkgs#nodejs nixpkgs#postgresql`.
set -euo pipefail

HAYSTACK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-47328}"
# Bind address: 127.0.0.1 for local testing, 0.0.0.0 to reach the UI from
# another host on the LAN. Anyone with the URL + printed token gets full
# read/write access — this is a throwaway test server, no TLS, no firewall.
BIND="${2:-127.0.0.1}"
PGPORT="$((PORT + 100))"

need() { command -v "$1" >/dev/null 2>&1 || { echo "quick-ui: missing $1" >&2; return 1; }; }
if ! (need node && need npm && need initdb && need pg_ctl && need psql); then
  if command -v nix >/dev/null 2>&1; then
    echo "quick-ui: entering nix shell for nodejs+postgresql (one time)…" >&2
    REPO="$(dirname -- "$HAYSTACK_DIR")"
    if [[ -f "$REPO/flake.nix" ]]; then
      exec nix shell --inputs-from "$REPO" nixpkgs#nodejs nixpkgs#postgresql -c "$0" "$@"
    fi
    exec nix shell nixpkgs#nodejs nixpkgs#postgresql -c "$0" "$@"
  fi
  echo "quick-ui: need node, npm, initdb, pg_ctl, psql on PATH" >&2
  exit 2
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/haystack-ui.XXXXXX")"
SRVPID=""
cleanup() {
  if [[ -n "${SRVPID:-}" ]]; then kill "$SRVPID" 2>/dev/null || true; fi
  if [[ -n "${WORK:-}" && -d "$WORK/pg" ]]; then pg_ctl -D "$WORK/pg" stop >/dev/null 2>&1 || true; fi
  if [[ -n "${WORK:-}" ]]; then rm -rf "$WORK"; fi
}
trap cleanup EXIT

cd "$HAYSTACK_DIR"
# Rebuild when outputs are missing OR any source is newer (a stale dist is
# worse than a slow start: the old stub would boot without migrating).
if [[ ! -f server/dist/index.js || ! -f web/dist/index.html ]] || \
   [[ -n "$(find server/src web/src server/tsconfig.json web/tsconfig.json web/vite.config.ts \
       web/index.html package.json package-lock.json server/package.json web/package.json \
       -type f \( -newer server/dist/index.js -o -newer web/dist/index.html \) -print -quit)" ]]; then
  echo "quick-ui: building…" >&2
  npm ci --no-audit --no-fund >&2
  npm run build >&2
fi

export PGDATA="$WORK/pg" PGSOCK="$WORK/sock"
mkdir -p "$PGSOCK"
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null
pg_ctl -D "$PGDATA" -l "$WORK/pg.log" -o "-k $PGSOCK -p $PGPORT -c listen_addresses='localhost'" start >/dev/null
psql -h "$PGSOCK" -p "$PGPORT" -U postgres -c "CREATE DATABASE haystack;" >/dev/null
psql -h "$PGSOCK" -p "$PGPORT" -U postgres -c "CREATE USER haystack;" >/dev/null
psql -h "$PGSOCK" -p "$PGPORT" -U postgres -c "GRANT ALL ON DATABASE haystack TO haystack;" >/dev/null
psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d haystack -c "GRANT CREATE ON SCHEMA public TO haystack;" >/dev/null

# LAN IP early: other-host origins must be allowlisted in auth.json.
LANIP_EARLY="$((ip -4 route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || hostname -I 2>/dev/null | awk '{print $1}' || hostname --ip-address 2>/dev/null | awk '{print $1}' || true) | head -1)"
EXTRA_ORIGIN=""
EXTRA_HOST=""
if [[ "$BIND" != "127.0.0.1" && -n "$LANIP_EARLY" ]]; then
  EXTRA_ORIGIN=",\"http://$LANIP_EARLY:$PORT\""
  EXTRA_HOST=",\"$LANIP_EARLY\""
fi
TOKEN_FILE="$HAYSTACK_DIR/../debug/haystack-ui/$PORT/token.txt"
umask 077
mkdir -p -- "$(dirname -- "$TOKEN_FILE")"
TOKEN="$(node --input-type=module - "$TOKEN_FILE" <<'JS'
import { writeFile } from 'node:fs/promises';
import { generateToken, readTokenFile } from './server/dist/auth/tokens.js';
const path = process.argv[2];
try {
  await writeFile(path, generateToken() + '\n', { flag: 'wx', mode: 0o600 });
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
}
process.stdout.write(await readTokenFile(path));
JS
)"
chmod 600 -- "$TOKEN_FILE"
printf '%s\n' "$TOKEN" > "$WORK/token.txt"
DIGEST="$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)"
printf '%s\n' "$DIGEST" > "$WORK/token.sha"
cat > "$WORK/auth.json" <<EOF
{"activityProjectId":"demo",
 "users":[{"id":"op","type":"human","displayName":"Op","tokens":[{"id":"browser","hashFile":"$WORK/token.sha"}]}],
 "cookieSecure":false,"allowedHosts":["127.0.0.1","localhost","$BIND"$EXTRA_HOST],"allowedOrigins":["http://127.0.0.1:$PORT","http://$BIND:$PORT"$EXTRA_ORIGIN]}
EOF

HAYSTACK_AUTH_JSON="$WORK/auth.json" \
HAYSTACK_DATABASE_URL="postgresql://haystack@127.0.0.1:$PGPORT/haystack" \
HAYSTACK_LISTEN="$BIND" HAYSTACK_PORT="$PORT" HAYSTACK_POOL_MAX=4 \
node server/dist/index.js >"$WORK/server.log" 2>&1 &
SRVPID=$!
READY=0
for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:$PORT/api/v1/health" >/dev/null 2>&1; then READY=1; break; fi
  sleep 0.2
done
if [[ "$READY" != 1 ]]; then
  echo "quick-ui: server never became ready; log:" >&2
  tail -20 "$WORK/server.log" >&2
  exit 1
fi

# Demo data so every view has something to show.
api() { curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$2" "http://127.0.0.1:$PORT$1"; }
put() { # key document-json request-suffix (fails loudly: no silent empty UI)
  local out
  out=$(api /api/v1/put "{\"key\":\"$1\",\"document_json\":$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$2"),\"expected_revision\":0,\"request_id\":\"0193e8d5-6f5c-7a1b-8c2d-000000000$3\"}")
  echo "$out" | grep -q '"revision":' || { echo "quick-ui: seed put failed for $1: $out" >&2; exit 1; }
}
DOC='{"title":"Hello haystack","description":"First memory. Try editing me, then check history.","fields":{"n":9007199254740993},"type":"fact","status":"actual","importance":"high","human-attention":"cleared","links":[]}'
put "demo:hello" "$DOC" 501
DOC2='{"title":"Needs a human","description":"Attention inbox preset finds this.","fields":{},"type":"todo","status":"actual","importance":"high","human-attention":"required","links":[["related-to","demo:hello"]]}'
put "demo:todo" "$DOC2" 502
DOC3='{"title":"Buried one","description":"Hidden unless you ask for archived.","fields":{},"type":"fact","status":"archived","importance":"low","human-attention":"cleared","links":[]}'
put "demo:old" "$DOC3" 503

# Portable LAN IP (hostname -I is GNU-only); never fatal (|| true) so a
# missing toolbox cannot kill the script under pipefail + set -e.
LANIP="$( (ip -4 route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || hostname -I 2>/dev/null | awk '{print $1}' || hostname --ip-address 2>/dev/null | awk '{print $1}' || true) | head -1)"
echo
echo "  UI (this host):  http://127.0.0.1:$PORT/#/browse"
if [[ "$BIND" != "127.0.0.1" && -n "$LANIP" ]]; then
  echo "  UI (other hosts): http://$LANIP:$PORT/#/browse"
fi
echo "  Token:   $TOKEN"
echo "  Saved:   $TOKEN_FILE (retained across launches)"
echo "  WARNING: no TLS; anyone on the network with the URL + token has full access. Throwaway testing only."
echo "  Try:     search 'hello' · attention inbox · show-archived · edit demo:hello twice in two tabs (conflict)"
echo "  Stop:    Ctrl-C (server, postgres, and demo data are removed; login token is retained)"
echo
wait "$SRVPID"
