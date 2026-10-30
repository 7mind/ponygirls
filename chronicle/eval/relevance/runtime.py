"""Linux-owned process lifecycle; external providers are never owned or stopped."""
import ctypes
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time
from bridge import ListenerNotReady, ownership
from evaluate import digest, save

AGENT_STOP_SECONDS = 60
OWNED_STOP_SECONDS = 8


class Run:
    def __init__(self, directory, environment, seconds):
        self.directory = directory; self.children = []; self.exits = []; self.deadline = time.monotonic() + seconds
        (directory / 'home').mkdir(); (directory / 'tmp').mkdir()
        self.env = dict(environment, HOME=str(directory / 'home'), TMPDIR=str(directory / 'tmp'))

    def remaining(self, seconds):
        left = min(seconds, self.deadline - time.monotonic())
        if left <= 0:
            raise TimeoutError('matrix deadline; incomplete experiment')
        return left

    def start(self, name, command):
        log = (self.directory / (name + '.log')).open('x')
        try:
            process = subprocess.Popen(command, cwd=self.directory, env=self.env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        except BaseException:
            log.close(); raise
        self.children.append((name, process, log)); return process

    def stop(self, item):
        name, process, log = item
        if any(e['name'] == name for e in self.exits):
            return
        forced = False
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(AGENT_STOP_SECONDS if name.startswith('agent-') else OWNED_STOP_SECONDS)
            except subprocess.TimeoutExpired:
                forced = True
                os.killpg(process.pid, signal.SIGKILL); process.wait(8)
        log.close(); self.exits.append({'name': name, 'pid': process.pid, 'exit': process.returncode, 'forced': forced})

    def command(self, name, command):
        process = self.start(name, command)
        try:
            code = process.wait(self.remaining(60))
        finally:
            self.stop(self.children[-1])
        if code != 0:
            raise RuntimeError(name + ' failed; retained log and exit status')

    def wait(self, label, inspect):
        deadline = time.monotonic() + self.remaining(60)
        while time.monotonic() < deadline:
            if inspect():
                return
            time.sleep(.1)
        raise TimeoutError(label)


def port():
    with socket.socket() as candidate:
        candidate.bind(('127.0.0.1', 0)); return candidate.getsockname()[1]


def identity(process, executable, sha, number, launcher):
    if process.poll() is not None:
        raise RuntimeError('owned child exited before readiness/inspection')
    actual = Path(f'/proc/{process.pid}/exe')
    if launcher is not None and actual.resolve() == Path(launcher['path']).resolve() and digest(actual) == launcher['sha256'] and actual.resolve() != executable.resolve():
        return False
    manifest = {'origin': f'http://127.0.0.1:{number}', 'pid': process.pid, 'executable': str(executable), 'elfSha256': sha}
    try:
        ownership(manifest)
        return True
    except ListenerNotReady:
        return False


def listener_proof(process, executable, sha, number):
    actual = Path(f'/proc/{process.pid}/exe')
    descriptors = {}
    for fd in Path(f'/proc/{process.pid}/fd').iterdir():
        try:
            target = os.readlink(fd)
        except FileNotFoundError:
            continue
        if target.startswith('socket:['):
            descriptors[target[8:-1]] = fd.name
    rows = []
    for table in ('tcp', 'tcp6'):
        for line in Path(f'/proc/{process.pid}/net/{table}').read_text().splitlines()[1:]:
            fields = line.split()
            if fields[3] == '0A' and int(fields[1].split(':')[1], 16) == number and fields[9] in descriptors:
                rows.append({'table': table, 'local': fields[1], 'inode': fields[9], 'fd': descriptors[fields[9]]})
    return {'pid': process.pid, 'expectedPort': number, 'expectedAddress': '127.0.0.1', 'expectedExecutable': str(executable),
            'expectedSha256': sha, 'actualExecutable': str(actual.resolve()), 'actualSha256': digest(actual), 'ownedListenerRows': rows}


def terminate(signum, frame):
    raise KeyboardInterrupt('parent termination; owned cleanup')


def enable_subreaper():
    if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'cannot enable owned-child subreaper')


def cleanup_adopted_children():
    started = time.monotonic(); signalled = set(); forced = set(); exits = []
    children_file = Path(f'/proc/self/task/{os.getpid()}/children')
    while children_file.read_text().split():
        elapsed = time.monotonic() - started
        if elapsed > 8:
            raise TimeoutError('owned adopted-child cleanup deadline')
        for text in children_file.read_text().split():
            pid = int(text)
            try:
                descriptor = os.pidfd_open(pid)
            except ProcessLookupError:
                continue
            try:
                status = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
                if int(status[1]) != os.getpid():
                    raise RuntimeError('refusing non-child cleanup')
                if pid not in signalled or elapsed > 4 and pid not in forced:
                    sig = signal.SIGKILL if elapsed > 4 else signal.SIGTERM
                    try:
                        signal.pidfd_send_signal(descriptor, sig)
                    except ProcessLookupError:
                        pass
                    signalled.add(pid)
                    if sig == signal.SIGKILL:
                        forced.add(pid)
                reaped, code = os.waitpid(pid, os.WNOHANG)
                if reaped:
                    exits.append({'pid': pid, 'waitStatus': code, 'forced': pid in forced})
            finally:
                os.close(descriptor)
        time.sleep(.02)
    return exits


def read_trace(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def finish(run, directory, failure, summary, adopted_cleanup):
    errors = []
    def attempt(stage, action):
        try:
            action(); return True
        except BaseException as error:
            errors.append({'stage': stage, 'type': type(error).__name__, 'message': str(error)})
            return False
    managed = []
    for item in reversed(run.children):
        managed.append(attempt('managed:' + item[0], lambda: run.stop(item)))
    attempt('managed-exit-record', lambda: save(directory / 'child-exits.json', run.exits))
    adopted = attempt('adopted-children', lambda: save(directory / 'adopted-child-exits.json', adopted_cleanup()))
    save(directory / 'cleanup.json', {'ownedChildrenReaped': all(managed) and adopted, 'externalProvidersManaged': False,
         'failure': failure, 'cleanupErrors': errors,
         'forcedChildren': [item['name'] for item in run.exits if item.get('forced', False)],
         'managedExitStatuses': run.exits,
         'summaryStatus': 'cleanup-failed' if errors else summary['status'] if summary is not None else 'matrix-incomplete-test'})
    if errors:
        raise RuntimeError('candidate cleanup failed; inspect retained cleanup.json')
