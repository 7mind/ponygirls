#!/usr/bin/env bash
# Raw read compatibility (ingest-c spec §8, row L1), on demand: synthetic sessions sent through /api/ingest to a server with
# a small raw read bound (maxRawReadBytes), then
#   tree server × base CLI: `raw` below the bound returns the files exactly, above it `too-large`;
#   tree server × tree CLI: `raw` without --revision reads the head, above the bound `too-large` names --output FILE, and
#     `raw --output FILE|-` downloads byte-exact (an epoch revision, and the second file of a two-file legacy revision);
#   base server × tree CLI: `raw --output` fails with the old-server message and writes nothing; `raw` still reads exactly.
# Base = agent/ingest-b-land 66fce48e. Both servers run serve-standby on one owned database, one after the other. From the
# repository root:
#
#   CHRONICLE_SERVER="$(nix build --no-link --print-out-paths .#chronicle.nativeArtifact)/libexec/chronicle-server" \
#   CHRONICLE_CLI="$(nix build --no-link --print-out-paths .#chronicle-cli)/bin/chronicle" \
#   BASE_SERVER="$(nix build --no-link --print-out-paths "git+file://$PWD?rev=66fce48e651758158e6df8bee4d6ed443160421c#chronicle.nativeArtifact")/libexec/chronicle-server" \
#   BASE_CLI="$(nix build --no-link --print-out-paths "git+file://$PWD?rev=66fce48e651758158e6df8bee4d6ed443160421c#chronicle-cli")/bin/chronicle" \
#   "$(nix build --no-link --print-out-paths .#service-test-fixture-tools)/bin/with-service-postgres" \
#     bash chronicle/scripts/test-raw-compat.sh
#
# Synthetic home, sessions and credentials in a private temporary directory; each server is stopped on exit.
set -euo pipefail
: "${CHRONICLE_SERVER:?set CHRONICLE_SERVER to the server executable built from this tree}"
: "${CHRONICLE_CLI:?set CHRONICLE_CLI to the chronicle CLI built from this tree}"
: "${BASE_SERVER:?set BASE_SERVER to the server executable built from 66fce48e}"
: "${BASE_CLI:?set BASE_CLI to the chronicle CLI built from 66fce48e}"
: "${PONYGIRLS_OWNED_FIXTURE_ROOT:?run via the owned with-service-postgres wrapper}"
cd "$(dirname "$0")/../.."
exec python3 -c "$(cat <<'PY'
import hashlib, json, os, secrets, signal, socket, subprocess, tempfile, time, urllib.request, uuid
from pathlib import Path

TREE_SERVER, TREE_CLI = Path(os.environ['CHRONICLE_SERVER']).resolve(strict=True), Path(os.environ['CHRONICLE_CLI']).resolve(strict=True)
BASE_SERVER, BASE_CLI = Path(os.environ['BASE_SERVER']).resolve(strict=True), Path(os.environ['BASE_CLI']).resolve(strict=True)
OWNED = Path(os.environ['PONYGIRLS_OWNED_FIXTURE_ROOT']).resolve(strict=True)
assert (OWNED / '.owned-test-only').read_text() == 'ponygirls-owned-test-v1\n'
DATABASE = json.loads(os.environ['PONYGIRLS_TEST_DATABASE_CHRONICLE'])
assert Path(DATABASE['passwordFile']).resolve(strict=True).is_relative_to(OWNED)
# The servers' raw read bound in this run: GetRaw answers the small sessions whole and the large one too-large.
RAW_READ_BYTES = 65536
EXIT_USAGE, EXIT_UNAVAILABLE = 2, 6
checks = []


def check(label, condition, detail=''):
    if not condition:
        raise AssertionError(f'{label}: {detail}')
    checks.append(label)
    print('ok -', label, flush=True)


def pi_lines(identifier, texts):
    records = [{'type': 'session', 'version': 3, 'id': identifier, 'timestamp': '2026-11-21T00:00:00.000Z'}]
    records += [{'type': 'message', 'id': f'{identifier}-{i}', 'parentId': identifier, 'timestamp': '2026-11-21T00:00:01.000Z',
                 'message': {'role': 'user', 'content': [{'type': 'text', 'text': text}]}} for i, text in enumerate(texts)]
    return records


def request(name, files):
    """An IngestRequest of new source `name`: files [(path, records)], one message per message record."""
    contents = [''.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) + '\n' for r in records) for _, records in files]
    messages, index = [], 0
    for _, records in files:
        for record in records:
            if record['type'] == 'message':
                messages.append(dict(id=record['id'], parentId=None, role='user', text=record['message']['content'][0]['text'], timestamp=record['timestamp'], recordIndex=index))
            index += 1
    sha = lambda text: hashlib.sha256(text.encode()).hexdigest()
    body = dict(requestId=str(uuid.uuid4()), source=dict(collectorNamespace='raw-compat', discoveryRootId='raw-compat', format='Pi', producerSessionId=name, subagentId=None),
                expectedRevision=0, digest=sha(''.join(contents)), completion='Quiescent', redacted=False,
                metadata=dict(title=name, project=None, workdir=None, gitRemote=None, gitBranch=None, gitCommit=None, producer='raw-compat', model=None,
                              startedAt=None, endedAt=None, tags=[]),
                messages=messages, files=[dict(path=path, sha256=sha(content), content=content) for (path, _), content in zip(files, contents)])
    return body, [content.encode() for content in contents]


