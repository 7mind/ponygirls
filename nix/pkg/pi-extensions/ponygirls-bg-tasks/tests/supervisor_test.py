"""Step 4: real PTY, process-group, and supervisor-lifetime behavior (Linux)."""
import base64
import json
import os
import queue
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest

from support import FakeClock, sv

HERE = os.path.dirname(os.path.abspath(__file__))
SUPERVISOR = os.path.join(HERE, "..", "supervisor.py")
INSTRUMENTED = os.path.join(HERE, "instrumented_supervisor.py")
SHELL = os.environ.get("PI_BG_TASKS_SHELL")
if not SHELL:
    raise RuntimeError("Set PI_BG_TASKS_SHELL to the packaged bash; real-process checks must not silently skip.")
REPLY_TIMEOUT = 20.0


def pgroup_members(pgid):
    members = []
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        identity = sv.proc_parent_and_group(int(name))
        if identity is not None and identity[1] == pgid:
            try:
                with open(f"/proc/{name}/stat", "rb") as f:
                    state = f.read().rsplit(b")", 1)[1].split()[0]
            except FileNotFoundError:
                continue
            if state != b"Z":
                members.append(int(name))
    return members


def wait_until(predicate, timeout=10.0, interval=0.02, what="condition"):
    deadline = time.monotonic() + timeout
    while True:
        value = predicate()
        if value:
            return value
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out waiting for {what}")
        time.sleep(interval)


