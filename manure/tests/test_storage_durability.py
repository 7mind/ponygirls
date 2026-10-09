"""Storage unit spec: receipts/publish crash windows/quota/sweep (server owned).

Runs against the real SQLite/FS store in a temp dir plus a narrow
in-memory dummy through one abstract receipt-coalescing suite
(dual-tests pattern). No network.
"""

import hashlib
import os
import tempfile
import threading
import time
import unittest

from manure.storage import ArtifactStore, MemoryArtifactStore

GOOD = hashlib.sha256(b"payload").hexdigest()


def _manifest(path="f.bin", size=7, sha=GOOD):
    return [{"path": path, "kind": "file", "size": size, "sha256": sha}]


def _make_store(test, subdir="s", clock=None, **kw):
    data_dir = os.path.join(test.tmp.name, subdir)
    os.makedirs(data_dir, exist_ok=True)
    store = ArtifactStore(data_dir, now=clock, **kw)
    test.addCleanup(store.close)
    return store


class ReceiptCoalescingSuite:
    """Abstract suite: meaningful for both SQLite and in-memory trackers."""

    def _tracker(self):
        raise NotImplementedError

    def test_coalesce_and_idempotent_reput(self):
        tr = self._tracker()
        tr.record("a", "f", 0, 4, "h0")
        tr.record("a", "f", 4, 4, "h1")
        self.assertEqual(tr.received("a", "f"), 8)
        self.assertEqual(tr.ranges("a", "f"), [(0, 4), (4, 8)])
        tr.record("a", "f", 0, 4, "h0")  # identical re-PUT: no-op
        self.assertEqual(tr.received("a", "f"), 8)
        with self.assertRaises(KeyError):
            tr.record("a", "f", 0, 4, "different")

    def test_gap_ranges_sorted(self):
        tr = self._tracker()
        tr.record("a", "g", 8, 4, "h2")
        tr.record("a", "g", 0, 4, "h0")
        self.assertEqual(tr.ranges("a", "g"), [(0, 4), (8, 12)])
        self.assertEqual(tr.received("a", "g"), 8)


class TestMemoryReceipts(ReceiptCoalescingSuite, unittest.TestCase):
    def _tracker(self):
        return MemoryArtifactStore()


