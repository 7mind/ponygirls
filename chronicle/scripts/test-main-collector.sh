#!/usr/bin/env bash
# Old-client check (gate O of docs/drafts/20261120-1201-append-only-ingest-spec.md, §8 and §11): the collector built
# from main 0aedcfa8, unmodified, uploads synthetic Pi sessions through /api/ingest to a server built from this tree (a
# new session, an append, a rewrite, and a session above the server's body bound), and this tree's CLI reads every
# revision back exactly. On demand, from the repository root:
#
#   CHRONICLE_SERVER="$(nix build --no-link --print-out-paths .#chronicle.nativeArtifact)/libexec/chronicle-server" \
#   MAIN_COLLECTOR="$(nix build --no-link --print-out-paths "git+file://$PWD?rev=0aedcfa8bcdbfd93610ba63b3836384240538b83#chronicle-collector")/bin/chronicle-collector" \
#   CHRONICLE_CLI="$(nix build --no-link --print-out-paths .#chronicle-cli)/bin/chronicle" \
#   "$(nix build --no-link --print-out-paths .#service-test-fixture-tools)/bin/with-service-postgres" \
#     bash chronicle/scripts/test-main-collector.sh
#
# Synthetic home, sessions and credentials in a private temporary directory; the owned database only. The server runs
# serve-standby (no indexing workers) and is stopped on exit.
set -euo pipefail
: "${CHRONICLE_SERVER:?set CHRONICLE_SERVER to the server executable built from this tree}"
: "${MAIN_COLLECTOR:?set MAIN_COLLECTOR to the chronicle-collector executable built from main 0aedcfa8}"
: "${CHRONICLE_CLI:?set CHRONICLE_CLI to the chronicle CLI built from this tree}"
: "${PONYGIRLS_OWNED_FIXTURE_ROOT:?run via the owned with-service-postgres wrapper}"
cd "$(dirname "$0")/../.."
exec python3 -c "$(cat <<'PY'
import hashlib, json, os, re, secrets, signal, socket, subprocess, tempfile, time, urllib.request, uuid
from pathlib import Path

SERVER = Path(os.environ['CHRONICLE_SERVER']).resolve(strict=True)
COLLECTOR = Path(os.environ['MAIN_COLLECTOR']).resolve(strict=True)
CLI = Path(os.environ['CHRONICLE_CLI']).resolve(strict=True)
OWNED = Path(os.environ['PONYGIRLS_OWNED_FIXTURE_ROOT']).resolve(strict=True)
assert (OWNED / '.owned-test-only').read_text() == 'ponygirls-owned-test-v1\n'
DATABASE = json.loads(os.environ['PONYGIRLS_TEST_DATABASE_CHRONICLE'])
assert Path(DATABASE['passwordFile']).resolve(strict=True).is_relative_to(OWNED)
LOCATION = re.fullmatch(r'jdbc:postgresql://127\.0\.0\.1:(\d+)/(\w+)', DATABASE['jdbcUrl'])
assert LOCATION is not None, 'owned loopback database required'
# The server's body bound in this run: the large session's request exceeds it, the others do not.
BODY_BYTES = 65536
PROJECT = '--gate-o--'
checks = []


def check(label, condition, detail=''):
    if not condition:
        raise AssertionError(f'{label}: {detail}')
    checks.append(label)
    print('ok -', label, flush=True)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sql(query, *args):
    """The rows of a query against the owned database; arguments are bound as psql variables :'arg0', :'arg1', ..."""
    variables = [option for i, value in enumerate(args) for option in ('-v', f'arg{i}={value}')]
    result = subprocess.run(['psql', '-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', *variables, '-h', '127.0.0.1', '-p', LOCATION[1],
                             '-U', DATABASE['user'], '-d', LOCATION[2], '-f', '-'], input=query + ';\n', capture_output=True, text=True, timeout=30,
                            env=dict(os.environ, PGPASSWORD=Path(DATABASE['passwordFile']).read_text().strip()))
    assert result.returncode == 0, result.stderr
    return [line.split('|') for line in result.stdout.splitlines()]


def pi_message(identifier, parent, role, text, second):
    return {'type': 'message', 'id': identifier, 'parentId': parent, 'timestamp': f'2026-11-20T00:00:{second:02d}.000Z',
            'message': {'role': role, 'content': [{'type': 'text', 'text': text}]}}


def pi_session(identifier):
    return {'type': 'session', 'version': 3, 'id': identifier, 'timestamp': '2026-11-20T00:00:00.000Z'}


def content(records):
    return ''.join(json.dumps(record, ensure_ascii=False, separators=(',', ':')) + '\n' for record in records)


def messages(records):
    """The messages the collector derives from the records (Pi normalization: one text block per message)."""
    return [dict(id=r['id'], parentId=r['parentId'], role=r['message']['role'], text=r['message']['content'][0]['text'],
                 timestamp=r['timestamp'], recordIndex=index) for index, r in enumerate(records) if r['type'] == 'message']


