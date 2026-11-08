"""BA checks for native evidence accounting and secret-safe report output."""
from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent))

from native_acceptance import Reporter


class ReportingTests(unittest.TestCase):
    def test_failures_errors_and_native_state_are_reported_exactly(self) -> None:
        with tempfile.TemporaryDirectory(prefix="rites-report-selftest-") as temporary:
            root = Path(temporary)
            launcher = root / "launcher"
            worker = root / "worker"
            elf = root / "elf"
            for artifact in (launcher, worker, elf):
                artifact.write_bytes(b"fixture-artifact-identity")
            reporter = Reporter(root / "report", launcher, worker, elf, Path(__file__).resolve().parents[3])
            reporter.case("passing-case", lambda: None)

            def fail() -> None:
                raise AssertionError("intentional recorder check")

            def error() -> None:
                raise RuntimeError("intentional recorder check")

            reporter.case("failing-case", fail)
            reporter.case("error-case", error)
            reporter.log("sanitized.log", "synthetic-model-key owner-password Bearer synthetic-oauth-access-1\n")
            with contextlib.redirect_stdout(io.StringIO()):
                reporter.finish()
            document = json.loads((reporter.root / "report.json").read_text())
            self.assertEqual({"tests": 3, "failures": 1, "errors": 1, "skipped": 0, "passed": 1}, document["counts"])
            self.assertIsInstance(document["source"]["ownedPathsDirtyAtStart"], bool)
            self.assertEqual("not-executed", document["nativeExecution"])
            suite = ET.parse(reporter.root / "junit.xml").getroot()
            self.assertEqual("3", suite.attrib["tests"])
            self.assertEqual(1, len(suite.findall("testcase/failure")))
            self.assertEqual(1, len(suite.findall("testcase/error")))
            sanitized = (reporter.root / "sanitized.log").read_text()
            for plaintext in ("synthetic-model-key", "owner-password", "synthetic-oauth-access-1"):
                self.assertNotIn(plaintext, sanitized)


if __name__ == "__main__":
    unittest.main()
