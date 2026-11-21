"""Mandatory local Linux/bubblewrap isolation for every upstream Python execution."""

import functools
import os
from pathlib import Path
import re
import resource
import selectors
import shutil
import signal
import subprocess
import tempfile
import time

HERE = Path(__file__).resolve().parent
WALL_SECONDS = 12
OUTPUT_BYTES = 192 * 1024


class Unknown(RuntimeError):
    """Trusted short reason code; never include sandbox output in a receipt."""


@functools.lru_cache
def runtime():
    # Resolve the standard library, not sys.prefix (which may be an environment
    # with arbitrary packages). There is no permissive system-Python fallback.
    root = Path(os.__file__).resolve().parents[2]
    bwrap = shutil.which('bwrap')
    if not (bwrap and root.parent == Path('/nix/store') and
            re.fullmatch(r'[0-9a-z]{32}-python3-[\d.]+', root.name)):
        raise Unknown('need_bwrap_and_plain_nix_python')
    try:
        nix_store = shutil.which('nix-store')
        if not nix_store:
            raise Unknown('python_closure_unavailable')
        rc, output = capture([nix_store, '--query', '--requisites', str(root)])
        if rc != 0:
            raise Unknown('python_closure_unavailable')
        paths = output.decode('ascii').splitlines()
    except (OSError, UnicodeError, subprocess.SubprocessError):
        raise Unknown('python_closure_unavailable') from None
    if not (0 < len(paths) <= 80 and str(root) in paths and all(
        re.fullmatch(r'/nix/store/[0-9a-z]{32}-[^/\s]+', path) for path in paths
    )):
        raise Unknown('invalid_python_closure')
    return bwrap, str(root / 'bin/python3'), tuple(sorted(paths))


def limits():
    # These apply to bwrap and every descendant. The driver drops NPROC to
    # zero *after* bwrap constructs the PID namespace (before loading source).
    for key, value in (
        (resource.RLIMIT_CPU, 6), (resource.RLIMIT_AS, 384 << 20),
        (resource.RLIMIT_FSIZE, 512 << 10), (resource.RLIMIT_NOFILE, 64),
        (resource.RLIMIT_CORE, 0),
    ):
        inherited = [n for n in resource.getrlimit(key) if n != resource.RLIM_INFINITY]
        bound = min([value, *inherited])
        resource.setrlimit(key, (bound, bound))


def capture(args):
    # communicate() / capture_output=True would accumulate unbounded output
    # before checking its size. The timeout bounds even the drain after exit.
    deadline = time.monotonic() + WALL_SECONDS
    try:
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, env={}, cwd='/', close_fds=True,
                                   start_new_session=True, preexec_fn=limits)
    except (OSError, subprocess.SubprocessError):
        raise Unknown('local_process_start_failed') from None
    with process:
        try:
            data = bytearray()
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while True:
                    left = deadline - time.monotonic()
                    if left <= 0 or not selector.select(left):
                        raise Unknown('wall_limit')
                    chunk = os.read(process.stdout.fileno(), 8192)
                    if not chunk:
                        break
                    if len(data) + len(chunk) > OUTPUT_BYTES:
                        raise Unknown('output_limit')
                    data.extend(chunk)
            try:
                return process.wait(timeout=max(0, deadline - time.monotonic())), bytes(data)
            except subprocess.TimeoutExpired:
                raise Unknown('wall_limit') from None
        finally:
            if process.poll() is None:
                # Terminate outer bwrap; its --die-with-parent and PID namespace
                # reaper also kill the session started *inside* the sandbox.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass


def execute(files, case_id, phase):
    bwrap, python, closure = runtime()
    with tempfile.TemporaryDirectory(prefix='preview-case-') as temporary:
        root = Path(temporary)
        for name, data in files.items():  # names selected by host from pinned archives only
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        args = [bwrap, '--unshare-all', '--unshare-user', '--unshare-net',
                '--unshare-pid', '--disable-userns', '--assert-userns-disabled',
                '--new-session', '--die-with-parent', '--clearenv', '--cap-drop', 'ALL',
                '--uid', '65534', '--gid', '65534', '--hostname', 'ci',
                '--setenv', 'HOME', '/home/empty', '--setenv', 'LC_ALL', 'C',
                '--setenv', 'TZ', 'UTC', '--setenv', 'NO_COLOR', '1',
                '--dir', '/home/empty', '--ro-bind', '/dev/null', '/dev/null',
                '--size', str(2 << 20), '--tmpfs', '/tmp']
        for path in closure:
            args.extend(['--ro-bind', path, path])
        args.extend(['--ro-bind', str(root), '/project',
                     '--ro-bind', str(HERE / 'driver.py'), '/suite/driver.py'])
        if phase == 'heldout':
            args.extend(['--ro-bind', str(HERE / 'heldout.py'), '/suite/heldout.py'])
        args.extend(['--remount-ro', '/', '--chdir', '/project', '--', python,
                     '-I', '-S', '-B', '-X', 'utf8', '-W', 'ignore::DeprecationWarning',
                     '/suite/driver.py', case_id, phase])
        return capture(args)
