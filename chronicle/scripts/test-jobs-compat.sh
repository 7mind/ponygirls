#!/usr/bin/env bash
# Job operations for tokens (R-f), compatibility and rollback, on demand. Base = main dca197e2 (before R-f). On one owned
# database, servers run serve-standby one after the other:
#   tree server, owner opted in: tokens with OperateJobs (configured and issued), a WS-minted typed token with its receipt,
#     a token RetryJob receipt; base CLI × tree server: settings, tokens list/mint/revoke (the scoped and an unrelated
#     token), whoami --auth bearer with a scoped token — all unchanged (typed scopes only, no header);
#   base server, same configuration: refuses to start (OperateJobs is not a scope it knows);
#   base server, OperateJobs removed from configuration (the rollback): starts, keeps the configured token's id and
#     creation time, lists tokens, revokes an issued scoped token, reads both receipts, accepts the scoped tokens as Read,
#     answers /api/jobs/v1 with a 404 without a Failure body; tree CLI × base server: the job commands with --auth bearer
#     exit 6 with the old-server text (also the mutations: definitive, not uncertain), a mint of OperateJobs exits 2;
#   tree server again: the configured token's OperateJobs follows configuration (refused without it, admitted with it),
#     the revoked token stays revoked.
# From the repository root:
#
#   CHRONICLE_SERVER="$(nix build --no-link --print-out-paths .#chronicle.nativeArtifact)/libexec/chronicle-server" \
#   CHRONICLE_CLI="$(nix build --no-link --print-out-paths .#chronicle-cli)/bin/chronicle" \
#   BASE_SERVER="$(nix build --no-link --print-out-paths "git+file://$PWD?rev=dca197e25268990242b036c1f39941798717eba0#chronicle.nativeArtifact")/libexec/chronicle-server" \
#   BASE_CLI="$(nix build --no-link --print-out-paths "git+file://$PWD?rev=dca197e25268990242b036c1f39941798717eba0#chronicle-cli")/bin/chronicle" \
#   "$(nix build --no-link --print-out-paths .#service-test-fixture-tools)/bin/with-service-postgres" \
#     bash chronicle/scripts/test-jobs-compat.sh
#
# Synthetic home, session and credentials in a private temporary directory; each server is stopped on exit.
set -euo pipefail
: "${CHRONICLE_SERVER:?set CHRONICLE_SERVER to the server executable built from this tree}"
: "${CHRONICLE_CLI:?set CHRONICLE_CLI to the chronicle CLI built from this tree}"
: "${BASE_SERVER:?set BASE_SERVER to the server executable built from dca197e2}"
: "${BASE_CLI:?set BASE_CLI to the chronicle CLI built from dca197e2}"
: "${PONYGIRLS_OWNED_FIXTURE_ROOT:?run via the owned with-service-postgres wrapper}"
cd "$(dirname "$0")/../.."
exec python3 -c "$(cat <<'PY'
import hashlib, json, os, secrets, signal, socket, subprocess, tempfile, time, urllib.error, urllib.request, uuid
from pathlib import Path

TREE_SERVER, TREE_CLI = Path(os.environ['CHRONICLE_SERVER']).resolve(strict=True), Path(os.environ['CHRONICLE_CLI']).resolve(strict=True)
BASE_SERVER, BASE_CLI = Path(os.environ['BASE_SERVER']).resolve(strict=True), Path(os.environ['BASE_CLI']).resolve(strict=True)
OWNED = Path(os.environ['PONYGIRLS_OWNED_FIXTURE_ROOT']).resolve(strict=True)
assert (OWNED / '.owned-test-only').read_text() == 'ponygirls-owned-test-v1\n'
DATABASE = json.loads(os.environ['PONYGIRLS_TEST_DATABASE_CHRONICLE'])
assert Path(DATABASE['passwordFile']).resolve(strict=True).is_relative_to(OWNED)
EXIT_USAGE, EXIT_AUTH, EXIT_UNAVAILABLE = 2, 3, 6
PINNED = b'{"code":"forbidden","message":"browser session required"}'
OLD_SERVER = b'This server predates job operations for tokens; use --auth session or upgrade the server.'
READY_SECONDS, REFUSAL_SECONDS = 60, 60
checks = []


def check(label, condition, detail=''):
    if not condition:
        raise AssertionError(f'{label}: {detail}')
    checks.append(label)
    print('ok -', label, flush=True)


