#!/usr/bin/env python3
"""Behavioral-Active Blackbox-GoodCommunication: owned native server + PostgreSQL.
Synthetic inputs and an owned scripted model only; no live URL/DB/provider option.
"""
import datetime
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import signal
import shutil
import socket
import subprocess
import tempfile
import threading
import time

CLI_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = CLI_ROOT.parents[1]
SERVER = Path(os.environ['CHRONICLE_SERVER']).resolve(strict=True)
OWNED_ROOT = Path(os.environ['PONYGIRLS_OWNED_FIXTURE_ROOT']).resolve(strict=True)
assert (OWNED_ROOT / '.owned-test-only').read_text() == 'ponygirls-owned-test-v1\n'
DATABASE = json.loads(os.environ['PONYGIRLS_TEST_DATABASE_CHRONICLE'])
assert Path(DATABASE['passwordFile']).resolve(strict=True).is_relative_to(OWNED_ROOT)
assert DATABASE['jdbcUrl'].startswith('jdbc:postgresql://127.0.0.1:')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cli_identity():
    node_path = shutil.which('node')
    assert node_path is not None, 'pinned Node executable required'
    node_reference = Path(node_path)
    node = node_reference.resolve(strict=True)
    selected = os.environ.get('CHRONICLE_CLI_EXECUTABLE')
    def bindings(root):
        files = [root / 'package.json'] + sorted(p for p in (root / 'dist').rglob('*') if p.suffix in ('.js', '.mjs', '.cjs'))
        return {str(p.relative_to(root)): digest(p) for p in files}
    source = bindings(CLI_ROOT)
    assert len(source) > 1, 'freshly built CLI runtime required'
    identity = dict(kind='source-built', runtimeFiles=source,
                    node=dict(reference=str(node_reference), path=str(node), sha256=digest(node), version=subprocess.check_output([str(node), '--version'], text=True).strip()))
    if selected is None:
        return [str(node), str(CLI_ROOT / 'dist/cli/src/main.js')], identity
    assert Path(selected).is_absolute(), 'installed CLI executable must be absolute'
    executable = Path(selected).resolve(strict=True)
    runtime_root = executable.parent.parent / 'lib/chronicle-cli'
    actual = bindings(runtime_root)
    assert source == actual, 'installed CLI runtime does not match the freshly built source/model codecs'
    assert str(node_reference) in executable.read_text(), 'installed wrapper does not use the pinned test Node reference'
    identity.update(kind='installed', executable=str(executable), executableSha256=digest(executable), runtimeFiles=actual,
                    sourceRuntimeMatches=True)
    return [str(executable)], identity


def listening(process, port):
    inodes = set()
    for fd in Path(f'/proc/{process.pid}/fd').iterdir():
        try:
            target = os.readlink(fd)
        except FileNotFoundError:
            continue
        if target.startswith('socket:['):
            inodes.add(target[8:-1])
    for table in ('tcp', 'tcp6'):
        for line in Path(f'/proc/{process.pid}/net/{table}').read_text().splitlines()[1:]:
            parts = line.split()
            if parts[3] == '0A' and int(parts[1].split(':')[1], 16) == port and parts[9] in inodes:
                return True
    return False


