#!/usr/bin/env bash
# Claim-order observability: the existing replies and an older CLI, on demand. Base = main fe4f69f7 (before the claim
# order). On one owned database, servers run serve-standby (no workers: no job changes state) one after the other:
#   base server: two owners' synthetic jobs in the stored states the claim order reads (planted with SQL), and the raw
#     replies of the existing reads — Activity and ActivityJobs over the browser WebSocket (sorts, scopes, filters, a
#     page and its continuation, both owners) and ActivityJobs / PreviewRetryFailed over POST /api/jobs/v1 — recorded;
#   tree server with indexing.claimOrder "source-id" (flag OFF; its start applies migration 033 and the start fill), then
#     "waiting" (flag ON): the same requests answer byte-identical replies (status, the windows header and the body; only
#     the observation instant `observedAt` differs between reads);
#   base CLI (fe4f69f7) × tree server, both orders: activity, jobs, rpc Activity and ActivityJobs, retry-failed preview
#     (session and bearer), jobs --auth bearer, and with the flag ON jobs retry (session and bearer) — all succeed, none
#     answers protocol-error.
# From the repository root, inside the development shell (node for the WebSocket client):
#
#   nix develop .#chronicle --command env \
#   CHRONICLE_SERVER="$(nix build --no-link --print-out-paths .#chronicle.nativeArtifact)/libexec/chronicle-server" \
#   BASE_SERVER="$(nix build --no-link --print-out-paths "git+file://$PWD?rev=fe4f69f75c8f904473ddcb1c1fd6c8a21dcbda6e#chronicle.nativeArtifact")/libexec/chronicle-server" \
#   BASE_CLI="$(nix build --no-link --print-out-paths "git+file://$PWD?rev=fe4f69f75c8f904473ddcb1c1fd6c8a21dcbda6e#chronicle-cli")/bin/chronicle" \
#   "$(nix build --no-link --print-out-paths .#service-test-fixture-tools)/bin/with-service-postgres" \
#     bash chronicle/scripts/test-claim-order-compat.sh
#
# Synthetic home, sessions and credentials in a private temporary directory; each server is stopped on exit.
set -euo pipefail
: "${CHRONICLE_SERVER:?set CHRONICLE_SERVER to the server executable built from this tree}"
: "${BASE_SERVER:?set BASE_SERVER to the server executable built from fe4f69f7}"
: "${BASE_CLI:?set BASE_CLI to the chronicle CLI built from fe4f69f7}"
: "${PONYGIRLS_OWNED_FIXTURE_ROOT:?run via the owned with-service-postgres wrapper}"
command -v node >/dev/null || { echo 'node (the development shell) is required for the WebSocket client' >&2; exit 2; }
command -v psql >/dev/null || { echo 'psql (the with-service-postgres wrapper) is required' >&2; exit 2; }
cd "$(dirname "$0")/../.."
exec python3 -c "$(cat <<'PY'
import hashlib, json, os, re, secrets, signal, socket, subprocess, tempfile, time, urllib.error, urllib.parse, urllib.request, uuid
from pathlib import Path

TREE_SERVER = Path(os.environ['CHRONICLE_SERVER']).resolve(strict=True)
BASE_SERVER, BASE_CLI = Path(os.environ['BASE_SERVER']).resolve(strict=True), Path(os.environ['BASE_CLI']).resolve(strict=True)
OWNED = Path(os.environ['PONYGIRLS_OWNED_FIXTURE_ROOT']).resolve(strict=True)
assert (OWNED / '.owned-test-only').read_text() == 'ponygirls-owned-test-v1\n'
DATABASE = json.loads(os.environ['PONYGIRLS_TEST_DATABASE_CHRONICLE'])
assert Path(DATABASE['passwordFile']).resolve(strict=True).is_relative_to(OWNED)
JDBC = re.fullmatch(r'jdbc:postgresql://(127\.0\.0\.1):(\d+)/([A-Za-z0-9_]+)', DATABASE['jdbcUrl'])
assert JDBC is not None, 'an owned loopback database'
READY_SECONDS = 90
WINDOWS = 'X-Chronicle-Windows-To-Annotate'
checks = []


def check(label, condition, detail=''):
    if not condition:
        raise AssertionError(f'{label}: {detail}')
    checks.append(label)
    print('ok -', label, flush=True)


def sql(statement):
    env = dict(os.environ, PGPASSWORD=Path(DATABASE['passwordFile']).read_text().strip())
    return subprocess.run(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-h', JDBC.group(1), '-p', JDBC.group(2), '-U', DATABASE['user'], '-d', JDBC.group(3), '-c', statement],
                          env=env, capture_output=True, text=True, check=True, timeout=60).stdout


