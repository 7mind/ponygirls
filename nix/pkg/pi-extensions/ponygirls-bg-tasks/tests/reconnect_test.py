"""Production socket transport, reload handoff, and owner-lifetime regressions."""
import json
import os
import queue
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid

import supervisor_test as helpers
from support import FakeClock, MemoryTaskStore, sv


def socket_path(address):
    return "\0" + address[1:] if address.startswith("@") else address


def supervisor_command(sidecar, address, script=helpers.SUPERVISOR):
    return [sys.executable, script, "--sidecar", sidecar, "--session-id", "sess", "--activation", "socket-act",
            "--shell", helpers.SHELL, "--handoff-wait-ms", "0", "--control-socket", address,
            "--owner-pid", str(os.getpid())]


class SocketClient(helpers.Client):
    def __init__(self, sidecar, script=helpers.SUPERVISOR, address=None):
        if address is None:
            name = uuid.uuid4().hex
            address = os.path.join(tempfile.gettempdir(), "b" + name[:16], "s") if sys.platform == "darwin" else "@pi-bg-test-" + name
        self.address = address
        self.proc = subprocess.Popen(supervisor_command(sidecar, address, script),
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        self.stderr = []
        threading.Thread(target=self._pump_err, daemon=True).start()
        self.first = json.loads(self.proc.stdout.readline())
        assert self.first["type"] == "ready", self.first
        self.socket = None
        self.stream = None
        # Ending the old startup pipe must not count as losing the owner.
        self.proc.stdin.close()
        self.attach()

    def attach(self):
        self.socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.socket.settimeout(helpers.REPLY_TIMEOUT)
        self.socket.connect(socket_path(self.address))
        self.stream = self.socket.makefile("rwb", buffering=0)
        self.lines = queue.Queue()
        self.replies = {}
        self.hints = []
        self.next_id = 1
        threading.Thread(target=self._pump_socket, args=(self.stream, self.lines), daemon=True).start()
        self.greeting = self._next_line(helpers.REPLY_TIMEOUT)
        assert self.greeting["type"] == "ready", self.greeting

    @staticmethod
    def _pump_socket(stream, lines):
        try:
            for line in stream:
                lines.put(json.loads(line))
        finally:
            lines.put(None)

    def send(self, op, args):
        req_id = self.next_id
        self.next_id += 1
        self.stream.write((json.dumps({"v": 1, "id": req_id, "op": op, "args": args}) + "\n").encode())
        return req_id

    def disconnect(self):
        if self.socket is not None:
            self.socket.shutdown(socket.SHUT_WR)
            # Server must close its half after observing authorized EOF,
            # matching the production transport's end()/exited sequence.
            while self._next_line(helpers.REPLY_TIMEOUT) is not None:
                pass
            self.stream.close()
            self.socket.close()
            self.stream = self.socket = None

    def detach(self):
        assert self.call("detach", {}) == {}
        self.disconnect()

    def close(self):
        if self.proc.poll() is None:
            if self.socket is not None:
                try:
                    self.call("shutdown", {"reason": "quit"}, timeout=30)
                except (OSError, AssertionError, queue.Empty):
                    pass
            else:
                self.proc.terminate()
            self.proc.wait(timeout=15)
        if self.socket is not None:
            self.stream.close()
            self.socket.close()
            self.stream = self.socket = None
        self.proc.stdout.close()
        self.proc.stderr.close()


class ReconnectTest(helpers.SupervisorTestBase):
    def socket_client(self, **kwargs):
        c = SocketClient(self.sidecar, **kwargs)
        self.addCleanup(c.close)
        return c

    def assert_owner_lost(self, c, task):
        c.proc.wait(timeout=15)
        done = self.registry()[task["id"]]
        self.assertEqual((done["state"], done["reason"]), ("dead", "owner_lost"))
        self.assertEqual(helpers.pgroup_members(task["pgid"]), [])

    def test_detach_reconnect_retains_pid_output_and_completion(self):
        c = self.socket_client()
        self.assertEqual(c.greeting, c.first)
        gate = os.path.join(self.tmp.name, "finish")
        task = c.spawn(f"printf before; while [ ! -e '{gate}' ]; do sleep 0.05; done; printf after")
        helpers.wait_until(lambda: b"before" in c.read_all(task["id"]))
        for _ in range(2):
            self.assertEqual(c.call("detach", {}), {})
            # A partial old-generation request must never prefix a new one.
            c.stream.write(b'{"v":1,"id":999,"op":"spawn"')
            c.disconnect()
            self.assertIsNone(c.proc.poll())
            self.assertTrue(helpers.pgroup_members(task["pgid"]))
            c.attach()
            self.assertEqual(c.greeting, {**c.first, "recovered": []})
            self.assertEqual(c.get(task["id"])["pid"], task["pid"])
        c.detach()
        with open(gate, "w"):
            pass
        helpers.wait_until(lambda: self.registry()[task["id"]]["state"] == "completed")
        c.attach()
        done = c.get(task["id"])
        self.assertEqual(done["activation"], "socket-act")
        self.assertEqual(done["event"]["status"], "pending")
        self.assertEqual(c.read_all(task["id"]), b"beforeafter")
        self.assertEqual(c.call("notices", {"status": "eligible", "after": None, "limit": 50})["items"][0]["id"], task["id"])

    def test_unexpected_disconnect_still_cleans_up(self):
        c = self.socket_client()
        task = c.spawn("sleep 300")
        c.disconnect()
        self.assert_owner_lost(c, task)

    def test_disconnect_after_shutdown_request_preserves_graceful_reason(self):
        c = self.socket_client()
        task = c.spawn("sleep 300")
        c.send("shutdown", {"reason": "quit"})
        c.disconnect()
        c.proc.wait(timeout=15)
        done = self.registry()[task["id"]]
        self.assertEqual((done["state"], done["reason"]), ("failed", "session_shutdown"))

    def test_abandoned_detach_expires_with_real_process_and_injected_clock(self):
        c = self.socket_client(script=os.path.join(helpers.HERE, "reconnect_supervisor.py"))
        task = c.spawn("sleep 300")
        c.detach()
        self.assertIsNone(c.proc.poll())
        os.kill(c.proc.pid, signal.SIGUSR1)
        self.assert_owner_lost(c, task)

    def test_unauthenticated_or_second_connection_does_not_displace_owner(self):
        c = self.socket_client()
        other = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(other.close)
        other.settimeout(5)
        other.connect(socket_path(c.address))
        self.assertEqual(other.recv(1), b"")
        self.assertEqual(c.get(c.spawn("sleep 300")["id"])["state"], "running")
        c.detach()
        # Same uid but not the PID named by --owner-pid must be refused.
        foreign = subprocess.run([sys.executable, "-c", "import socket,sys; s=socket.socket(socket.AF_UNIX); "
                                  "s.settimeout(5); a=sys.argv[1]; s.connect('\\0'+a[1:] if a.startswith('@') else a); "
                                  "assert s.recv(1)==b''", c.address],
                                 capture_output=True, timeout=10)
        self.assertEqual(foreign.returncode, 0, foreign.stderr)
        c.attach()

    def test_rebind_after_supervisor_is_killed(self):
        c = self.socket_client()
        c.detach()
        c.proc.kill()
        self.assertEqual(c.proc.wait(timeout=5), -signal.SIGKILL)
        if sys.platform == "darwin":
            self.assertTrue(os.path.lexists(c.address))
            self.addCleanup(shutil.rmtree, os.path.dirname(c.address), ignore_errors=True)
        replacement = self.socket_client(address=c.address)
        self.assertEqual(replacement.call("list", {"upper": None, "after": None, "limit": 50})["items"], [])
        replacement.shutdown()
        if sys.platform == "darwin":
            self.assertFalse(os.path.lexists(os.path.dirname(c.address)))

    def test_startup_does_not_replace_an_existing_live_or_wrong_type_endpoint(self):
        c = self.socket_client()
        wrong_sidecar = os.path.join(self.tmp.name, "another-session.jsonl.bg-tasks")
        proc = subprocess.run(supervisor_command(wrong_sidecar, c.address), capture_output=True, timeout=10)
        greeting = json.loads(proc.stdout)
        expected_code = "SESSION_BUSY" if sys.platform == "darwin" else "STORAGE_FAILED"
        self.assertEqual((proc.returncode, greeting["type"], greeting["error"]["code"]), (1, "fatal", expected_code))
        c.detach()
        c.attach()
        if sys.platform == "darwin":
            c.shutdown()
            directory = os.path.dirname(c.address)
            os.mkdir(directory, 0o700)
            self.addCleanup(shutil.rmtree, directory)
            with open(c.address, "w") as f:
                f.write("not a socket")
            proc = subprocess.run(supervisor_command(wrong_sidecar, c.address), capture_output=True, timeout=10)
            greeting = json.loads(proc.stdout)
            self.assertEqual((proc.returncode, greeting["type"], greeting["error"]["code"]), (1, "fatal", "INVALID_REQUEST"))
            with open(c.address) as f:
                self.assertEqual(f.read(), "not a socket")

    def test_owner_death_during_detached_wait_does_not_wait_for_deadline(self):
        self.assert_detached_owner_death([])

    def test_owner_death_cleanup_survives_a_closed_diagnostic_pipe(self):
        self.assert_detached_owner_death([helpers.INSTRUMENTED],
                                         {"BG_OWNER_LOSS_DIAGNOSTIC": "1", "BG_TRACE": self.trace})
        self.assertIn({"op": "owner_loss_diagnostic"}, self.trace_entries())

    def assert_detached_owner_death(self, supervisor_args, env=None):
        owner = subprocess.Popen([sys.executable, os.path.join(helpers.HERE, "socket_owner.py"), self.sidecar, *supervisor_args],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
                                 env=None if env is None else {**os.environ, **env})
        self.addCleanup(lambda: (owner.poll() is None and owner.kill(), owner.wait(), owner.stdout.close(), owner.stderr.close()))
        info = json.loads(owner.stdout.readline())
        owner.kill()
        self.assertEqual(owner.wait(timeout=5), -signal.SIGKILL)
        lock = sv.OwnerLock(self.sidecar, sv.FsOps())
        lock.acquire(15000, sv.SystemClock())
        lock.release()
        done = self.registry()[info["task"]["id"]]
        self.assertEqual((done["state"], done["reason"]), ("dead", "owner_lost"))
        self.assertEqual(helpers.pgroup_members(info["task"]["pgid"]), [])
        if sys.platform == "darwin":
            self.assertFalse(os.path.lexists(os.path.dirname(info["address"])))

    def test_cli_flags_are_paired_and_owner_must_be_parent(self):
        for flags in (["--owner-pid", str(os.getpid())], ["--control-socket", "@unused"],
                      ["--control-socket", "@unused", "--owner-pid", "1"]):
            proc = subprocess.run([sys.executable, helpers.SUPERVISOR, "--sidecar", self.sidecar,
                                   "--session-id", "sess", "--activation", "a", "--shell", helpers.SHELL,
                                   "--handoff-wait-ms", "0", *flags], capture_output=True, timeout=10)
            greeting = json.loads(proc.stdout)
            self.assertEqual((proc.returncode, greeting["type"], greeting["error"]["code"]), (1, "fatal", "INVALID_REQUEST"))


class DetachUnitTest(unittest.TestCase):
    def test_pending_operations_reject_detach_and_deadline_is_full_safety_window(self):
        clock = FakeClock()
        store = MemoryTaskStore()
        registry = sv.TaskRegistry(store, "sess", clock)
        registry.open()
        # The transport dependency is needed only as a mode marker here;
        # actual credential/descriptor behavior is tested with real processes.
        s = sv.Supervisor(registry, store, lambda t: t, helpers.SHELL, "a", sv.ProtocolWriter(1), clock,
                          control_socket=object())
        self.addCleanup(s.selector.close)
        self.addCleanup(os.close, s.wake_r)
        self.addCleanup(os.close, s.wake_w)
        s.deferred_spawns.append((7, ()))
        with self.assertRaises(sv.DomainError) as caught:
            s._op_detach(1, {})
        self.assertEqual(caught.exception.code, "SESSION_BUSY")
        s.deferred_spawns.clear()
        rt = sv.TaskRuntime("task", 0, 0, None, None, 0, waiters=[8])
        s.runtimes["task"] = rt
        with self.assertRaises(sv.DomainError):
            s._op_detach(1, {})
        s.runtimes.clear()
        s._op_detach(1, {})
        self.assertEqual(s.reconnect_deadline, clock.mono + 30)
        clock.mono += 29.999
        s._advance_deadlines()
        self.assertIsNone(s.shutting_down)
        clock.mono += 0.001
        s._advance_deadlines()
        self.assertEqual(s.shutting_down, "owner_lost")