class Server:
    def __init__(self, root, label, binary, config, env):
        self.label = label
        self.log = (root / f'{label}.log').open('x')
        self.process = subprocess.Popen([str(binary), 'serve-standby', str(config)], env=env, stdin=subprocess.DEVNULL, stdout=self.log,
                                        stderr=subprocess.STDOUT, start_new_session=True)
        origin = json.loads(config.read_text())['allowedOrigin']
        deadline = time.monotonic() + 60
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


def main():
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='chronicle-raw-compat-') as temporary:
        root = Path(temporary)
        env = {k: v for k, v in os.environ.items() if not k.startswith('CHRONICLE_') and k not in ('NODE_OPTIONS', 'NODE_PATH')}
        env.update(HOME=str(root / 'home'))
        (root / 'home').mkdir()
        password = 'synthetic-raw-compat'
        (root / 'password').write_text(password + '\n')
        (root / 'password-hash').write_text(subprocess.run([str(TREE_SERVER), 'password-hash'], input=password + '\n', text=True,
                                                            capture_output=True, check=True, timeout=30).stdout)
        (root / 'empty-credential').write_text('')
        token = secrets.token_urlsafe(32)
        (root / 'ingest-token').write_text(token + '\n')
        token_id = str(uuid.uuid4())  # one static token for both servers: the archive keeps its identity
        downloads = root / 'downloads'
        downloads.mkdir()

        def config(label):
            with socket.socket() as candidate:
                candidate.bind(('127.0.0.1', 0))
                port = candidate.getsockname()[1]
            value = json.loads(Path('chronicle/config.example.json').read_text())
            value.update(listenPort=port, allowedOrigin=f'http://127.0.0.1:{port}', secureCookies=False, allowInsecureHttp=False, maxRawReadBytes=RAW_READ_BYTES,
                         jdbcUrl=DATABASE['jdbcUrl'], databaseUser=DATABASE['user'], databasePasswordFile=DATABASE['passwordFile'], databaseLimits=DATABASE['limits'],
                         users=[dict(id='alice', login='alice', passwordHashFile=str(root / 'password-hash'), enabled=True)],
                         staticTokens=[dict(id=token_id, userId='alice', name='raw-compat-ingest', scopes=['Ingest'], tokenFile=str(root / 'ingest-token'))])
            value['annotation'].update(endpoint='http://127.0.0.1:1/chat', credentialFile=str(root / 'empty-credential'))
            value['embedding'].update(endpoint='http://127.0.0.1:1/embed', credentialFile=str(root / 'empty-credential'), dimensions=3)
            path = root / f'{label}.json'
            path.write_text(json.dumps(value))
            return path, value['allowedOrigin']

        def cli(binary, origin, state, *args):
            return subprocess.run([str(binary), '--url', origin, '--allow-insecure-http', *args], stdin=subprocess.DEVNULL, capture_output=True, timeout=120,
                                  env=dict(env, CHRONICLE_STATE_DIR=str(root / state)))

        def login(binary, origin, state):
            result = cli(binary, origin, state, 'login', '--login', 'alice', '--password-file', str(root / 'password'))
            assert result.returncode == 0, result.stderr

        def raw(binary, origin, state, *args):
            result = cli(binary, origin, state, 'raw', *args, '--json')
            assert result.returncode == 0, result.stderr
            return json.loads(result.stdout)['Raw']['result']

        def files_of(result):
            return [(f['path'], f['content'].encode()) for f in result['files']]

        servers = []
        try:
            tree_config, tree = config('tree')
            servers.append(Server(root, 'tree', TREE_SERVER, tree_config, env))
            sessions = {}
            for name, files in (('small', [('--compat--/small.jsonl', pi_lines('small', ['first é question', 'second 🙂 answer']))]),
                                ('large', [('--compat--/large.jsonl', pi_lines('large', [f'line {i} ' + 'ünïcode payload ' * 60 for i in range(400)]))]),
                                ('pair', [('--compat--/one.jsonl', pi_lines('pair', ['one'])), ('--compat--/two.jsonl', pi_lines('pair-b', ['two ✓']))])):
                body, contents = request(name, files)
                http = urllib.request.Request(tree + '/api/ingest', method='POST', data=json.dumps(body).encode(),
                                              headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
                with urllib.request.urlopen(http, timeout=60) as response:
                    receipt = json.loads(response.read())
                sessions[name] = (receipt['sessionId'], [path for path, _ in files], contents)
            small, large, pair = sessions['small'], sessions['large'], sessions['pair']
            check('the large session is above the raw read bound, the others below it',
                  len(large[2][0]) > RAW_READ_BYTES and len(small[2][0]) < RAW_READ_BYTES and sum(map(len, pair[2])) < RAW_READ_BYTES, [len(c) for _, _, cs in sessions.values() for c in cs])

            # Old client × new server: GetRaw unchanged.
            login(BASE_CLI, tree, 'base-cli')
            for session, paths, contents in (small, pair):
                check(f'base CLI × tree server: raw of {paths} is exact', files_of(raw(BASE_CLI, tree, 'base-cli', session, '--revision', '1')) == list(zip(paths, contents)))
            refused = cli(BASE_CLI, tree, 'base-cli', 'raw', large[0], '--revision', '1')
            check('base CLI × tree server: raw above the bound is too-large (exit 6)', refused.returncode == EXIT_UNAVAILABLE and b'too-large' in refused.stderr, refused.stderr)

            # New client × new server.
            login(TREE_CLI, tree, 'tree-cli')
            check('tree CLI × tree server: raw without --revision reads the head exactly', files_of(raw(TREE_CLI, tree, 'tree-cli', small[0])) == list(zip(small[1], small[2])))
            refused = cli(TREE_CLI, tree, 'tree-cli', 'raw', large[0])
            check('tree CLI × tree server: raw above the bound is too-large and names --output FILE', refused.returncode == EXIT_UNAVAILABLE
                  and b'too-large' in refused.stderr and b'use --output FILE' in refused.stderr, refused.stderr)
            target = downloads / 'large.jsonl'
            saved = cli(TREE_CLI, tree, 'tree-cli', 'raw', large[0], '--output', str(target), '--json')
            sha = hashlib.sha256(large[2][0]).hexdigest()
            check('tree CLI × tree server: raw --output FILE saves the epoch revision byte-exact, mode 0600',
                  saved.returncode == 0 and json.loads(saved.stdout) == dict(sessionId=large[0], revision=1, file=0, path=str(target), bytes=str(len(large[2][0])), sha256=sha)
                  and target.read_bytes() == large[2][0] and target.stat().st_mode & 0o777 == 0o600, saved.stderr)
            piped = cli(TREE_CLI, tree, 'tree-cli', 'raw', large[0], '--revision', '1', '--output', '-')
            check('tree CLI × tree server: raw --output - writes the same bytes to stdout and nothing else', piped.returncode == 0 and piped.stdout == large[2][0] and piped.stderr == b'', piped.stderr)
            several = cli(TREE_CLI, tree, 'tree-cli', 'raw', pair[0], '--output', str(downloads / 'pair.jsonl'))
            check('tree CLI × tree server: a two-file legacy revision needs --file, the files are listed', several.returncode == EXIT_USAGE
                  and all(json.dumps(path).encode() in several.stderr for path in pair[1]), several.stderr)
            second = cli(TREE_CLI, tree, 'tree-cli', 'raw', pair[0], '--file', '1', '--output', str(downloads / 'pair.jsonl'))
            check('tree CLI × tree server: --file 1 saves the legacy revision\'s second file byte-exact',
                  second.returncode == 0 and (downloads / 'pair.jsonl').read_bytes() == pair[2][1], second.stderr)
            servers.pop().stop()

            # New client × old server: the raw download API is missing; nothing is written, GetRaw still works.
            base_config, base = config('base')
            servers.append(Server(root, 'base', BASE_SERVER, base_config, env))
            login(TREE_CLI, base, 'tree-cli')
            before = sorted(p.name for p in downloads.iterdir())
            for output in (str(downloads / 'old.jsonl'), '-'):
                result = cli(TREE_CLI, base, 'tree-cli', 'raw', large[0], '--output', output)
                check(f'tree CLI × base server: raw --output {"FILE" if output != "-" else "-"} exits 6 with the old-server message, stdout empty',
                      result.returncode == EXIT_UNAVAILABLE and result.stdout == b''
                      and f'The server at {base} has no raw download API (it predates it): upgrade the server;'.encode() in result.stderr, result.stderr)
            check('tree CLI × base server: nothing was written', sorted(p.name for p in downloads.iterdir()) == before, before)
            check('tree CLI × base server: raw (GetRaw) is exact', files_of(raw(TREE_CLI, base, 'tree-cli', small[0], '--revision', '1')) == list(zip(small[1], small[2])))
        except BaseException:
            for label in ('tree', 'base'):
                if (root / f'{label}.log').exists():
                    print(f'--- {label} server log (tail)', (root / f'{label}.log').read_text()[-3000:], sep='\n', flush=True)
            raise
        finally:
            for server in servers:
                server.stop()
    print(json.dumps(dict(status='passed', checks=len(checks), treeServer=str(TREE_SERVER), treeCli=str(TREE_CLI), baseServer=str(BASE_SERVER), baseCli=str(BASE_CLI))), flush=True)


main()
PY
)"
