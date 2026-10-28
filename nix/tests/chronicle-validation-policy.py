#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('report_policy', sys.argv.pop(1))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class FullReportPolicyTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.inventory = self.root/'inventory'
        self.inventory.write_text('chronicle.ExampleTest\n')
        self.reports = self.root/'reports'
        self.reports.mkdir()
        self.suite = self.reports/'TEST-example.xml'
        self.suite.write_text('<testsuite name="chronicle.ExampleTest" tests="2" failures="0" errors="0" skipped="0"><testcase name="a"/><testcase name="b"/></testsuite>')

    def run_report(self):
        return policy.report(self.inventory, self.reports, 'runtime-source', 'test-source')

    def test_complete_reports_derive_actual_counts(self):
        value = self.run_report()
        self.assertEqual(value['tests'], 2)
        self.assertEqual(value['suites'], 1)
        self.assertEqual(value['suiteCounts'], {'chronicle.ExampleTest': 2})

    def test_empty_inventory_rejected(self):
        self.inventory.write_text('')
        with self.assertRaises(ValueError): self.run_report()

    def test_duplicate_inventory_rejected(self):
        self.inventory.write_text('chronicle.ExampleTest\nchronicle.ExampleTest\n')
        with self.assertRaises(ValueError): self.run_report()

    def test_missing_report_rejected(self):
        self.suite.unlink()
        with self.assertRaises(ValueError): self.run_report()

    def test_unreported_discovered_suite_rejected(self):
        self.inventory.write_text('chronicle.ExampleTest\nchronicle.MissingTest\n')
        with self.assertRaises(ValueError): self.run_report()

    def test_unexpected_or_stale_report_rejected(self):
        self.suite.write_text(self.suite.read_text().replace('chronicle.ExampleTest', 'chronicle.OtherTest'))
        with self.assertRaises(ValueError): self.run_report()

    def test_failures_errors_and_skips_rejected(self):
        original = self.suite.read_text()
        for field in ['failures', 'errors', 'skipped']:
            with self.subTest(field=field):
                self.suite.write_text(original.replace(field+'="0"', field+'="1"'))
                with self.assertRaises(ValueError): self.run_report()

    def test_failure_nodes_rejected_even_when_counters_claim_zero(self):
        original = self.suite.read_text()
        for tag in ['failure', 'error', 'skipped']:
            with self.subTest(tag=tag):
                self.suite.write_text(original.replace('<testcase name="a"/>', '<testcase name="a"><'+tag+'/></testcase>'))
                with self.assertRaises(ValueError): self.run_report()

    def test_zero_case_suite_rejected(self):
        self.suite.write_text('<testsuite name="chronicle.ExampleTest" tests="0"/>')
        with self.assertRaises(ValueError): self.run_report()

    def test_count_mismatch_rejected(self):
        self.suite.write_text(self.suite.read_text().replace('tests="2"', 'tests="3"'))
        with self.assertRaises(ValueError): self.run_report()

    def test_duplicate_report_rejected(self):
        (self.reports/'duplicate.xml').write_text(self.suite.read_text())
        with self.assertRaises(ValueError): self.run_report()


unittest.main()
