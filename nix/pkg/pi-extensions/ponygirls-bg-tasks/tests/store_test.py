"""Step 3: durable store and registry service contracts.

One behavioral suite runs against the hand-written memory store and the real
temporary-directory store. Real-only cases cover commit ordering, directory
entry synchronization, fault injection, and the ownership lock.
"""
import json
import os
import stat
import tempfile
import unittest

from support import FakeClock, InjectedCrash, MemoryTaskStore, RecordingFs, sv

SESSION = "session-1"
CODE0 = sv.ExitEvidence("code", 0, None)


class RegistryContract:
    """Subclasses provide make_store() and reopen(store) returning a fresh view of the same durable state."""

    def make_store(self):
        raise NotImplementedError

    def reopen(self, store):
        raise NotImplementedError

    def setUp(self):
        self.clock = FakeClock()
        self.store = self.make_store()
        self.reg = sv.TaskRegistry(self.store, SESSION, self.clock)
        self.reg.open()

    def fresh(self):
        reg = sv.TaskRegistry(self.reopen(self.store), SESSION, self.clock)
        recovered = reg.open()
        return reg, recovered

    def admit(self, label="job", notify=True):
        tid = f"bgt-{len(self.reg.state.tasks) + self.reg.state.next_seq:04d}"
        log = self.store.create_log(tid)
        rec = self.reg.admit(label, "echo hi", "/tmp", notify, "act-1", tid, f"tasks/{tid}/terminal.log")
        return rec, log

    def finish(self, tid, log, data=b"output\n"):
        log.write(data)
        log.sync()
        log.close()
        self.reg.update(tid, lambda r: setattr(r, "phase", "running"))
        return self.reg.finalize(tid, sv.Outcome("completed", "exit", None), CODE0, len(data), sv.NOTICE_PENDING)

    def test_fresh_registry_is_empty_and_durable(self):
        reg, recovered = self.fresh()
        self.assertEqual((reg.state.next_seq, len(reg.state.tasks), recovered), (1, 0, []))

    def test_completed_records_and_logs_survive_reads_and_restart(self):
        rec, log = self.admit()
        self.finish(rec.id, log, b"abc\xffdef")
        for _ in range(3):
            self.assertEqual(self.store.read_log(rec.id, 0, 100), (b"abc\xffdef", 7))
        reg, recovered = self.fresh()
        self.assertEqual(recovered, [])
        got = reg.get(rec.id)
        self.assertEqual((got.state, got.reason, got.log_bytes, got.event.status), ("completed", "exit", 7, "pending"))
        self.assertEqual(self.reopen(self.store).read_log(rec.id, 3, 100), (b"\xffdef", 7))

    def test_unfinished_records_recover_as_dead_and_terminal_ones_stay(self):
        done, log = self.admit("done")
        self.finish(done.id, log)
        running, _ = self.admit("running")
        self.reg.update(running.id, lambda r: setattr(r, "phase", "running"))
        closing, _ = self.admit("closing")

        def to_closing(r):
            r.phase = "closing"
            r.exit = CODE0
        self.reg.update(closing.id, to_closing)
        starting, _ = self.admit("starting")
        reg, recovered = self.fresh()
        self.assertEqual(sorted(recovered), sorted([running.id, closing.id, starting.id]))
        for tid in recovered:
            r = reg.get(tid)
            self.assertEqual((r.state, r.reason, r.interrupted_activation, r.event.status), ("dead", "supervisor_lost", "act-1", "pending"))
        self.assertEqual(reg.get(closing.id).exit, CODE0)
        self.assertEqual(reg.get(done.id).state, "completed")
        # Recovery was persisted before exposure: a second reopen recovers nothing new.
        _, again = self.fresh()
        self.assertEqual(again, [])

    def test_clear_removes_record_outbox_and_log_but_not_other_tasks(self):
        a, la = self.admit("a")
        self.finish(a.id, la)
        b, lb = self.admit("b")
        self.finish(b.id, lb, b"keep")
        self.assertEqual(self.reg.clear(a.id), 7)
        with self.assertRaises(sv.DomainError) as cm:
            self.reg.get(a.id)
        self.assertEqual(cm.exception.code, "NOT_FOUND")
        with self.assertRaises(sv.DomainError) as cm:
            self.store.read_log(a.id, 0, 10)
        self.assertEqual(cm.exception.code, "ARTIFACT_MISSING")
        reg, _ = self.fresh()
        self.assertNotIn(a.id, reg.state.tasks)
        self.assertEqual(self.reopen(self.store).read_log(b.id, 0, 10), (b"keep", 4))

    def test_clear_rejects_unfinished_and_absent_tasks(self):
        r, _ = self.admit()
        with self.assertRaises(sv.DomainError) as cm:
            self.reg.clear(r.id)
        self.assertEqual(cm.exception.code, "TASK_UNFINISHED")
        with self.assertRaises(sv.DomainError) as cm:
            self.reg.clear("bgt-missing")
        self.assertEqual(cm.exception.code, "NOT_FOUND")

    def test_creation_sequence_is_never_reused_after_clearing_everything(self):
        r, log = self.admit()
        self.finish(r.id, log)
        self.reg.clear(r.id)
        reg, _ = self.fresh()
        self.assertEqual(reg.state.next_seq, 2)
        self.assertEqual(reg.state.tasks, {})

    def test_failed_commit_leaves_memory_and_disk_at_the_prior_state(self):
        r, log = self.admit()
        self.fail_next_commit()
        with self.assertRaises(sv.StorageError):
            self.reg.finalize(r.id, sv.Outcome("completed", "exit", None), CODE0, 0, sv.NOTICE_PENDING)
        self.assertEqual(self.reg.get(r.id).phase, "starting")
        reg, recovered = self.fresh()
        self.assertEqual(recovered, [r.id])

    def test_receipts_move_between_pending_and_received(self):
        r, log = self.admit()
        done = self.finish(r.id, log)
        self.assertEqual(self.reg.set_receipts([done.event.id, "unknown"], sv.NOTICE_RECEIVED), [done.event.id])
        self.assertEqual(self.reg.set_receipts([done.event.id], sv.NOTICE_RECEIVED), [])
        self.assertEqual(self.reg.notices("eligible", None, 10)["items"], [])
        self.assertEqual([t.id for t in self.reg.notices("received", None, 10)["items"]], [r.id])
        self.assertEqual(self.reg.set_receipts([done.event.id], sv.NOTICE_PENDING), [done.event.id])
        self.assertEqual(self.reg.get(r.id).event.id, done.event.id)

    def test_muted_pending_events_are_not_eligible_until_reenabled(self):
        r, log = self.admit(notify=False)
        done = self.finish(r.id, log)
        self.assertEqual(self.reg.notices("eligible", None, 10)["items"], [])
        after = self.reg.set_notify(r.id, True)
        self.assertEqual(after.event.id, done.event.id)
        self.assertEqual([t.id for t in self.reg.notices("eligible", None, 10)["items"]], [r.id])

    def test_pages_cover_history_with_a_watermark_despite_inserts_and_clears(self):
        ids = []
        for i in range(7):
            r, log = self.admit(f"t{i}")
            self.finish(r.id, log)
            ids.append(r.id)
        first = self.reg.page(None, None, 3)
        self.assertEqual([t.label for t in first["items"]], ["t6", "t5", "t4"])
        # Concurrent insert and clear between pages.
        late, late_log = self.admit("late")
        self.finish(late.id, late_log)
        self.reg.clear(ids[3])
        pages = [first]
        while pages[-1]["next"] is not None:
            pages.append(self.reg.page(first["upper"], pages[-1]["next"], 3))
        seen = [t.label for page in pages for t in page["items"]]
        self.assertEqual(seen, ["t6", "t5", "t4", "t2", "t1", "t0"])
        self.assertEqual(self.reg.page(None, None, 1)["items"][0].label, "late")