def main():
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='chronicle-gate-o-') as temporary:
        root = Path(temporary)
        env = {k: v for k, v in os.environ.items() if not k.startswith('CHRONICLE_') and k not in ('NODE_OPTIONS', 'NODE_PATH')}
        env.update(HOME=str(root / 'home'))
        password = 'synthetic-gate-o'
        (root / 'password').write_text(password + '\n')
        (root / 'password-hash').write_text(subprocess.run([str(SERVER), 'password-hash'], input=password + '\n', text=True,
                                                            capture_output=True, check=True, timeout=30).stdout)
        (root / 'empty-credential').write_text('')
        (root / 'collector-token').write_text(secrets.token_urlsafe(32) + '\n')
        with socket.socket() as candidate:
            candidate.bind(('127.0.0.1', 0))
            port = candidate.getsockname()[1]
        origin = f'http://127.0.0.1:{port}'
        config = json.loads(Path('chronicle/config.example.json').read_text())
        config.update(listenPort=port, allowedOrigin=origin, secureCookies=False, allowInsecureHttp=False, maxBodyBytes=BODY_BYTES,
                      jdbcUrl=DATABASE['jdbcUrl'], databaseUser=DATABASE['user'], databasePasswordFile=DATABASE['passwordFile'],
                      databaseLimits=DATABASE['limits'],
                      users=[dict(id='alice', login='alice', passwordHashFile=str(root / 'password-hash'), enabled=True)],
                      staticTokens=[dict(id=str(uuid.uuid4()), userId='alice', name='gate-o-collector', scopes=['Ingest'], tokenFile=str(root / 'collector-token'))])
        config['annotation'].update(endpoint='http://127.0.0.1:1/chat', credentialFile=str(root / 'empty-credential'))
        config['embedding'].update(endpoint='http://127.0.0.1:1/embed', credentialFile=str(root / 'empty-credential'), dimensions=3)
        (root / 'server.json').write_text(json.dumps(config))
        sessions = root / 'home/.pi/agent/sessions' / PROJECT
        sessions.mkdir(parents=True)
        (root / 'collector.json').write_text(json.dumps(dict(enabled=True, endpoint=origin, tokenFile=str(root / 'collector-token'),
                                                             stateDir=str(root / 'collector-state'), homeDir=str(root / 'home'),
                                                             discoverYolo=False, quietMs=0)))
        log = (root / 'server.log').open('x')
        server = subprocess.Popen([str(SERVER), 'serve-standby', str(root / 'server.json')], env=env, stdin=subprocess.DEVNULL,
                                  stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            deadline = time.monotonic() + 60
            while True:
                assert server.poll() is None, 'the server exited during start'
                try:
                    with urllib.request.urlopen(origin + '/api/versions', timeout=1) as response:
                        if response.status == 200:
                            break
                except OSError:
                    pass
                assert time.monotonic() < deadline, 'server readiness'
                time.sleep(0.1)

            def collect(expected):
                result = subprocess.run([str(COLLECTOR), '--config', str(root / 'collector.json'), '--once'], env=env, stdin=subprocess.DEVNULL,
                                        capture_output=True, text=True, timeout=120)
                assert result.returncode == expected, f'collector --once exit {result.returncode}: {result.stdout} {result.stderr}'
                return json.loads(result.stdout.strip().splitlines()[-1])

            def status():
                result = subprocess.run([str(COLLECTOR), '--config', str(root / 'collector.json'), '--status', '--json'], env=env,
                                        stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60, check=True)
                return json.loads(result.stdout)

            def cli(*args):
                result = subprocess.run([str(CLI), '--url', origin, '--allow-insecure-http', '--json', *args], stdin=subprocess.DEVNULL,
                                        env=dict(env, CHRONICLE_STATE_DIR=str(root / 'cli-state')), capture_output=True, text=True, timeout=60)
                assert result.returncode == 0 and result.stderr == '', f'chronicle {args[0]}: exit {result.returncode}: {result.stderr}'
                return json.loads(result.stdout)

            def uploaded_once(counters, label):
                check(label + ': --once uploads one revision, no failure, nothing left queued',
                      counters['enqueued'] == 1 and counters['uploaded'] == 1 and all(counters[k] == 0 for k in ('uploadFailures', 'quarantined', 'pending', 'stopped', 'conflicts')),
                      counters)

            def revisions(session):
                return [(int(revision), epoch) for revision, epoch in sql("SELECT revision,coalesce(epoch::text,'') FROM ch_revisions WHERE session_id=:'arg0' ORDER BY revision", session)]

            path = sessions / 'session-a.jsonl'
            first = [pi_session('gate-o-a'), pi_message('u1', 'gate-o-a', 'user', 'first question about the gate', 1),
                     pi_message('a1', 'u1', 'assistant', 'first answer, Σ and 🙂', 2), pi_message('u2', 'a1', 'user', 'second question', 3)]
            appended = first + [pi_message('a2', 'u2', 'assistant', 'second answer', 4), pi_message('u3', 'a2', 'user', 'third question with the gate needle', 5)]
            rewritten = [first[0], pi_message('u1', 'gate-o-a', 'user', 'first question, rewritten by compaction', 1)] + appended[2:]
            history = []
            for label, records in (('new session', first), ('appended lines', appended), ('rewrite', rewritten)):
                path.write_text(content(records), encoding='utf-8')
                uploaded_once(collect(0), label)
                history.append(records)
            sources = sql("SELECT id,revision FROM ch_sources WHERE owner='alice' AND NOT tombstone")
            check('one source for the session at revision 3', len(sources) == 1 and sources[0][1] == '3', sources)
            session = sources[0][0]
            check('three receipts, one per revision', sql("SELECT count(*) FROM ch_ingest_receipts WHERE owner='alice'") == [['3']])
            layout = revisions(session)
            check('revision 1 starts an epoch, the append extends it, the rewrite starts another',
                  [r for r, _ in layout] == [1, 2, 3] and all(e != '' for _, e in layout) and layout[0][1] == layout[1][1] != layout[2][1], layout)
            check('the append wrote only its delta into the epoch: 5 message rows',
                  sql("SELECT count(*) FROM ch_epoch_messages WHERE epoch=:'arg0'", layout[0][1]) == [['5']])
            check('the rewrite superseded the first epoch', sql("SELECT candidates FROM ch_epochs WHERE id=:'arg0'", layout[0][1]) == [['prune']])
            observed = status()
            check('collector status: nothing queued, last run uploaded one, no failures, only missing-root diagnostics',
                  observed['queue'] == [] and observed['lastRun']['counters']['uploaded'] == 1 and observed['lastRun']['counters']['uploadFailures'] == 0
                  and all(d['code'] == 'root-missing' for d in observed['diagnostics']), observed)

            cli('login', '--login', 'alice', '--password-file', str(root / 'password'))
            needles = {'gate needle': ([], ['u3'], ['u3']), 'rewritten by compaction': ([], [], ['u1'])}
            for revision, records in enumerate(history, start=1):
                page = cli('messages', session, '--revision', str(revision), '--limit', '100', '--auth', 'session')['Messages']['result']
                check(f'messages of revision {revision} are the synthetic messages exactly',
                      page['messages'] == messages(records) and page['total'] == len(messages(records)) and page['view'] == dict(revision=revision, generationId=None), page)
                raw = cli('raw', session, '--revision', str(revision), '--auth', 'session')['Raw']['result']
                expected = content(records)
                check(f'raw of revision {revision} is the file exactly',
                      raw['revision'] == revision and raw['files'] == [dict(path=f'{PROJECT}/session-a.jsonl', sha256=hashlib.sha256(expected.encode()).hexdigest(), content=expected)], raw)
                for literal, hits in needles.items():
                    found = cli('find', session, literal, '--revision', str(revision), '--auth', 'session')['SessionMessageSearch']['result']
                    check(f'Find {literal!r} in revision {revision}', [hit['messageId'] for hit in found['hits']] == hits[revision - 1], found)

            # Words, not one long run: the collector's default redaction shortens secret-like runs.
            large = sessions / 'session-b.jsonl'
            large.write_text(content([pi_session('gate-o-b')] + [pi_message(f'b{i}', 'gate-o-b', 'user', f'large message {i} ' + 'lorem ipsum dolor sit amet ' * 150, i + 1) for i in range(30)]), encoding='utf-8')
            counters = collect(1)
            check('a session above the server body bound: one upload failure, stopped, the rest unchanged',
                  counters['uploadFailures'] == 1 and counters['stopped'] == 1 and counters['uploaded'] == 0 and counters['unchanged'] == 1, counters)
            queue = status()['queue']
            check('the old collector stops it as protocol-rejected (413), unchanged behaviour',
                  len(queue) == 1 and queue[0]['status'] == 'stopped' and queue[0]['error'] == 'protocol-rejected', queue)
            check('the server stored nothing for it', sql("SELECT count(*) FROM ch_sources WHERE owner='alice'") == [['1']])
            check('the earlier session is unchanged', revisions(session) == layout)
        except BaseException:
            log.flush()
            print((root / 'server.log').read_text()[-4000:], flush=True)
            raise
        finally:
            if server.poll() is None:
                os.killpg(server.pid, signal.SIGTERM)
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(server.pid, signal.SIGKILL)
                    server.wait(timeout=5)
            log.close()
    print(json.dumps(dict(status='passed', checks=len(checks), server=str(SERVER), serverSha256=digest(SERVER), collector=str(COLLECTOR),
                          cli=str(CLI))), flush=True)


main()
PY
)"
