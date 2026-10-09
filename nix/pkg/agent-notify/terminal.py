import errno
import fcntl
import os
import pty
import select
import signal
import subprocess
import sys
import tempfile
import termios
import tty
from pathlib import Path
from typing import Callable

from notify import Focus


FOCUS_REPORTING_ON = b"\x1b[?1004h"
FOCUS_REPORTING_OFF = b"\x1b[?1004l"
FOCUS_IN = b"\x1b[I"
FOCUS_OUT = b"\x1b[O"
BUFFER_SIZE = 8192
HIGH_WATER_BYTES = 4096


class FocusInput:
    def __init__(self, publish: Callable[[Focus], None]):
        self.publish = publish
        self.tail = b""
        self.known = False

    def feed(self, data: bytes) -> None:
        combined = self.tail + data
        for index in range(len(combined) - 2):
            event = combined[index:index + 3]
            if event in (FOCUS_IN, FOCUS_OUT):
                self.publish(Focus.FOCUSED if event == FOCUS_IN else Focus.UNFOCUSED)
                self.known = True
        if not self.known and combined and not any(event.startswith(combined) for event in (FOCUS_IN, FOCUS_OUT)):
            self.publish(Focus.FOCUSED)
            self.known = True
        self.tail = combined[-2:]


class FocusOutput:
    def __init__(self):
        self.pending = b""

    def feed(self, data: bytes) -> bytes:
        self.pending += data
        suffix = 0
        for length in range(1, len(FOCUS_REPORTING_OFF)):
            if self.pending.endswith(FOCUS_REPORTING_OFF[:length]):
                suffix = length
        output = self.pending[:-suffix] if suffix else self.pending
        self.pending = self.pending[-suffix:] if suffix else b""
        return output.replace(FOCUS_REPORTING_OFF, FOCUS_REPORTING_ON)


def write_all(descriptor: int, data: bytes) -> None:
    remaining = memoryview(data)
    while remaining:
        count = os.write(descriptor, remaining)
        remaining = remaining[count:]


def run(command: list[str], focus_file: Path) -> int:
    def publish(focus: Focus) -> None:
        descriptor, name = tempfile.mkstemp(dir=focus_file.parent)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(focus.value)
        os.replace(name, focus_file)

    if not os.isatty(0) or not os.isatty(1):
        publish(Focus.UNFOCUSED)
        code = subprocess.run(command, check=False).returncode
        return code if code >= 0 else 128 - code
    publish(Focus.UNKNOWN)
    size = fcntl.ioctl(0, termios.TIOCGWINSZ, b"\0" * 8)
    child, master = pty.fork()
    if child == 0:
        fcntl.ioctl(0, termios.TIOCSWINSZ, size)
        os.execvp(command[0], command)

    def resize(_signal: int, _frame: object) -> None:
        fcntl.ioctl(master, termios.TIOCSWINSZ, fcntl.ioctl(0, termios.TIOCGWINSZ, b"\0" * 8))

    previous_resize = signal.signal(signal.SIGWINCH, resize)
    def forward(number: int, _frame: object) -> None:
        try:
            os.killpg(child, number)
        except ProcessLookupError:
            pass

    previous_signals = {
        number: signal.signal(number, forward)
        for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT)
    }
    attributes = termios.tcgetattr(0)
    inputs = FocusInput(publish)
    outputs = FocusOutput()
    stdout_blocking = os.get_blocking(1)
    try:
        tty.setraw(0)
        write_all(1, FOCUS_REPORTING_ON)
        os.set_blocking(master, False)
        os.set_blocking(1, False)
        pending_input = b""
        pending_output = b""
        master_open = True
        while master_open or pending_output:
            readers = []
            writers = []
            if master_open and len(pending_input) < HIGH_WATER_BYTES:
                readers.append(0)
            if master_open and len(pending_output) < HIGH_WATER_BYTES:
                readers.append(master)
            if pending_input and master_open:
                writers.append(master)
            if pending_output:
                writers.append(1)
            readable, writable, _exceptional = select.select(readers, writers, [])
            for descriptor in readable:
                try:
                    data = os.read(descriptor, BUFFER_SIZE)
                except BlockingIOError:
                    continue
                except OSError as error:
                    if descriptor != master or error.errno != errno.EIO:
                        raise
                    data = b""
                if not data:
                    master_open = False
                    continue
                if descriptor == 0:
                    inputs.feed(data)
                    pending_input += data
                else:
                    pending_output += outputs.feed(data)
            for descriptor in writable:
                try:
                    if descriptor == master and master_open:
                        pending_input = pending_input[os.write(master, pending_input):]
                    elif descriptor == 1:
                        pending_output = pending_output[os.write(1, pending_output):]
                except BlockingIOError:
                    continue
        os.set_blocking(1, stdout_blocking)
        write_all(1, outputs.pending)
    finally:
        os.set_blocking(1, stdout_blocking)
        termios.tcsetattr(0, termios.TCSADRAIN, attributes)
        write_all(1, FOCUS_REPORTING_OFF)
        signal.signal(signal.SIGWINCH, previous_resize)
        for number, handler in previous_signals.items():
            signal.signal(number, handler)
        os.close(master)
    _pid, status = os.waitpid(child, 0)
    code = os.waitstatus_to_exitcode(status)
    return code if code >= 0 else 128 - code


def main() -> int:
    if len(sys.argv) < 2:
        raise ValueError("terminal focus wrapper requires a command")
    cache = Path(os.environ.get("XDG_CACHE_HOME", str(Path(os.environ["HOME"]) / ".cache")))
    directory = cache / "ponygirls-notify" / "focus"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(dir=directory)
    os.close(descriptor)
    focus_file = Path(name)
    os.environ["PONYGIRLS_NOTIFY_FOCUS_FILE"] = name
    try:
        return run(sys.argv[1:], focus_file)
    finally:
        focus_file.unlink()


if __name__ == "__main__":
    sys.exit(main())
