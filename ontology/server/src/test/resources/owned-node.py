#!/usr/bin/env python3
"""Linux-only owned Node acceptance supervisor; never a production service."""
import ctypes
from dataclasses import dataclass
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

PR_SET_CHILD_SUBREAPER = 36
PR_GET_CHILD_SUBREAPER = 37
POLL_SECONDS = 0.02
NATURAL_DRAIN_SECONDS = 2.0
TERM_GRACE_SECONDS = 15.0
KILL_GRACE_SECONDS = 15.0


@dataclass
class State:
    main_exit: int | None = None
    stop_signal: int | None = None
    reaped_descendants: int = 0
    term_signals: int = 0
    kill_signals: int = 0


def main() -> int:
    if sys.platform != "linux" or not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        raise RuntimeError("owned process supervision requires Linux pidfds")
    if len(sys.argv) < 7:
        raise ValueError("expected deadline, run ID, label, receipt path, node and driver")
    deadline_seconds = int(sys.argv[1])
    if deadline_seconds <= 0:
        raise ValueError("positive deadline required")
    run_id, label = sys.argv[2:4]
    receipt = Path(sys.argv[4])
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    libc.prctl.restype = ctypes.c_int
    if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        raise RuntimeError("could not establish owned subreaper")
    enabled = ctypes.c_int(0)
    if libc.prctl(PR_GET_CHILD_SUBREAPER, ctypes.addressof(enabled), 0, 0, 0) != 0 or enabled.value != 1:
        raise RuntimeError("subreaper qualification failed")
    children_path = Path(f"/proc/self/task/{os.getpid()}/children")
    children_path.read_text()
    state = State()

    def stop(number: int, _frame: object) -> None:
        state.stop_signal = number

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    child = subprocess.Popen(sys.argv[5:], stdin=subprocess.DEVNULL, start_new_session=True)
    signalled: set[int] = set()

    def reap() -> bool:
        while True:
            try:
                pid, status = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                return True
            if pid == 0:
                return False
            signalled.discard(pid)
            if pid == child.pid:
                state.main_exit = os.waitstatus_to_exitcode(status)
                child.returncode = state.main_exit
            else:
                state.reaped_descendants += 1

    def children() -> list[int]:
        return [int(value) for value in children_path.read_text().split()]

    def send_owned(number: int) -> None:
        for pid in children():
            if pid in signalled:
                continue
            try:
                descriptor = os.pidfd_open(pid)
            except ProcessLookupError:
                continue
            try:
                # Pin identity first, then recheck kernel parent membership.
                if pid in children():
                    try:
                        signal.pidfd_send_signal(descriptor, number)
                        signalled.add(pid)
                        if number == signal.SIGTERM:
                            state.term_signals += 1
                        else:
                            state.kill_signals += 1
                    except ProcessLookupError:
                        pass
            finally:
                os.close(descriptor)

    timed_out = False
    forced_cleanup = False
    confirmed = False
    diagnostic: str | None = None
    try:
        deadline = time.monotonic() + deadline_seconds
        while state.main_exit is None and state.stop_signal is None:
            reap()
            if state.main_exit is not None:
                break
            if time.monotonic() >= deadline:
                timed_out = True
                break
            time.sleep(POLL_SECONDS)
        natural_deadline = time.monotonic() + NATURAL_DRAIN_SECONDS
        confirmed = reap()
        while not confirmed and state.main_exit is not None and state.stop_signal is None and time.monotonic() < natural_deadline:
            time.sleep(POLL_SECONDS)
            confirmed = reap()
    except Exception:
        diagnostic = "process-observation-failed"
    finally:
        if not confirmed:
            forced_cleanup = True
            for number, grace in [(signal.SIGTERM, TERM_GRACE_SECONDS), (signal.SIGKILL, KILL_GRACE_SECONDS)]:
                signalled.clear()
                deadline = time.monotonic() + grace
                while time.monotonic() < deadline:
                    try:
                        confirmed = reap()
                        if confirmed:
                            break
                        send_owned(number)
                    except Exception:
                        diagnostic = "cleanup-observation-failed"
                    time.sleep(POLL_SECONDS)
                if confirmed:
                    break
        result = {"version": 1, "runId": run_id, "label": label, "subreaperConfirmed": True,
                  "mainExit": state.main_exit, "stopSignal": state.stop_signal, "timedOut": timed_out,
                  "forcedCleanup": forced_cleanup, "cleanupConfirmed": confirmed,
                  "reapedDescendants": state.reaped_descendants, "termSignals": state.term_signals,
                  "killSignals": state.kill_signals, "diagnostic": diagnostic}
        temporary = receipt.with_name(receipt.name + ".pending")
        temporary.write_text(json.dumps(result, indent=2) + "\n")
        temporary.replace(receipt)
    if not confirmed or diagnostic is not None:
        return 125
    if timed_out:
        return 124
    if state.stop_signal is not None:
        return 128 + state.stop_signal
    if forced_cleanup:
        return 125
    if state.main_exit is None:
        return 125
    return state.main_exit if state.main_exit >= 0 else 128 - state.main_exit


if __name__ == "__main__":
    sys.exit(main())
