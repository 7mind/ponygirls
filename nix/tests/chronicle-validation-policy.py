#!/usr/bin/env python3
import copy
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('report_policy', sys.argv.pop(1))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
evidence_spec = importlib.util.spec_from_file_location('evidence_policy', sys.argv.pop(1))
evidence_policy = importlib.util.module_from_spec(evidence_spec)
evidence_spec.loader.exec_module(evidence_policy)


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


class FastReportPolicyTest(unittest.TestCase):
    def setUp(self):
        FullReportPolicyTest.setUp(self)
        self.inventory.write_text('chronicle.ExampleTest\nchronicle.ManualPostgresTest\n')
        self.selected = self.root/'selected'
        self.selected.write_text('chronicle.ExampleTest\n')

    def run_report(self):
        return policy.fast_report(self.inventory, self.reports, 'runtime-source', 'test-source', self.selected)

    def test_complete_selection_is_explicitly_not_full_validation(self):
        value = self.run_report()
        self.assertEqual(value['schemaVersion'], 2)
        self.assertEqual(value['scope'], 'fast-explicit-suite-subset')
        self.assertEqual(value['selectedSuites'], ['chronicle.ExampleTest'])
        self.assertEqual(value['discoveredSuites'], 2)
        self.assertEqual(value['tests'], 2)
        self.assertEqual(value['suites'], 1)
        self.assertEqual(value['suiteCounts'], {'chronicle.ExampleTest': 2})
        with self.assertRaises(ValueError):
            policy.report(self.inventory, self.reports, 'runtime-source', 'test-source')

    def test_empty_duplicate_unknown_and_unreported_selections_rejected(self):
        for names in ['', '\n', 'chronicle.ExampleTest\nchronicle.ExampleTest\n',
                      'chronicle.UnknownTest\n', 'chronicle.ExampleTest\nchronicle.ManualPostgresTest\n']:
            with self.subTest(selection=names):
                self.selected.write_text(names)
                with self.assertRaises(ValueError): self.run_report()

    def test_missing_selection_or_inventory_rejected(self):
        self.selected.unlink()
        with self.assertRaises(FileNotFoundError): self.run_report()
        self.selected.write_text('chronicle.ExampleTest\n')
        self.inventory.unlink()
        with self.assertRaises(FileNotFoundError): self.run_report()

    def test_unselected_stale_suite_rejected_even_if_discovered(self):
        (self.reports/'manual.xml').write_text(self.suite.read_text().replace('chronicle.ExampleTest', 'chronicle.ManualPostgresTest'))
        with self.assertRaises(ValueError): self.run_report()

    def test_negative_counters_cannot_cancel_a_failure(self):
        self.suite.write_text(self.suite.read_text().replace('failures="0" errors="0"', 'failures="1" errors="-1"'))
        with self.assertRaises(ValueError): self.run_report()

    # Retain the original full-run failure assertions and exercise them against the explicit subset too.
    test_empty_inventory_rejected = FullReportPolicyTest.test_empty_inventory_rejected
    test_duplicate_inventory_rejected = FullReportPolicyTest.test_duplicate_inventory_rejected
    test_missing_report_rejected = FullReportPolicyTest.test_missing_report_rejected
    test_unexpected_or_stale_report_rejected = FullReportPolicyTest.test_unexpected_or_stale_report_rejected
    test_failures_errors_and_skips_rejected = FullReportPolicyTest.test_failures_errors_and_skips_rejected
    test_failure_nodes_rejected_even_when_counters_claim_zero = FullReportPolicyTest.test_failure_nodes_rejected_even_when_counters_claim_zero
    test_zero_case_suite_rejected = FullReportPolicyTest.test_zero_case_suite_rejected
    test_count_mismatch_rejected = FullReportPolicyTest.test_count_mismatch_rejected
    test_duplicate_report_rejected = FullReportPolicyTest.test_duplicate_report_rejected


class FastEvidencePolicyTest(unittest.TestCase):
    def setUp(self):
        FastReportPolicyTest.setUp(self)
        self.inputs = {'runtimeSource': 'runtime-source', 'testSource': 'test-source'}
        self.backend = policy.fast_report(self.inventory, self.reports, 'runtime-source', 'test-source', self.selected)

    def check(self, backend):
        evidence_policy.check_backend(self.inputs, backend, self.selected.read_text().splitlines(), self.inventory.read_text().splitlines())

    def test_exact_source_and_selection_binding_accepted(self):
        self.assertIsNone(self.check(self.backend))

    def test_full_claim_bad_counts_and_mismatched_sources_rejected(self):
        mutations = [
            ('schemaVersion', 1), ('scope', 'full-unfiltered-postgres-protocol-concurrency'), ('status', 'failed'),
            ('runtimeSource', 'other-runtime'), ('testSource', 'other-tests'),
            ('tests', 0), ('tests', -1), ('tests', True), ('tests', 3),
            ('suites', 0), ('suites', True), ('suites', 2),
            ('failed', 1), ('errors', 1), ('skipped', 1), ('skipped', False),
            ('selectedSuites', []), ('selectedSuites', ['chronicle.OtherTest']),
            ('discoveredSuites', 1), ('discoveredSuites', True),
            ('suiteCounts', {}), ('suiteCounts', {'chronicle.ExampleTest': 0}),
            ('suiteCounts', {'chronicle.ExampleTest': -1}), ('suiteCounts', {'chronicle.ExampleTest': True}),
            ('suiteCounts', {'chronicle.ExampleTest': 3}), ('suiteCounts', {'chronicle.OtherTest': 2}),
        ]
        for key, value in mutations:
            with self.subTest(key=key, value=value):
                backend = copy.deepcopy(self.backend)
                backend[key] = value
                with self.assertRaises(ValueError): self.check(backend)

    def test_changed_or_duplicate_allowlist_cannot_reuse_a_report(self):
        for names in ['chronicle.OtherTest\n', 'chronicle.ExampleTest\nchronicle.ExampleTest\n']:
            with self.subTest(selection=names):
                self.selected.write_text(names)
                with self.assertRaises(ValueError): self.check(self.backend)

    def test_changed_or_duplicate_inventory_cannot_reuse_a_report(self):
        for names in ['chronicle.OtherTest\n', 'chronicle.ExampleTest\nchronicle.ExampleTest\n']:
            with self.subTest(inventory=names):
                self.inventory.write_text(names)
                with self.assertRaises(ValueError): self.check(self.backend)

    def test_non_store_or_incomplete_input_identities_rejected_before_io(self):
        valid = {key: '/nix/store/synthetic-'+key for key in [
            'nativeArtifact', 'nativeDerivation', 'runtimeSource', 'testSource', 'backendValidation',
            'backendDerivation', 'protocolValidation', 'protocolDerivation', 'protocolSource']}
        for bad in [{}, valid | {'runtimeSource': '/tmp/mutable'}, valid | {'extra': '/nix/store/extra'},
                    valid | {'nativeArtifact': 1}]:
            with self.subTest(inputs=bad):
                with self.assertRaises(ValueError): evidence_policy.evidence(bad)


unittest.main()