def main():
    os.umask(0o077)
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    report = CLI_ROOT / 'artifacts' / ('server-' + timestamp)
    report.mkdir(parents=True, exist_ok=False)
    cases = []
    cli_command, cli_binding = cli_identity()
    with tempfile.TemporaryDirectory(prefix='chronicle-cli-server-') as temporary:
        root = Path(temporary)
        env = {k: v for k, v in os.environ.items() if not k.startswith('CHRONICLE_') and k not in ('NODE_OPTIONS', 'NODE_PATH')}
        env.update(HOME=str(root), CHRONICLE_STATE_DIR=str(root / 'alice-state'))
        password = 'synthetic-cli-acceptance'
        password_file = root / 'password'
        password_file.write_text(password + '\n')
        password_hash = subprocess.run([str(SERVER), 'password-hash'], input=password + '\n', text=True,
                                       capture_output=True, check=True, timeout=30).stdout
        hash_file = root / 'password-hash'
        hash_file.write_text(password_hash)
        model_file = root / 'empty-model-credential'
        model_file.write_text('')
        token_files = {}
        static_tokens = []
        import uuid
        for user in ('alice', 'bob'):
            path = root / (user + '-token')
            path.write_text(secrets.token_urlsafe(32) + '\n')
            token_files[user] = path
            static_tokens.append(dict(id=str(uuid.uuid4()), userId=user, name='owned-test-token',
                                      scopes=['Ingest', 'Read', 'Raw'], tokenFile=str(path)))
        with socket.socket() as candidate:
            candidate.bind(('127.0.0.1', 0))
            port = candidate.getsockname()[1]
        origin = f'http://127.0.0.1:{port}'
        model_calls = []
        class ScriptedModel(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                self.connection.settimeout(5)
                length = int(self.headers.get('Content-Length', '0'))
                assert 0 < length <= 512 * 1024
                request = json.loads(self.rfile.read(length))
                model_calls.append('completion')
                if any(m['role'] == 'tool' for m in request['messages']):
                    message = dict(role='assistant', content='owned scripted MCP fixture complete')
                    finish = 'stop'
                else:
                    message = dict(role='assistant', content=None, tool_calls=[dict(id='owned-call', type='function', function=dict(name='whoami', arguments='{}'))])
                    finish = 'tool_calls'
                body = json.dumps(dict(choices=[dict(message=message, finish_reason=finish)], usage=dict(prompt_tokens=10, completion_tokens=5))).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        model = ThreadingHTTPServer(('127.0.0.1', 0), ScriptedModel)
        model.daemon_threads = True
        model_thread = threading.Thread(target=model.serve_forever, daemon=True)
        model_thread.start()
        config = json.loads((REPO_ROOT / 'chronicle/config.example.json').read_text())
        config.update(listenPort=port, allowedOrigin=origin, secureCookies=False, allowInsecureHttp=False,
                      jdbcUrl=DATABASE['jdbcUrl'], databaseUser=DATABASE['user'],
                      databasePasswordFile=DATABASE['passwordFile'], databaseLimits=DATABASE['limits'],
                      users=[dict(id=u, login=u, passwordHashFile=str(hash_file), enabled=True) for u in ('alice', 'bob')],
                      staticTokens=static_tokens)
        config['annotation'].update(endpoint=f'http://127.0.0.1:{model.server_port}/chat', credentialFile=str(model_file))
        config['embedding'].update(endpoint='http://127.0.0.1:1/embed', credentialFile=str(model_file), dimensions=3)
        config_file = root / 'server.json'
        config_file.write_text(json.dumps(config))
        log = (report / 'server.log').open('x')
        process = subprocess.Popen([str(SERVER), 'serve-standby', str(config_file)], cwd=REPO_ROOT,
                                   env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        summary = dict(serverSha256=digest(SERVER), runtimeSource=os.environ.get('CHRONICLE_RUNTIME_SOURCE'),
                       runnerSha256=digest(Path(__file__)), nodeVersion=cli_binding['node']['version'], cliExecution=cli_binding,
                       packageLockSha256=digest(CLI_ROOT / 'package-lock.json'),
                       generatedCodecSha256={str(p.relative_to(REPO_ROOT)): digest(p) for p in sorted((REPO_ROOT / 'chronicle/generated/typescript').rglob('*.ts'))},
                       cliSourceSha256={str(p.relative_to(CLI_ROOT)): digest(p) for p in sorted((CLI_ROOT / 'src').glob('*.ts'))},
                       modelSha256=digest(REPO_ROOT / 'chronicle/models/chronicle.baboon'),
                       mode='native-standby-owned-postgresql-synthetic-scripted-model', cases=cases)
        try:
            deadline = time.monotonic() + 60
            while not listening(process, port):
                if process.poll() is not None:
                    raise AssertionError('owned native process exited; inspect retained server.log')
                if time.monotonic() >= deadline:
                    raise TimeoutError('owned native server readiness')
                time.sleep(.1)

            def call(label, args, user='alice', expected=0, document=None, token_file=None):
                assert process.poll() is None, 'owned native process exited'
                selected = dict(env, CHRONICLE_STATE_DIR=str(root / (user + '-state')),
                                CHRONICLE_TOKEN_FILE=str(token_files[user] if token_file is None else token_file))
                result = subprocess.run([*cli_command, '--url', origin,
                                         '--allow-insecure-http', '--json', *args], env=selected,
                                        input=None if document is None else json.dumps(document), text=True,
                                        capture_output=True, timeout=35)
                cases.append(dict(name=label, command=['chronicle', *[arg.replace(str(root), '<owned-fixture>') for arg in args]], expected=expected, actual=result.returncode,
                                  pass_=result.returncode == expected))
                assert result.returncode == expected, f'{label}: expected exit {expected}, got {result.returncode}; {result.stderr}'
                if expected == 0:
                    assert result.stderr == '', f'{label}: success diagnostics'
                    return json.loads(result.stdout)
                assert result.stdout == '', f'{label}: failure polluted stdout'
                return None

            def rpc(label, name, body, user='alice', expected=0, extra=None):
                return call(label, ['rpc', '--file', '-', *(extra or [])], user, expected, {name: body})

            call('public current versions', ['versions'])
            for user in ('alice', 'bob'):
                call('independent login ' + user, ['login', '--login', user, '--password-file', str(password_file)], user)
                call('session identity ' + user, ['whoami'], user)
            call('account settings and configured token metadata', ['settings'])
            call('account configured token rejection remains definitive', ['tokens', 'revoke', static_tokens[0]['id'], '--yes'], expected=3)
            call('account unknown token rejection remains definitive', ['tokens', 'revoke', str(uuid.uuid4()), '--yes'], expected=4)
            call('bearer identity', ['whoami', '--auth', 'bearer'])
            messages = [dict(id=f'm{i}', parentId=None, role='user', text=('Needle synthetic PostgreSQL 🙂' if i == 2 else f'synthetic content {i}'), timestamp=None, recordIndex=i) for i in range(1, 4)]
            records = [dict(type='session', id='session', version=3)] + [dict(type='message', id=m['id'], message=dict(role='user', content=[dict(type='text', text=m['text'])])) for m in messages]
            raw = ''.join(json.dumps(record, ensure_ascii=False) + '\n' for record in records)
            sha = hashlib.sha256(raw.encode()).hexdigest()
            request = dict(requestId=str(uuid.uuid4()), source=dict(collectorNamespace='cli-owned-test', discoveryRootId='synthetic-root', format='Pi', producerSessionId='synthetic-session', subagentId=None), expectedRevision=0, digest=sha, completion='Quiescent', redacted=False,
                           metadata=dict(title='CLI synthetic fixture', project='cli-project', workdir=None, gitRemote=None, gitBranch='main', gitCommit=None, producer='pi', model=None, startedAt=None, endedAt=None, tags=['synthetic']), messages=messages,
                           files=[dict(path='session.jsonl', sha256=sha, content=raw)])
            receipt = call('explicit stdin ingestion', ['ingest', '--file', '-', '--yes'], document=request)
            replay = call('deliberate exact payload ingest receipt replay', ['ingest', '--file', '-', '--yes'], document=request)
            assert replay == receipt
            conflict = dict(request, requestId=str(uuid.uuid4()))
            call('generated ingest CAS conflict remains definitive', ['ingest', '--file', '-', '--yes'], expected=5, document=conflict)
            session_id, job_id = receipt['sessionId'], receipt['jobId']
            report_data = dict(collectorId='cli-owned-test', sequence='1', runId=str(uuid.uuid4()), phase='Idle', startedAt='2026-11-16T00:00:00Z',
                               counters={**{k: 0 for k in ['discovered', 'scanned', 'waiting', 'excluded', 'unchanged', 'enqueued', 'uploaded', 'uploadFailures', 'quarantined', 'pending', 'stopped', 'conflicts']}, 'scannedBytes': '0'}, totalUploadBytes='0', uploadedBytes='0', currentUploadTotalBytes=None, error=None)
            call('explicit collector progress', ['report-progress', '--file', '-', '--yes'], document=report_data)
            session = call('session discovery and provenance', ['session', session_id])['Session']['result']['session']
            assert session['view'] == dict(revision=1, generationId=None)
            page = call('pinned message page one', ['messages', session_id, '--revision', '1', '--limit', '2'])['Messages']['result']
            assert len(page['messages']) == 2 and page['total'] == 3 and page['view'] == session['view']
            page = call('pinned message page two', ['messages', session_id, '--revision', '1', '--offset', '2', '--limit', '2'])['Messages']['result']
            assert [m['id'] for m in page['messages']] == ['m3']
            call('bearer pinned messages', ['messages', session_id, '--revision', '1', '--auth', 'bearer'])
            call('revision-only chunks', ['chunks', session_id, '--revision', '1'])
            call('revision-only passages', ['passages', session_id, '--revision', '1'])
            hits = call('selected history find', ['find', session_id, 'Needle', '--revision', '1'])['SessionMessageSearch']['result']['hits']
            assert [h['messageId'] for h in hits] == ['m2']
            call('locate exact message', ['locate', session_id, 'm2', '--revision', '1'])
            context = call('exact byte-context', ['context', session_id, '--revision', '1', '--message', 'm2', '--start', '0', '--end', '6'])['MessageContext']['result']
            assert context['view'] == session['view'] and context['anchor']['messageId'] == 'm2'
            archived = call('raw JSONL fidelity', ['raw', session_id, '--revision', '1'])['Raw']['result']
            assert archived['files'][0]['content'] == raw
            for label, args in [('lexical search (unindexed fixture)', ['search', 'synthetic']), ('archive', ['archive']), ('related', ['related', session_id]), ('facets', ['facets']), ('activity', ['activity']), ('jobs', ['jobs']), ('model usage/settings', ['usage']), ('collector status', ['collectors']), ('ingest progress', ['progress']), ('bearer facets', ['facets', '--auth', 'bearer']), ('bearer tag catalog', ['tags', '', '--auth', 'bearer'])]:
                call(label, args)
            rpc('typed archive legacy result', 'Archive', dict(query=dict(expression='', sort='LastTimestamp', direction='Desc', cursor=None, limit=20, preferRelevance=False)))
            rpc('typed expression hints', 'ExpressionHints', dict(query=dict(target=dict(Archive={}), expression='', caretUtf16=0, limit=10)))
            catalog = rpc('MCP test tool catalog', 'McpTestTools', {})['McpTestTools']['result']
            run_id = str(uuid.uuid4())
            tested = rpc('connection-owned MCP test through actual scripted model/tool loop', 'StartMcpTest', dict(instanceId=catalog['instanceId'], runId=run_id, prompt='Use whoami once, then finish the owned synthetic test.'), extra=['--yes'])['McpTestRun']['result']
            assert tested['state'] == 'Complete' and len(tested['events']) == 3
            assert len(model_calls) == 2
            observed = rpc('MCP trace erased after owner socket closes', 'ReadMcpTest', dict(instanceId=catalog['instanceId'], runId=run_id, afterSequence='0', limit=256))['McpTestRun']['result']
            assert observed['state'] == 'Cancelled' and observed['events'] == []
            rpc('MCP run-key cancellation', 'CancelMcpTest', dict(instanceId=catalog['instanceId'], runId=run_id), extra=['--yes'])
            failed_plan = call('failed retry preview', ['retry-failed', 'preview'])['RetryFailedPreview']['result']
            retried = call('confirmed empty failed retry', ['retry-failed', 'apply', '--target-profile', failed_plan['targetProfile'], '--selection-hash', failed_plan['selectionHash'], '--yes'])['RetryFailed']['result']
            recovered_retry = call('retry receipt lookup binds its historical request', ['receipt', retried['requestId']])['RetryFailed']['result']
            assert recovered_retry == retried
            plan = call('owner reindex preview', ['reindex', 'preview'])['OwnerReindexPreview']['result']
            rebuilt = call('confirmed owner reindex apply', ['reindex', 'apply', '--target-profile', plan['targetProfile'], '--selection-hash', plan['selectionHash'], '--yes'])['OwnerReindexed']['result']
            recovered_reindex = call('owner reindex receipt lookup binds its historical request', ['receipt', rebuilt['requestId']])['OwnerReindexed']['result']
            assert recovered_reindex == rebuilt
            status = call('captured reindex cohort status', ['reindex', 'status', rebuilt['requestId']])['ReindexStatus']['result']
            assert int(status['total']) == 1 and sum(int(status[k]) for k in ['complete', 'superseded', 'failed', 'pending']) == 1
            issued_file = root / 'issued-token'
            issued = call('account token mint to private file', ['tokens', 'mint', '--name', 'acceptance-issued', '--scopes', 'Read,Raw', '--secret-out', str(issued_file), '--yes'])
            assert issued_file.stat().st_mode & 0o777 == 0o600 and 'secret' not in issued
            call('issued token bearer authentication', ['whoami', '--auth', 'bearer'], token_file=issued_file)
            call('account token revoke', ['tokens', 'revoke', issued['token']['id'], '--yes'])
            call('revoked bearer denied', ['whoami', '--auth', 'bearer'], token_file=issued_file, expected=3)
            ws_secret = root / 'ws-token'
            mutation_id = str(uuid.uuid4())
            token_result = rpc('WS token mint', 'MintToken', dict(name='ws-issued', scopes=['Read']), extra=['--yes', '--secret-out', str(ws_secret), '--request-id', mutation_id])
            assert token_result['Token']['result']['secret'] is None and ws_secret.stat().st_mode & 0o777 == 0o600
            recovered = call('WS one-time secret receipt metadata only', ['receipt', mutation_id])
            assert recovered['Token']['result']['secret'] is None
            rpc('WS token revoke', 'RevokeToken', dict(tokenId=token_result['Token']['result']['token']['id']), extra=['--yes'])
            created = call('create group', ['groups', 'create', 'owned-test-sharing', '--yes'])['Mutation']['receipt']
            recovered_group = call('ordinary mutation receipt lookup binds its historical request', ['receipt', created['requestId']])['Mutation']['receipt']
            assert recovered_group == created
            group = created['entityId']
            invite = call('invite member', ['groups', 'invite', group, 'bob', '--yes'])['Mutation']['receipt']['entityId']
            call('list invitations', ['groups'], 'bob')
            call('accept explicit archive sharing', ['groups', 'accept', invite, '--confirm-sharing', '--yes'], 'bob')
            call('shared source authorized', ['session', session_id], 'bob')
            call('remove member', ['groups', 'remove', group, 'bob', '--yes'])
            call('removed member denied indistinguishably', ['session', session_id], 'bob', expected=4)
            call('delete group', ['groups', 'delete', group, '--yes'])
            call('purge only owned synthetic source', ['purge', session_id, '--yes'])
            call('purged source unavailable', ['session', session_id], expected=4)
            call('independent logout', ['logout', '--yes'])
            call('logged out session rejected', ['whoami'], expected=3)
            call('other human session remains independent', ['session-status'], 'bob')
            summary.update(status='passed', tests=len(cases), failures=0, errors=0, skips=0)
        except BaseException:
            summary.update(status='failed', tests=len(cases), failures=sum(not c['pass_'] for c in cases), errors=1, skips=0)
            raise
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
            log.close()
            model.shutdown()
            model.server_close()
            model_thread.join(timeout=5)
            assert not model_thread.is_alive(), 'owned scripted model cleanup failed'
            summary['scriptedModelCalls'] = len(model_calls)
            summary['ownedServerExit'] = process.returncode
            (report / 'receipt.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(dict(status=summary['status'], tests=summary['tests'], failures=summary['failures'], errors=summary['errors'], skips=0, report=str(report))))


if __name__ == '__main__':
    main()