def ingest_request():
    records = [{'type': 'session', 'version': 3, 'id': 'jobs-compat', 'timestamp': '2026-11-23T00:00:00.000Z'},
               {'type': 'message', 'id': 'jobs-compat-1', 'parentId': 'jobs-compat', 'timestamp': '2026-11-23T00:00:01.000Z',
                'message': {'role': 'user', 'content': [{'type': 'text', 'text': 'synthetic job operations'}]}}]
    content = ''.join(json.dumps(r, separators=(',', ':')) + '\n' for r in records)
    sha = hashlib.sha256(content.encode()).hexdigest()
    return dict(requestId=str(uuid.uuid4()), source=dict(collectorNamespace='jobs-compat', discoveryRootId='jobs-compat', format='Pi', producerSessionId='jobs-compat', subagentId=None),
                expectedRevision=0, digest=sha, completion='Quiescent', redacted=False,
                metadata=dict(title='jobs-compat', project=None, workdir=None, gitRemote=None, gitBranch=None, gitCommit=None, producer='jobs-compat', model=None, startedAt=None, endedAt=None, tags=[]),
                messages=[dict(id='jobs-compat-1', parentId=None, role='user', text='synthetic job operations', timestamp='2026-11-23T00:00:01.000Z', recordIndex=1)],
                files=[dict(path='jobs-compat.jsonl', sha256=sha, content=content)])


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