def ingest_request(name, text, namespace='claim-order-compat'):
    records = [{'type': 'session', 'version': 3, 'id': name, 'timestamp': '2026-11-23T00:00:00.000Z'},
               {'type': 'message', 'id': name + '-1', 'parentId': name, 'timestamp': '2026-11-23T00:00:01.000Z',
                'message': {'role': 'user', 'content': [{'type': 'text', 'text': text}]}}]
    content = ''.join(json.dumps(r, separators=(',', ':')) + '\n' for r in records)
    sha = hashlib.sha256(content.encode()).hexdigest()
    return dict(requestId=str(uuid.uuid4()), source=dict(collectorNamespace=namespace, discoveryRootId='claim-order-compat', format='Pi', producerSessionId=name, subagentId=None),
                metadata=dict(title=name, project='compat', workdir=None, gitRemote=None, gitBranch='main', gitCommit=None, producer='claim-order-compat', model=None, startedAt=None, endedAt=None, tags=['synthetic']),
                expectedRevision=0, digest=sha, completion='Quiescent', redacted=False,
                messages=[dict(id=name + '-1', parentId=None, role='user', text=text, timestamp='2026-11-23T00:00:01.000Z', recordIndex=1)],
                files=[dict(path=name + '.jsonl', sha256=sha, content=content)])


class Server:
    def __init__(self, root, label, binary, config, env):
        self.label = label
        self.log = (root / f'{label}.log').open('x')
        self.process = subprocess.Popen([str(binary), 'serve-standby', str(config)], env=env, stdin=subprocess.DEVNULL, stdout=self.log,
                                        stderr=subprocess.STDOUT, start_new_session=True)
        origin = json.loads(config.read_text())['allowedOrigin']
        deadline = time.monotonic() + READY_SECONDS
        while True:
            assert self.process.poll() is None, f'the {label} server exited during start'
            try:
                with urllib.request.urlopen(origin + '/api/versions', timeout=1) as response:
                    if response.status == 200:
                        return
            except OSError:
                pass
            assert time.monotonic() < deadline, f'{label} server readiness'
            time.sleep(0.1)

    def stop(self):
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGTERM)
            try:
                self.process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=5)
        self.log.close()


