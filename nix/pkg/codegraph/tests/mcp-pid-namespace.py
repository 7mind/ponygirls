#!/usr/bin/env python3
"""Optional real yolo MCP regression; intentionally not a nested Nix build test.

CODEGRAPH_TEST_ROOT must be an absolute writable project directory that yolo
binds into its sandbox. CODEGRAPH_BIN must be the absolute patched CLI path.
Run from an environment where `yolo cmd` is available. Both steady-state peer
sweeping and namespace crash/relaunch are always exercised. Failure fixtures
are retained; CODEGRAPH_KEEP_FIXTURE=1 also retains successful diagnostics.
"""
import json
import os
import pathlib
import select
import shutil
import stat
import subprocess
import tempfile
import time

base = pathlib.Path(os.environ['CODEGRAPH_TEST_ROOT'])
binary = pathlib.Path(os.environ['CODEGRAPH_BIN'])
if not base.is_absolute() or not base.is_dir() or not binary.is_absolute():
    raise ValueError('CODEGRAPH_TEST_ROOT must be an absolute existing project; CODEGRAPH_BIN must be absolute')
base = base.resolve()
root = pathlib.Path(tempfile.mkdtemp(prefix='codegraph-mcp-namespace-', dir=base))
clients = []
logs = []
owned_sockets = set()
env = {**os.environ, 'CODEGRAPH_NO_UPDATE_CHECK': '1', 'CODEGRAPH_TELEMETRY': '0', 'CODEGRAPH_FORCE_WATCH': '1'}
# This test must exercise daemon mode even if the caller normally opts out.
env.pop('CODEGRAPH_NO_DAEMON', None)
env.pop('CODEGRAPH_DAEMON_INTERNAL', None)
success = False


def start(sandbox):
    log_path = root / ('sandbox-%d.stderr' % len(clients) if sandbox else 'host.stderr')
    log = log_path.open('w')
    logs.append(log)
    cmd = [str(binary), 'serve', '--mcp', '--path', str(root)]
    if sandbox:
        cmd = ['yolo', '--env', 'CODEGRAPH_NO_UPDATE_CHECK=1', '--env', 'CODEGRAPH_TELEMETRY=0',
               '--env', 'CODEGRAPH_DAEMON_CLIENT_SWEEP_MS=500',
               '--env', 'CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS=1000'] + (
                   ['--env', 'CODEGRAPH_SOCKET_DIR=' + env['CODEGRAPH_SOCKET_DIR']]
                   if 'CODEGRAPH_SOCKET_DIR' in env else []) + ['cmd'] + cmd
    p = subprocess.Popen(cmd, cwd=base, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=log, env=env, text=True, bufsize=1)
    clients.append(p)
    return p


def request(p, i, method, params):
    p.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': i, 'method': method, 'params': params}) + '\n')
    p.stdin.flush()
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if not select.select([p.stdout], [], [], max(0, deadline - time.monotonic()))[0]:
            raise TimeoutError(method)
        line = p.stdout.readline()
        if not line:
            raise RuntimeError('MCP exited: %s' % p.poll())
        response = json.loads(line)
        if response.get('id') == i:
            return response
    raise TimeoutError(method)


def initialize(p):
    result = request(p, 1, 'initialize', {'protocolVersion': '2024-11-05', 'capabilities': {},
                                      'clientInfo': {'name': 'namespace-regression', 'version': '1'}})
    assert 'result' in result, result
    p.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
    p.stdin.flush()


def explore(p, i):
    result = request(p, i, 'tools/call', {'name': 'codegraph_explore',
                     'arguments': {'query': 'namespaceSentinel', 'projectPath': str(root)}})
    assert 'namespaceSentinel' in json.dumps(result), result
    assert not result.get('result', {}).get('isError'), result
    return result


def fences_free():
    flock = os.environ.get('CODEGRAPH_FLOCK', shutil.which('flock'))
    if not flock:
        return False  # cannot prove safety to remove diagnostics
    for name in ['writer.pid.flock', 'daemon.pid.flock', 'rebuild.pid.flock', 'codegraph.lock.flock']:
        sidecar = root / '.codegraph' / name
        if sidecar.exists() and subprocess.run([flock, '-n', str(sidecar), 'true'],
                                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
            return False
    return True


try:
    subprocess.run(['git', '-C', str(root), 'init', '--quiet'], check=True)
    (root / 'sentinel.ts').write_text('export function namespaceSentinel() { return 42; }\n')
    subprocess.run([str(binary), 'init', str(root), '--yes'], env=env, check=True, capture_output=True)
    sandbox = start(True)
    initialize(sandbox)
    explore(sandbox, 2)
    before = json.loads((root / '.codegraph' / 'daemon.pid').read_text())
    assert before.get('lockProtocol') == 'flock-v1', before
    owned_sockets.add(pathlib.Path(before['socketPath']))
    # Killing yolo's namespace root abandons daemon records but the kernel
    # releases ownership. A new namespace must elect normally, not fall back.
    sandbox.kill()
    sandbox.wait(timeout=5)
    deadline = time.monotonic() + 10
    while not fences_free() and time.monotonic() < deadline:
        time.sleep(.1)
    assert fences_free(), 'Killed namespace still owns kernel fences'
    sandbox = start(True)
    initialize(sandbox)
    explore(sandbox, 2)
    after = json.loads((root / '.codegraph' / 'daemon.pid').read_text())
    # Linux may recycle the dead namespace inode immediately. The kernel
    # fences above prove death; startedAt proves a new ownership incarnation.
    assert after['startedAt'] > before['startedAt'], 'Expected newly elected daemon ownership'
    assert after['lockProtocol'] == 'flock-v1', after
    owned_sockets.add(pathlib.Path(after['socketPath']))
    host = start(False)
    initialize(host)
    explore(host, 2)
    time.sleep(3)  # six client sweeps plus the 1-second idle backstop
    explore(host, 3)
    daemon_log = (root / '.codegraph' / 'daemon.log').read_text()
    assert 'Reaping client with dead peer' not in daemon_log, daemon_log
    for log in root.glob('*.stderr'):
        assert 'degraded' not in log.read_text(), log.read_text()
    print('PASS: namespace crash/relaunch and live foreign MCP peer survive sweeps')
    print('namespace identities:', before['namespace'], '->', after['namespace'])
    success = True
finally:
    # Only terminate Popen handles owned by this test. Never signal recorded
    # daemon PIDs: those integers belong to another namespace.
    for p in reversed(clients):
        if p.poll() is None:
            try:
                p.stdin.close()
            except (BrokenPipeError, OSError):
                pass
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.terminate()
                try:
                    p.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    p.kill()
                    p.wait(timeout=5)
    for log in logs:
        log.close()
    deadline = time.monotonic() + 10
    while not fences_free() and time.monotonic() < deadline:
        time.sleep(.1)
    if success and os.environ.get('CODEGRAPH_KEEP_FIXTURE') != '1' and fences_free():
        shared_dir = pathlib.Path(env.get('CODEGRAPH_SOCKET_DIR', str(pathlib.Path.home() / '.cache/codegraph/sockets'))).resolve()
        for socket in owned_sockets:
            # Only exact socket names captured from this test's elected daemon
            # records, under the configured shared cache, after all fences free.
            if socket.parent.resolve() == shared_dir and socket.exists() and stat.S_ISSOCK(socket.lstat().st_mode):
                socket.unlink()
        shutil.rmtree(root)
    else:
        print('Retained fixture and diagnostics:', root, flush=True)
