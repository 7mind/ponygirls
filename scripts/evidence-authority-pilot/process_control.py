"""Bounded owned-process lifecycle capture, including the period AFTER pipe EOF.

The caller supplies reviewed argv/cwd/environment and containment. This port does
not build a sandbox, authorize code, authenticate PID/cwd, or decode provider errors.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
import math
import os
import selectors
import signal
import subprocess
import time


class ProcessError(ValueError):
    pass


def require(ok: bool, code: str) -> None:
    if not ok:
        raise ProcessError(code)


@dataclass(frozen=True)
class ProcessRequest:
    argv: tuple[str, ...]
    cwd: str
    environment: tuple[tuple[str, str], ...]
    input_bytes: bytes | None
    timeout_seconds: float
    output_bytes: int

    def __post_init__(self) -> None:
        require(type(self.argv) is tuple and bool(self.argv)
                and all(type(x) is str and x and '\x00' not in x for x in self.argv), 'process-argv')
        require(self.argv[0].startswith('/'), 'process-executable-absolute')
        require(type(self.cwd) is str and self.cwd.startswith('/') and '\x00' not in self.cwd, 'process-cwd')
        require(type(self.environment) is tuple and all(type(p) is tuple and len(p) == 2
                and all(type(x) is str and '\x00' not in x for x in p)
                and p[0] and '=' not in p[0] for p in self.environment), 'process-environment')
        require(len({p[0] for p in self.environment}) == len(self.environment), 'process-environment-duplicate')
        require(self.input_bytes is None or type(self.input_bytes) is bytes, 'process-input')
        require(type(self.timeout_seconds) in (int, float) and math.isfinite(self.timeout_seconds)
                and self.timeout_seconds > 0, 'process-deadline')
        require(type(self.output_bytes) is int and self.output_bytes > 0, 'process-output-bound')


@dataclass(frozen=True)
class ProcessOutcome:
    status: str
    exit_code: int | None
    stdout: bytes
    stderr: bytes
    stdout_eof: bool
    stderr_eof: bool
    process_id: int | None
    argv: tuple[str, ...]
    cwd: str
    started_monotonic_ns: int
    ended_monotonic_ns: int
    started_utc: str
    ended_utc: str
    input_bytes_sent: int
    error_codes: tuple[str, ...]


class ProcessRunner:
    def run(self, request: ProcessRequest) -> ProcessOutcome:
        require(type(request) is ProcessRequest, 'process-request-type')
        started_ns = time.monotonic_ns()
        started_utc = datetime.now(timezone.utc).isoformat()
        deadline = time.monotonic() + request.timeout_seconds
        buffers = {'stdout': bytearray(), 'stderr': bytearray()}
        eof = {'stdout': False, 'stderr': False}
        errors = []
        status = 'completed'
        sent = 0
        try:
            process = subprocess.Popen(request.argv, cwd=request.cwd,
                env=dict(request.environment), stdin=subprocess.DEVNULL if request.input_bytes is None else subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, close_fds=True)
        except OSError:
            return ProcessOutcome('start-failed', None, b'', b'', False, False, None,
                request.argv, request.cwd, started_ns, time.monotonic_ns(), started_utc,
                datetime.now(timezone.utc).isoformat(), 0, ('process-start',))

        def terminate_owned_group() -> None:
            # Popen created this exact new session/group. Caller must isolate PIDs;
            # this is not a general hostile PID-reuse/escape guarantee.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except OSError:
                errors.append('process-group-stop')

        try:
            with selectors.DefaultSelector() as selector:
                for label, stream in [('stdout', process.stdout), ('stderr', process.stderr)]:
                    os.set_blocking(stream.fileno(), False)
                    selector.register(stream, selectors.EVENT_READ, label)
                if process.stdin is not None:
                    if request.input_bytes:
                        os.set_blocking(process.stdin.fileno(), False)
                        selector.register(process.stdin, selectors.EVENT_WRITE, 'stdin')
                    else:
                        process.stdin.close()
                while selector.get_map() or process.poll() is None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        status = 'timeout'; terminate_owned_group(); break
                    if not selector.get_map():
                        # Unlike g5's unbounded post-EOF wait, this still observes
                        # the same lifecycle deadline after both channels close.
                        try:
                            process.wait(timeout=remaining)
                        except subprocess.TimeoutExpired:
                            status = 'timeout'; terminate_owned_group()
                        break
                    for key, _ in selector.select(remaining):
                        stream = key.fileobj
                        if key.data == 'stdin':
                            try:
                                sent += os.write(stream.fileno(), request.input_bytes[sent:sent + 65536])
                            except BlockingIOError:
                                continue
                            except BrokenPipeError:
                                selector.unregister(stream); stream.close(); continue
                            if sent == len(request.input_bytes):
                                selector.unregister(stream); stream.close()
                            continue
                        try:
                            chunk = os.read(stream.fileno(), 65536)
                        except BlockingIOError:
                            continue
                        if not chunk:
                            eof[key.data] = True
                            selector.unregister(stream); stream.close(); continue
                        target = buffers[key.data]
                        room = request.output_bytes - len(target)
                        target.extend(chunk[:room])
                        if len(chunk) > room:
                            status = 'output-limit'; terminate_owned_group(); break
                    if status != 'completed':
                        break
        except KeyboardInterrupt:
            status = 'interrupted'; terminate_owned_group()
        except (OSError, ValueError):
            status = 'capture-failed'; errors.append('process-channel'); terminate_owned_group()
        finally:
            if process.poll() is None:
                terminate_owned_group()
            try:
                process.wait(timeout=5)
            except (subprocess.TimeoutExpired, OSError):
                errors.append('process-reap')
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream is not None and not stream.closed:
                    try:
                        stream.close()
                    except OSError:
                        errors.append('process-channel-close')
        if errors:
            status = 'capture-failed'
        return ProcessOutcome(status, process.returncode, bytes(buffers['stdout']), bytes(buffers['stderr']),
            eof['stdout'], eof['stderr'], process.pid, request.argv, request.cwd, started_ns,
            time.monotonic_ns(), started_utc, datetime.now(timezone.utc).isoformat(), sent, tuple(errors))
