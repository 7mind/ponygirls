"""Production socket transport, reload handoff, and owner-lifetime regressions."""
import json
import os
import queue
import signal
import socket
import subprocess
import sys
import threading
import time
import unittest
import uuid

import supervisor_test as helpers
from support import FakeClock, MemoryTaskStore, sv


class SocketClient(helpers.Client):
    def __init__(self, sidecar, script=helpers.SUPERVISOR):
        self.address = "@pi-bg-test-" + uuid.uuid4().hex
        self.proc = subprocess.Popen(
            [sys.executable, script, "--sidecar", sidecar, "--session-id", "sess", "--activation", "socket-act",
             "--shell", helpers.SHELL, "--handoff-wait-ms", "0", "--control-socket", self.address,
             "--owner-pid", str(os.getpid())],
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
        self.socket.connect("\0" + self.address[1:])
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
        other.connect("\0" + c.address[1:])
        self.assertEqual(other.recv(1), b"")
        self.assertEqual(c.get(c.spawn("sleep 300")["id"])["state"], "running")
        c.detach()
        # Same uid but not the PID named by --owner-pid must be refused.
        foreign = subprocess.run([sys.executable, "-c", "import socket,sys; s=socket.socket(socket.AF_UNIX); "
                                  "s.settimeout(5); s.connect('\\0'+sys.argv[1][1:]); assert s.recv(1)==b''", c.address],
                                 capture_output=True, timeout=10)
        self.assertEqual(foreign.returncode, 0, foreign.stderr)
        c.attach()

    def test_owner_death_during_detached_wait_does_not_wait_for_deadline(self):
        owner = subprocess.Popen([sys.executable, os.path.join(helpers.HERE, "socket_owner.py"), self.sidecar],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        self.addCleanup(lambda: (owner.poll() is None and owner.kill(), owner.wait(), owner.stdout.close(), owner.stderr.close()))
        info = json.loads(owner.stdout.readline())
        owner.kill()
        owner.wait(timeout=5)
        helpers.wait_until(lambda: self.registry()[info["task"]["id"]]["state"] != "running", timeout=15)
        self.assertEqual(self.registry()[info["task"]["id"]]["reason"], "owner_lost")
        self.assertEqual(helpers.pgroup_members(info["task"]["pgid"]), [])
        lock = sv.OwnerLock(self.sidecar, sv.FsOps())
        lock.acquire(1000, sv.SystemClock())
        lock.release()

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
