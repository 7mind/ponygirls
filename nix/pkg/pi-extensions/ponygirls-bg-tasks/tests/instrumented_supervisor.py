"""The real supervisor with signal-authority tracing for tests.

Every numeric group signal must target an unreaped leader that is still this
process's child; every pidfd must be opened on a current child. Violations are
appended to $BG_TRACE. With BG_IGNORE_KILLS=1, TERM/KILL deliveries are dropped
to simulate work whose cleanup cannot be confirmed.
"""
import json
import os
import signal
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import supervisor as sv  # noqa: E402

TRACE = os.environ["BG_TRACE"]
IGNORE_KILLS = os.environ.get("BG_IGNORE_KILLS") == "1"
_real_killpg = os.killpg
_real_pidfd_open = os.pidfd_open
_real_pidfd_send = signal.pidfd_send_signal


def _trace(entry):
    with open(TRACE, "a") as f:
        f.write(json.dumps(entry) + "\n")


def _is_child(pid):
    identity = sv.proc_parent_and_group(pid)
    return identity is not None and identity[0] == os.getpid()


def killpg(pgid, sig):
    ok = _is_child(pgid) and sv.proc_parent_and_group(pgid)[1] == pgid
    _trace({"op": "killpg", "pgid": pgid, "sig": int(sig), "authorized": ok})
    if IGNORE_KILLS and sig in (signal.SIGTERM, signal.SIGKILL):
        return
    _real_killpg(pgid, sig)


def pidfd_open(pid, flags=0):
    ok = pid == os.getpid() or _is_child(pid)
    _trace({"op": "pidfd_open", "pid": pid, "authorized": ok})
    return _real_pidfd_open(pid, flags)


def pidfd_send_signal(fd, sig, *args):
    _trace({"op": "pidfd_send_signal", "sig": int(sig)})
    if IGNORE_KILLS and sig in (signal.SIGTERM, signal.SIGKILL):
        return
    _real_pidfd_send(fd, sig, *args)


os.killpg = killpg
os.pidfd_open = pidfd_open
signal.pidfd_send_signal = pidfd_send_signal

if __name__ == "__main__":
    sys.exit(sv.main(sys.argv[1:]))
