#!/usr/bin/env bash
# Haystack Step 8 deployment test (disposable): boot the real nix-built
# server binary from module-equivalent config against disposable PostgreSQL.
# Proves start/restart, DB persistence, credential permissions, revocation,
# and secret hygiene. TLS routing is asserted at module-eval level
# (checks.haystack-nixos-eval); full nginx/TLS runs on a NixOS host (Step 11).
#
# Usage: ./tests-deploy/local-boot.sh [package-out-path]
# Requires: nix-built haystack package, nixpkgs postgresql + nodejs on PATH
#   (e.g. via `nix shell --inputs-from . nixpkgs#postgresql nixpkgs#nodejs`).
set -euo pipefail

PKG="${1:-$(nix build --no-link --print-out-paths .#haystack 2>/dev/null | tail -1)}"
echo "package: $PKG"
test -x "$PKG/bin/haystack-server" || { echo "FAIL: no server binary"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; kill "$SRVPID" 2>/dev/null || true' EXIT
export PGDATA="$WORK/pg" PGSOCK="$WORK/sock"
mkdir -p "$PGSOCK"

initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null
pg_ctl -D "$PGDATA" -l "$WORK/pg.log" -o "-k $PGSOCK -p 54399 -c listen_addresses='localhost'" start >/dev/null
psql -h "$PGSOCK" -p 54399 -U postgres -c "CREATE DATABASE haystack;" >/dev/null
psql -h "$PGSOCK" -p 54399 -U postgres -c "CREATE USER haystack;" >/dev/null
psql -h "$PGSOCK" -p 54399 -U postgres -c "GRANT ALL ON DATABASE haystack TO haystack;" >/dev/null
psql -h "$PGSOCK" -p 54399 -U postgres -d haystack -c "GRANT CREATE ON SCHEMA public TO haystack;" >/dev/null

# Operator-style secrets (0600). The live tokens double as hygiene canaries
# for the store/config grep below.
TOK_AGENT="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
TOK_HUMAN="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
printf '%s' "$TOK_AGENT" > "$WORK/agent.token"
printf '%s\n' "$TOK_HUMAN" > "$WORK/human.token"
chmod 600 "$WORK"/agent.token "$WORK"/human.token
sha256() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
printf '%s' "$(sha256 "$TOK_AGENT")" > "$WORK/agent.sha"
printf '%s\n' "$(sha256 "$TOK_HUMAN")" > "$WORK/human.sha"
chmod 600 "$WORK"/agent.sha "$WORK"/human.sha
mkdir -p "$WORK/creds"
cp "$WORK/agent.sha" "$WORK/creds/haystack-hash-w-agent-default"
cp "$WORK/human.sha" "$WORK/creds/haystack-hash-operator-browser"

# Module-equivalent auth.json (hashFile paths, never secrets).
cat > "$WORK/auth.json" <<EOF
{
  "activityProjectId": "agent-activity",
  "users": [
    {"id": "operator", "type": "human", "displayName": "Op",
     "tokens": [{"id": "browser", "hashFile": "\$CREDENTIALS_DIRECTORY/haystack-hash-operator-browser"}]},
    {"id": "w-agent", "type": "agent", "displayName": "Agent",
     "tokens": [{"id": "default", "hashFile": "\$CREDENTIALS_DIRECTORY/haystack-hash-w-agent-default"}]}
  ],
  "cookieSecure": false,
  "allowedHosts": ["127.0.0.1", "localhost"],
  "allowedOrigins": [],
  "rateLimit": {"windowMs": 60000, "max": 600}
}
EOF

boot() {
  HAYSTACK_AUTH_JSON="$WORK/auth.json" \
  HAYSTACK_DATABASE_URL="postgresql://haystack@127.0.0.1:54399/haystack" \
  HAYSTACK_LISTEN=127.0.0.1 HAYSTACK_PORT=47444 HAYSTACK_POOL_MAX=4 \
  CREDENTIALS_DIRECTORY="$WORK/creds" \
  "$PKG/bin/haystack-server" >"$WORK/server.log" 2>&1 &
  SRVPID=$!
  for _ in $(seq 1 50); do
    curl -sf http://127.0.0.1:47444/api/v1/health >/dev/null 2>&1 && return 0
    sleep 0.2
  done
  echo "FAIL: server did not become ready"; cat "$WORK/server.log"; return 1
}

PASS=0; FAIL=0
check() { # check <name> <command...>
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "ok - $name"; PASS=$((PASS+1)); else echo "FAIL - $name"; FAIL=$((FAIL+1)); fi
}

boot
echo "--- live flows"
WHO=$(curl -s -H "Authorization: Bearer $TOK_AGENT" http://127.0.0.1:47444/api/v1/whoami)
echo "$WHO" | grep -q '"userId":"w-agent"' && echo "ok - whoami identity+namespace" && PASS=$((PASS+1)) || { echo "FAIL - whoami"; FAIL=$((FAIL+1)); }
echo "$WHO" | grep -q '"activityProjectId":"agent-activity"' && echo "ok - activity namespace" && PASS=$((PASS+1)) || { echo "FAIL - namespace"; FAIL=$((FAIL+1)); }
RID="0193e8d5-6f5c-7a1b-8c2d-000000000101"
DOC='{"title":"deploy probe","description":"d","fields":{},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[]}'
PUT=$(curl -s -H "Authorization: Bearer $TOK_AGENT" -H 'Content-Type: application/json' \
  -d "{\"key\":\"deploy:probe\",\"document_json\":$(printf '%s' "$DOC" | jq -Rs .),\"expected_revision\":0,\"request_id\":\"$RID\"}" \
  http://127.0.0.1:47444/api/v1/put)
echo "$PUT" | grep -q '"revision":1' && echo "ok - put" && PASS=$((PASS+1)) || { echo "FAIL - put: $PUT"; FAIL=$((FAIL+1)); }
check "bearer get" curl -sf -H "Authorization: Bearer $TOK_HUMAN" http://127.0.0.1:47444/api/v1/get -H 'Content-Type: application/json' -d '{"key":"deploy:probe"}'
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:47444/api/v1/whoami)
if [ "$CODE" = 401 ]; then echo "ok - anonymous whoami rejected"; PASS=$((PASS+1)); else echo "FAIL - anonymous whoami: $CODE"; FAIL=$((FAIL+1)); fi
echo "--- restart persistence"
kill "$SRVPID"; wait "$SRVPID" 2>/dev/null || true
boot
GOT=$(curl -s -H "Authorization: Bearer $TOK_HUMAN" -H 'Content-Type: application/json' -d '{"key":"deploy:probe"}' http://127.0.0.1:47444/api/v1/get)
echo "$GOT" | grep -q deploy && echo "ok - data survives restart" && PASS=$((PASS+1)) || { echo "FAIL - persistence"; FAIL=$((FAIL+1)); }
echo "--- revocation"
rm "$WORK/creds/haystack-hash-w-agent-default"
kill "$SRVPID"; wait "$SRVPID" 2>/dev/null || true
HAYSTACK_AUTH_JSON="$WORK/auth.json" HAYSTACK_DATABASE_URL="postgresql://haystack@127.0.0.1:54399/haystack" HAYSTACK_LISTEN=127.0.0.1 HAYSTACK_PORT=47444 CREDENTIALS_DIRECTORY="$WORK/creds" "$PKG/bin/haystack-server" >"$WORK/revoked.log" 2>&1 &
REVPID=$!
sleep 1.5
if kill -0 "$REVPID" 2>/dev/null && curl -sf http://127.0.0.1:47444/api/v1/health >/dev/null 2>&1; then
  echo "FAIL - revoked server should not start (missing digest)"; FAIL=$((FAIL+1))
  kill "$REVPID" 2>/dev/null || true
else
  echo "ok - missing digest fails startup"; PASS=$((PASS+1))
  wait "$REVPID" 2>/dev/null || true
fi
SRVPID=""
cp "$WORK/agent.sha" "$WORK/creds/haystack-hash-w-agent-default"
echo "--- secret hygiene"
if grep -rIl "$TOK_AGENT\|$TOK_HUMAN" "$PKG" >/dev/null 2>&1; then echo "FAIL - token in store"; FAIL=$((FAIL+1)); else echo "ok - no token material in store"; PASS=$((PASS+1)); fi
if grep -rIl "$TOK_AGENT" "$WORK/auth.json" >/dev/null 2>&1; then echo "FAIL - token in auth.json"; FAIL=$((FAIL+1)); else echo "ok - auth.json carries paths, not secrets"; PASS=$((PASS+1)); fi
echo "=== $PASS passed, $FAIL failed ==="
pg_ctl -D "$PGDATA" stop >/dev/null 2>&1 || true
test "$FAIL" -eq 0
