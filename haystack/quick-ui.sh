#!/usr/bin/env bash
# Disposable PostgreSQL + the selected Scala/native executable + built UI.
# HAYSTACK_SERVER_COMMAND='java -jar /absolute/haystack-server.jar' ./quick-ui.sh [port] [bind]
# No TypeScript/Node server fallback. Node is only a build/fixture client tool.
set -euo pipefail
HAYSTACK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-47328}"
BIND="${2:-127.0.0.1}"
[[ "$PORT" =~ ^[0-9]+$ && "$PORT" -ge 1 && "$PORT" -le 65435 ]] || { echo 'quick-ui: invalid port' >&2; exit 2; }
: "${HAYSTACK_SERVER_COMMAND:?select the Scala/native executable (a shell command accepting serve CONFIG.json)}"
PGPORT="$((PORT + 100))"
need() { command -v "$1" >/dev/null 2>&1 || { echo "quick-ui: missing $1 (use the pinned chronicle development shell)" >&2; return 1; }; }
for tool in node npm initdb pg_ctl psql curl; do need "$tool"; done
# A selected port must belong to this disposable preview, never an existing app.
node --input-type=module - "$PORT" "$BIND" <<'JS'
import { createServer } from 'node:net';
const socket = createServer();
socket.once('error', () => { console.error('quick-ui: selected port is unavailable; refusing to contact an existing listener'); process.exitCode = 2; });
socket.listen(Number(process.argv[2]), process.argv[3], () => socket.close());
JS
WORK="$(mktemp -d "${TMPDIR:-/tmp}/haystack-ui.XXXXXX")"
SRVPID=""
cleanup() {
  if [[ -n "${SRVPID:-}" ]]; then kill "$SRVPID" 2>/dev/null || true; wait "$SRVPID" 2>/dev/null || true; fi
  if [[ -d "$WORK/pg" ]]; then pg_ctl -D "$WORK/pg" -m fast stop >/dev/null 2>&1 || true; fi
  rm -rf -- "$WORK"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
cd "$HAYSTACK_DIR"
if [[ ! -f web/dist/index.html ]] || [[ -n "$(find web/src generated/typescript web/index.html web/vite.config.ts web/package.json package-lock.json -type f -newer web/dist/index.html -print -quit 2>/dev/null)" ]]; then
  echo 'quick-ui: building browser…' >&2
  [[ -d node_modules ]] || npm ci --offline --no-audit --no-fund >&2
  npm run build -w web >&2
fi
umask 077
export PGDATA="$WORK/pg" PGSOCK="$WORK/sock"
mkdir -p "$PGSOCK"
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null
pg_ctl -D "$PGDATA" -l "$WORK/pg.log" -o "-k $PGSOCK -p $PGPORT -c listen_addresses='127.0.0.1'" start >/dev/null
psql -h "$PGSOCK" -p "$PGPORT" -U postgres -c 'CREATE ROLE haystack_preview LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;' >/dev/null
psql -h "$PGSOCK" -p "$PGPORT" -U postgres -c 'CREATE DATABASE haystack OWNER haystack_preview;' >/dev/null
# Extension installation is an explicit owned-cluster administrator operation;
# the selected application runtime remains NOSUPERUSER/NOCREATEDB.
psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d haystack -c 'CREATE EXTENSION IF NOT EXISTS vector;' >/dev/null
TOKEN_FILE="$HAYSTACK_DIR/../debug/haystack-ui/$PORT/token.txt"
mkdir -p -- "$(dirname -- "$TOKEN_FILE")"
TOKEN="$(node --input-type=module - "$TOKEN_FILE" <<'JS'
import { writeFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const file = process.argv[2];
try { await writeFile(file, randomBytes(32).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const token = (await readFile(file, 'utf8')).replace(/\n$/, '');
if (!/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token, 'base64url').toString('base64url') !== token) throw new Error('Invalid saved preview token');
process.stdout.write(token);
JS
)"
chmod 600 -- "$TOKEN_FILE"
printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1 > "$WORK/token.sha"
printf 'unused-preview-password\n' > "$WORK/database-password"
LANIP="$( (ip -4 route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || hostname -I 2>/dev/null | awk '{print $1}' || true) | head -1)"
node --input-type=module - "$WORK" "$PORT" "$BIND" "$PGPORT" "$HAYSTACK_DIR/web/dist" "$LANIP" <<'JS'
import { writeFile } from 'node:fs/promises';
const [dir, port, bind, pgport, webRoot, lan] = process.argv.slice(2);
const hosts = [...new Set(['127.0.0.1', 'localhost', bind, ...(bind !== '127.0.0.1' && lan ? [lan] : [])])];
const origins = hosts.map(h => `http://${h}:${port}`);
const config = {
  listenHost: bind, listenPort: Number(port), webRoot, authReloadMs: 1000,
  auth: { activityProjectId: 'demo', users: [{id:'op',type:'human',displayName:'Op',tokens:[{id:'browser',hashFile:`${dir}/token.sha`}]}],
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
TOKEN="$TOKEN" node --import ./scripts/register-generated.mjs --input-type=module - "$PORT" <<'JS'
import { publicClient } from './web/tests-browser/native.mjs';
const client = publicClient(`http://127.0.0.1:${process.argv[2]}`, process.env.TOKEN);
const doc = (over) => JSON.stringify({title:'Hello haystack',description:'Try editing me, then check history.',fields:{},type:'fact',status:'actual',importance:'high','human-attention':'cleared',links:[],tags:[],...over});
const rows = [
  ['demo:hello',doc({}).replace('"fields":{}','"fields":{"n":9007199254740993}')],
  ['demo:todo',doc({title:'Needs a human',type:'todo','human-attention':'required',links:[['related-to','demo:hello']]})],
  ['demo:old',doc({title:'Buried one',status:'archived',importance:'low'})],
];
for (let i=0;i<rows.length;i++) await client.put({key:rows[i][0],documentJson:rows[i][1],expectedRevision:0,requestId:`0193e8d5-6f5c-7a1b-8c2d-${String(501+i).padStart(12,'0')}`});
JS
echo
echo "  UI (this host):  http://127.0.0.1:$PORT/#/browse"
if [[ "$BIND" != "127.0.0.1" && -n "$LANIP" ]]; then echo "  UI (other hosts): http://$LANIP:$PORT/#/browse"; fi
echo "  Token:   $TOKEN"
echo "  Saved:   $TOKEN_FILE (retained across launches)"
echo '  WARNING: no TLS; URL + token grants full access. Throwaway testing only.'
echo '  Stop: Ctrl-C (server, database and demo data removed; token retained)'
echo
wait "$SRVPID"
