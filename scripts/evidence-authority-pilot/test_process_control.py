"""Owned real-process contracts; harmless engineering children, no provider/data."""
from pathlib import Path
import signal
import sys
import time
import unittest
import uuid

from process_control import ProcessError, ProcessRequest, ProcessRunner


class ProcessControls(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[2] / '.local/evidence-process-controls' / uuid.uuid4().hex
        self.root.mkdir(parents=True, exist_ok=False)
        self.runner = ProcessRunner()

    def request(self, code, *, timeout=3.0, limit=4194304, input_bytes=None):
        helper = self.root / ('helper-' + uuid.uuid4().hex + '.py')
        helper.write_text(code)
        return ProcessRequest((sys.executable, '-B', '-I', '-S', str(helper)),
                              str(self.root), (), input_bytes, timeout, limit)

    def test_complete_channels_and_process_lifecycle_are_both_observed(self):
        req = self.request('import os\nos.write(1,b"out")\nos.write(2,b"err")\n')
        result = self.runner.run(req)
        self.assertEqual(result.status, 'completed'); self.assertEqual(result.exit_code, 0)
        self.assertEqual((result.stdout, result.stderr), (b'out', b'err'))
        self.assertTrue(result.stdout_eof and result.stderr_eof)
        self.assertGreaterEqual(result.ended_monotonic_ns, result.started_monotonic_ns)
        self.assertTrue(result.started_utc and result.ended_utc)
        self.assertEqual(result.argv, req.argv)

    def test_deadline_applies_after_both_output_FDs_close(self):
        # Regression origin: exact g5 fragment failed under the retained1s probe.
        # This is a finite harmless test config; production tool deadline stays120s.
        req = self.request('import os,time\nos.close(1)\nos.close(2)\ntime.sleep(2.0)\n', timeout=1.0)
        started = time.monotonic(); result = self.runner.run(req); elapsed = time.monotonic()-started
        self.assertEqual(result.status, 'timeout')
        self.assertEqual(result.exit_code, -signal.SIGKILL)
        self.assertLess(elapsed, 1.8)
        self.assertTrue(result.stdout_eof and result.stderr_eof)

    def test_deadline_also_applies_while_channels_are_open(self):
        req = self.request('import time\ntime.sleep(2.0)\n', timeout=1.0)
        result = self.runner.run(req)
        self.assertEqual(result.status, 'timeout')
        self.assertFalse(result.stdout_eof and result.stderr_eof)

    def test_streaming_output_guard_preserves_bounded_prefix_not_success(self):
        req = self.request('import os,time\nos.write(1,b"x"*10000)\ntime.sleep(2)\n', limit=128)
        result = self.runner.run(req)
        self.assertEqual(result.status, 'output-limit')
        self.assertEqual(result.stdout, b'x'*128)
        self.assertFalse(result.stdout_eof)

    def test_stderr_guard_is_separate_from_stdout(self):
        req = self.request('import os\nos.write(1,b"ok")\nos.write(2,b"z"*10000)\n', limit=128)
        result = self.runner.run(req)
        self.assertEqual(result.status, 'output-limit')
        self.assertEqual(result.stderr, b'z'*128)
        self.assertLessEqual(len(result.stdout), 128)

    def test_unicode_is_captured_as_exact_bytes_no_replacement(self):
        result = self.runner.run(self.request('import os\nos.write(1,"é🐎".encode())\n'))
        self.assertEqual(result.stdout, 'é🐎'.encode())
        self.assertEqual(result.status, 'completed')

    def test_nonblocking_input_handles_more_than_pipe_capacity(self):
        raw = b'abcd'*262144
        result = self.runner.run(self.request('import os\nwhile True:\n b=os.read(0,65536)\n if not b:break\n os.write(1,b)\n', input_bytes=raw))
        self.assertEqual(result.status, 'completed')
        self.assertEqual(result.stdout, raw)
        self.assertEqual(result.input_bytes_sent, len(raw))

    def test_environment_is_explicit_not_ambient_home_or_pythonpath(self):
        result = self.runner.run(self.request('import os,json\nprint(json.dumps([os.getenv("HOME"),os.getenv("PYTHONPATH"),os.getcwd()]))\n'))
        import json
        self.assertEqual(json.loads(result.stdout), [None, None, str(self.root)])

    def test_start_failure_is_not_empty_completed_output(self):
        req = ProcessRequest(('/fictional/nonexistent/executable',), str(self.root), (), None, 3.0, 128)
        result = self.runner.run(req)
        self.assertEqual(result.status, 'start-failed')
        self.assertIsNone(result.process_id); self.assertIsNone(result.exit_code)
        self.assertFalse(result.stdout_eof or result.stderr_eof)

    def test_zero_boolean_or_nonfinite_limits_reject_before_spawn(self):
        for timeout in (False, True, 0, -1, float('inf')):
            with self.subTest(timeout=timeout), self.assertRaises(ProcessError):
                self.request('raise AssertionError("not started")', timeout=timeout)
        for limit in (False, True, 0, -1, 1.0):
            with self.subTest(limit=limit), self.assertRaises(ProcessError):
                self.request('raise AssertionError("not started")', limit=limit)


if __name__ == '__main__':
    unittest.main()
