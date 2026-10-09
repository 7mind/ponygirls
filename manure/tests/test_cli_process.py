"""Genuine subprocess kill/restart CLI resume + owned fetch resume (B8)."""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

# Reuse the stateful adapter + token from test_client_stateful (import, no copy).
from test_client_stateful import StatefulServer, VALID_TOKEN


def _env_for(srv: StatefulServer, td: str) -> dict:
    env = dict(os.environ)
    for k in list(env):
        if k.startswith("MANURE_"):
            del env[k]
    env.update({"MANURE_URL": srv.base, "MANURE_TOKEN": VALID_TOKEN,
                "MANURE_CACHE_DIR": os.path.join(td, "cache"),
                "PYTHONPATH": os.pathsep.join([
                    str(Path(__file__).resolve().parents[1]),
                    env.get("PYTHONPATH", "")]).rstrip(os.pathsep)})
    return env


def _wait_for_acks(srv: StatefulServer, n: int, timeout: float = 15.0) -> bool:
    """Wait for n chunk ACKs (receipt-mutated), not mere request arrivals."""
    from test_client_stateful import StatefulHandler
    end = time.time() + timeout
    while time.time() < end:
        acks = [e for e in StatefulHandler.log if e[0] == "ACK"]
        if len(acks) >= n:
            return True
        time.sleep(0.005)
    return False


def _wait_for_puts(srv: StatefulServer, n: int, timeout: float = 15.0) -> bool:
    return _wait_for_acks(srv, n, timeout)


class _DelayedPuts:
    """Widen the SIGKILL window: sleep briefly per chunk PUT (test-only)."""

    def __init__(self, delay: float = 0.05):
        self.delay = delay
        self._orig = None

    def __enter__(self):
        from test_client_stateful import StatefulHandler
        self._orig = StatefulHandler.do_PUT

        def delayed(this):
            import time as _t
            _t.sleep(self.delay)
            return self._orig(this)

        StatefulHandler.do_PUT = delayed
        return self

    def __exit__(self, *exc):
        from test_client_stateful import StatefulHandler
        StatefulHandler.do_PUT = self._orig
        return False


class TestSubprocessKillResume(unittest.TestCase):
    def test_kill_auto_resume(self):
        srv = StatefulServer()
        try:
            with tempfile.TemporaryDirectory() as td:
                src = os.path.join(td, "big.bin")
                payload = b"Q" * 2500000
                Path(src).write_bytes(payload)
                worktree = str(Path(__file__).resolve().parents[2])
                env = _env_for(srv, td)
                # Start upload in a real child process, kill after 1 chunk ack.
                from test_client_stateful import StatefulHandler
                StatefulHandler.log.clear()
                with _DelayedPuts():
                    proc = subprocess.Popen(
                        [sys.executable, "-m", "manure.cli", "upload", src,
                         "--access", "internal", "--json"],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                        cwd=worktree, env=env)
                    self.assertTrue(_wait_for_acks(srv, 1), msg="no chunk ack observed")
                    proc.kill()
                    try:
                        proc.communicate(timeout=10)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.communicate(timeout=10)
                self.assertNotEqual(proc.returncode, 0)
                # Interrupted cache: exactly one record, no secrets.
                recs = list(Path(td, "cache").rglob("*.json"))
                self.assertEqual(len(recs), 1)
                txt = recs[0].read_text()
                self.assertNotIn(VALID_TOKEN, txt)
                self.assertNotIn("external_password", txt.lower())
                aid = json.loads(txt)["artifact_id"]
                # Restart: plain upload auto-resumes the killed session.
                StatefulHandler.log.clear()
                proc2 = subprocess.run(
                    [sys.executable, "-m", "manure.cli", "upload", src,
                     "--access", "internal", "--json"],
                    capture_output=True, text=True, cwd=worktree, env=env, timeout=60)
                self.assertEqual(proc2.returncode, 0, msg=proc2.stderr)
                self.assertEqual(json.loads(proc2.stdout)["artifact_id"], aid)
                # Acked chunk(s) skipped: resume PUTs never include offset 0.
                puts = [e for e in StatefulHandler.log if e[0] == "PUT"]
                offs = sorted(int(e[1].split("offset=")[1]) for e in puts)
                self.assertNotIn(0, offs)
                self.assertLess(len(puts), 10)
                # Retired after success.
                self.assertFalse(recs[0].exists())
                # Bytes + hash verified via fetch.
                dest = os.path.join(td, "out")
                proc3 = subprocess.run(
                    [sys.executable, "-m", "manure.cli", "fetch", aid, dest],
                    capture_output=True, text=True, cwd=worktree, env=env, timeout=60)
                self.assertEqual(proc3.returncode, 0, msg=proc3.stderr)
                self.assertEqual(Path(dest, "big.bin").read_bytes(), payload)
        finally:
            srv.close()

    def test_kill_manual_resume(self):
        srv = StatefulServer()
        try:
            with tempfile.TemporaryDirectory() as td:
                src = os.path.join(td, "m.bin")
                payload = b"M" * 2500000
                Path(src).write_bytes(payload)
                worktree = str(Path(__file__).resolve().parents[2])
                env = _env_for(srv, td)
                from test_client_stateful import StatefulHandler
                StatefulHandler.log.clear()
                with _DelayedPuts():
                    proc = subprocess.Popen(
                        [sys.executable, "-m", "manure.cli", "upload", src,
                         "--access", "internal", "--json"],
                        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                        cwd=worktree, env=env)
                    self.assertTrue(_wait_for_acks(srv, 1), msg="no chunk ack observed")
                    proc.kill()
                    proc.communicate(timeout=10)
                recs = list(Path(td, "cache").rglob("*.json"))
                self.assertEqual(len(recs), 1)
                aid = json.loads(recs[0].read_text())["artifact_id"]
                StatefulHandler.log.clear()
                proc2 = subprocess.run(
                    [sys.executable, "-m", "manure.cli", "upload", src,
                     "--access", "internal", "--resume", aid, "--json"],
                    capture_output=True, text=True, cwd=worktree, env=env, timeout=60)
                self.assertEqual(proc2.returncode, 0, msg=proc2.stderr)
                self.assertEqual(json.loads(proc2.stdout)["artifact_id"], aid)
                # Acknowledged chunk(s) must have been skipped: no PUT at
                # offset 0, and fewer PUTs than a full 10-chunk upload.
                puts = [e for e in StatefulHandler.log if e[0] == "PUT"]
                offs = sorted(int(e[1].split("offset=")[1]) for e in puts)
                self.assertNotIn(0, offs)
                self.assertLess(len(puts), 10, msg=f"puts={puts}")
                self.assertEqual(offs[0], 262144)
        finally:
            srv.close()


