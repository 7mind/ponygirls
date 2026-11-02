#!/usr/bin/env python3
"""BA specified: nonempty, exact-inventory foundation evidence fails closed."""
import importlib.util
import json
import shutil
import subprocess
from pathlib import Path
import sys
import tempfile
import unittest

report_path = Path(sys.argv.pop(1)).resolve()
spec = importlib.util.spec_from_file_location("foundation_report", report_path)
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class FoundationReportTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.base = Path(self.directory.name)
        self.reports = self.base / "target/test-reports"
        self.reports.mkdir(parents=True)
        self.inventory = self.base / "target/validation-inventory.txt"
        self.inventory.write_text("example.ContractTest\n")
        self.xml = self.reports / "TEST-example.ContractTest.xml"
        self.xml.write_text('<testsuite name="example.ContractTest" tests="1"><testcase name="contract"/></testsuite>')

    def test_complete_inventory_has_exact_counts(self):
        counts = report.module_counts(self.base)
        self.assertEqual(counts["tests"], 1)
        self.assertEqual(counts["suites"], 1)
        self.assertEqual(counts["skipped"], 0)

    def test_empty_duplicate_or_missing_inventory_rejected(self):
        for value in ["", "\n", "example.ContractTest\nexample.ContractTest\n"]:
            with self.subTest(value=value):
                self.inventory.write_text(value)
                with self.assertRaises(ValueError):
                    report.module_counts(self.base)
        self.inventory.unlink()
        with self.assertRaises(FileNotFoundError):
            report.module_counts(self.base)

    def test_missing_or_extra_suite_rejected(self):
        for value in ["example.MissingTest\n", "example.ContractTest\nexample.MissingTest\n"]:
            with self.subTest(value=value):
                self.inventory.write_text(value)
                with self.assertRaises(ValueError):
                    report.module_counts(self.base)

    def test_empty_miscount_duplicate_failed_errored_skipped_xml_rejected(self):
        for body in [
            '<testsuite name="example.ContractTest" tests="0"/>',
            '<testsuite name="example.ContractTest" tests="2"><testcase/></testsuite>',
            *[f'<testsuite name="example.ContractTest" tests="1" {tag}="1"><testcase/></testsuite>'
              for tag in ["failures", "errors", "skipped"]],
            *[f'<testsuite name="example.ContractTest" tests="1"><testcase><{tag}/></testcase></testsuite>'
              for tag in ["failure", "error", "skipped"]],
        ]:
            with self.subTest(body=body):
                self.xml.write_text(body)
                with self.assertRaises(ValueError):
                    report.module_counts(self.base)
        self.xml.write_text('<testsuite name="example.ContractTest" tests="1"><testcase/></testsuite>')
        (self.reports / "duplicate.xml").write_text(self.xml.read_text())
        with self.assertRaises(ValueError):
            report.module_counts(self.base)

    def test_stale_extra_report_rejected(self):
        (self.reports / "stale.xml").write_text('<testsuite name="example.StaleTest" tests="1"><testcase/></testsuite>')
        with self.assertRaises(ValueError):
            report.module_counts(self.base)

    def test_receipt_binds_source_and_only_jvm_foundation_scope(self):
        for base in report.MODULES.values():
            shutil.copytree(self.base / "target", self.base / base / "target")
        output = self.base / "foundation.json"
        subprocess.run([sys.executable, str(report_path), "--source", "/nix/store/synthetic-foundation-source",
                        "--output", str(output)], cwd=self.base, check=True, capture_output=True)
        value = json.loads(output.read_text())
        self.assertEqual(value["scope"], "complete-jvm-foundation-modules")
        self.assertEqual(value["foundationSource"], "/nix/store/synthetic-foundation-source")
        self.assertEqual(set(value["modules"]), {"losslessJson", "manureStorage"})
        self.assertTrue(all(counts["tests"] == 1 for counts in value["modules"].values()))
        self.assertIs(value["claimsChronicleValidation"], False)
        self.assertIs(value["claimsNativeAcceptance"], False)

    def test_no_reports_rejected(self):
        self.xml.unlink()
        with self.assertRaises(ValueError):
            report.module_counts(self.base)


if __name__ == "__main__":
    unittest.main()