class MemoryRegistryTest(RegistryContract, unittest.TestCase):
    def make_store(self):
        return MemoryTaskStore()

    def reopen(self, store):
        return store

    def fail_next_commit(self):
        self.store.fail_next.add("commit")


class FailOnceFs(sv.FsOps):
    def __init__(self):
        self.fail_next_write = False

    def write(self, fd, data):
        if self.fail_next_write:
            self.fail_next_write = False
            raise OSError(28, "injected ENOSPC")
        super().write(fd, data)


class FileRegistryTest(RegistryContract, unittest.TestCase):
    def make_store(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = os.path.join(self.tmp.name, "session.jsonl.bg-tasks")
        self.fs = FailOnceFs()
        return sv.FileTaskStore(self.root, self.fs)

    def reopen(self, store):
        return sv.FileTaskStore(self.root, sv.FsOps())

    def fail_next_commit(self):
        self.fs.fail_next_write = True


class FileStoreDurabilityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = os.path.join(self.tmp.name, "s.jsonl.bg-tasks")
        self.clock = FakeClock()

    def registry(self, fs):
        return sv.TaskRegistry(sv.FileTaskStore(self.root, fs), SESSION, self.clock)

    def test_initialization_syncs_parent_and_sidecar_entries_with_private_modes(self):
        fs = RecordingFs(self.root)
        store = sv.FileTaskStore(self.root, fs)
        store.init_layout()
        lock = sv.OwnerLock(self.root, fs)
        lock.acquire(0, self.clock)
        self.addCleanup(lock.release)
        reg = sv.TaskRegistry(store, SESSION, self.clock)
        reg.open()
        ops = fs.ops
        self.assertLess(ops.index(("mkdir", ".")), ops.index(("fsync_dir", "..")))
        self.assertLess(ops.index(("mkdir", "tasks")), ops.index(("fsync_dir", ".")))
        self.assertLess(ops.index(("mkdir", "clearing")), ops.index(("fsync_dir", ".")))
        self.assertLess(ops.index(("fsync", "owner.lock")), len(ops) - ops[::-1].index(("fsync_dir", ".")) - 1)
        for d in (".", "tasks", "clearing"):
            self.assertEqual(stat.S_IMODE(os.stat(os.path.join(self.root, d)).st_mode), 0o700)
        for f in ("owner.lock", "tasks.json"):
            self.assertEqual(stat.S_IMODE(os.stat(os.path.join(self.root, f)).st_mode), 0o600)

    def test_launch_artifacts_are_durable_before_the_admission_commit(self):
        fs = RecordingFs(self.root)
        reg = self.registry(fs)
        reg.open()
        fs.ops.clear()
        log = reg.store.create_log("bgt-a")
        reg.admit("l", "c", "/", True, "act", "bgt-a", "tasks/bgt-a/terminal.log")
        log.close()
        self.assertEqual(fs.ops[:5], [("mkdir", "tasks/bgt-a"), ("open", "tasks/bgt-a/terminal.log"),
                                      ("fsync", "tasks/bgt-a/terminal.log"), ("fsync_dir", "tasks/bgt-a"), ("fsync_dir", "tasks")])
        self.assertEqual(fs.ops[5:], [("open", "tasks.json.tmp"), ("write", "tasks.json.tmp"), ("fsync", "tasks.json.tmp"),
                                      ("rename", "tasks.json.tmp->tasks.json"), ("fsync_dir", ".")])
        self.assertEqual(stat.S_IMODE(os.stat(os.path.join(self.root, "tasks/bgt-a/terminal.log")).st_mode), 0o600)

    def test_clear_order_syncs_both_rename_parents_and_deletion_before_dropping_intent(self):
        fs = RecordingFs(self.root)
        reg = self.registry(fs)
        reg.open()
        log = reg.store.create_log("bgt-a")
        reg.admit("l", "c", "/", True, "act", "bgt-a", "tasks/bgt-a/terminal.log")
        log.close()
        reg.finalize("bgt-a", sv.Outcome("failed", "exit_nonzero", None), sv.ExitEvidence("code", 1, None), 0, sv.NOTICE_PENDING)
        fs.ops.clear()
        reg.clear("bgt-a")
        names = [f"{n}:{p}" for n, p in fs.ops]
        intent = names.index("rename:tasks.json.tmp->tasks.json")
        expected = ["rename:tasks/bgt-a->clearing/bgt-a", "fsync_dir:tasks", "fsync_dir:clearing",
                    "unlink:clearing/bgt-a/terminal.log", "fsync_dir:clearing/bgt-a", "rmdir:clearing/bgt-a", "fsync_dir:clearing"]
        self.assertEqual(names[intent + 2:intent + 2 + len(expected)], expected)
        self.assertEqual(names[-2:], ["rename:tasks.json.tmp->tasks.json", "fsync_dir:."])
        with open(os.path.join(self.root, "tasks.json")) as f:
            data = json.load(f)
        self.assertEqual(data["tasks"], [])

    def scenario(self, fs):
        """Init, admit, finalize, clear one task, and admit a second; returns completed step names."""
        steps = []
        reg = self.registry(fs)
        reg.open()
        steps.append("init")
        log = reg.store.create_log("bgt-a")
        log.write(b"data")
        reg.admit("l", "c", "/", True, "act", "bgt-a", "tasks/bgt-a/terminal.log")
        steps.append("admit")
        log.sync()
        log.close()
        reg.update("bgt-a", lambda r: setattr(r, "phase", "running"))
        reg.finalize("bgt-a", sv.Outcome("completed", "exit", None), CODE0, 4, sv.NOTICE_PENDING)
        steps.append("finalize")
        reg.clear("bgt-a")
        steps.append("clear")
        log = reg.store.create_log("bgt-b")
        reg.admit("l2", "c", "/", True, "act", "bgt-b", "tasks/bgt-b/terminal.log")
        log.close()
        steps.append("admit2")
        return steps

    def test_failure_after_every_operation_exposes_a_committed_state_never_an_empty_registry(self):
        probe_fs = RecordingFs(os.path.join(self.tmp.name, "probe.bg-tasks"))
        probe_root = self.root
        self.root = os.path.join(self.tmp.name, "probe.bg-tasks")
        self.scenario(probe_fs)
        total = len(probe_fs.ops)
        self.root = probe_root
        self.assertGreater(total, 30)
        for n in range(1, total + 1):
            with self.subTest(fail_at=n, op=probe_fs.ops[n - 1]):
                root = os.path.join(self.tmp.name, f"case-{n}.bg-tasks")
                self.root = root
                completed = []
                try:
                    completed = self.scenario(RecordingFs(root, fail_at=n))
                    self.fail("the injected failure did not surface")
                except (sv.StorageError, sv.DomainError, InjectedCrash):
                    pass
                if not os.path.exists(os.path.join(root, "tasks.json")):
                    # Interrupted before the first registry commit: initialization never claimed success.
                    reg = self.registry(sv.FsOps())
                    reg.open()
                    self.assertEqual(reg.state.tasks, {})
                    continue
                reg = self.registry(sv.FsOps())
                recovered = reg.open()
                tasks = reg.state.tasks
                if "bgt-a" in tasks:
                    a = tasks["bgt-a"]
                    self.assertIn(a.state, ("dead", "completed"))
                    if a.state == "dead":
                        self.assertEqual(recovered, ["bgt-a"])
                    self.assertEqual(reg.store.read_log("bgt-a", 0, 10)[0], b"data")
                else:
                    # Either never admitted, or its committed clear was completed by recovery.
                    self.assertFalse(os.path.exists(os.path.join(root, "clearing", "bgt-a")))
                    if reg.state.next_seq > 1:
                        self.assertFalse(os.path.exists(os.path.join(root, "tasks", "bgt-a")))
                if "bgt-b" in tasks:
                    self.assertNotIn("bgt-a", tasks)
                self.assertEqual(os.listdir(os.path.join(root, "clearing")), [])

    def test_recovery_completes_an_interrupted_committed_clear_including_absent_directory(self):
        reg = self.registry(sv.FsOps())
        reg.open()
        for tid in ("bgt-a", "bgt-b"):
            log = reg.store.create_log(tid)
            log.close()
            reg.admit("l", "c", "/", True, "act", tid, f"tasks/{tid}/terminal.log")
            reg.finalize(tid, sv.Outcome("failed", "exit_nonzero", None), sv.ExitEvidence("code", 2, None), 0, sv.NOTICE_PENDING)
            reg.update(tid, lambda r: setattr(r, "clearing", True))
        # bgt-a: intent only; bgt-b: directory already gone.
        os.rename(os.path.join(self.root, "tasks", "bgt-b"), os.path.join(self.root, "clearing", "bgt-b"))
        for name in os.listdir(os.path.join(self.root, "clearing", "bgt-b")):
            os.unlink(os.path.join(self.root, "clearing", "bgt-b", name))
        os.rmdir(os.path.join(self.root, "clearing", "bgt-b"))
        reg2 = self.registry(sv.FsOps())
        reg2.open()
        self.assertEqual(reg2.state.tasks, {})
        self.assertEqual(os.listdir(os.path.join(self.root, "tasks")), [])
        self.assertEqual(os.listdir(os.path.join(self.root, "clearing")), [])

    def test_corrupt_or_unsupported_metadata_is_not_recovered_as_empty(self):
        reg = self.registry(sv.FsOps())
        reg.open()
        path = os.path.join(self.root, "tasks.json")
        with open(path, "w") as f:
            f.write("{not json")
        with self.assertRaises(sv.DomainError) as cm:
            self.registry(sv.FsOps()).open()
        self.assertEqual(cm.exception.code, "STORE_CORRUPT")
        with open(path, "w") as f:
            json.dump({"schema": sv.REGISTRY_SCHEMA, "version": 99}, f)
        with self.assertRaises(sv.DomainError) as cm:
            self.registry(sv.FsOps()).open()
        self.assertEqual(cm.exception.code, "UNSUPPORTED_SCHEMA")

    def test_a_second_owner_cannot_acquire_the_session_lock(self):
        store = sv.FileTaskStore(self.root, sv.FsOps())
        store.init_layout()
        first = sv.OwnerLock(self.root, sv.FsOps())
        first.acquire(0, self.clock)
        inode = os.stat(os.path.join(self.root, "owner.lock")).st_ino
        second = sv.OwnerLock(self.root, sv.FsOps())
        with self.assertRaises(sv.DomainError) as cm:
            second.acquire(0, sv.SystemClock())
        self.assertEqual(cm.exception.code, "SESSION_BUSY")
        first.release()
        second.acquire(0, self.clock)
        second.release()
        self.assertEqual(os.stat(os.path.join(self.root, "owner.lock")).st_ino, inode)

    def test_missing_log_is_an_artifact_error_not_empty_output(self):
        reg = self.registry(sv.FsOps())
        reg.open()
        log = reg.store.create_log("bgt-a")
        log.close()
        os.unlink(os.path.join(self.root, "tasks", "bgt-a", "terminal.log"))
        with self.assertRaises(sv.DomainError) as cm:
            reg.store.read_log("bgt-a", 0, 10)
        self.assertEqual(cm.exception.code, "ARTIFACT_MISSING")


if __name__ == "__main__":
    unittest.main()