class Client:
    def __init__(self, sidecar, session_id="sess", script=SUPERVISOR, env=None, handoff_ms=0, activation="act-1", preexec=None):
        self.proc = subprocess.Popen(
            [sys.executable, script, "--sidecar", sidecar, "--session-id", session_id, "--activation", activation,
             "--shell", SHELL, "--handoff-wait-ms", str(handoff_ms)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
            env={**os.environ, **(env or {})}, preexec_fn=preexec)
        self.lines = queue.Queue()
        self.replies = {}
        self.hints = []
        self.next_id = 1
        self.stderr = []
        threading.Thread(target=self._pump, daemon=True).start()
        threading.Thread(target=self._pump_err, daemon=True).start()
        self.first = self._next_line(REPLY_TIMEOUT)

    def _pump(self):
        for line in self.proc.stdout:
            self.lines.put(json.loads(line))
        self.lines.put(None)

    def _pump_err(self):
        for line in self.proc.stderr:
            self.stderr.append(line.decode(errors="replace"))

    def _next_line(self, timeout):
        msg = self.lines.get(timeout=timeout)
        return msg

    def send(self, op, args):
        req_id = self.next_id
        self.next_id += 1
        self.proc.stdin.write((json.dumps({"v": 1, "id": req_id, "op": op, "args": args}) + "\n").encode())
        self.proc.stdin.flush()
        return req_id

    def wait_reply(self, req_id, timeout=REPLY_TIMEOUT):
        deadline = time.monotonic() + timeout
        while req_id not in self.replies:
            msg = self._next_line(max(0.01, deadline - time.monotonic()))
            if msg is None:
                raise AssertionError(f"supervisor exited; stderr: {''.join(self.stderr)}")
            if msg["type"] == "reply":
                self.replies[msg["id"]] = msg
            else:
                self.hints.append(msg)
        return self.replies.pop(req_id)

    def call(self, op, args, timeout=REPLY_TIMEOUT):
        reply = self.wait_reply(self.send(op, args), timeout)
        if not reply["ok"]:
            raise sv.DomainError(reply["error"]["code"], reply["error"]["message"], reply["error"].get("task"))
        return reply["result"]

    def spawn(self, command, label="job", notify=True, cwd="/"):
        return self.call("spawn", {"label": label, "command": command, "cwd": cwd, "notify": notify})["task"]

    def get(self, task_id):
        return self.call("get", {"id": task_id})["task"]

    def wait_final(self, task_id, timeout=15.0):
        return wait_until(lambda: (lambda t: t if t["state"] != "running" else None)(self.get(task_id)), timeout, 0.05, f"{task_id} to finish")

    def read_all(self, task_id):
        out = b""
        offset = 0
        while True:
            r = self.call("read", {"id": task_id, "offset": offset, "limit": sv.MAX_READ_BYTES})
            chunk = base64.b64decode(r["data"])
            out += chunk
            offset += len(chunk)
            if offset >= r["size"]:
                return out

    def shutdown(self, reason="quit"):
        result = self.call("shutdown", {"reason": reason}, timeout=30)
        self.proc.wait(timeout=10)
        return result

    def close(self):
        if self.proc.poll() is None:
            self.proc.stdin.close()
            try:
                self.proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
        for stream in (self.proc.stdout, self.proc.stderr):
            stream.close()
        if self.proc.stdin and not self.proc.stdin.closed:
            self.proc.stdin.close()


class SupervisorTestBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.sidecar = os.path.join(self.tmp.name, "session.jsonl.bg-tasks")
        self.trace = os.path.join(self.tmp.name, "trace.jsonl")

    def client(self, **kw):
        c = Client(self.sidecar, **kw)
        self.addCleanup(c.close)
        self.assertEqual(c.first["type"], "ready", c.first)
        return c

    def instrumented(self, preexec=None, **env):
        return self.client(script=INSTRUMENTED, env={"BG_TRACE": self.trace, **env}, preexec=preexec)

    def trace_entries(self):
        if not os.path.exists(self.trace):
            return []
        with open(self.trace) as f:
            return [json.loads(line) for line in f]

    def assert_signal_authority(self):
        entries = self.trace_entries()
        bad = [e for e in entries if e.get("authorized") is False]
        self.assertEqual(bad, [], f"unauthorized signal authority use: {bad}")
        return entries

    def registry(self):
        with open(os.path.join(self.sidecar, "tasks.json")) as f:
            return {t["id"]: t for t in json.load(f)["tasks"]}


class ExecutionTest(SupervisorTestBase):
    def test_tty_detection_and_zero_exit(self):
        c = self.client()
        t = c.spawn("test -t 0 && test -t 1 && test -t 2 && echo TTY-OK")
        done = c.wait_final(t["id"])
        self.assertEqual((done["state"], done["reason"], done["exit"]), ("completed", "exit", {"kind": "code", "code": 0}))
        self.assertIn(b"TTY-OK", c.read_all(t["id"]))
        self.assertEqual(done["event"], {"id": f"{t['id']}:{done['revision']}", "status": "pending"})

    def test_nonzero_exit_retains_the_code(self):
        c = self.client()
        done = c.wait_final(c.spawn("exit 7")["id"])
        self.assertEqual((done["state"], done["reason"], done["exit"]), ("failed", "exit_nonzero", {"kind": "code", "code": 7}))

    def test_spawn_returns_after_launch_without_waiting_for_exit(self):
        c = self.client()
        start = time.monotonic()
        t = c.spawn("sleep 30")
        self.assertLess(time.monotonic() - start, 3)
        self.assertEqual((t["state"], t["phase"]), ("running", "running"))
        self.assertEqual(c.get(t["id"])["state"], "running")
        done = c.call("terminate", {"id": t["id"]})["task"]
        self.assertEqual((done["state"], done["reason"]), ("failed", "terminated"))

    def test_split_utf8_and_final_bytes_are_preserved_in_order(self):
        c = self.client()
        t = c.spawn(r"printf '\342'; sleep 0.2; printf '\202\254-'; printf 'final-bytes'")
        c.wait_final(t["id"])
        self.assertEqual(c.read_all(t["id"]), "€-final-bytes".encode())
        for i in range(15):
            t = c.spawn(f"printf 'last-{i}'")
            done = c.wait_final(t["id"])
            self.assertEqual(c.read_all(t["id"]), f"last-{i}".encode())
            self.assertEqual(done["logBytes"], len(f"last-{i}"))

    def test_concurrent_noisy_commands_keep_every_byte(self):
        c = self.client()
        size = 1_000_000
        ids = [c.spawn(f"head -c {size} /dev/zero | tr '\\0' '{ch}'", label=f"noisy-{ch}")["id"] for ch in "abcd"]
        for task_id, ch in zip(ids, "abcd"):
            done = c.wait_final(task_id, timeout=60)
            self.assertEqual(done["state"], "completed")
            data = c.read_all(task_id)
            self.assertEqual(len(data), size)
            self.assertEqual(data, ch.encode() * size)

    def test_supervisor_descriptors_are_not_inherited(self):
        c = self.client()
        # ls runs as a child; /proc/$$ lists the task shell's own descriptors.
        t = c.spawn("ls -l /proc/$$/fd/; true")
        c.wait_final(t["id"])
        lines = c.read_all(t["id"]).decode().split("\r\n")
        targets = {}
        for line in lines:
            if " -> " in line:
                left, target = line.split(" -> ", 1)
                targets[left.split()[-1]] = target
        for fd in ("0", "1", "2"):
            self.assertTrue(targets[fd].startswith("/dev/pts/"), targets)
        leaked = {fd: path for fd, path in targets.items() if fd not in ("0", "1", "2")}
        self.assertEqual(leaked, {}, f"inherited descriptors: {leaked}")

    def test_launch_failure_after_admission_is_retained_as_failed(self):
        c = self.client()
        with self.assertRaises(sv.DomainError) as cm:
            c.spawn("echo never", cwd=os.path.join(self.tmp.name, "missing"))
        self.assertEqual(cm.exception.code, "LAUNCH_FAILED")
        task = cm.exception.task
        self.assertEqual((task["state"], task["reason"], task["event"]["status"]), ("failed", "launch_failed", "inline"))
        self.assertIn("chdir", task["reasonDetail"])
        self.assertEqual(c.get(task["id"])["state"], "failed")
        # Runner-level evidence lands in the task log itself, so read (not just
        # the spawn error) distinguishes a spawn failure from a fast command
        # death: the command never started, and the log says so.
        log = c.read_all(task["id"])
        self.assertIn(b"bg-tasks: launch failed: chdir failed", log)
        self.assertIn(b"the command never started", log)
        self.assertEqual(task["logBytes"], len(log))
        self.assertGreater(len(log), 0)

    def test_invalid_requests_are_rejected_before_admission(self):
        c = self.client()
        for args in ({"label": "x", "command": "true", "cwd": "relative", "notify": True},
                     {"label": "x", "command": "true", "cwd": "/"},
                     {"label": "x", "command": "true", "cwd": "/", "notify": "yes"}):
            with self.assertRaises(sv.DomainError) as cm:
                c.call("spawn", args)
            self.assertEqual(cm.exception.code, "INVALID_REQUEST")
        with self.assertRaises(sv.DomainError) as cm:
            c.call("read", {"id": "bgt-x", "offset": 0, "limit": sv.MAX_READ_BYTES + 1})
        self.assertEqual(cm.exception.code, "INVALID_REQUEST")
        self.assertEqual(c.call("list", {"upper": None, "after": None, "limit": 10})["items"], [])


class SignalTest(SupervisorTestBase):
    LOOP = "trap 'echo got-{0}; exit 3' {0}; echo ready; while :; do sleep 0.05; done"

    def wait_output(self, c, task_id, needle, timeout=10):
        return wait_until(lambda: needle in c.read_all(task_id), timeout, 0.05, f"output {needle!r}")

    def test_int_and_usr1_reach_the_owned_group(self):
        c = self.client()
        for name in ("INT", "USR1", "USR2", "HUP"):
            t = c.spawn(self.LOOP.format(name))
            self.wait_output(c, t["id"], b"ready")
            r = c.call("signal", {"id": t["id"], "signal": f"SIG{name}"})
            self.assertEqual((r["delivered"], r["task"]["state"]), (True, "running"))
            done = c.wait_final(t["id"])
            self.assertIn(f"got-{name}".encode(), c.read_all(t["id"]))
            self.assertEqual(done["exit"], {"kind": "code", "code": 3})

    def test_stop_and_cont_change_observed_progress_without_fabricating_a_state(self):
        c = self.client()
        t = c.spawn("i=0; while :; do i=$((i+1)); echo tick-$i; sleep 0.05; done")
        self.wait_output(c, t["id"], b"tick-3")
        c.call("signal", {"id": t["id"], "signal": "SIGSTOP"})
        time.sleep(0.3)
        frozen = len(c.read_all(t["id"]))
        time.sleep(0.5)
        self.assertEqual(len(c.read_all(t["id"])), frozen)
        self.assertEqual(c.get(t["id"])["state"], "running")
        c.call("signal", {"id": t["id"], "signal": "SIGCONT"})
        wait_until(lambda: len(c.read_all(t["id"])) > frozen, 5, 0.05, "progress after SIGCONT")
        done = c.call("terminate", {"id": t["id"]})["task"]
        self.assertEqual(done["reason"], "terminated")

    def test_unsupported_signal_and_finalized_task(self):
        c = self.client()
        t = c.spawn("true")
        c.wait_final(t["id"])
        with self.assertRaises(sv.DomainError) as cm:
            c.call("signal", {"id": t["id"], "signal": "SIGSEGV"})
        self.assertEqual(cm.exception.code, "INVALID_REQUEST")
        with self.assertRaises(sv.DomainError) as cm:
            c.call("signal", {"id": t["id"], "signal": "SIGINT"})
        self.assertEqual(cm.exception.code, "TASK_FINALIZED")
        self.assertEqual(c.call("terminate", {"id": t["id"]})["task"]["state"], "completed")

    def test_term_ignoring_command_escalates_to_kill(self):
        c = self.instrumented()
        t = c.spawn("trap '' TERM; echo armed; while :; do sleep 0.1; done")
        self.wait_output(c, t["id"], b"armed")
        start = time.monotonic()
        done = c.call("terminate", {"id": t["id"]}, timeout=30)["task"]
        elapsed = time.monotonic() - start
        self.assertGreaterEqual(elapsed, sv.TERM_GRACE_MS / 1000 - 0.2)
        self.assertEqual((done["state"], done["reason"], done["exit"]), ("failed", "terminated", {"kind": "signal", "signal": "SIGKILL"}))
        self.assertEqual(pgroup_members(t["pgid"]), [])
        self.assert_signal_authority()


class GroupSettlementTest(SupervisorTestBase):
    def test_redirected_descendant_blocks_completion_after_root_exit_and_pty_eof(self):
        c = self.instrumented()
        t = c.spawn('trap "" HUP; sleep 30 </dev/null >/dev/null 2>&1 & exit 0')
        closing = wait_until(lambda: (lambda x: x if x["phase"] == "closing" else None)(c.get(t["id"])), 5, 0.02, "closing")
        self.assertEqual((closing["state"], closing["exit"]), ("running", {"kind": "code", "code": 0}))
        self.assertEqual(len(pgroup_members(t["pgid"])), 1)
        with self.assertRaises(sv.DomainError) as cm:
            c.call("signal", {"id": t["id"], "signal": "SIGINT"})
        self.assertEqual(cm.exception.code, "TASK_CLOSING")
        done = c.wait_final(t["id"])
        self.assertEqual((done["state"], done["reason"], done["exit"]), ("failed", "descendants_remaining", {"kind": "code", "code": 0}))
        self.assertEqual(pgroup_members(t["pgid"]), [])
        entries = self.assert_signal_authority()
        self.assertFalse([e for e in entries if e["op"] == "killpg" and e["pgid"] == t["pgid"]], "no numeric group signal after sealing")
        self.assertTrue([e for e in entries if e["op"] == "pidfd_send_signal"])

    def test_child_holding_the_pty_open_is_cleaned_up(self):
        c = self.instrumented()
        t = c.spawn('(trap "" HUP; exec sleep 30) & sleep 0.1; exit 0')
        done = c.wait_final(t["id"])
        self.assertEqual((done["state"], done["reason"]), ("failed", "descendants_remaining"))
        self.assertEqual(pgroup_members(t["pgid"]), [])
        self.assert_signal_authority()

    def test_background_child_killed_by_hangup_settles_and_completes(self):
        c = self.client()
        done = c.wait_final(c.spawn("sleep 30 & exit 0")["id"])
        self.assertEqual((done["state"], done["reason"]), ("completed", "exit"))

    def test_multiple_descendant_generations_are_adopted_and_cleaned(self):
        c = self.instrumented()
        t = c.spawn('trap "" HUP; ( (sleep 30 </dev/null >/dev/null 2>&1 &); sleep 30 </dev/null >/dev/null 2>&1 ) </dev/null >/dev/null 2>&1 & exit 0')
        done = c.wait_final(t["id"], timeout=20)
        self.assertEqual((done["state"], done["reason"]), ("failed", "descendants_remaining"))
        self.assertEqual(pgroup_members(t["pgid"]), [])
        self.assert_signal_authority()

    def test_fork_while_exiting_race_settles_through_kernel_wait(self):
        c = self.instrumented()
        t = c.spawn("trap '' HUP; (trap '' TERM; while :; do sleep 0.01 & done) </dev/null >/dev/null 2>&1 & exit 0")
        done = c.wait_final(t["id"], timeout=30)
        self.assertEqual(done["reason"], "descendants_remaining")
        self.assertEqual(done["state"], "failed")
        self.assertEqual(pgroup_members(t["pgid"]), [])
        self.assert_signal_authority()

    def test_launch_is_paused_while_a_group_is_closing(self):
        c = self.client()
        t = c.spawn('trap "" HUP; sleep 30 </dev/null >/dev/null 2>&1 & exit 0')
        wait_until(lambda: c.get(t["id"])["phase"] == "closing", 5, 0.02, "closing")
        req = c.send("spawn", {"label": "next", "command": "true", "cwd": "/", "notify": False})
        reply = c.wait_reply(req, timeout=20)
        self.assertTrue(reply["ok"], reply)
        self.assertNotEqual(c.get(t["id"])["state"], "running", "the deferred launch ran only after settlement")

    def test_many_simultaneous_tasks(self):
        c = self.client()
        ids = [c.spawn(f"sleep 0.{i}; echo task-{i}; exit {i % 2}")["id"] for i in range(1, 9)]
        for i, task_id in zip(range(1, 9), ids):
            done = c.wait_final(task_id)
            self.assertEqual(done["exit"], {"kind": "code", "code": i % 2})
            self.assertIn(f"task-{i}".encode(), c.read_all(task_id))


class ReviewRegressionTest(SupervisorTestBase):
    def test_spawn_held_behind_a_closing_group_is_answered_when_cleanup_is_unconfirmed(self):
        c = self.instrumented(BG_IGNORE_KILLS="1")
        t = c.spawn('trap "" HUP; sleep 300 </dev/null >/dev/null 2>&1 & exit 0')
        wait_until(lambda: c.get(t["id"])["phase"] == "closing", 5, 0.02, "closing")
        req = c.send("spawn", {"label": "held", "command": "true", "cwd": "/", "notify": False})
        reply = c.wait_reply(req, timeout=(sv.DESCENDANT_GRACE_MS + sv.TERM_GRACE_MS + sv.KILL_WAIT_MS) / 1000 + 5)
        self.assertFalse(reply["ok"])
        self.assertEqual(reply["error"]["code"], "SESSION_CLOSING_GROUP")
        for pid in pgroup_members(t["pgid"]):
            os.kill(pid, signal.SIGKILL)

    def test_descriptor_exhaustion_fails_the_launch_without_killing_the_supervisor(self):
        import resource

        def limit():
            resource.setrlimit(resource.RLIMIT_NOFILE, (24, 24))
        c = self.instrumented(preexec=limit)
        failed = None
        for _ in range(20):
            try:
                c.spawn("trap '' HUP; exec sleep 300")
            except sv.DomainError as e:
                failed = e
                break
        self.assertIsNotNone(failed, "descriptor exhaustion never surfaced")
        self.assertEqual(failed.code, "LAUNCH_FAILED")
        self.assertEqual((failed.task["state"], failed.task["reason"]), ("failed", "launch_failed"))
        self.assertIsNone(c.proc.poll(), "the supervisor survives")
        self.assertEqual(c.get(failed.task["id"])["state"], "failed")
        c.shutdown()

    def test_initialization_always_syncs_the_sidecar_parent(self):
        from support import RecordingFs
        sv.FileTaskStore(self.sidecar, sv.FsOps()).init_layout()
        fs = RecordingFs(self.sidecar)
        sv.FileTaskStore(self.sidecar, fs).init_layout()
        self.assertIn(("fsync_dir", ".."), fs.ops, "a later start re-syncs the parent entry left by an interrupted first start")


class UnitSignalCandidateTest(unittest.TestCase):
    def test_a_settled_group_is_never_signalled_by_numeric_pgid_identity(self):
        reg = sv.TaskRegistry(None, "s", FakeClock())
        s = sv.Supervisor(reg, None, lambda t: t, SHELL, "a", sv.ProtocolWriter(1), FakeClock())
        rt = sv.TaskRuntime(task_id="x", pid=4242, pgid=4242, master_fd=None, log=None, log_bytes=0, sealed=True, group_settled=True)
        sent = []
        saved = (sv.proc_children, sv.proc_parent_and_group, os.pidfd_open, signal.pidfd_send_signal)
        sv.proc_children = lambda _pid: [4242]
        sv.proc_parent_and_group = lambda _pid: (os.getpid(), 4242)
        os.pidfd_open = lambda pid, flags=0: os.open("/dev/null", os.O_RDONLY)
        signal.pidfd_send_signal = lambda fd, sig, *a: sent.append(sig)
        try:
            s._signal_candidates(rt, signal.SIGTERM)
        finally:
            sv.proc_children, sv.proc_parent_and_group, os.pidfd_open, signal.pidfd_send_signal = saved
        self.assertEqual(sent, [], "a recycled PID in the old PGID must not be signalled after settlement")

    def test_a_disappeared_proc_candidate_is_skipped(self):
        reg = sv.TaskRegistry(None, "s", FakeClock())
        s = sv.Supervisor(reg, None, lambda t: t, SHELL, "a", sv.ProtocolWriter(1), FakeClock())
        rt = sv.TaskRuntime(task_id="x", pid=999999, pgid=999999, master_fd=None, log=None, log_bytes=0, sealed=True)
        original = sv.proc_children
        sv.proc_children = lambda _pid: [999999, 999998]
        try:
            s._signal_candidates(rt, signal.SIGTERM)
        finally:
            sv.proc_children = original
        self.assertEqual(rt.termed, set())


class LifetimeTest(SupervisorTestBase):
    def start_fake_pi(self, command):
        proc = subprocess.Popen([sys.executable, os.path.join(HERE, "fake_pi.py"), self.sidecar, "sess", SHELL, command],
                                stdout=subprocess.PIPE, start_new_session=True)
        self.addCleanup(lambda: (proc.poll() is None and proc.kill(), proc.wait(), proc.stdout.close()))
        info = json.loads(proc.stdout.readline())
        return proc, info

    def assert_lock_released(self):
        lock = sv.OwnerLock(self.sidecar, sv.FsOps())
        lock.acquire(sv.TERM_GRACE_MS + sv.KILL_WAIT_MS + 5000, sv.SystemClock())
        lock.release()

    def test_killing_pi_lets_the_isolated_supervisor_clean_up_and_record_dead(self):
        proc, info = self.start_fake_pi("echo started; sleep 300")
        pgid = info["task"]["pgid"]
        self.assertEqual(len(pgroup_members(pgid)), 1)
        proc.kill()
        proc.wait()
        self.assert_lock_released()
        task = self.registry()[info["task"]["id"]]
        self.assertEqual((task["state"], task["reason"]), ("dead", "owner_lost"))
        self.assertEqual(pgroup_members(pgid), [])
        wait_until(lambda: sv.proc_parent_and_group(info["supervisorPid"]) is None, 10, 0.05, "supervisor exit")

    def test_killing_pis_whole_process_group_spares_the_supervisor_session(self):
        proc, info = self.start_fake_pi("sleep 300")
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
        self.assert_lock_released()
        task = self.registry()[info["task"]["id"]]
        self.assertEqual((task["state"], task["reason"]), ("dead", "owner_lost"))
        self.assertEqual(pgroup_members(info["task"]["pgid"]), [])

    def test_killed_supervisor_is_recovered_as_dead_without_signalling_saved_identifiers(self):
        c = self.instrumented()
        # Closing the PTY master hangs the terminal up, so only a HUP-immune task outlives its supervisor.
        # Spawn returns after the shell execs, but the trap runs later: kill only after
        # "ready" proves HUP is already ignored. Otherwise the hangup may land in the
        # shell-startup window and kill the task, failing either census below depending
        # on when the pending HUP is delivered under load.
        t = c.spawn("trap '' HUP; echo ready; exec sleep 300")
        wait_until(lambda: b"ready" in c.read_all(t["id"]), 30, 0.05, "trap installed before the kill")
        os.kill(c.first["pid"], signal.SIGKILL)
        c.proc.wait()
        pgid = t["pgid"]
        self.assertEqual(len(pgroup_members(pgid)), 1, "the orphan survives supervisor loss")
        before = len(self.trace_entries())
        c2 = self.instrumented()
        self.assertEqual(c2.first["recovered"], [t["id"]])
        recovered = c2.get(t["id"])
        self.assertEqual((recovered["state"], recovered["reason"], recovered["interruptedActivation"]), ("dead", "supervisor_lost", "act-1"))
        after = self.trace_entries()[before:]
        self.assertFalse([e for e in after if e["op"] in ("killpg", "pidfd_send_signal") or (e["op"] == "pidfd_open" and e["pid"] == t["pid"])], after)
        self.assertEqual(len(pgroup_members(pgid)), 1, "recovery never signals the saved PGID")
        os.killpg(pgid, signal.SIGKILL)

    def test_cold_restart_recovers_stale_records_and_keeps_terminal_ones(self):
        c = self.client()
        done = c.spawn("echo finished")
        c.wait_final(done["id"])
        c.shutdown()
        path = os.path.join(self.sidecar, "tasks.json")
        with open(path) as f:
            reg = json.load(f)
        template = reg["tasks"][0]
        for i, phase in enumerate(("starting", "running", "closing", "stopping")):
            stale = dict(template, id=f"bgt-stale{i}", seq=reg["nextSeq"], state="running", phase=phase, reason=None,
                         reasonDetail=None, event=None, endedAt=None, exit={"kind": "code", "code": 0} if phase == "closing" else None,
                         activation="old-act", logPath=f"tasks/bgt-stale{i}/terminal.log", pid=1, pgid=1)
            reg["nextSeq"] += 1
            reg["tasks"].append(stale)
            os.makedirs(os.path.join(self.sidecar, "tasks", stale["id"]))
            with open(os.path.join(self.sidecar, "tasks", stale["id"], "terminal.log"), "wb") as f:
                f.write(b"captured")
        with open(path, "w") as f:
            json.dump(reg, f)
        c2 = self.instrumented()
        self.assertEqual(sorted(c2.first["recovered"]), [f"bgt-stale{i}" for i in range(4)])
        for i in range(4):
            r = c2.get(f"bgt-stale{i}")
            self.assertEqual((r["state"], r["reason"], r["interruptedActivation"], r["event"]["status"]), ("dead", "supervisor_lost", "old-act", "pending"))
            self.assertEqual(c2.read_all(r["id"]), b"captured")
        self.assertEqual(c2.get("bgt-stale2")["exit"], {"kind": "code", "code": 0})
        self.assertEqual(c2.get(done["id"])["state"], "completed")
        self.assertFalse([e for e in self.trace_entries() if e["op"] in ("killpg", "pidfd_send_signal")])

    def test_graceful_shutdown_finalizes_with_the_lifecycle_reason(self):
        c = self.client()
        t = c.spawn("sleep 300")
        c.shutdown("reload")
        task = self.registry()[t["id"]]
        self.assertEqual((task["state"], task["reason"], task["reasonDetail"]), ("failed", "session_shutdown", "reload"))
        self.assertEqual(pgroup_members(t["pgid"]), [])
        self.assert_lock_released()

    def test_second_supervisor_is_refused_while_the_first_lives(self):
        c = self.client()
        other = Client(self.sidecar)
        self.addCleanup(other.close)
        self.assertEqual(other.first["type"], "fatal")
        self.assertEqual(other.first["error"]["code"], "SESSION_BUSY")
        c.shutdown()
        third = self.client(handoff_ms=5000)
        self.assertEqual(third.first["type"], "ready")

    def test_unconfirmed_cleanup_is_bounded_live_and_at_teardown(self):
        c = self.instrumented(BG_IGNORE_KILLS="1")
        t = c.spawn("trap '' HUP; echo up; exec sleep 300")
        start = time.monotonic()
        with self.assertRaises(sv.DomainError) as cm:
            c.call("terminate", {"id": t["id"]}, timeout=30)
        self.assertEqual(cm.exception.code, "TERMINATION_UNCONFIRMED")
        self.assertLess(time.monotonic() - start, (sv.TERM_GRACE_MS + sv.KILL_WAIT_MS) / 1000 + 3)
        live = c.get(t["id"])
        self.assertEqual((live["state"], live["phase"], live["cleanupUnconfirmed"]), ("running", "stopping", True))
        with self.assertRaises(sv.DomainError) as cm:
            c.call("clear", {"id": t["id"]})
        self.assertEqual(cm.exception.code, "TASK_UNFINISHED")
        start = time.monotonic()
        c.shutdown("quit")
        self.assertLess(time.monotonic() - start, (sv.TERM_GRACE_MS + sv.KILL_WAIT_MS + sv.OUTPUT_DRAIN_MS) / 1000 + 5)
        task = self.registry()[t["id"]]
        self.assertEqual((task["state"], task["reason"]), ("dead", "cleanup_unconfirmed"))
        self.assertIsNone(task["exit"], "no exit evidence was invented")
        self.assert_lock_released()
        self.assertEqual(len(pgroup_members(t["pgid"])), 1, "abandoned, not claimed killed")
        os.killpg(t["pgid"], signal.SIGKILL)
        c2 = self.client()
        c2.call("clear", {"id": t["id"]})


class ProtocolSurfaceTest(SupervisorTestBase):
    def test_running_snapshots_carry_liveness_evidence(self):
        c = self.client()
        t = c.spawn("sleep 30")
        try:
            seen = c.get(t["id"])
            self.assertEqual(seen["leaderAlive"], True)
            self.assertTrue(seen["observedAt"].endswith("Z"), seen["observedAt"])
            # A second poll re-observes: the snapshot time never goes backwards
            # while the supervisor still owns the task, even with zero output.
            again = c.get(t["id"])
            self.assertGreaterEqual(again["observedAt"], seen["observedAt"])
            listed = c.call("list", {"upper": None, "after": None, "limit": 10})["items"]
            self.assertEqual([(i["id"], i["leaderAlive"]) for i in listed], [(t["id"], True)])
            self.assertTrue(all("observedAt" in i for i in listed))
        finally:
            done = c.call("terminate", {"id": t["id"]})["task"]
        # Finalized records carry the outcome, not liveness: no stale evidence.
        self.assertNotIn("observedAt", done)
        self.assertNotIn("leaderAlive", done)
        self.assertNotIn("observedAt", c.get(t["id"]))

    def test_sealed_but_draining_task_reports_root_exited(self):
        c = self.client()
        # A lingering group member keeps the task in closing long after the
        # root is reaped, so the liveness snapshot is stable, not a transient.
        # trap '' HUP: without it the kernel's hangup to the foreground group
        # kills the member the instant the session-leader root exits.
        t = c.spawn("trap '' HUP; sleep 30 & exit 0")
        try:
            closing = wait_until(lambda: (lambda x: x if x["phase"] == "closing" else None)(c.get(t["id"])),
                                 30, 0.05, "root exit with a lingering group member")
            # The leader is reaped (its PID must never be probed again) while the
            # group still drains: alive would be a lie, exited points at the group.
            self.assertEqual(closing["leaderAlive"], False)
            self.assertTrue(closing["observedAt"].endswith("Z"))
        finally:
            done = c.call("terminate", {"id": t["id"]})["task"]
        self.assertEqual((done["state"], done["reason"]), ("failed", "terminated"))

    def test_read_windows_tail_and_offsets(self):
        c = self.client()
        t = c.spawn("head -c 100000 /dev/zero | tr '\\0' x; printf END")
        c.wait_final(t["id"])
        r = c.call("read", {"id": t["id"], "offset": "tail", "limit": 10})
        self.assertEqual((r["offset"], base64.b64decode(r["data"]), r["size"]), (100003 - 10, b"xxxxxxxEND", 100003))
        with self.assertRaises(sv.DomainError) as cm:
            c.call("read", {"id": t["id"], "offset": 200000, "limit": 10})
        self.assertEqual(cm.exception.code, "OFFSET_OUT_OF_RANGE")

    def test_notify_mute_receipts_and_clear(self):
        c = self.client()
        a = c.spawn("true", notify=False)
        b = c.spawn("true")
        for task_id in (a["id"], b["id"]):
            c.wait_final(task_id)
        eligible = c.call("notices", {"status": "eligible", "after": None, "limit": 10})["items"]
        self.assertEqual([t["id"] for t in eligible], [b["id"]])
        muted_event = c.get(a["id"])["event"]["id"]
        unmuted = c.call("notify", {"id": a["id"], "enabled": True})["task"]
        self.assertEqual(unmuted["event"]["id"], muted_event)
        changed = c.call("receipts", {"eventIds": [c.get(b["id"])["event"]["id"]], "received": True})["changed"]
        self.assertEqual(len(changed), 1)
        eligible = c.call("notices", {"status": "eligible", "after": None, "limit": 10})["items"]
        self.assertEqual([t["id"] for t in eligible], [a["id"]])
        cleared = c.call("clear", {"id": a["id"]})
        self.assertEqual(cleared["id"], a["id"])
        self.assertFalse(os.path.exists(os.path.join(self.sidecar, "tasks", a["id"])))
        with self.assertRaises(sv.DomainError) as cm:
            c.call("clear", {"id": a["id"]})
        self.assertEqual(cm.exception.code, "NOT_FOUND")
        self.assertTrue(any(h["type"] == "changed" and h["terminal"] for h in c.hints))


if __name__ == "__main__":
    unittest.main()
