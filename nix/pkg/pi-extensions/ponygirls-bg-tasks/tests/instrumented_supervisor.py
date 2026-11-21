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
DARWIN = sys.platform == "darwin"
if not DARWIN:
    _real_pidfd_open = os.pidfd_open
    _real_pidfd_send = signal.pidfd_send_signal


def _trace(entry):
    with open(TRACE, "a") as f:
        f.write(json.dumps(entry) + "\n")


def _is_child(pid):
    identity = sv.proc_parent_and_group(pid)
    return identity is not None and identity[0] == os.getpid()


def killpg(pgid, sig):
    entry = {"op": "killpg", "pgid": pgid, "sig": int(sig)}
    if DARWIN:
        try:
            status = os.waitid(os.P_PID, pgid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
        except ChildProcessError:
            entry["authorized"] = False
        else:
            entry["authorized"] = status is None or status.si_pid in (0, pgid)
            entry["leaderExited"] = status is not None and status.si_pid == pgid
    else:
        entry["authorized"] = _is_child(pgid) and sv.proc_parent_and_group(pgid)[1] == pgid
    _trace(entry)
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
if not DARWIN:
    os.pidfd_open = pidfd_open
    signal.pidfd_send_signal = pidfd_send_signal

if os.environ.get("BG_OWNER_LOSS_DIAGNOSTIC") == "1":
    _begin_shutdown = sv.Supervisor._begin_shutdown

    def begin_shutdown(supervisor, kind, detail, waiter):
        _begin_shutdown(supervisor, kind, detail, waiter)
        if kind == "owner_lost" and supervisor.runtimes:
            _trace({"op": "owner_loss_diagnostic"})
            rt = next(iter(supervisor.runtimes.values()))
            supervisor._group_observation_error(rt, "injected observation fault during owner loss")

    sv.Supervisor._begin_shutdown = begin_shutdown

if __name__ == "__main__":
    sys.exit(sv.main(sys.argv[1:]))