class TestSqliteReceipts(ReceiptCoalescingSuite, unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def _tracker(self):
        store = _make_store(self)
        store._test_init_artifact("a", "u1", "t1", "file", _manifest())
        return store._receipt_tracker_for_test("a")


class StorageCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.clock = [time.time()]

    def _store(self, subdir="s", **kw):
        data_dir = os.path.join(self.tmp.name, subdir)
        os.makedirs(data_dir, exist_ok=True)
        store = ArtifactStore(data_dir, now=lambda: self.clock[0], **kw)
        self.addCleanup(store.close)
        return store

    # -- durable receipt ordering --------------------------------------
    def test_bytes_without_row_and_row_without_bytes_reconcile(self):
        store = self._store()
        data = b"payload"
        aid = store.init_artifact("u1", "t1", "n", "file", "internal",
                                  _manifest(size=len(data)), None)["id"]
        # complete the file through the durable path
        store.put_chunk("u1", aid, "f.bin", 0, data,
                        hashlib.sha256(data).hexdigest())
        # fault 1: stray bytes appended past receipts (crash between 1-2)
        tree = os.path.join(store.data_dir, "staging", aid, "tree", "f.bin")
        with open(tree, "ab") as fh:
            fh.write(b"STRAY")
        # fault 2: receipt row without bytes (crash between 2-3)
        store._inject_receipt_for_test(aid, "f.bin", 999, 4, "ab" * 32)
        store.reconcile()
        status = store.upload_status(aid)
        self.assertEqual(status["files"][0]["received_bytes"], len(data))
        self.assertEqual(status["files"][0]["received_ranges"],
                         [[0, len(data)]])
        with open(tree, "rb") as fh:
            self.assertEqual(fh.read(), data)

    # -- publish windows ------------------------------------------------
    def test_publish_window_live_present_commits_ready(self):
        store = self._store()
        data = b"payload"
        aid = store.init_artifact("u1", "t1", "n", "file", "internal",
                                  _manifest(size=len(data)), None)["id"]
        store.put_chunk("u1", aid, "f.bin", 0, data,
                        hashlib.sha256(data).hexdigest())
        # simulate crash after rename, before P5: live present + publishing
        store._set_state_for_test(aid, "publishing")
        store._simulate_rename_for_test(aid)
        store.reconcile()
        self.assertEqual(store.get_artifact(aid)["state"], "ready")

    def test_publish_window_neither_tree_returns_to_uploading(self):
        store = self._store()
        data = b"payload"
        aid = store.init_artifact("u1", "t1", "n", "file", "internal",
                                  _manifest(size=len(data)), None)["id"]
        store._set_state_for_test(aid, "publishing")
        # staging incomplete (no chunks at all): must go back to uploading
        store.reconcile()
        self.assertEqual(store.get_artifact(aid)["state"], "uploading")

    def test_ready_stray_staging_cleaned(self):
        store = self._store()
        data = b"payload"
        aid = store.init_artifact("u1", "t1", "n", "file", "internal",
                                  _manifest(size=len(data)), None)["id"]
        store.put_chunk("u1", aid, "f.bin", 0, data,
                        hashlib.sha256(data).hexdigest())
        store.publish("u1", aid)
        # stray remnant after P5 (crash before P6)
        stray = os.path.join(store.data_dir, "staging", aid + ".json")
        with open(stray, "w") as fh:
            fh.write("{}")
        store.reconcile()
        self.assertEqual(store.get_artifact(aid)["state"], "ready")
        self.assertFalse(os.path.exists(stray))

    def test_orphan_live_tree_without_row_deleted(self):
        store = self._store()
        ghost = os.path.join(store.data_dir, "live",
                             "f" * 32)
        os.makedirs(ghost)
        with open(os.path.join(ghost, "x"), "w") as fh:
            fh.write("ghost")
        store.reconcile()
        self.assertFalse(os.path.exists(ghost))

    # -- quota / sessions ------------------------------------------------
    def test_concurrent_init_quota_subset(self):
        store = self._store(storage_quota_bytes=3000)
        outcomes = []
        lock = threading.Lock()

        def worker(i):
            try:
                store.init_artifact("u%d" % i, "t", "q%d" % i, "file",
                                    "internal", _manifest(size=1000), None)
                ok = True
            except Exception:
                ok = False
            with lock:
                outcomes.append(ok)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sorted(outcomes), [False, False, True, True, True])

    def test_sweep_expired_idle_orphans_grants(self):
        store = self._store()
        aid = store.init_artifact("u1", "t1", "n", "file", "internal",
                                  _manifest(), 60)["id"]
        grant = store.create_one_time_grant(aid, "u1", "u1", "t1", "d1")
        self.clock[0] += 61
        removed = store.sweep()
        self.assertGreaterEqual(removed, 1)
        self.assertIsNone(store.get_artifact(aid))
        with self.assertRaises(KeyError):
            store.consume_one_time_grant(grant, aid)

    def test_r1_failed_receipt_commit_retry_safe(self):
        import sqlite3
        from unittest import mock
        store = self._store()
        data = b"retry-payload-bytes!!"
        aid = store.init_artifact(
            "u1", "t1", "n", "file", "internal",
            _manifest(size=len(data),
                      sha=hashlib.sha256(data).hexdigest()), None)["id"]
        real_insert = ArtifactStore._insert_receipt

        def flaky(self, *args):
            if not getattr(flaky, "fired", False):
                flaky.fired = True
                raise sqlite3.OperationalError("disk I/O error")
            return real_insert(self, *args)
        with mock.patch.object(ArtifactStore, "_insert_receipt",
                               autospec=True, side_effect=flaky):
            with self.assertRaises(ValueError) as ctx:
                store.put_chunk("u1", aid, "f.bin", 0, data,
                                hashlib.sha256(data).hexdigest())
            self.assertEqual(ctx.exception.code, "unavailable")
        # retry overwrites the unreceipted bytes and publishes cleanly
        ack = store.put_chunk("u1", aid, "f.bin", 0, data,
                              hashlib.sha256(data).hexdigest())
        self.assertEqual(ack["received_bytes"], len(data))
        store.publish("u1", aid)
        with open(os.path.join(store.data_dir, "live", aid,
                               "f.bin"), "rb") as fh:
            self.assertEqual(fh.read(), data)

    def test_r10_interrupted_publish_empty_root(self):
        store = self._store()
        aid = store.init_artifact("u1", "t1", "empty", "dir", "internal",
                                  [], None)["id"]
        # before rename: publishing + complete staging -> redo -> ready
        store._set_state_for_test(aid, "publishing")
        store.reconcile()
        self.assertEqual(store.get_artifact(aid)["state"], "ready")
        self.assertTrue(os.path.isdir(os.path.join(store.data_dir, "live",
                                                   aid)))
        # after rename: publishing + live present -> commit ready
        aid2 = store.init_artifact("u1", "t1", "empty2", "dir",
                                   "internal", [], None)["id"]
        store._set_state_for_test(aid2, "publishing")
        store._simulate_rename_for_test(aid2)
        store.reconcile()
        self.assertEqual(store.get_artifact(aid2)["state"], "ready")

    def test_r8_sweep_vs_publish_invariants(self):
        import threading
        store = self._store()
        data = b"r8-payload"
        manifest = _manifest(size=len(data),
                             sha=hashlib.sha256(data).hexdigest())
        for round_no in range(25):
            aid = store.init_artifact("u%d" % round_no, "t", "r8-%d" % round_no,
                                      "file", "internal", manifest,
                                      None)["id"]
            store.put_chunk("u%d" % round_no, aid, "f.bin", 0, data,
                            hashlib.sha256(data).hexdigest())
            pub_errors: list = []

            def publish():
                try:
                    store.publish("u%d" % round_no, aid)
                except ValueError as exc:
                    pub_errors.append(exc)

            publisher = threading.Thread(target=publish)
            sweeper = threading.Thread(target=store.sweep)
            publisher.start()
            sweeper.start()
            publisher.join()
            sweeper.join()
            self.assertEqual(pub_errors, [])
            item = store.get_artifact(aid)
            self.assertIsNotNone(item)
            self.assertEqual(item["state"], "ready")
            # ready bytes must remain intact: sweep never ate a live tree
            with open(os.path.join(store.data_dir, "live", aid,
                                   "f.bin"), "rb") as fh:
                self.assertEqual(fh.read(), data)

    def test_r8_init_vs_delete_leaves_no_debris(self):
        import threading
        store = self._store()
        seen: list = []
        seen_lock = threading.Lock()
        stop = threading.Event()

        def producer():
            i = 0
            while not stop.is_set() and i < 30:
                try:
                    aid = store.init_artifact("u", "t", "c-%d" % i, "file",
                                              "internal", _manifest(),
                                              None)["id"]
                except ValueError:
                    continue
                with seen_lock:
                    seen.append(aid)
                try:
                    store.put_chunk("u", aid, "f.bin", 0, b"payload",
                                    GOOD)
                except ValueError:
                    pass  # lost the race with deleter: fine
                i += 1

        def deleter():
            while not stop.is_set():
                with seen_lock:
                    targets = list(seen)
                    seen.clear()
                if not targets and stop.is_set():
                    break
                for aid in targets:
                    store.delete_artifact(aid)

        prod = threading.Thread(target=producer)
        dele = threading.Thread(target=deleter)
        prod.start()
        dele.start()
        prod.join()
        stop.set()
        dele.join()
        store.sweep()
        store.reconcile()
        rows = store._db.execute("SELECT id FROM artifacts").fetchall()
        live_rows = {r["id"] for r in rows}
        # every surviving row is fully consistent
        for aid in live_rows:
            item = store.get_artifact(aid)
            self.assertIn(item["state"], ("uploading", "ready"))
        # no filesystem debris without rows
        for base in ("live",):
            try:
                entries = os.listdir(os.path.join(store.data_dir, base))
            except FileNotFoundError:
                entries = []
            for name in entries:
                self.assertIn(name, live_rows)
        orphans = store._db.execute(
            "SELECT COUNT(*) FROM receipts WHERE artifact_id NOT IN "
            "(SELECT id FROM artifacts)").fetchone()[0]
        self.assertEqual(orphans, 0)
        ogrants = store._db.execute(
            "SELECT COUNT(*) FROM content_grants WHERE artifact_id NOT IN "
            "(SELECT id FROM artifacts)").fetchone()[0]
        self.assertEqual(ogrants, 0)

    def test_r8_quota_failure_leaves_no_storage(self):
        store = self._store(storage_quota_bytes=100)
        big = _manifest(size=1000, sha=hashlib.sha256(b"x" * 1000).hexdigest())
        with self.assertRaises(ValueError):
            store.init_artifact("u", "t", "big", "file", "internal", big,
                                None)
        rows = store._db.execute("SELECT COUNT(*) FROM artifacts").fetchone()
        self.assertEqual(rows[0], 0)
        staging = os.listdir(os.path.join(store.data_dir, "staging"))
        self.assertEqual(staging, [])

    def test_r4_unlock_rotate_race_never_honors_old_password(self):
        import threading
        store = self._store()
        data = b"r4"
        manifest = [{"path": "f.bin", "kind": "file", "size": len(data),
                     "sha256": hashlib.sha256(data).hexdigest()}] 
        out = store.init_artifact("u", "t", "ext", "file", "external",
                                  manifest, None)
        aid, current = out["id"], out["external_password"]
        store.put_chunk("u", aid, "f.bin", 0, data,
                        hashlib.sha256(data).hexdigest())
        store.publish("u", aid)
        stale: list = []
        for _round in range(40):
            victim = current
            issued: list = []

            def unlock():
                got = store.unlock_with_password(aid, victim)
                if got is not None:
                    issued.append(got[0])

            rot: list = []

            def rotate():
                rot.append(store.rotate_password(aid))

            threads = [threading.Thread(target=unlock),
                       threading.Thread(target=rotate)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            self.assertEqual(len(rot), 1)
            current = rot[0]
            stale.append(victim)
            # every grant issued under a superseded password is dead
            for value in issued:
                self.assertIsNone(store.lookup_content_grant(value, aid))
        # all superseded passwords stay rejected
        for password in stale:
            self.assertIsNone(store.unlock_with_password(aid, password))
        self.assertIsNotNone(store.unlock_with_password(aid, current))

    def test_r9_second_claim_fails_first_unaffected(self):
        from manure.storage import StorageError
        first = self._store(subdir="claim")
        with self.assertRaises(StorageError) as ctx:
            ArtifactStore(os.path.join(self.tmp.name, "claim"),
                          now=lambda: self.clock[0])
        self.assertEqual(ctx.exception.code, "unavailable")
        # first instance fully functional despite the competitor
        data = b"claim"
        aid = first.init_artifact(
            "u", "t", "c", "file", "internal",
            _manifest(size=len(data),
                      sha=hashlib.sha256(data).hexdigest()), None)["id"]
        first.put_chunk("u", aid, "f.bin", 0, data,
                        hashlib.sha256(data).hexdigest())
        first.publish("u", aid)
        self.assertEqual(first.get_artifact(aid)["state"], "ready")
        first.close()
        # claim released on close: a successor starts cleanly
        successor = ArtifactStore(os.path.join(self.tmp.name, "claim"),
                                  now=lambda: self.clock[0])
        self.addCleanup(successor.close)
        self.assertEqual(successor.get_artifact(aid)["state"], "ready")

    def test_r9_claim_handoff_after_close(self):
        first = self._store(subdir="claim2")
        first.close()
        second = ArtifactStore(os.path.join(self.tmp.name, "claim2"),
                               now=lambda: self.clock[0])
        self.addCleanup(second.close)
        aid = second.init_artifact("u", "t", "h", "file", "internal",
                                   _manifest(), None)["id"]
        self.assertIsNotNone(second.get_artifact(aid))

    def test_r11_publish_faults_recover_without_restart(self):
        import io
        from contextlib import redirect_stderr
        from unittest import mock
        store = self._store()
        data = b"r11-bytes"
        aid = store.init_artifact(
            "u", "t", "n", "file", "internal",
            _manifest(size=len(data),
                      sha=hashlib.sha256(data).hexdigest()), None)["id"]
        store.put_chunk("u", aid, "f.bin", 0, data,
                        hashlib.sha256(data).hexdigest())
        log = io.StringIO()
        # rename failure: sanitized 503, back to uploading, retry works
        with mock.patch("os.rename", side_effect=OSError("disk full")):
            with redirect_stderr(log):
                with self.assertRaises(ValueError) as ctx:
                    store.publish("u", aid)
            self.assertEqual(ctx.exception.code, "unavailable")
        self.assertIn(store.get_artifact(aid)["state"], ("uploading",))
        store.publish("u", aid)
        self.assertEqual(store.get_artifact(aid)["state"], "ready")
        self.assertNotIn(store.data_dir, log.getvalue())

    def _r11_complete_artifact(self, store, tag="n"):
        data = ("r11-%s-payload" % tag).encode()
        aid = store.init_artifact(
            "u", "t", tag, "file", "internal",
            _manifest(size=len(data),
                      sha=hashlib.sha256(data).hexdigest()), None)["id"]
        store.put_chunk("u", aid, "f.bin", 0, data,
                        hashlib.sha256(data).hexdigest())
        return aid, data

    def test_r11_lost_p5_retry_completes(self):
        # True lost-P5 window: one-shot fault between rename and ready
        # commit. First publish -> unavailable (staging gone, live done);
        # F4: the retry encountering publishing is 409 (prepares ready),
        # then observes ready; bytes verified, not labels.
        store = self._store()
        aid, data = self._r11_complete_artifact(store)
        store._failpoints = {"after_rename"}
        with self.assertRaises(ValueError) as ctx:
            store.publish("u", aid)
        self.assertEqual(ctx.exception.code, "unavailable")
        self.assertFalse(os.path.exists(
            os.path.join(store.data_dir, "staging", aid, "tree")))
        with self.assertRaises(ValueError) as ctx2:
            store.publish("u", aid)
        self.assertEqual(ctx2.exception.code, "state-conflict")
        self.assertEqual(store.get_artifact(aid)["state"], "ready")
        out = store.publish("u", aid)
        self.assertEqual(out["state"], "ready")
        status = store.upload_status(aid)
        self.assertEqual(status["state"], "ready")
        with open(os.path.join(store.data_dir, "live", aid,
                               "f.bin"), "rb") as fh:
            self.assertEqual(fh.read(), data)

    def test_r11_lost_p5_restart_recovers(self):
        # Same window, but the process dies before retry: startup
        # reconciliation commits ready and serves bytes.
        store = self._store()
        aid, data = self._r11_complete_artifact(store, tag="rst")
        store._failpoints = {"before_ready_commit"}
        with self.assertRaises(ValueError):
            store.publish("u", aid)
        store.close()
        successor = ArtifactStore(store.data_dir,
                                  now=lambda: self.clock[0])
        self.addCleanup(successor.close)
        successor.reconcile()
        self.assertEqual(successor.get_artifact(aid)["state"], "ready")
        with open(os.path.join(successor.data_dir, "live", aid,
                               "f.bin"), "rb") as fh:
            self.assertEqual(fh.read(), data)

    def test_r11_recovery_fsync_fault_keeps_publishing(self):
        # fsync failure during the recovered ready path: no acknowledgment,
        # recoverable mark kept; F4 requires 409 even when recovery would
        # commit, so the prepared retry needs one more call for ready.
        store = self._store()
        aid, data = self._r11_complete_artifact(store, tag="fs")
        store._set_state_for_test(aid, "publishing")
        store._simulate_rename_for_test(aid)
        store._failpoints = {"fsync_live_dir"}
        with self.assertRaises(ValueError) as ctx:
            store.publish("u", aid)
        self.assertEqual(ctx.exception.code, "state-conflict")
        self.assertEqual(store.get_artifact(aid)["state"], "publishing")
        # F4: encountering publishing is 409 (recovery commits ready).
        with self.assertRaises(ValueError) as ctx2:
            store.publish("u", aid)
        self.assertEqual(ctx2.exception.code, "state-conflict")
        self.assertEqual(store.get_artifact(aid)["state"], "ready")
        out = store.publish("u", aid)
        self.assertEqual(out["state"], "ready")
        with open(os.path.join(store.data_dir, "live", aid,
                               "f.bin"), "rb") as fh:
            self.assertEqual(fh.read(), data)

    def _r11_record_order(self, store, aid, fn):
        # Record actual live/ fsync, data_dir fsync, and ready COMMIT order.
        # Distinguishes fds by fstat dev/ino against known dirs (Linux).
        import stat as _stat
        live_path = os.path.join(store.data_dir, "live")
        live_st = os.stat(live_path)
        live_id = (live_st.st_dev, live_st.st_ino)
        data_st = os.stat(store.data_dir)
        data_id = (data_st.st_dev, data_st.st_ino)
        events: list[str] = []
        real_fsync = os.fsync
        real_execute = store._db.execute

        def spy_fsync(fd):
            try:
                st = os.fstat(fd)
            except OSError:
                return real_fsync(fd)
            key = (st.st_dev, st.st_ino)
            # Only directory fds can be live/ or data_dir; files share
            # dev but have distinct inos.
            if _stat.S_ISDIR(st.st_mode):
                if key == live_id:
                    events.append("fsync-live")
                elif key == data_id:
                    events.append("fsync-data")
            return real_fsync(fd)

        class _SpyDB:
            def execute(self, query, params=()):
                if isinstance(query, str) and query.strip().upper() == \
                        "COMMIT":
                    # Only the ready COMMIT after parent fsyncs matters;
                    # BEGIN/COMMIT pairs for other transactions also log,
                    # but ordering relative to parent fsyncs is asserted.
                    events.append("commit")
                return real_execute(query, params)

            def __getattr__(self, name):
                return getattr(real_execute, name)

        # Patch os.fsync globally for this store op only.
        from unittest import mock as _mock
        with _mock.patch("os.fsync", side_effect=spy_fsync):
            # Wrap the connection object for COMMIT logging.
            orig_db = store._db
            assert orig_db is not None
            wrapper = _SpyDB()
            # _SpyDB needs execute + all other attrs from the real conn.
            wrapper_execute = wrapper.execute

            class _Conn:
                def execute(self, q, p=()):
                    return wrapper_execute(q, p)

                def __getattr__(self, name):
                    return getattr(orig_db, name)
            store._db = _Conn()  # type: ignore[assignment]
            try:
                fn()
            finally:
                store._db = orig_db
        return events

    def test_r11_live_path_fsync_commit_order(self):
        # Live publish path: live/ fsync, then data_dir fsync, then ready
        # COMMIT (P4 parents before P5). No recovery involved.
        store = self._store()
        aid, data = self._r11_complete_artifact(store, tag="ord")
        events = self._r11_record_order(
            store, aid, lambda: store.publish("u", aid))
        self.assertEqual(store.get_artifact(aid)["state"], "ready")
        # Last three relevant events: live, data, commit in order.
        # Filter to the final publish window (init/chunk fsyncs precede).
        live_idx = max(i for i, e in enumerate(events)
                       if e == "fsync-live")
        data_idx = max(i for i, e in enumerate(events)
                       if e == "fsync-data")
        commit_idx = max(i for i, e in enumerate(events)
                         if e == "commit")
        self.assertLess(live_idx, data_idx,
                        "live/ fsync must precede data_dir fsync: %r"
                        % (events,))
        self.assertLess(data_idx, commit_idx,
                        "data_dir fsync must precede ready COMMIT: %r"
                        % (events,))

    def test_r11_recovery_path_fsync_commit_order(self):
        # Recovered ready path (publishing + live present): same ordering,
        # observed through the F4 409-then-ready sequence.
        store = self._store()
        aid, data = self._r11_complete_artifact(store, tag="rec")
        store._set_state_for_test(aid, "publishing")
        store._simulate_rename_for_test(aid)
        def first():
            with self.assertRaises(ValueError) as ctx:
                store.publish("u", aid)
            self.assertEqual(ctx.exception.code, "state-conflict")
        events = self._r11_record_order(store, aid, first)
        self.assertEqual(store.get_artifact(aid)["state"], "ready")
        live_idx = max(i for i, e in enumerate(events)
                       if e == "fsync-live")
        data_idx = max(i for i, e in enumerate(events)
                       if e == "fsync-data")
        commit_idx = max(i for i, e in enumerate(events)
                         if e == "commit")
        self.assertLess(live_idx, data_idx)
        self.assertLess(data_idx, commit_idx)
        # Subsequent retry observes ready (F4).
        out = store.publish("u", aid)
        self.assertEqual(out["state"], "ready")

    def test_r11_recovery_data_dir_fault_keeps_publishing_unserved(self):
        # Fault the FINAL data_dir fsync (not live/): recoverable publishing,
        # never served; retry commits ready with full bytes+hash.
        store = self._store()
        aid, data = self._r11_complete_artifact(store, tag="dd")
        store._set_state_for_test(aid, "publishing")
        store._simulate_rename_for_test(aid)
        store._failpoints = {"fsync_data_dir"}
        with self.assertRaises(ValueError) as ctx:
            store.publish("u", aid)
        self.assertEqual(ctx.exception.code, "state-conflict")
        self.assertEqual(store.get_artifact(aid)["state"], "publishing")
        # Unserved while publishing: no ready row, no content route.
        self.assertNotEqual(store.get_artifact(aid)["state"], "ready")
        with self.assertRaises(ValueError) as ctx2:
            store.publish("u", aid)
        self.assertEqual(ctx2.exception.code, "state-conflict")
        self.assertEqual(store.get_artifact(aid)["state"], "ready")
        out = store.publish("u", aid)
        self.assertEqual(out["state"], "ready")
        with open(os.path.join(store.data_dir, "live", aid,
                               "f.bin"), "rb") as fh:
            got = fh.read()
        self.assertEqual(got, data)
        self.assertEqual(hashlib.sha256(got).hexdigest(),
                         hashlib.sha256(data).hexdigest())

    def test_r11_recovery_ready_commit_fault_keeps_publishing_unserved(self):
        # Fault the ready COMMIT itself: publishing retained, unserved;
        # retry completes with bytes+hash intact.
        store = self._store()
        aid, data = self._r11_complete_artifact(store, tag="rc")
        store._set_state_for_test(aid, "publishing")
        store._simulate_rename_for_test(aid)
        store._failpoints = {"ready_commit"}
        with self.assertRaises(ValueError) as ctx:
            store.publish("u", aid)
        self.assertEqual(ctx.exception.code, "state-conflict")
        self.assertEqual(store.get_artifact(aid)["state"], "publishing")
        with self.assertRaises(ValueError) as ctx2:
            store.publish("u", aid)
        self.assertEqual(ctx2.exception.code, "state-conflict")
        self.assertEqual(store.get_artifact(aid)["state"], "ready")
        out = store.publish("u", aid)
        self.assertEqual(out["state"], "ready")
        with open(os.path.join(store.data_dir, "live", aid,
                               "f.bin"), "rb") as fh:
            got = fh.read()
        self.assertEqual(got, data)

    def test_r11_missing_trees_rebuild_resumable(self):
        # Publishing with neither tree: back to uploading with rebuilt
        # topology; chunks resume, publish and bytes verify.
        store = self._store()
        aid, data = self._r11_complete_artifact(store, tag="mt")
        store._set_state_for_test(aid, "publishing")
        import shutil as _shutil
        _shutil.rmtree(os.path.join(store.data_dir, "staging", aid),
                       ignore_errors=True)
        store.reconcile()
        self.assertEqual(store.get_artifact(aid)["state"], "uploading")
        tree_file = os.path.join(store.data_dir, "staging", aid, "tree",
                                 "f.bin")
        self.assertTrue(os.path.isfile(tree_file))
        status = store.upload_status(aid)
        self.assertEqual(status["files"][0]["received_bytes"], 0)
        store.put_chunk("u", aid, "f.bin", 0, data,
                        hashlib.sha256(data).hexdigest())
        store.publish("u", aid)
        with open(os.path.join(store.data_dir, "live", aid,
                               "f.bin"), "rb") as fh:
            self.assertEqual(fh.read(), data)

    def test_r13_symlink_staging_blocked_and_never_served(self):
        store = self._store()
        data = b"r13-data!"
        manifest = [{"path": "sub/f.bin", "kind": "file",
                     "size": len(data),
                     "sha256": hashlib.sha256(data).hexdigest()}] 
        aid = store.init_artifact("u", "t", "n", "dir", "internal",
                                  manifest, None)["id"]
        tree = os.path.join(store.data_dir, "staging", aid, "tree")
        outside = os.path.join(self.tmp.name, "outside")
        os.makedirs(outside)
        with open(os.path.join(outside, "f.bin"), "wb") as fh:
            fh.write(b"EXTERNAL" + data)
        # swap the real parent for a symlink: chunks must not escape
        import shutil as _shutil
        _shutil.rmtree(os.path.join(tree, "sub"))
        os.symlink(outside, os.path.join(tree, "sub"))
        with self.assertRaises(ValueError) as ctx:
            store.put_chunk("u", aid, "sub/f.bin", 0, data,
                            hashlib.sha256(data).hexdigest())
        self.assertEqual(ctx.exception.code, "invalid-path")
        self.assertFalse(os.path.exists(
            os.path.join(outside, "f.bin." + aid[:4])))
        # symlinked file leaf blocks publication; session stays resumable
        os.unlink(os.path.join(tree, "sub"))
        os.makedirs(os.path.join(tree, "sub"))
        store.put_chunk("u", aid, "sub/f.bin", 0, data,
                        hashlib.sha256(data).hexdigest())
        os.remove(os.path.join(tree, "sub", "f.bin"))
        os.symlink(os.path.join(outside, "f.bin"),
                   os.path.join(tree, "sub", "f.bin"))
        with self.assertRaises(ValueError) as ctx2:
            store.publish("u", aid)
        self.assertIn(ctx2.exception.code, ("hash-mismatch", "invalid-path"))
        self.assertEqual(store.get_artifact(aid)["state"], "uploading")

    def test_r11_chunk_write_fault_maps_and_retries(self):
        from unittest import mock
        store = self._store()
        data = b"r11-write-fault"
        aid = store.init_artifact(
            "u", "t", "n", "file", "internal",
            _manifest(size=len(data),
                      sha=hashlib.sha256(data).hexdigest()), None)["id"]
        with mock.patch("os.fsync", side_effect=OSError("disk full")):
            with self.assertRaises(ValueError) as ctx:
                store.put_chunk("u", aid, "f.bin", 0, data,
                                hashlib.sha256(data).hexdigest())
            self.assertEqual(ctx.exception.code, "unavailable")
            self.assertNotIn(store.data_dir, str(ctx.exception)) 
        ack = store.put_chunk("u", aid, "f.bin", 0, data,
                              hashlib.sha256(data).hexdigest())
        self.assertEqual(ack["received_bytes"], len(data))
        store.publish("u", aid)
        self.assertEqual(store.get_artifact(aid)["state"], "ready")

    def _r13_outside(self, name="victim.bin", data=b"OUTSIDE-DATA-XYZ"):
        path = os.path.join(self.tmp.name, name)
        with open(path, "wb") as fh:
            fh.write(data)
        st = os.stat(path)
        return path, data, (st.st_mtime_ns, st.st_size)

    def _r13_outside_intact(self, path, data, sig):
        with open(path, "rb") as fh:
            self.assertEqual(fh.read(), data)
        st = os.stat(path)
        self.assertEqual((st.st_mtime_ns, st.st_size), sig)

    def test_r13_symlinked_parent_restart_touches_nothing_external(self):
        store = self._store()
        data = b"r13-parent"
        manifest = [{"path": "sub/f.bin", "kind": "file",
                     "size": len(data),
                     "sha256": hashlib.sha256(data).hexdigest()}] 
        aid = store.init_artifact("u", "t", "n", "dir", "internal",
                                  manifest, None)["id"]
        store.put_chunk("u", aid, "sub/f.bin", 0, data,
                        hashlib.sha256(data).hexdigest())
        outside, obytes, osig = self._r13_outside()
        tree = os.path.join(store.data_dir, "staging", aid, "tree")
        import shutil as _shutil
        _shutil.rmtree(os.path.join(tree, "sub"))
        os.symlink(self.tmp.name, os.path.join(tree, "sub"))
        # note: outside victim lives at tmp root: sub/<basename> resolves
        # through the link while receipts name sub/f.bin (absent outside).
        store.close()
        reopened = ArtifactStore(store.data_dir,
                                 now=lambda: self.clock[0])
        self.addCleanup(reopened.close)
        reopened.reconcile()  # must survive tamper, drop bad receipts
        self.assertEqual(reopened.get_artifact(aid)["state"], "uploading")
        status = reopened.upload_status(aid)
        self.assertEqual(status["files"][0]["received_bytes"], 0)
        self._r13_outside_intact(outside, obytes, osig)

    def test_r13_symlinked_staging_root_restart(self):
        store = self._store()
        data = b"r13-root"
        aid = store.init_artifact(
            "u", "t", "n", "file", "internal",
            _manifest(size=len(data),
                      sha=hashlib.sha256(data).hexdigest()), None)["id"]
        store.put_chunk("u", aid, "f.bin", 0, data,
                        hashlib.sha256(data).hexdigest())
        outside, obytes, osig = self._r13_outside()
        staging_aid = os.path.join(store.data_dir, "staging", aid)
        import shutil as _shutil
        _shutil.rmtree(os.path.join(staging_aid, "tree"))
        os.rmdir(staging_aid)
        os.symlink(self.tmp.name, staging_aid)
        store.close()
        reopened = ArtifactStore(store.data_dir,
                                 now=lambda: self.clock[0])
        self.addCleanup(reopened.close)
        reopened.reconcile()  # survives; never truncates through the link
        self.assertEqual(reopened.get_artifact(aid)["state"], "uploading")
        self._r13_outside_intact(outside, obytes, osig)

    def test_r9_simultaneous_start_single_winner(self):
        import threading
        from manure.storage import StorageError
        data_dir = os.path.join(self.tmp.name, "race")
        os.makedirs(data_dir)
        winners: list = []
        losers: list = []
        lock = threading.Lock()
        barrier = threading.Barrier(8)

        def start_one():
            barrier.wait(timeout=15)
            try:
                store = ArtifactStore(data_dir,
                                      now=lambda: self.clock[0])
            except StorageError as exc:
                with lock:
                    losers.append(exc.code)
                return
            with lock:
                winners.append(store)

        threads = [threading.Thread(target=start_one) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        try:
            # exactly one holder; every loser failed before touching payloads
            self.assertEqual(len(winners), 1)
            self.assertEqual(len(losers), 7)
            self.assertEqual(sorted(set(losers)), ["unavailable"])
            self.assertEqual(
                os.listdir(os.path.join(data_dir, "staging")), [])
            aid = winners[0].init_artifact("u", "t", "w", "file",
                                           "internal", _manifest(),
                                           None)["id"]
            self.assertIsNotNone(winners[0].get_artifact(aid))
        finally:
            for store in winners:
                store.close()

    def test_r9_sigkill_releases_claim(self):
        # A SIGKILLed holder leaves no stale claim: kernel lifetime ends
        # with the process, so a successor starts cleanly on the same dir.
        import signal as _signal
        import subprocess as _subprocess
        import sys as _sys
        data_dir = os.path.join(self.tmp.name, "kill")
        os.makedirs(os.path.join(data_dir, "data"))
        token = "A" * 32 + "AA"  # canonical-shaped? no: use generator
        from manure import auth as _auth
        token = _auth.generate_token()
        hf = os.path.join(self.tmp.name, "k.hash")
        with open(hf, "w") as fh:
            fh.write(_auth.sha256_hex(token) + "\n")
        cfg = {"data_dir": os.path.join(data_dir, "data"), "port": 0,
               "api_origin": "http://127.0.0.1:0",
               "content_suffix": "artifacts.localhost",
               "loopback_dev": True, "dashboard_dir": None,
               "unlock_shell_dir": None,
               "users": [{"id": "u", "type": "agent",
                            "tokens": [{"id": "t", "hashFile": hf}]}]}
        cfg_path = os.path.join(data_dir, "cfg.json")
        with open(cfg_path, "w") as fh:
            fh.write(__import__("json").dumps(cfg))
        env = dict(os.environ)
        env["PYTHONPATH"] = os.path.abspath("manure") + os.pathsep + \
            env.get("PYTHONPATH", "")
        proc = _subprocess.Popen(
            [_sys.executable, "-m", "manure.server",
             "--config", cfg_path],
            stdout=_subprocess.PIPE, stderr=_subprocess.PIPE, env=env)
        try:
            assert proc.stderr is not None
            line = proc.stderr.readline().decode()
            self.assertIn("serving", line)
            proc.send_signal(_signal.SIGKILL)
            proc.wait(timeout=15)
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=15)
            for pipe in (proc.stdout, proc.stderr):
                try:
                    if pipe is not None:
                        pipe.close()
                except OSError:
                    pass
        successor = ArtifactStore(os.path.join(data_dir, "data"),
                                  now=lambda: self.clock[0])
        self.addCleanup(successor.close)
        successor.reconcile()
        aid = successor.init_artifact("u", "t", "s", "file", "internal",
                                      _manifest(), None)["id"]
        self.assertIsNotNone(successor.get_artifact(aid))

    def test_r9_failed_sqlite_startup_releases_claim(self):
        data_dir = os.path.join(self.tmp.name, "corrupt")
        os.makedirs(data_dir)
        with open(os.path.join(data_dir, "manure.db"), "wb") as fh:
            fh.write(b"this is not a database file at all")
        from manure.storage import StorageError
        with self.assertRaises(Exception):
            ArtifactStore(data_dir, now=lambda: self.clock[0])
        # repaired directory starts cleanly: nothing was retained
        os.remove(os.path.join(data_dir, "manure.db"))
        successor = ArtifactStore(data_dir, now=lambda: self.clock[0])
        self.addCleanup(successor.close)
        aid = successor.init_artifact("u", "t", "s", "file", "internal",
                                      _manifest(), None)["id"]
        self.assertIsNotNone(successor.get_artifact(aid))

    def test_r7_stuck_lock_close_raises_and_retains_ownership(self):
        # Governor invariant: on bounded-shutdown timeout fail fast but
        # RETAIN claim+storage; a successor must be denied until the old
        # worker terminates. Fails on last-resort-release implementations.
        import threading
        from manure.storage import StorageError
        store = self._store(subdir="stuck")
        data_dir = os.path.join(self.tmp.name, "stuck")
        held, release = threading.Event(), threading.Event()

        def stuck_worker():  # a different thread: RLock blocks here
            store._lock.acquire()
            held.set()
            release.wait(timeout=30)
            store._lock.release()

        worker = threading.Thread(target=stuck_worker)
        worker.start()
        self.assertTrue(held.wait(timeout=10))
        try:
            with self.assertRaises(StorageError) as ctx:
                store.close(_timeout=0.5)
            self.assertEqual(ctx.exception.code, "unavailable")
            # ownership retained: no successor while the worker holds on
            with self.assertRaises(StorageError) as ctx2:
                ArtifactStore(data_dir, now=lambda: self.clock[0])
            self.assertEqual(ctx2.exception.code, "unavailable")
        finally:
            release.set()
            worker.join(timeout=10)
        store.close()  # retry after the worker terminated succeeds
        successor = ArtifactStore(data_dir, now=lambda: self.clock[0])
        self.addCleanup(successor.close)
        aid = successor.init_artifact("u", "t", "s", "file", "internal",
                                      _manifest(), None)["id"]
        self.assertIsNotNone(successor.get_artifact(aid))

    def test_r7_closed_store_rejects_use(self):
        from manure.storage import StorageError
        store = self._store(subdir="closeduse")
        store.close()
        with self.assertRaises(StorageError) as ctx:
            store.init_artifact("u", "t", "s", "file", "internal",
                                _manifest(), None)
        self.assertEqual(ctx.exception.code, "unavailable")

    def test_r11_empty_root_loss_restart_recovers(self):
        # Empty manifest: tree loss must still rebuild the root so the
        # session stays publishable after restart.
        store = self._store()
        aid = store.init_artifact("u1", "t1", "empty", "dir", "internal",
                                  [], None)["id"]
        store._set_state_for_test(aid, "publishing")
        import shutil as _shutil
        _shutil.rmtree(os.path.join(store.data_dir, "staging", aid),
                       ignore_errors=True)
        store.close()
        reopened = ArtifactStore(store.data_dir,
                                 now=lambda: self.clock[0])
        self.addCleanup(reopened.close)
        reopened.reconcile()
        self.assertEqual(reopened.get_artifact(aid)["state"], "uploading")
        tree = os.path.join(reopened.data_dir, "staging", aid, "tree")
        self.assertTrue(os.path.isdir(tree))
        reopened.publish("u1", aid)
        self.assertEqual(reopened.get_artifact(aid)["state"], "ready")
        self.assertTrue(os.path.isdir(
            os.path.join(reopened.data_dir, "live", aid)))

    def test_r11_reconcile_uploading_live_fsync_commit_order(self):
        # Supported branch: uploading + verified live tree adopts to ready
        # only after actual live/ + data_dir fsyncs and a transactional
        # commit. Faults retain uploading unserved; retry recovers bytes.
        for fault, expect_state in (("fsync_live_dir", "uploading"),
                                    ("fsync_data_dir", "uploading"),
                                    ("ready_commit", "uploading"),
                                    (None, "ready")):
            store = self._store(subdir="r11rec-%s" % (fault or "ok"))
            aid, data = self._r11_complete_artifact(store,
                                                    tag="rec-%s" % (fault or "ok"))
            store._simulate_rename_for_test(aid)
            # uploading + live present (staging tree gone via rename).
            self.assertEqual(store.get_artifact(aid)["state"], "uploading")
            if fault is not None:
                store._failpoints = {fault}
            events = self._r11_record_order(store, aid,
                                            lambda: store.reconcile())
            state = store.get_artifact(aid)["state"]
            self.assertEqual(state, expect_state, fault)
            if fault is not None:
                # Unserved while uploading: live bytes exist but row is not
                # ready, so no ready commit or cleanup happened.
                self.assertTrue(os.path.exists(
                    os.path.join(store.data_dir, "live", aid, "f.bin")))
                store._failpoints = set()
                store.reconcile()
                self.assertEqual(store.get_artifact(aid)["state"],
                                 "ready")
            else:
                # Successful path ordered live/ -> data_dir -> COMMIT.
                live_idx = max(i for i, e in enumerate(events)
                               if e == "fsync-live")
                data_idx = max(i for i, e in enumerate(events)
                               if e == "fsync-data")
                commit_idx = max(i for i, e in enumerate(events)
                                 if e == "commit")
                self.assertLess(live_idx, data_idx, events)
                self.assertLess(data_idx, commit_idx, events)
            with open(os.path.join(store.data_dir, "live", aid,
                                   "f.bin"), "rb") as fh:
                got = fh.read()
            self.assertEqual(got, data)
            self.assertEqual(hashlib.sha256(got).hexdigest(),
                             hashlib.sha256(data).hexdigest())
            store.close()

    def _r11_sigkill_child(self, data_dir, script, aid_file, ready_file,
                           timeout_s=20):
        # Launch a real storage child holding the data_dir claim; wait for
        # its ready file, then SIGKILL. Returns the child's aid (via file).
        import signal as _signal
        import subprocess as _subprocess
        import sys as _sys
        env = dict(os.environ)
        env["PYTHONPATH"] = os.path.abspath("manure") + os.pathsep + \
            env.get("PYTHONPATH", "")
        proc = _subprocess.Popen(
            [_sys.executable, "-c", script, data_dir, aid_file, ready_file],
            stdout=_subprocess.PIPE, stderr=_subprocess.PIPE, env=env)
        try:
            deadline = time.time() + timeout_s
            while time.time() < deadline:
                if os.path.exists(ready_file):
                    break
                if proc.poll() is not None:
                    out, err = proc.communicate(timeout=5)
                    self.fail("child exited early rc=%s out=%r err=%r"
                              % (proc.returncode, out[:500], err[:2000]))
                time.sleep(0.05)
            else:
                self.fail("child never became ready")
            with open(aid_file) as fh:
                aid = fh.read().strip()
            proc.send_signal(_signal.SIGKILL)
            proc.wait(timeout=15)
            return aid
        finally:
            if proc.poll() is None:
                try:
                    proc.kill()
                except OSError:
                    pass
                try:
                    proc.wait(timeout=15)
                except Exception:
                    pass
            for pipe in (proc.stdout, proc.stderr):
                try:
                    if pipe is not None:
                        pipe.close()
                except OSError:
                    pass

    def test_r11_sigkill_chunk_receipt_resumes_truthfully(self):
        # Real production boundary: child exercises actual put_chunk for
        # chunk 1; synchronization sleeps INSIDE _insert_receipt (after
        # bytes fsync, before receipt COMMIT, holding the store lock).
        # SIGKILL (no close) leaves bytes-without-row; restart must report
        # truthful status (only chunk 0), accept safe resend, publish bytes.
        chunk = 65536
        data_dir = os.path.join(self.tmp.name, "kill-chunk")
        os.makedirs(data_dir)
        aid_file = os.path.join(self.tmp.name, "kc-aid")
        ready_file = os.path.join(self.tmp.name, "kc-ready")
        script = (
            "import os, sys, time, hashlib\n"
            "from manure.storage import ArtifactStore\n"
            "data_dir, aid_file, ready_file = sys.argv[1:4]\n"
            "chunk = %d\n"
            "size = chunk + 100\n"
            "data = bytes(i %% 251 for i in range(size))\n"
            "files = [{'path': 'big.bin', 'kind': 'file', 'size': size,\n"
            "         'sha256': hashlib.sha256(data).hexdigest()}]\n"
            "store = ArtifactStore(data_dir, chunk_bytes=chunk)\n"
            "aid = store.init_artifact('u', 't', 'n', 'file', 'internal',\n"
            "                         files, None)['id']\n"
            "store.put_chunk('u', aid, 'big.bin', 0, data[:chunk],\n"
            "                hashlib.sha256(data[:chunk]).hexdigest())\n"
            "real_insert = ArtifactStore._insert_receipt\n"
            "def gated(self, aid2, path, offset, length, sha):\n"
            "    assert aid2 == aid and offset == chunk\n"
            "    with open(aid_file, 'w') as fh:\n"
            "        fh.write(aid)\n"
            "    with open(ready_file, 'w') as fh:\n"
            "        fh.write('inside-insert')\n"
            "    time.sleep(60)\n"
            "    return real_insert(self, aid2, path, offset, length, sha)\n"
            "ArtifactStore._insert_receipt = gated\n"
            "store.put_chunk('u', aid, 'big.bin', chunk, data[chunk:],\n"
            "                hashlib.sha256(data[chunk:]).hexdigest())\n"
            % (chunk,)
        )
        aid = self._r11_sigkill_child(data_dir, script, aid_file,
                                      ready_file)
        # Successor acquires the kernel-released claim and reconciles.
        successor = ArtifactStore(data_dir, now=lambda: self.clock[0],
                                      chunk_bytes=65536)
        self.addCleanup(successor.close)
        successor.reconcile()
        item = successor.get_artifact(aid)
        self.assertIsNotNone(item)
        self.assertEqual(item["state"], "uploading")
        status = successor.upload_status(aid)
        self.assertEqual(status["state"], "uploading")
        # Truthful: only the committed first chunk counts.
        self.assertEqual(status["files"][0]["received_bytes"], chunk)
        # Safe resend of the unacked second chunk, then publish.
        size = chunk + 100
        data = bytes(i % 251 for i in range(size))
        ack = successor.put_chunk(
            "u", aid, "big.bin", chunk, data[chunk:],
            hashlib.sha256(data[chunk:]).hexdigest())
        self.assertEqual(ack["received_bytes"], size)
        # F4: uploading publish completes (no publishing conflict here).
        out = successor.publish("u", aid)
        # Inline recovery may leave publishing->ready as 409 on first try
        # when racing __init__? No: state is uploading, so publish runs
        # P2-P6 directly to ready.
        if out["state"] != "ready":
            out = successor.publish("u", aid)
        self.assertEqual(out["state"], "ready")
        with open(os.path.join(successor.data_dir, "live", aid,
                               "big.bin"), "rb") as fh:
            got = fh.read()
        self.assertEqual(got, data)
        self.assertEqual(hashlib.sha256(got).hexdigest(),
                         hashlib.sha256(data).hexdigest())

    def test_r11_sigkill_publish_lost_p5_recovers_ready(self):
        # Real production boundary: child exercises actual publish;
        # synchronization sleeps INSIDE os.rename (after the staging->live
        # rename, before parent fsyncs/ready COMMIT, holding the lock).
        # SIGKILL (no close) leaves lost-P5; restart must commit ready.
        chunk = 65536
        data_dir = os.path.join(self.tmp.name, "kill-pub")
        os.makedirs(data_dir)
        aid_file = os.path.join(self.tmp.name, "kp-aid")
        ready_file = os.path.join(self.tmp.name, "kp-ready")
        script = (
            "import os, sys, time, hashlib\n"
            "from manure.storage import ArtifactStore\n"
            "data_dir, aid_file, ready_file = sys.argv[1:4]\n"
            "chunk = %d\n"
            "size = chunk + 40\n"
            "data = bytes(i %% 251 for i in range(size))\n"
            "files = [{'path': 'big.bin', 'kind': 'file', 'size': size,\n"
            "         'sha256': hashlib.sha256(data).hexdigest()}]\n"
            "store = ArtifactStore(data_dir, chunk_bytes=chunk)\n"
            "aid = store.init_artifact('u', 't', 'n', 'file', 'internal',\n"
            "                         files, None)['id']\n"
            "store.put_chunk('u', aid, 'big.bin', 0, data[:chunk],\n"
            "                hashlib.sha256(data[:chunk]).hexdigest())\n"
            "store.put_chunk('u', aid, 'big.bin', chunk, data[chunk:],\n"
            "                hashlib.sha256(data[chunk:]).hexdigest())\n"
            "real_rename = os.rename\n"
            "def gated(*a, **k):\n"
            "    out = real_rename(*a, **k)\n"
            "    with open(aid_file, 'w') as fh:\n"
            "        fh.write(aid)\n"
            "    with open(ready_file, 'w') as fh:\n"
            "        fh.write('inside-rename')\n"
            "    time.sleep(60)\n"
            "    return out\n"
            "os.rename = gated\n"
            "store.publish('u', aid)\n"
            % (chunk,)
        )
        aid = self._r11_sigkill_child(data_dir, script, aid_file,
                                      ready_file)
        successor = ArtifactStore(data_dir, now=lambda: self.clock[0],
                                      chunk_bytes=65536)
        self.addCleanup(successor.close)
        successor.reconcile()
        item = successor.get_artifact(aid)
        self.assertIsNotNone(item)
        # Lost-P5 reconciles to ready (never stuck, never served partial).
        self.assertEqual(item["state"], "ready")
        size = chunk + 40
        data = bytes(i % 251 for i in range(size))
        with open(os.path.join(successor.data_dir, "live", aid,
                               "big.bin"), "rb") as fh:
            got = fh.read()
        self.assertEqual(got, data)
        self.assertEqual(hashlib.sha256(got).hexdigest(),
                         hashlib.sha256(data).hexdigest())
        # Idempotent republish observes ready.
        out = successor.publish("u", aid)
        self.assertEqual(out["state"], "ready")

    def test_r13_top_level_roots_symlinked_reconcile_sweep_safe(self):
        # data_dir/live -> outside dir holding a sentinel AND a file whose
        # name matches the manifest: enumeration/removal must never reach
        # through the symlinked root.
        store = self._store()
        data = b"r13-top"
        manifest = [{"path": "f.bin", "kind": "file", "size": len(data),
                     "sha256": hashlib.sha256(data).hexdigest()}] 
        aid = store.init_artifact("u", "t", "n", "file", "internal",
                                  manifest, None)["id"]
        store.put_chunk("u", aid, "f.bin", 0, data,
                        hashlib.sha256(data).hexdigest())
        store.publish("u", aid)
        outside = os.path.join(self.tmp.name, "outside-live")
        os.makedirs(outside)
        sentinel = os.path.join(outside, "sentinel.txt")
        with open(sentinel, "w") as fh:
            fh.write("SENTINEL")
        match = os.path.join(outside, aid)
        os.makedirs(match)
        with open(os.path.join(match, "f.bin"), "wb") as fh:
            fh.write(b"WRONG" * 100)
        live = os.path.join(store.data_dir, "live")
        import shutil as _shutil
        _shutil.rmtree(live)
        os.symlink(outside, live)
        sig_before = (os.stat(sentinel).st_mtime_ns,
                      os.stat(os.path.join(match, "f.bin")).st_mtime_ns)
        store.reconcile()
        store.sweep()
        # outside entries byte-identical and present; row still ready
        with open(sentinel) as fh:
            self.assertEqual(fh.read(), "SENTINEL")
        with open(os.path.join(match, "f.bin"), "rb") as fh:
            self.assertEqual(fh.read(), b"WRONG" * 100)
        sig_after = (os.stat(sentinel).st_mtime_ns,
                     os.stat(os.path.join(match, "f.bin")).st_mtime_ns)
        self.assertEqual(sig_before, sig_after)
        self.assertEqual(store.get_artifact(aid)["state"], "ready")
        store.close()

    def test_r13_top_level_staging_symlinked_init_fails_closed(self):
        store = self._store()
        staging = os.path.join(store.data_dir, "staging")
        import shutil as _shutil
        _shutil.rmtree(staging)
        os.symlink(self.tmp.name, staging)
        with self.assertRaises(ValueError) as ctx:
            store.init_artifact("u", "t", "n", "file", "internal",
                                _manifest(), None)
        self.assertIn(ctx.exception.code, ("invalid-path", "not-found"))
        # tmp root untouched: no aid dirs or sidecars created through it
        leftovers = [n for n in os.listdir(self.tmp.name)
                     if n not in ("s",)]
        self.assertEqual(leftovers, [])

    def test_r9_alias_paths_contend_for_one_claim(self):
        # Same physical directory via a symlinked-parent alias: exactly one
        # holder; the loser cannot reconcile or alter active payloads.
        import threading
        from manure.storage import StorageError
        real = os.path.join(self.tmp.name, "real")
        os.makedirs(real)
        alias_parent = os.path.join(self.tmp.name, "alias")
        os.symlink(self.tmp.name, alias_parent)
        alias_dir = os.path.join(alias_parent, "real")
        winners: list = []
        losers: list = []
        lock = threading.Lock()
        barrier = threading.Barrier(6)

        def start_one(i):
            barrier.wait(timeout=15)
            target = real if i % 2 == 0 else alias_dir
            try:
                store = ArtifactStore(target, now=lambda: self.clock[0])
            except StorageError as exc:
                with lock:
                    losers.append(exc.code)
                return
            with lock:
                winners.append(store)

        threads = [threading.Thread(target=start_one, args=(i,))
                   for i in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        try:
            self.assertEqual(len(winners), 1)
            self.assertEqual(len(losers), 5)
            self.assertEqual(sorted(set(losers)), ["unavailable"])
            data = b"alias-payload"
            aid = winners[0].init_artifact(
                "u", "t", "a", "file", "internal",
                _manifest(size=len(data),
                          sha=hashlib.sha256(data).hexdigest()), None)["id"]
            winners[0].put_chunk("u", aid, "f.bin", 0, data,
                                 hashlib.sha256(data).hexdigest())
            winners[0].publish("u", aid)
            self.assertEqual(winners[0].get_artifact(aid)["state"],
                             "ready")
        finally:
            for store in winners:
                store.close()

    def test_r9_parent_alias_retarget_keeps_physical_binding(self):
        # Deterministic retarget: alias parent A->B with matching outside
        # payload + sidecar names in B. The holder stays bound to physical
        # A (canonical data_dir); deletion removes A, never B; B bytes and
        # mtimes are unchanged. A separate B holder operates independently.
        from manure.storage import StorageError
        baseA = os.path.join(self.tmp.name, "r9A")
        baseB = os.path.join(self.tmp.name, "r9B")
        os.makedirs(os.path.join(baseA, "real"))
        os.makedirs(os.path.join(baseB, "real"))
        alias = os.path.join(self.tmp.name, "r9alias")
        os.symlink(baseA, alias)
        alias_path = os.path.join(alias, "real")
        store = ArtifactStore(alias_path, now=lambda: self.clock[0])
        self.addCleanup(store.close)
        # Canonical binding: data_dir is the physical target, not the alias.
        self.assertEqual(store.data_dir,
                         os.path.realpath(alias_path))
        self.assertEqual(store.data_dir,
                         os.path.join(baseA, "real"))
        data = b"r9-bound-payload"
        aid = store.init_artifact(
            "u", "t", "n", "file", "internal",
            _manifest(size=len(data),
                      sha=hashlib.sha256(data).hexdigest()), None)["id"]
        store.put_chunk("u", aid, "f.bin", 0, data,
                        hashlib.sha256(data).hexdigest())
        store.publish("u", aid)
        self.assertEqual(store.get_artifact(aid)["state"], "ready")
        # Outside B with MATCHING aid payload and sidecar names.
        b_live = os.path.join(baseB, "real", "live", aid)
        os.makedirs(b_live, exist_ok=True)
        outside = b"R9-OUTSIDE-DIFFERENT!!!!"
        with open(os.path.join(b_live, "f.bin"), "wb") as fh:
            fh.write(outside)
        os.makedirs(os.path.join(baseB, "real", "staging"),
                    exist_ok=True)
        with open(os.path.join(baseB, "real", "staging",
                               aid + ".json"), "w") as fh:
            fh.write('{"evil": true}')
        st_before = os.stat(os.path.join(b_live, "f.bin"))
        sig_before = (st_before.st_mtime_ns, st_before.st_size)
        # Retarget the parent alias A->B (leaf stays a real dir).
        os.unlink(alias)
        os.symlink(baseB, alias)
        self.assertEqual(os.path.realpath(alias_path),
                         os.path.join(baseB, "real"))
        # The existing holder still points at physical A.
        self.assertEqual(store.data_dir, os.path.join(baseA, "real"))
        self.assertTrue(store.delete_artifact(aid))
        self.assertIsNone(store.get_artifact(aid))
        self.assertFalse(os.path.exists(
            os.path.join(baseA, "real", "live", aid)))
        # Outside B byte-identical, mtime unchanged (payload + sidecar).
        with open(os.path.join(b_live, "f.bin"), "rb") as fh:
            self.assertEqual(fh.read(), outside)
        st_after = os.stat(os.path.join(b_live, "f.bin"))
        self.assertEqual((st_after.st_mtime_ns, st_after.st_size),
                         sig_before)
        b_side = os.path.join(baseB, "real", "staging", aid + ".json")
        with open(b_side, "rb") as fh:
            b_side_bytes = fh.read()
        b_side_st = os.stat(b_side)
        b_side_sig = (b_side_st.st_mtime_ns, b_side_st.st_size)
        self.assertEqual(b_side_bytes, b'{"evil": true}')
        # Independent B holder operates on B alone (different physical).
        second = ArtifactStore(alias_path, now=lambda: self.clock[0])
        self.addCleanup(second.close)
        self.assertEqual(second.data_dir, os.path.join(baseB, "real"))
        # Same physical root via two paths still contends.
        with self.assertRaises(StorageError) as ctx:
            ArtifactStore(os.path.join(baseA, "real"),
                          now=lambda: self.clock[0])
        self.assertEqual(ctx.exception.code, "unavailable")
        # Through close: shutting down the A holder touches neither B
        # payload/sidecar bytes/mtime nor B SQLite sidecars.
        b_db = os.path.join(baseB, "real", "manure.db")
        def _sig_or_missing(path):
            try:
                st = os.stat(path)
            except FileNotFoundError:
                return None
            with open(path, "rb") as fh:
                return (fh.read(), (st.st_mtime_ns, st.st_size))
        b_db_sig = _sig_or_missing(b_db)
        b_wal_sig = _sig_or_missing(b_db + "-wal")
        b_shm_sig = _sig_or_missing(b_db + "-shm")
        store.close()
        with open(os.path.join(b_live, "f.bin"), "rb") as fh:
            self.assertEqual(fh.read(), outside)
        st_after_close = os.stat(os.path.join(b_live, "f.bin"))
        self.assertEqual((st_after_close.st_mtime_ns,
                          st_after_close.st_size), sig_before)
        with open(b_side, "rb") as fh:
            self.assertEqual(fh.read(), b_side_bytes)
        st_side_close = os.stat(b_side)
        self.assertEqual((st_side_close.st_mtime_ns,
                          st_side_close.st_size), b_side_sig)
        self.assertEqual(_sig_or_missing(b_db), b_db_sig)
        self.assertEqual(_sig_or_missing(b_db + "-wal"), b_wal_sig)
        self.assertEqual(_sig_or_missing(b_db + "-shm"), b_shm_sig)
        # B holder still fully functional after A shutdown.
        data2 = b"r9-b-independent"
        aid2 = second.init_artifact(
            "u", "t", "nb", "file", "internal",
            _manifest(size=len(data2),
                      sha=hashlib.sha256(data2).hexdigest()), None)["id"]
        second.put_chunk("u", aid2, "f.bin", 0, data2,
                         hashlib.sha256(data2).hexdigest())
        second.publish("u", aid2)
        self.assertEqual(second.get_artifact(aid2)["state"], "ready")

    def test_r9_root_replacement_fails_closed_before_touching(self):
        # Same path string, new directory (new inode) with matching outside
        # payload + sidecar: the holder fails closed, touching nothing.
        import shutil as _shutil
        from manure.storage import StorageError
        root = os.path.join(self.tmp.name, "r9repl")
        os.makedirs(root)
        store = ArtifactStore(root, now=lambda: self.clock[0])
        self.addCleanup(store.close)
        data = b"r9-replace-me"
        aid = store.init_artifact(
            "u", "t", "n", "file", "internal",
            _manifest(size=len(data),
                      sha=hashlib.sha256(data).hexdigest()), None)["id"]
        store.put_chunk("u", aid, "f.bin", 0, data,
                        hashlib.sha256(data).hexdigest())
        store.publish("u", aid)
        old = root + ".old"
        os.rename(root, old)
        self.addCleanup(lambda: _shutil.rmtree(old, ignore_errors=True))
        os.makedirs(root)
        os.makedirs(os.path.join(root, "staging"), exist_ok=True)
        os.makedirs(os.path.join(root, "live", aid), exist_ok=True)
        outside = b"REPLACEMENT-OUTSIDE"
        with open(os.path.join(root, "live", aid, "f.bin"),
                  "wb") as fh:
            fh.write(outside)
        with open(os.path.join(root, "staging", aid + ".json"),
                  "w") as fh:
            fh.write("{}")
        st_before = os.stat(os.path.join(root, "live", aid, "f.bin"))
        sig_before = (st_before.st_mtime_ns, st_before.st_size)
        for op in (lambda: store.get_artifact(aid),
                   lambda: store.delete_artifact(aid),
                   lambda: store.list_artifacts(10, "", True, None, None)):
            with self.assertRaises(StorageError) as ctx:
                op()
            self.assertEqual(ctx.exception.code, "unavailable")
        with open(os.path.join(root, "live", aid, "f.bin"),
                  "rb") as fh:
            self.assertEqual(fh.read(), outside)
        st_after = os.stat(os.path.join(root, "live", aid, "f.bin"))
        self.assertEqual((st_after.st_mtime_ns, st_after.st_size),
                         sig_before)
        # Sidecar bytes/mtime also preserved pre-close.
        r_side = os.path.join(root, "staging", aid + ".json")
        with open(r_side, "rb") as fh:
            r_side_bytes = fh.read()
        r_side_st = os.stat(r_side)
        r_side_sig = (r_side_st.st_mtime_ns, r_side_st.st_size)
        # Renamed-root competitor (same physical as the old holder) is
        # denied while ownership lives and leaves no startup effects.
        before_live = sorted(os.listdir(os.path.join(old, "live")))
        before_staging = sorted(os.listdir(os.path.join(old, "staging")))
        old_db = os.path.join(old, "manure.db")
        old_db_mtime = os.stat(old_db).st_mtime_ns
        with self.assertRaises(StorageError) as ctx2:
            ArtifactStore(old, now=lambda: self.clock[0])
        self.assertEqual(ctx2.exception.code, "unavailable")
        self.assertEqual(sorted(os.listdir(os.path.join(old, "live"))),
                         before_live)
        self.assertEqual(sorted(os.listdir(os.path.join(old, "staging"))),
                         before_staging)
        self.assertEqual(os.stat(old_db).st_mtime_ns, old_db_mtime)
        # Through close with an INDEPENDENTLY ACTIVE replacement DB:
        # keep s_new open with populated WAL/SHM (open txn) during old
        # shutdown; old close must touch no replacement payload, sidecar,
        # database or sidecar bytes/mtime.
        def _sig_or_missing(path):
            try:
                st = os.stat(path)
            except FileNotFoundError:
                return None
            with open(path, "rb") as fh:
                return (fh.read(), (st.st_mtime_ns, st.st_size))
        new_db = os.path.join(root, "manure.db")
        s_new = ArtifactStore(root, now=lambda: self.clock[0])
        self.addCleanup(s_new.close)
        # Populate replacement WAL/SHM with an open write txn (active).
        s_new._db.execute("BEGIN IMMEDIATE")
        s_new._db.execute(
            "CREATE TABLE IF NOT EXISTS _r9_probe(x TEXT)")
        s_new._db.execute("INSERT INTO _r9_probe(x) VALUES('active-wal')")
        # Re-record replacement guards now that an active DB exists
        # (payload/sidecar may have been left intact by s_new startup).
        with open(os.path.join(root, "live", aid, "f.bin"),
                  "rb") as fh:
            self.assertEqual(fh.read(), outside)
        st_before = os.stat(os.path.join(root, "live", aid, "f.bin"))
        sig_before = (st_before.st_mtime_ns, st_before.st_size)
        with open(r_side, "rb") as fh:
            r_side_bytes = fh.read()
        r_side_st = os.stat(r_side)
        r_side_sig = (r_side_st.st_mtime_ns, r_side_st.st_size)
        new_db_sig = _sig_or_missing(new_db)
        new_wal_sig = _sig_or_missing(new_db + "-wal")
        new_shm_sig = _sig_or_missing(new_db + "-shm")
        new_journal_sig = _sig_or_missing(new_db + "-journal")
        self.assertIsNotNone(new_db_sig)
        self.assertIsNotNone(new_wal_sig,
                             "replacement WAL must be populated (active)")
        self.assertIsNotNone(new_shm_sig,
                             "replacement SHM must be populated (active)")
        store.close()
        with open(os.path.join(root, "live", aid, "f.bin"),
                  "rb") as fh:
            self.assertEqual(fh.read(), outside)
        st_closed = os.stat(os.path.join(root, "live", aid, "f.bin"))
        self.assertEqual((st_closed.st_mtime_ns, st_closed.st_size),
                         sig_before)
        with open(r_side, "rb") as fh:
            self.assertEqual(fh.read(), r_side_bytes)
        st_side_closed = os.stat(r_side)
        self.assertEqual((st_side_closed.st_mtime_ns,
                          st_side_closed.st_size), r_side_sig)
        self.assertEqual(_sig_or_missing(new_db), new_db_sig)
        self.assertEqual(_sig_or_missing(new_db + "-wal"), new_wal_sig)
        self.assertEqual(_sig_or_missing(new_db + "-shm"), new_shm_sig)
        self.assertEqual(_sig_or_missing(new_db + "-journal"),
                         new_journal_sig)
        # Active replacement still fully functional after old shutdown.
        cur = s_new._db.execute("SELECT x FROM _r9_probe")
        self.assertEqual(cur.fetchone()[0], "active-wal")
        s_new._db.execute("ROLLBACK")
        # After ownership ends, the renamed root opens cleanly.
        reopened = ArtifactStore(old, now=lambda: self.clock[0])
        self.addCleanup(reopened.close)
        self.assertIsNotNone(reopened.get_artifact(aid))

    def test_r9_startup_replacement_with_active_db_fails_closed(self):
        # Deterministic replacement AFTER pin+claim but BEFORE child
        # effects. Startup must bind to the pinned fd (old) and never
        # create staging/live/db in replacement B under the original claim;
        # shutdown then leaves an independently ACTIVE B (WAL/SHM) intact.
        import shutil as _shutil
        from manure.storage import StorageError
        root = os.path.join(self.tmp.name, "r9startup")
        os.makedirs(root)
        orig_mkdir = os.mkdir
        state = {"injected": False}

        def patched_mkdir(path, mode=0o777, *, dir_fd=None):
            is_staging = (isinstance(path, str) and path == "staging"
                          and dir_fd is not None)
            if not state["injected"] and is_staging:
                state["injected"] = True
                old = root + ".old"
                os.rename(root, old)
                os.makedirs(root)
                with open(os.path.join(root, "REPLACEMENT-MARKER"),
                          "w") as fh:
                    fh.write("replacement")
            return orig_mkdir(path, mode, dir_fd=dir_fd) \
                if dir_fd is not None else orig_mkdir(path, mode)
        os.mkdir = patched_mkdir
        try:
            starting = ArtifactStore(root, now=lambda: self.clock[0])
        finally:
            os.mkdir = orig_mkdir
        self.assertTrue(state["injected"],
                        "replacement must hit the startup boundary")
        self.addCleanup(lambda: _shutil.rmtree(root + ".old",
                                               ignore_errors=True))
        # Startup bound to pinned old root: no staging/live/db in B.
        self.assertTrue(os.path.exists(
            os.path.join(root, "REPLACEMENT-MARKER")))
        self.assertFalse(os.path.exists(os.path.join(root, "staging")))
        self.assertFalse(os.path.exists(os.path.join(root, "live")))
        self.assertFalse(os.path.exists(os.path.join(root, "manure.db")))
        # Old claim held (renamed root contends), B independently openable.
        old = root + ".old"
        with self.assertRaises(StorageError) as ctx:
            ArtifactStore(old, now=lambda: self.clock[0])
        self.assertEqual(ctx.exception.code, "unavailable")
        self.addCleanup(starting.close)
        # Independently ACTIVE replacement B with populated WAL/SHM.
        active = ArtifactStore(root, now=lambda: self.clock[0])
        self.addCleanup(active.close)
        active._db.execute("BEGIN IMMEDIATE")
        active._db.execute(
            "CREATE TABLE IF NOT EXISTS _startup_probe(x TEXT)")
        active._db.execute(
            "INSERT INTO _startup_probe(x) VALUES('live-wal')")
        def _sig_or_missing(path):
            try:
                st = os.stat(path)
            except FileNotFoundError:
                return None
            with open(path, "rb") as fh:
                return (fh.read(), (st.st_mtime_ns, st.st_size))
        new_db = os.path.join(root, "manure.db")
        marker_sig = _sig_or_missing(
            os.path.join(root, "REPLACEMENT-MARKER"))
        db_sig = _sig_or_missing(new_db)
        wal_sig = _sig_or_missing(new_db + "-wal")
        shm_sig = _sig_or_missing(new_db + "-shm")
        self.assertIsNotNone(db_sig)
        self.assertIsNotNone(wal_sig, "active WAL must be populated")
        self.assertIsNotNone(shm_sig, "active SHM must be populated")
        # Shutdown of the pinned-old holder leaves active B intact.
        starting.close()
        self.assertEqual(_sig_or_missing(
            os.path.join(root, "REPLACEMENT-MARKER")), marker_sig)
        self.assertEqual(_sig_or_missing(new_db), db_sig)
        self.assertEqual(_sig_or_missing(new_db + "-wal"), wal_sig)
        self.assertEqual(_sig_or_missing(new_db + "-shm"), shm_sig)
        cur = active._db.execute("SELECT x FROM _startup_probe")
        self.assertEqual(cur.fetchone()[0], "live-wal")
        active._db.execute("ROLLBACK")

    def test_r9_failed_startup_closes_before_releasing(self):
        # Post-connect init failure with a gated DB close: a same-root
        # successor stays excluded while the failed handle is alive/closing
        # (close-before-release), then acquires cleanly after safe close.
        import threading
        from manure.storage import ArtifactStore as _AS
        from manure.storage import StorageError
        root = os.path.join(self.tmp.name, "r9initorder")
        os.makedirs(root)
        orig_open = _AS._open_database
        orig_migrate = _AS._migrate_grant_columns
        fail_once = {"n": 1}
        entered = threading.Event()
        go = threading.Event()

        def failing_migrate(self):
            if fail_once["n"] > 0:
                fail_once["n"] -= 1
                raise RuntimeError("injected post-connect")
            return orig_migrate(self)

        class _GatedDB:
            def __init__(self, real):
                self._real = real

            def close(self):
                entered.set()
                go.wait(timeout=15)
                return self._real.close()

            def __getattr__(self, name):
                return getattr(self._real, name)

        def patched_open(self, db_path=None):
            try:
                return orig_open(self, db_path)
            except Exception:
                if self._db is not None and \
                        not isinstance(self._db, _GatedDB):
                    self._db = _GatedDB(self._db)
                raise
        _AS._migrate_grant_columns = failing_migrate
        _AS._open_database = patched_open
        outcome: dict = {}

        def failing_init():
            try:
                _AS(root, now=lambda: self.clock[0])
                outcome["init"] = "unexpected-success"
            except Exception as exc:
                outcome["init"] = type(exc).__name__
        worker = threading.Thread(target=failing_init)
        try:
            worker.start()
            self.assertTrue(entered.wait(timeout=15),
                            "gated close never entered")
            with self.assertRaises(StorageError) as ctx:
                _AS(root, now=lambda: self.clock[0])
            self.assertEqual(ctx.exception.code, "unavailable")
            outcome["during"] = "excluded"
            go.set()
            worker.join(timeout=15)
            self.assertEqual(outcome.get("init"), "RuntimeError")
            successor = _AS(root, now=lambda: self.clock[0])
            self.addCleanup(successor.close)
            outcome["after"] = "acquired"
        finally:
            go.set()
            worker.join(timeout=15)
            _AS._migrate_grant_columns = orig_migrate
            _AS._open_database = orig_open
        self.assertEqual(outcome.get("during"), "excluded")
        self.assertEqual(outcome.get("after"), "acquired")

    def test_r9_post_close_admission_no_touch(self):
        # Thread proven (by barrier, not sleep) past the outer open check
        # resumes after close + successor acquisition: the inner atomic
        # recheck must return unavailable before any staging/row effects.
        import threading
        from manure.storage import ArtifactStore as _AS
        root = os.path.join(self.tmp.name, "r9admit")
        os.makedirs(root)
        old = _AS(root, now=lambda: self.clock[0])
        data = b"postclose-real"
        files = [{"path": "f.bin", "kind": "file", "size": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}] 
        passed_outer = threading.Event()
        release_to_lock = threading.Event()
        calls = {"n": 0}
        orig_ensure = _AS._ensure_open

        def gated_ensure(target):
            # Gate only the worker's first (outer, pre-lock) check on old:
            # reaching it proves pre-close admission. After the barrier,
            # return WITHOUT another open check so the worker resumes into
            # lifecycle exclusion, where the production inner recheck must
            # reject it; the inner recheck and other instances pass free.
            if target is old and calls["n"] == 0:
                calls["n"] += 1
                orig_ensure(target)  # must pass: store still open
                passed_outer.set()  # PROOF of pre-close admission
                release_to_lock.wait(timeout=15)
                return None
            return orig_ensure(target)
        _AS._ensure_open = gated_ensure
        old._lock.acquire()
        outcome: dict = {}

        def paused_init():
            try:
                old.init_artifact("u", "t", "n", "file", "internal",
                                  files, None)
                outcome["t1"] = "unexpected-success"
            except ValueError as exc:
                outcome["t1"] = getattr(exc, "code", "no-code")
        worker = threading.Thread(target=paused_init)
        try:
            worker.start()
            # Deterministic: proceed only with proof the worker passed the
            # outer check while open (not merely that time elapsed).
            self.assertTrue(passed_outer.wait(timeout=15),
                            "worker never passed outer open check")
            old.close()
            new = _AS(root, now=lambda: self.clock[0])
            self.addCleanup(new.close)
            old._lock.release()
            release_to_lock.set()
            worker.join(timeout=15)
            self.assertEqual(outcome.get("t1"), "unavailable")
            self.assertEqual(os.listdir(os.path.join(root, "staging")),
                             [])
            cur = new._db.execute("SELECT COUNT(*) FROM artifacts")
            self.assertEqual(cur.fetchone()[0], 0)
        finally:
            _AS._ensure_open = orig_ensure
            release_to_lock.set()
            try:
                old._lock.release()
            except RuntimeError:
                pass
            worker.join(timeout=15)

    def test_r9_reconcile_cleanup_holds_ownership(self):
        # Orphan-live scan stays within lifecycle exclusion: a close during
        # the scan retains ownership (unavailable), a same-root successor is
        # denied, and after completion the successor publishes intact bytes.
        import threading
        from manure.storage import ArtifactStore as _AS
        from manure.storage import StorageError
        from manure import storage as _S
        root = os.path.join(self.tmp.name, "r9rechold")
        os.makedirs(root)
        old = _AS(root, now=lambda: self.clock[0])
        data0 = b"seed"
        m0 = [{"path": "f.bin", "kind": "file", "size": len(data0),
               "sha256": hashlib.sha256(data0).hexdigest()}] 
        a0 = old.init_artifact("u", "t", "s", "file", "internal",
                               m0, None)["id"]
        old.put_chunk("u", a0, "f.bin", 0, data0,
                      hashlib.sha256(data0).hexdigest())
        old.publish("u", a0)
        entered = threading.Event()
        go = threading.Event()
        orig_scan = _S._scan_root

        def gated_scan(data_dir, name, expected=None):
            if name == "live":
                entered.set()
                self.assertTrue(go.wait(timeout=20))
            return orig_scan(data_dir, name, expected=expected)
        _S._scan_root = gated_scan
        outcome: dict = {}

        def do_reconcile():
            try:
                old.reconcile()
                outcome["rec"] = "done"
            except ValueError as exc:
                outcome["rec"] = getattr(exc, "code", "no-code")
        worker = threading.Thread(target=do_reconcile)
        try:
            worker.start()
            self.assertTrue(entered.wait(timeout=20),
                            "orphan scan never entered")
            with self.assertRaises(StorageError) as ctx:
                old.close(_timeout=2)
            self.assertEqual(ctx.exception.code, "unavailable")
            outcome["close"] = "retained"
            with self.assertRaises(StorageError) as ctx2:
                _AS(root, now=lambda: self.clock[0])
            self.assertEqual(ctx2.exception.code, "unavailable")
            outcome["successor"] = "denied"
            go.set()
            worker.join(timeout=20)
            self.assertEqual(outcome.get("rec"), "done")
            old.close()
            new = _AS(root, now=lambda: self.clock[0])
            self.addCleanup(new.close)
            data = b"successor-real-bytes"
            m = [{"path": "g.bin", "kind": "file", "size": len(data),
                  "sha256": hashlib.sha256(data).hexdigest()}] 
            aid = new.init_artifact("u", "t", "n", "file", "internal",
                                    m, None)["id"]
            new.put_chunk("u", aid, "g.bin", 0, data,
                          hashlib.sha256(data).hexdigest())
            new.publish("u", aid)
            with open(os.path.join(new.data_dir, "live", aid,
                                   "g.bin"), "rb") as fh:
                got = fh.read()
            self.assertEqual(got, data)
            self.assertEqual(hashlib.sha256(got).hexdigest(),
                             hashlib.sha256(data).hexdigest())
            outcome["bytes"] = "intact"
        finally:
            go.set()
            _S._scan_root = orig_scan
            worker.join(timeout=20)
        self.assertEqual(outcome.get("close"), "retained")
        self.assertEqual(outcome.get("successor"), "denied")
        self.assertEqual(outcome.get("bytes"), "intact")

    def test_r9_close_failure_retains_handle_and_claim(self):
        # Injected SQLite close failure: close reports unavailable, keeps
        # the handle and claim (successor excluded); a retry finishes
        # cleanup and admits a successor. Admission never reopens.
        import sqlite3 as _sqlite
        from manure.storage import ArtifactStore as _AS
        from manure.storage import StorageError
        root = os.path.join(self.tmp.name, "r9closefail")
        os.makedirs(root)
        store = _AS(root, now=lambda: self.clock[0])
        real = store._db

        class _FailOnceDB:
            def __init__(self, wrapped):
                self._wrapped = wrapped
                self.calls = 0

            def close(self):
                self.calls += 1
                if self.calls == 1:
                    raise _sqlite.OperationalError("injected")
                return self._wrapped.close()

            def __getattr__(self, name):
                return getattr(self._wrapped, name)
        store._db = _FailOnceDB(real)
        with self.assertRaises(StorageError) as ctx:
            store.close()
        self.assertEqual(ctx.exception.code, "unavailable")
        self.assertIsNotNone(store._db)  # handle preserved
        with self.assertRaises(StorageError) as ctx2:
            _AS(root, now=lambda: self.clock[0])
        self.assertEqual(ctx2.exception.code, "unavailable")
        with self.assertRaises(StorageError):
            store.init_artifact("u", "t", "n", "file", "internal",
                                _manifest(), None)
        store.close()  # retry finishes cleanup
        self.assertIsNone(store._db)
        successor = _AS(root, now=lambda: self.clock[0])
        self.addCleanup(successor.close)
        self.assertIsNotNone(successor.get_artifact)  # open and usable

    def test_topology_validation_matrix(self):
        store = self._store()
        with self.assertRaises(ValueError):
            store.init_artifact("u", "t", "n", "dir", "internal",
                                [{"path": "a", "kind": "file", "size": 1,
                                  "sha256": GOOD},
                                 {"path": "a/b", "kind": "file", "size": 1,
                                  "sha256": GOOD}], None)
        with self.assertRaises(ValueError):
            store.init_artifact("u", "t", "n", "dir", "internal",
                                [{"path": "__manure/x", "kind": "dir"}],
                                None)

    def test_a1_pagination_sql_bounded_limit_plus_one(self):
        # A1: cursor/expiry/visibility/state filter in SQL; only limit+1
        # rows load (ordering + next_cursor preserved).
        store = self._store()
        ids = []
        for i in range(5):
            aid = store.init_artifact(
                "u", "t", "a%d" % i, "file", "internal",
                _manifest(), None)["id"]
            ids.append(aid)
            self.clock[0] += 1.05  # distinct created_at seconds
        # Capture the SQL: must filter/paginate in the database, not in
        # Python, and fetch at most limit+1 rows.
        seen_sql: list[str] = []
        seen_params: list[tuple] = []
        real_db = store._db
        assert real_db is not None

        class _Spy:
            def execute(self, query, params=()):
                if isinstance(query, str) and "FROM artifacts" in query:
                    seen_sql.append(query)
                    seen_params.append(tuple(params) if params else ())
                return real_db.execute(query, params)

            def __getattr__(self, name):
                return getattr(real_db, name)

        store._db = _Spy()  # type: ignore[assignment]
        try:
            page, nxt = store.list_artifacts(2, "", False, None, None)
        finally:
            store._db = real_db
        self.assertEqual([r["id"] for r in page], ids[:2])
        self.assertIsNotNone(nxt)
        self.assertTrue(seen_sql)
        last_q = seen_sql[-1]
        self.assertIn("ORDER BY created_at_s ASC, id ASC", last_q)
        self.assertIn("LIMIT ?", last_q)
        # limit=2 fetches at most 3 rows.
        self.assertEqual(seen_params[-1][-1], 3)
        # Full cursor traversal stays stable and gap-free.
        got = [r["id"] for r in page]
        cursor = nxt
        assert cursor is not None
        page2, nxt2 = store.list_artifacts(2, cursor, False, None, None)
        got.extend(r["id"] for r in page2)
        assert nxt2 is not None
        page3, nxt3 = store.list_artifacts(2, nxt2, False, None, None)
        got.extend(r["id"] for r in page3)
        self.assertEqual(got, ids)
        self.assertIsNone(nxt3)
        # Visibility/state/expiry filters also apply in SQL.
        store.patch_artifact("u", ids[0], visibility="public")
        pub, _ = store.list_artifacts(10, "", False, "public", None)
        self.assertEqual([r["id"] for r in pub], [ids[0]])
        ready, _ = store.list_artifacts(10, "", False, None, "uploading")
        self.assertEqual(len(ready), 5)


if __name__ == "__main__":
    unittest.main()