def post(origin, path, body, headers):
    request = urllib.request.Request(origin + path, method='POST', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', **headers})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as failure:
        return failure.code, dict(failure.headers), failure.read()


# The browser transport: Hello, then each envelope in turn; a server Ping is answered. Prints the raw reply texts.
WS_CLIENT = r'''
const [origin, cookie, input] = process.argv.slice(1);
const envelopes = JSON.parse(input), replies = [];
const socket = new WebSocket(origin.replace(/^http/, 'ws') + '/api/ws', { headers: { Origin: origin, Cookie: 'chronicle_session=' + cookie } });
let next = -1, hello = crypto.randomUUID();
const timer = setTimeout(() => { console.error('WebSocket deadline'); process.exit(3); }, 60000);
function send() {
  next += 1;
  if (next === envelopes.length) { clearTimeout(timer); socket.close(1000); process.stdout.write(JSON.stringify(replies)); return; }
  socket.send(JSON.stringify(envelopes[next]));
}
socket.onopen = () => socket.send(JSON.stringify({ requestId: hello, operation: { Hello: { versions: ['1.9.0'] } } }));
socket.onmessage = event => {
  const text = String(event.data), value = JSON.parse(text);
  if (value.result && value.result.Ping) { socket.send(JSON.stringify({ requestId: value.requestId, operation: { Pong: { nonce: value.result.Ping.nonce } } })); return; }
  if (value.requestId === hello) { if (!value.result.Hello) { console.error(text); process.exit(4); } send(); return; }
  if (next < 0 || value.requestId !== envelopes[next].requestId) { console.error('unexpected ' + text); process.exit(5); }
  replies.push(text); send();
};
socket.onerror = () => { console.error('WebSocket failed'); process.exit(6); };
socket.onclose = event => { if (next < envelopes.length) { console.error('closed ' + event.code); process.exit(7); } };
'''


def main():
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='chronicle-claim-order-compat-') as temporary:
        root = Path(temporary)
        env = {k: v for k, v in os.environ.items() if not k.startswith('CHRONICLE_') and k not in ('NODE_OPTIONS', 'NODE_PATH')}
        env.update(HOME=str(root / 'home'))
        (root / 'home').mkdir()
        password = 'synthetic-claim-order-compat'
        (root / 'password').write_text(password + '\n')
        (root / 'password-hash').write_text(subprocess.run([str(TREE_SERVER), 'password-hash'], input=password + '\n', text=True,
                                                            capture_output=True, check=True, timeout=30).stdout)
        (root / 'empty-credential').write_text('')
        secret = {}
        for name in ('ingest-alice', 'ingest-bob', 'operator'):
            secret[name] = secrets.token_urlsafe(32)
            (root / f'{name}-token').write_text(secret[name] + '\n')
        token_ids = {name: str(uuid.uuid4()) for name in secret}
        with socket.socket() as candidate:
            candidate.bind(('127.0.0.1', 0))
            port = candidate.getsockname()[1]
        origin = f'http://127.0.0.1:{port}'

        def config(label, claim_order):
            value = json.loads(Path('chronicle/config.example.json').read_text())
            value.update(listenPort=port, allowedOrigin=origin, secureCookies=False, allowInsecureHttp=False,
                         jdbcUrl=DATABASE['jdbcUrl'], databaseUser=DATABASE['user'], databasePasswordFile=DATABASE['passwordFile'], databaseLimits=DATABASE['limits'],
                         users=[dict(id=u, login=u, passwordHashFile=str(root / 'password-hash'), enabled=True) for u in ('alice', 'bob')],
                         staticTokens=[dict(id=token_ids['ingest-alice'], userId='alice', name='compat-ingest-alice', scopes=['Ingest'], tokenFile=str(root / 'ingest-alice-token')),
                                       dict(id=token_ids['ingest-bob'], userId='bob', name='compat-ingest-bob', scopes=['Ingest'], tokenFile=str(root / 'ingest-bob-token')),
                                       dict(id=token_ids['operator'], userId='alice', name='compat-operator', scopes=['Read', 'OperateJobs'], tokenFile=str(root / 'operator-token'))])
            if claim_order is not None:
                value['indexing'].update(claimOrder=claim_order, annotationSessions=4, bulkLanes=1)
            value['annotation'].update(endpoint='http://127.0.0.1:1/chat', credentialFile=str(root / 'empty-credential'))
            value['embedding'].update(endpoint='http://127.0.0.1:1/embed', credentialFile=str(root / 'empty-credential'), dimensions=3)
            path = root / f'{label}.json'
            path.write_text(json.dumps(value))
            return path

        def login(user):
            status, headers, body = post(origin, '/api/login', {'login': user, 'password': password}, {'Origin': origin})
            assert status == 200, (status, body)
            cookie = re.search(r'chronicle_session=([^;]+)', headers.get('Set-Cookie', ''))
            assert cookie is not None, headers
            return cookie.group(1)

        def ws(user, envelopes):
            result = subprocess.run(['node', '--input-type=module', '-e', WS_CLIENT, origin, login(user), json.dumps(envelopes)], capture_output=True, text=True, timeout=120, env=env)
            assert result.returncode == 0, f'WebSocket client: {result.returncode} {result.stderr}'
            return json.loads(result.stdout)

        def cli(state, *args, token=None, stdin=None):
            selected = dict(env, CHRONICLE_STATE_DIR=str(root / state))
            if token is not None:
                selected['CHRONICLE_TOKEN_FILE'] = str(token)
            return subprocess.run([str(BASE_CLI), '--url', origin, '--allow-insecure-http', *args, '--json'], input=stdin, capture_output=True, text=True, timeout=120, env=selected)

        def base_cli_succeeds(label, state, *args, token=None, stdin=None):
            result = cli(state, *args, token=token, stdin=stdin)
            shown = ' '.join(a for a in args if not a.startswith('/')) + ('' if stdin is None else ' ' + next(iter(json.loads(stdin))))
            check(f'base CLI × tree server ({label}): {shown}', result.returncode == 0 and 'protocol' not in result.stderr.lower(),
                  f'exit {result.returncode} {result.stderr}')
            return json.loads(result.stdout)

        # The recorded requests: fixed request ids, so that a reply's bytes are comparable between servers.
        def envelope(operation):
            return {'requestId': str(uuid.uuid5(uuid.NAMESPACE_URL, json.dumps(operation, sort_keys=True))), 'operation': operation}

        def jobs(scope='All', sort='JobId', direction='Asc', expression='', cursor=None, limit=100):
            return {'ActivityJobs': {'query': {'collectorId': None, 'scope': scope, 'expression': expression, 'sort': sort, 'direction': direction, 'cursor': cursor, 'limit': limit}}}

        def activity(sort='CollectorId', direction='Asc', expression='', cursor=None, limit=100):
            return {'Activity': {'query': {'expression': expression, 'sort': sort, 'direction': direction, 'cursor': cursor, 'limit': limit}}}

        sorts = ['LastTimestamp', 'Title', 'Collector', 'State', 'Revision', 'Profile', 'Attempts', 'CompletedWindows', 'TotalWindows', 'LeaseExpiresAt', 'LeaseState', 'Reason', 'Classification', 'JobId', 'SessionId']
        requests = [activity(), activity('CurrentTotal', 'Desc', limit=1), activity('HistoricalTotal', 'Asc', 'freshness:"unknown"')]
        requests += [jobs(sort=s) for s in sorts] + [jobs(sort=s, direction='Desc') for s in ('LastTimestamp', 'LeaseState', 'Title')]
        requests += [jobs('Current', 'LastTimestamp', 'Desc'), jobs('Historical'), jobs(expression='status:"failed"'), jobs(expression='lease:"expired"'), jobs(expression='lease:"unleased"'), jobs('Current', limit=2), jobs('Current', 'Title', limit=2)]
        bearer = [envelope(jobs('Current', 'LastTimestamp', 'Desc')), envelope(jobs(sort='LeaseState', limit=3)), envelope({'PreviewRetryFailed': {}})]

        def record(label):
            replies = {}
            for user in ('alice', 'bob'):
                first = [envelope(r) for r in requests]
                answers = ws(user, first)
                # The continuation pages, with the cursors of this reply (the base's cursors must be the tree's).
                follow = []
                for request, answer in zip(first, answers):
                    result = next(iter(json.loads(answer)['result'].values()))['result']
                    if result.get('nextCursor') is not None:
                        operation = json.loads(json.dumps(request['operation']))
                        next(iter(operation.values()))['query']['cursor'] = result['nextCursor']
                        follow.append(envelope(operation))
                check(f'{label}: {user} pages with a continuation', len(follow) >= (3 if user == 'alice' else 2), len(follow))
                answers += ws(user, follow)
                for request, answer in zip(first + follow, answers):
                    replies[(user, json.dumps(request['operation'], sort_keys=True))] = answer
            for request in bearer:
                status, headers, body = post(origin, '/api/jobs/v1', request, {'Authorization': f'Bearer {secret["operator"]}'})
                replies[('bearer', json.dumps(request['operation'], sort_keys=True))] = f'{status} {WINDOWS}: {headers.get(WINDOWS)}\n' + body.decode()
            return replies

        observed = re.compile(r'"observedAt":"[^"]*"')

        def same(label, base, tree):
            check(f'{label}: the same {len(base)} requests', base.keys() == tree.keys(), sorted(set(base) ^ set(tree))[:3])
            different = [key for key in base if observed.sub('"observedAt":"…"', base[key]) != observed.sub('"observedAt":"…"', tree[key])]
            for key in different[:3]:
                print('   base:', base[key][:1500], '\n   tree:', tree[key][:1500], flush=True)
            check(f'{label}: every reply byte-identical to the base server\'s ({len(base)} replies; observedAt aside)', not different, [k[1][:120] for k in different[:5]])

        servers = []
        try:
            # Base server: the synthetic jobs and the recorded replies.
            servers.append(Server(root, 'base', BASE_SERVER, config('base', None), env))
            sessions = {}
            for owner, names in (('alice', [f'a{n}' for n in range(1, 10)]), ('bob', ['b1', 'b2', 'b3'])):
                for name in names:
                    # Two collectors for alice, so that the collector list has a second page.
                    namespace = 'claim-order-compat-2' if name in ('a5', 'a6', 'a7', 'a8', 'a9') else 'claim-order-compat'
                    status, _, body = post(origin, '/api/ingest', ingest_request(name, f'synthetic claim-order compatibility {name}', namespace), {'Authorization': f'Bearer {secret["ingest-" + owner]}'})
                    check(f'base server: {name} is ingested', status == 200, body)
                    sessions[name] = json.loads(body)
            # A second revision of a9: its first job becomes historical.
            second = ingest_request('a9', 'synthetic claim-order compatibility a9, second revision', 'claim-order-compat-2')
            second['expectedRevision'] = 1
            status, _, body = post(origin, '/api/ingest', second, {'Authorization': f'Bearer {secret["ingest-alice"]}'})
            check('base server: a9 revision 2 is ingested', status == 200, body)
            job = {name: receipt['jobId'] for name, receipt in sessions.items()}
            planted = {
                'a1': "state='Running',attempts=1,lease_until='2100-01-01T00:00:00Z'",
                'a2': "state='Running',attempts=2,lease_until='2000-01-01T00:00:00Z'",
                'a3': "state='Running',attempts=1,lease_until=NULL",
                'a4': "state='Queued',attempts=1,lease_until='2100-01-01T00:00:00Z',error='model-http'",
                'a5': "state='Failed',attempts=5,error='synthetic failure',failure_stage='Annotation'",
                'a6': "state='Queued',total_windows=150",
                'a7': "state='Failed',attempts=5,error='synthetic failure'",
                'a8': "state='Running',attempts=5,lease_until='2000-01-01T00:00:00Z',completed_windows=3,total_windows=9",
                'a9': "state='Complete',attempts=1,completed_windows=2,total_windows=2",
                'b2': "state='Running',attempts=1,lease_until='2000-01-01T00:00:00Z'",
                'b3': "state='Failed',attempts=5,error='synthetic failure'",
            }
            for name, assignment in planted.items():
                sql(f"UPDATE ch_jobs SET {assignment} WHERE id='{job[name]}'")
            check('base server: the jobs are planted (Running active/expired/unleased/exhausted, held, failed, sized, complete, historical)', True)
            base = record('base server')
            servers.pop().stop()

            for flag, order in (('OFF', 'source-id'), ('ON', 'waiting')):
                servers.append(Server(root, f'tree-{order}', TREE_SERVER, config(f'tree-{order}', order), env))
                same(f'tree server, claim order {order} (flag {flag})', base, record(f'tree server ({order})'))
                state = f'cli-{order}'
                login_result = cli(state, 'login', '--login', 'alice', '--password-file', str(root / 'password'))
                check(f'base CLI × tree server ({order}): login', login_result.returncode == 0, login_result.stderr)
                listed = base_cli_succeeds(order, state, 'activity')['Activity']['result']
                check(f'base CLI × tree server ({order}): activity counts the planted jobs', listed['current']['total'] == '9', listed['current'])
                listed = base_cli_succeeds(order, state, 'jobs', '--scope', 'All')['ActivityJobs']['result']['jobs']
                check(f'base CLI × tree server ({order}): jobs lists alice\'s ten jobs', len(listed) == 10, len(listed))
                base_cli_succeeds(order, state, 'jobs', '--sort', 'LeaseState', '--ascending')
                base_cli_succeeds(order, state, 'rpc', '--file', '-', stdin=json.dumps(activity('CurrentTotal', 'Desc', limit=1)))
                base_cli_succeeds(order, state, 'rpc', '--file', '-', stdin=json.dumps(jobs('Historical')))
                preview = base_cli_succeeds(order, state, 'retry-failed', 'preview')['RetryFailedPreview']['result']
                check(f'base CLI × tree server ({order}): the preview counts the two current failures', preview['counts']['eligibleCurrentFailed'] == '2', preview['counts'])
                base_cli_succeeds(order, state, 'retry-failed', 'preview', '--auth', 'bearer', token=root / 'operator-token')
                listed = base_cli_succeeds(order, state, 'jobs', '--auth', 'bearer', token=root / 'operator-token')['ActivityJobs']['result']['jobs']
                check(f'base CLI × tree server ({order}): jobs --auth bearer lists the current jobs', len(listed) == 9, len(listed))
                if flag == 'ON':
                    base_cli_succeeds(order, state, 'jobs', 'retry', job['a5'], '--yes')
                    base_cli_succeeds(order, state, 'jobs', 'retry', job['a7'], '--auth', 'bearer', '--yes', token=root / 'operator-token')
                    states = sql(f"SELECT string_agg(state,',' ORDER BY id) FROM ch_jobs WHERE id IN ('{job['a5']}','{job['a7']}')").strip()
                    check('base CLI × tree server: both retries re-queued their jobs', states == 'Queued,Queued', states)
                servers.pop().stop()
        except BaseException:
            for log in sorted(root.glob('*.log')):
                print(f'--- {log.name} (tail)', log.read_text()[-3000:], sep='\n', flush=True)
            raise
        finally:
            for server in servers:
                server.stop()
    print(json.dumps(dict(status='passed', checks=len(checks), treeServer=str(TREE_SERVER), baseServer=str(BASE_SERVER), baseCli=str(BASE_CLI))), flush=True)


main()
PY
)"