def post(origin, path, token, body):
    request = urllib.request.Request(origin + path, method='POST', data=json.dumps(body).encode(),
                                     headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as failure:
        return failure.code, failure.read()


def main():
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='chronicle-jobs-compat-') as temporary:
        root = Path(temporary)
        env = {k: v for k, v in os.environ.items() if not k.startswith('CHRONICLE_') and k not in ('NODE_OPTIONS', 'NODE_PATH')}
        env.update(HOME=str(root / 'home'))
        (root / 'home').mkdir()
        password = 'synthetic-jobs-compat'
        (root / 'password').write_text(password + '\n')
        (root / 'password-hash').write_text(subprocess.run([str(TREE_SERVER), 'password-hash'], input=password + '\n', text=True,
                                                            capture_output=True, check=True, timeout=30).stdout)
        (root / 'empty-credential').write_text('')
        secret = {}
        for name in ('ingest', 'operator'):
            secret[name] = secrets.token_urlsafe(32)
            (root / f'{name}-token').write_text(secret[name] + '\n')
        ingest_id, operator_id = str(uuid.uuid4()), str(uuid.uuid4())

        def config(label, operator_scopes):
            with socket.socket() as candidate:
                candidate.bind(('127.0.0.1', 0))
                port = candidate.getsockname()[1]
            value = json.loads(Path('chronicle/config.example.json').read_text())
            value.update(listenPort=port, allowedOrigin=f'http://127.0.0.1:{port}', secureCookies=False, allowInsecureHttp=False,
                         jdbcUrl=DATABASE['jdbcUrl'], databaseUser=DATABASE['user'], databasePasswordFile=DATABASE['passwordFile'], databaseLimits=DATABASE['limits'],
                         users=[dict(id='alice', login='alice', passwordHashFile=str(root / 'password-hash'), enabled=True)],
                         staticTokens=[dict(id=ingest_id, userId='alice', name='jobs-compat-ingest', scopes=['Ingest'], tokenFile=str(root / 'ingest-token')),
                                       dict(id=operator_id, userId='alice', name='jobs-compat-operator', scopes=operator_scopes, tokenFile=str(root / 'operator-token'))])
            value['annotation'].update(endpoint='http://127.0.0.1:1/chat', credentialFile=str(root / 'empty-credential'))
            value['embedding'].update(endpoint='http://127.0.0.1:1/embed', credentialFile=str(root / 'empty-credential'), dimensions=3)
            path = root / f'{label}.json'
            path.write_text(json.dumps(value))
            return path, value['allowedOrigin']

        def cli(binary, origin, state, *args, token=None):
            selected = dict(env, CHRONICLE_STATE_DIR=str(root / state))
            if token is not None:
                selected['CHRONICLE_TOKEN_FILE'] = str(token)
            return subprocess.run([str(binary), '--url', origin, '--allow-insecure-http', *args], stdin=subprocess.DEVNULL, capture_output=True, timeout=120, env=selected)

        def ok(binary, origin, state, *args, token=None):
            result = cli(binary, origin, state, *args, '--json', token=token)
            assert result.returncode == 0, f'{args}: exit {result.returncode} {result.stderr}'
            return json.loads(result.stdout)

        def login(binary, origin, state):
            ok(binary, origin, state, 'login', '--login', 'alice', '--password-file', str(root / 'password'))

        def listed(binary, origin, state):
            return {t['id']: t for t in ok(binary, origin, state, 'tokens', 'list')['tokens']}

        operator = root / 'operator-token'
        servers = []
        try:
            # Tree server; the owner opts in.
            ops_config, tree = config('tree', ['Read', 'OperateJobs'])
            servers.append(Server(root, 'tree-1', TREE_SERVER, ops_config, env))
            status, body = post(tree, '/api/ingest', secret['ingest'], ingest_request())
            check('a synthetic session is ingested', status == 200, body)
            job = json.loads(body)['jobId']
            login(TREE_CLI, tree, 'tree-cli')
            issued = {}
            for name in ('scoped-a', 'scoped-b'):
                minted = ok(TREE_CLI, tree, 'tree-cli', 'tokens', 'mint', '--name', name, '--scopes', 'Read,OperateJobs', '--secret-out', str(root / name), '--yes')
                issued[name] = minted['token']['id']
                check(f'tree CLI × tree server: an issued token {name} has Read and OperateJobs', minted['token']['scopes'] == ['Read', 'OperateJobs'], minted)
            unrelated = ok(TREE_CLI, tree, 'tree-cli', 'tokens', 'mint', '--name', 'unrelated', '--scopes', 'Read', '--secret-out', str(root / 'unrelated'), '--yes')['token']['id']
            ws_request, retry_request = str(uuid.uuid4()), str(uuid.uuid4())
            minted = subprocess.run([str(TREE_CLI), '--url', tree, '--allow-insecure-http', 'rpc', '--file', '-', '--yes', '--secret-out', str(root / 'ws-typed'), '--request-id', ws_request, '--json'],
                                    input=json.dumps({'MintToken': {'name': 'ws-typed', 'scopes': ['Read']}}).encode(), capture_output=True, timeout=120, env=dict(env, CHRONICLE_STATE_DIR=str(root / 'tree-cli')))
            check('tree CLI × tree server: a WS-minted typed token and its receipt', minted.returncode == 0, minted.stderr)
            ok(TREE_CLI, tree, 'tree-cli', 'jobs', 'retry', job, '--auth', 'bearer', '--request-id', retry_request, '--yes', token=operator)
            check('tree CLI × tree server: the configured token retries the job (a token RetryJob receipt)', True)
            jobs = ok(TREE_CLI, tree, 'tree-cli', 'jobs', '--auth', 'bearer', token=root / 'scoped-b')['ActivityJobs']['result']['jobs']
            check('tree CLI × tree server: the issued scoped token lists the owner\'s job', [j['job']['id'] for j in jobs] == [job], jobs)
            created = listed(TREE_CLI, tree, 'tree-cli')[operator_id]['createdAt']

            # Old client × new server after the opt-in: typed scopes only, every command unchanged.
            login(BASE_CLI, tree, 'base-cli')
            settings = ok(BASE_CLI, tree, 'base-cli', 'settings')
            check('base CLI × tree server: settings offer the typed scopes and show scoped tokens with Read',
                  settings['scopes'] == ['Ingest', 'Read', 'Raw'] and all(t['scopes'] == ['Read'] for t in settings['tokens'] if t['id'] in issued.values() or t['id'] == operator_id), settings)
            check('base CLI × tree server: tokens list', issued['scoped-a'] in listed(BASE_CLI, tree, 'base-cli'))
            ok(BASE_CLI, tree, 'base-cli', 'tokens', 'mint', '--name', 'base-minted', '--scopes', 'Read', '--secret-out', str(root / 'base-minted'), '--yes')
            check('base CLI × tree server: tokens mint', True)
            for name, identifier in (('scoped', issued['scoped-a']), ('unrelated', unrelated)):
                ok(BASE_CLI, tree, 'base-cli', 'tokens', 'revoke', identifier, '--yes')
                check(f'base CLI × tree server: tokens revoke of the {name} token', True)
            whoami = ok(BASE_CLI, tree, 'base-cli', 'whoami', '--auth', 'bearer', token=root / 'scoped-b')['Whoami']['user']
            check('base CLI × tree server: whoami --auth bearer of a scoped token shows its typed scopes', whoami['scopes'] == ['Read'], whoami)
            servers.pop().stop()

            # Rollback rehearsal: the base server refuses a configuration that names OperateJobs.
            log = root / 'base-refused.log'
            with log.open('x') as output:
                refused = subprocess.run([str(BASE_SERVER), 'serve-standby', str(ops_config)], env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, timeout=REFUSAL_SECONDS)
            check('base server: a configuration naming OperateJobs refuses the start at the configuration stage', refused.returncode != 0 and b'config' in log.read_bytes(), log.read_text()[-2000:])
            print('   base server refusal:', [line for line in log.read_text().splitlines() if 'config' in line][:2], flush=True)

            # Without OperateJobs the base server starts on the same database.
            base_config, base = config('base', ['Read'])
            servers.append(Server(root, 'base', BASE_SERVER, base_config, env))
            login(BASE_CLI, base, 'base-cli')
            tokens = listed(BASE_CLI, base, 'base-cli')
            check('base server: keeps the configured token\'s id and creation time and lists tokens', tokens[operator_id]['createdAt'] == created and issued['scoped-b'] in tokens, tokens)
            receipt = ok(BASE_CLI, base, 'base-cli', 'receipt', ws_request)
            check('base server: reads the WS mint receipt (no secret)', receipt['Token']['result']['secret'] is None, receipt)
            receipt = ok(BASE_CLI, base, 'base-cli', 'receipt', retry_request)
            check('base server: reads the token RetryJob receipt', receipt['Mutation']['receipt'] == dict(requestId=retry_request, operation='RetryJob', entityId=job), receipt)
            for name, token in (('configured', operator), ('issued', root / 'scoped-b')):
                whoami = ok(BASE_CLI, base, 'base-cli', 'whoami', '--auth', 'bearer', token=token)['Whoami']['user']
                check(f'base server: accepts the {name} scoped token as Read', whoami['scopes'] == ['Read'], whoami)
            ok(BASE_CLI, base, 'base-cli', 'tokens', 'revoke', issued['scoped-b'], '--yes')
            check('base server: revokes an issued scoped token', listed(BASE_CLI, base, 'base-cli')[issued['scoped-b']]['revoked'])
            status, body = post(base, '/api/jobs/v1', secret['operator'], {'requestId': str(uuid.uuid4()), 'operation': {'PreviewRetryFailed': {}}})
            check('base server: /api/jobs/v1 is a 404 without a Failure body', status == 404 and b'"code"' not in body, (status, body))

            # New client × old server.
            login(TREE_CLI, base, 'tree-cli')
            for args in (['jobs'], ['jobs', 'retry', job, '--yes'], ['retry-failed', 'apply', '--target-profile', 'profile', '--selection-hash', '0' * 64, '--yes']):
                result = cli(TREE_CLI, base, 'tree-cli', *args, '--auth', 'bearer', token=operator)
                check(f'tree CLI × base server: {" ".join(args[:2])} --auth bearer exits 6 with the old-server text', result.returncode == EXIT_UNAVAILABLE and OLD_SERVER in result.stderr, result.stderr)
            result = cli(TREE_CLI, base, 'tree-cli', 'tokens', 'mint', '--name', 'refused', '--scopes', 'Read,OperateJobs', '--secret-out', str(root / 'refused'), '--yes')
            check('tree CLI × base server: a mint of OperateJobs is refused (exit 2)', result.returncode == EXIT_USAGE and not (root / 'refused').exists(), result.stderr)
            ok(TREE_CLI, base, 'tree-cli', 'settings')
            check('tree CLI × base server: settings (the header is ignored)', True)
            servers.pop().stop()

            # Tree server again: the configured token follows configuration; the revoked token stays revoked.
            servers.append(Server(root, 'tree-2', TREE_SERVER, base_config, env))
            status, body = post(base, '/api/jobs/v1', secret['operator'], {'requestId': str(uuid.uuid4()), 'operation': {'PreviewRetryFailed': {}}})
            check('tree server, OperateJobs removed from configuration: the configured token is refused with today\'s bearer refusal', status == 403 and body == PINNED, (status, body))
            login(TREE_CLI, base, 'tree-cli')
            check('tree server: the token revoked by the base server stays revoked', listed(TREE_CLI, base, 'tree-cli')[issued['scoped-b']]['revoked'])
            result = cli(TREE_CLI, base, 'tree-cli', 'jobs', '--auth', 'bearer', token=root / 'scoped-b')
            check('tree server: the revoked token is refused (exit 3)', result.returncode == EXIT_AUTH, result.stderr)
            servers.pop().stop()
            servers.append(Server(root, 'tree-3', TREE_SERVER, ops_config, env))
            status, body = post(tree, '/api/jobs/v1', secret['operator'], {'requestId': str(uuid.uuid4()), 'operation': {'PreviewRetryFailed': {}}})
            check('tree server, OperateJobs configured again: the configured token previews Retry failed', status == 200, (status, body))
        except BaseException:
            for log in sorted(root.glob('*.log')):
                print(f'--- {log.name} (tail)', log.read_text()[-3000:], sep='\n', flush=True)
            raise
        finally:
            for server in servers:
                server.stop()
    print(json.dumps(dict(status='passed', checks=len(checks), treeServer=str(TREE_SERVER), treeCli=str(TREE_CLI), baseServer=str(BASE_SERVER), baseCli=str(BASE_CLI))), flush=True)


main()
PY
)"