class TestOwnedFetchResumeRange(unittest.TestCase):
    def test_interrupted_fetch_resumes_exact_range(self):
        from manure.client import ManureClient, StdlibTransport
        srv = StatefulServer()
        try:
            with tempfile.TemporaryDirectory() as td:
                src = os.path.join(td, "f.bin")
                payload = b"F" * 2500000
                Path(src).write_bytes(payload)
                c0 = ManureClient(srv.base, token=VALID_TOKEN, cache_dir=os.path.join(td, "c0"))
                aid = c0.upload_path(src, access="internal", fresh=True)["artifact_id"]
                from test_client_stateful import StatefulHandler
                StatefulHandler.log.clear()

                class FailOnce:
                    def __init__(self, inner):
                        self.inner = inner
                        self.gets = 0

                    def request(self, method, url, headers, body):
                        if method == "GET" and "/content" in url:
                            self.gets += 1
                            if self.gets > 1:
                                raise ConnectionError("interrupted fetch")
                        return self.inner.request(method, url, headers, body)

                dest = os.path.join(td, "out")
                c1 = ManureClient(srv.base, token=VALID_TOKEN,
                                  cache_dir=os.path.join(td, "c1"),
                                  transport=FailOnce(StdlibTransport()))
                with self.assertRaises(Exception):
                    c1.fetch_to_dest(aid, dest)
                # Owned partial staging must exist inside the protected namespace.
                stages = [q for q in Path(dest).rglob("*") if ".manure-stage-" in str(q)]
                self.assertTrue(stages, msg="no owned staging preserved")
                # Find partial bytes to compute expected resume offset.
                parts = [q for q in Path(dest).rglob("*.part")]
                self.assertTrue(parts)
                partial = max(p.stat().st_size for p in parts)
                self.assertGreater(partial, 0)
                StatefulHandler.log.clear()
                c2 = ManureClient(srv.base, token=VALID_TOKEN, cache_dir=os.path.join(td, "c2"))
                c2.fetch_to_dest(aid, dest)
                self.assertEqual(Path(dest, "f.bin").read_bytes(), payload)
                ranged = [e for e in StatefulHandler.log if e[0] == "GET" and e[2]]
                self.assertTrue(ranged, msg="no Range observed on resume")
                # Exact resumed Range: bounded end per FETCH_RANGE_BYTES/size.
                from manure.client import FETCH_RANGE_BYTES
                total = len(payload)
                want_end = min(partial + FETCH_RANGE_BYTES - 1, total - 1)
                self.assertIn(f"bytes={partial}-{want_end}", [e[2] for e in ranged],
                              msg=f"expected exact Range bytes={partial}-{want_end}, saw {[e[2] for e in ranged]}")
        finally:
            srv.close()


if __name__ == "__main__":
    unittest.main()
