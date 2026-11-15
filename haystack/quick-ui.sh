#!/usr/bin/env bash
# Private per-port PostgreSQL preview + selected Scala/native executable + built UI.
# HAYSTACK_SERVER_COMMAND='java -jar /absolute/haystack-server.jar' ./quick-ui.sh [port] [bind]
# No TypeScript/Node server fallback. Node is only a build/fixture client tool.
set -euo pipefail
HAYSTACK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_DIR="$(cd -- "$HAYSTACK_DIR/.." && pwd -P)"
PORT="${1:-47328}"
BIND="${2:-127.0.0.1}"
[[ "$PORT" =~ ^[0-9]+$ && "$PORT" -ge 1 && "$PORT" -le 65435 ]] || { echo 'quick-ui: invalid port' >&2; exit 2; }
: "${HAYSTACK_SERVER_COMMAND:?select the Scala/native executable (a shell command accepting serve CONFIG.json)}"
PGPORT="$((PORT + 100))"
need() { command -v "$1" >/dev/null 2>&1 || { echo "quick-ui: missing $1 (use the pinned chronicle development shell)" >&2; return 1; }; }
for tool in node npm initdb pg_ctl psql curl; do need "$tool"; done
# A selected port must belong to this disposable preview, never an existing app.
node --input-type=module - "$PORT" "$BIND" "$PGPORT" <<'JS'
import { createServer } from 'node:net';
for (const [port, host] of [[Number(process.argv[2]), process.argv[3]], [Number(process.argv[4]), '127.0.0.1']]) {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', () => reject(new Error('quick-ui: selected port is unavailable; refusing to contact an existing listener')));
    socket.listen(port, host, () => socket.close(resolve));
  });
}
JS
WORK="$(mktemp -d "${TMPDIR:-/tmp}/haystack-ui.XXXXXX")"
SRVPID=""
PG_STARTED=0
PG_START_UNCERTAIN=0
LOCK_HELD=0
cleanup() {
  if [[ -n "$SRVPID" ]]; then
    kill "$SRVPID" 2>/dev/null || true
    local deadline=$((SECONDS + 15))
    while kill -0 "$SRVPID" 2>/dev/null && ((SECONDS < deadline)); do sleep 0.1; done
    if kill -0 "$SRVPID" 2>/dev/null; then echo 'quick-ui: server exceeded graceful shutdown deadline' >&2; kill -KILL "$SRVPID" 2>/dev/null || true; fi
    wait "$SRVPID" 2>/dev/null || true
  fi
  local stopped=1
  if [[ "$PG_START_UNCERTAIN" == 1 ]]; then stopped=0; fi
  if [[ "$PG_STARTED" == 1 ]] && ! pg_ctl -D "$PGDATA" -m fast -t 15 stop >/dev/null 2>&1; then
    echo "quick-ui: database shutdown unconfirmed; preserve and inspect $STATE_DIR" >&2
    stopped=0
  fi
  if [[ "$LOCK_HELD" == 1 && "$stopped" == 1 ]]; then rmdir -- "$STATE_DIR/launcher.lock" || echo "quick-ui: launcher lock cleanup failed: $STATE_DIR/launcher.lock" >&2; fi
  if [[ "$stopped" == 1 ]]; then rm -rf -- "$WORK";
  else echo "quick-ui: shutdown/startup ownership uncertain; retain $STATE_DIR and temporary logs/socket $WORK for operator inspection" >&2; fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
cd "$HAYSTACK_DIR"
umask 077
STATE_DIR="$REPO_DIR/debug/haystack-ui/$PORT"
node web/tests-browser/preview-state.mjs "$STATE_DIR" "$PORT" "$REPO_DIR"
if ! mkdir -m 700 -- "$STATE_DIR/launcher.lock"; then echo "quick-ui: preview is already running or its lock needs operator inspection: $STATE_DIR/launcher.lock" >&2; exit 2; fi
LOCK_HELD=1
if [[ ! -f web/dist/index.html ]] || [[ -n "$(find web/src generated/typescript web/index.html web/vite.config.ts web/package.json package-lock.json ../shared/account-web -type f -newer web/dist/index.html -print -quit 2>/dev/null)" ]]; then
  echo 'quick-ui: building browser…' >&2
  [[ -d node_modules ]] || npm ci --offline --no-audit --no-fund >&2
  npm run build -w web >&2
fi
export PGDATA="$STATE_DIR/pg" PGSOCK="$WORK/sock"
mkdir -p "$PGSOCK"
if [[ ! -f "$PGDATA/PG_VERSION" ]]; then initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null; fi
if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then echo 'quick-ui: retained database is already running; refusing to adopt it' >&2; exit 2; fi
PG_START_UNCERTAIN=1
if ! pg_ctl -D "$PGDATA" -l "$WORK/pg.log" -o "-k $PGSOCK -p $PGPORT -c listen_addresses='127.0.0.1'" start >/dev/null; then
  echo 'quick-ui: database startup unconfirmed; refusing stop authority' >&2; exit 1
fi
PG_STARTED=1
PG_START_UNCERTAIN=0
if [[ "$(psql -XAt -v ON_ERROR_STOP=1 -h "$PGSOCK" -p "$PGPORT" -U postgres -c "SELECT 1 FROM pg_roles WHERE rolname = 'haystack_preview'")" != 1 ]]; then
  psql -X -v ON_ERROR_STOP=1 -h "$PGSOCK" -p "$PGPORT" -U postgres -c 'CREATE ROLE haystack_preview LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;' >/dev/null
fi
if [[ "$(psql -XAt -v ON_ERROR_STOP=1 -h "$PGSOCK" -p "$PGPORT" -U postgres -c "SELECT 1 FROM pg_roles WHERE rolname = 'haystack_preview' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication")" != 1 ]]; then
  echo 'quick-ui: retained runtime role is not least-privilege; refusing startup' >&2; exit 2
fi
if [[ "$(psql -XAt -v ON_ERROR_STOP=1 -h "$PGSOCK" -p "$PGPORT" -U postgres -c "SELECT 1 FROM pg_database WHERE datname = 'haystack'")" != 1 ]]; then
  psql -X -v ON_ERROR_STOP=1 -h "$PGSOCK" -p "$PGPORT" -U postgres -c 'CREATE DATABASE haystack OWNER haystack_preview;' >/dev/null
fi
# Extension installation is an explicit owned-cluster administrator operation;
# the selected application runtime remains NOSUPERUSER/NOCREATEDB.
psql -X -v ON_ERROR_STOP=1 -h "$PGSOCK" -p "$PGPORT" -U postgres -d haystack -c 'CREATE EXTENSION IF NOT EXISTS vector;' >/dev/null
node --input-type=module - "$STATE_DIR/token.txt" "$WORK/token.sha" <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await writeFile(process.argv[3], createHash('sha256').update((await readFile(process.argv[2], 'utf8')).trimEnd(), 'ascii').digest('hex') + '\n', { mode: 0o600 });
JS
printf 'unused-preview-password\n' > "$WORK/database-password"
LANIP="$( (ip -4 route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || hostname -I 2>/dev/null | awk '{print $1}' || true) | head -1)"
node --input-type=module - "$WORK" "$PORT" "$BIND" "$PGPORT" "$HAYSTACK_DIR/web/dist" "$LANIP" "$STATE_DIR" <<'JS'
import { writeFile } from 'node:fs/promises';
const [dir, port, bind, pgport, webRoot, lan, state] = process.argv.slice(2);
const hosts = [...new Set(['127.0.0.1', 'localhost', bind, ...(bind !== '127.0.0.1' && lan ? [lan] : [])])];
const origins = hosts.map(h => `http://${h}:${port}`);
const config = {
  listenHost: bind, listenPort: Number(port), webRoot, authReloadMs: 1000,
  auth: { activityProjectId: 'demo', users: [{id:'op',type:'human',displayName:'Op',enabled:true,login:'op',passwordHashFile:`${state}/password.hash`,tokens:[{id:'seed',hashFile:`${dir}/token.sha`}]}],
    cookieSecure: true, allowedHosts: hosts, allowedOrigins: origins, insecureHttpOrigins: origins,
    rateLimit: {windowMs:60000,max:600} },
  database: {jdbcUrl:`jdbc:postgresql://127.0.0.1:${pgport}/haystack`,user:'haystack_preview',passwordFile:`${dir}/database-password`,
    limits:{maxConnections:4,maxQueued:32,queueTimeoutMs:5000,connectTimeoutMs:5000,statementTimeoutMs:30000,lockTimeoutMs:5000,idleTransactionTimeoutMs:30000,socketTimeoutMs:40000}},
  retrieval: {policy:'operator-approved-metadata-v1',includeMetadata:true,approvedFieldPrefixes:[],maxChunkBytes:8192,embedding:null,maxConcurrent:2,maxQueued:8,batchSize:4},
};
await writeFile(`${dir}/config.json`, JSON.stringify(config), {mode:0o600});
JS
bash -c "exec ${HAYSTACK_SERVER_COMMAND} \"\$@\"" haystack-server serve "$WORK/config.json" > "$WORK/server.log" 2>&1 &
SRVPID=$!
READY=0
for _ in $(seq 1 300); do
  if grep -qx "haystack: ready" "$WORK/server.log" && curl -sf "http://127.0.0.1:$PORT/api/v1/health" >/dev/null 2>&1; then READY=1; break; fi
  if ! kill -0 "$SRVPID" 2>/dev/null; then break; fi
  sleep 0.2
done
if [[ "$READY" != 1 ]]; then echo 'quick-ui: server never became ready:' >&2; cat "$WORK/server.log" >&2; exit 1; fi
# Seed exclusively through current generated codecs and authenticated public API.
node --import ./scripts/register-generated.mjs --input-type=module - "$PORT" "$STATE_DIR/token.txt" <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publicClient } from './web/tests-browser/native.mjs';
import { BaboonCodecContext } from './generated/typescript/BaboonSharedRuntime.ts';
import { GetRequest, Item } from './generated/typescript/haystack/api/index.ts';
const base = `http://127.0.0.1:${process.argv[2]}`;
const token = (await readFile(process.argv[3], 'utf8')).trimEnd();
const client = publicClient(base, token);
const doc = (over) => JSON.stringify({title:'Hello haystack',description:'Try editing me, then check history.',fields:{},type:'fact',status:'actual',importance:'high','human-attention':'cleared',links:[],tags:[],...over});
const rows = [
  ['demo:hello',doc({}).replace('"fields":{}','"fields":{"n":9007199254740993}')],
  ['demo:todo',doc({title:'Needs a human',type:'todo','human-attention':'required',links:[['related-to','demo:hello']]})],
  ['demo:old',doc({title:'Buried one',status:'archived',importance:'low'})],
];
for (let i=0;i<rows.length;i++) {
  const response = await fetch(`${base}/api/v1/get`, { method:'POST', signal:AbortSignal.timeout(15000), headers:{'Content-Type':'application/json','X-Haystack-Version':'1.0.0',Authorization:`Bearer ${token}`}, body:JSON.stringify(GetRequest.jsonCodec().encode(BaboonCodecContext.Default,new GetRequest(rows[i][0],undefined))) });
  if (response.status === 404) await client.put({key:rows[i][0],documentJson:rows[i][1],expectedRevision:0,requestId:`0193e8d5-6f5c-7a1b-8c2d-${String(501+i).padStart(12,'0')}`});
  else { assert.equal(response.status,200,'preview seed lookup failed'); Item.jsonCodec().decode(BaboonCodecContext.Default,await response.json()); }
}
JS
echo
echo "  UI (this host):  http://127.0.0.1:$PORT/#/browse"
if [[ "$BIND" != "127.0.0.1" && -n "$LANIP" ]]; then echo "  UI (other hosts): http://$LANIP:$PORT/#/browse"; fi
echo '  Username: op'
echo "  Password: $(cat "$STATE_DIR/password.txt")"
echo "  Saved:    $STATE_DIR (private credentials, demo data and sessions retained)"
echo '  WARNING: no TLS; URL + password grants full access. Local testing only.'
echo '  Stop: Ctrl-C (server and database stop; private preview state is retained)'
echo
wait "$SRVPID"
