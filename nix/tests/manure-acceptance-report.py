#!/usr/bin/env python3
"""Behavioral-Active / Blackbox-Atomic; regression: summary-only empty inventory passed grep gate."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

report_path, fixtures = map(lambda value: Path(value).resolve(), sys.argv[1:3])
del sys.argv[1:3]
spec = importlib.util.spec_from_file_location('manure_report', report_path)
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


def log(*names, count=None):
    return '\n'.join([*(f'PASS: {name}' for name in names),
                      f'PASS: {len(names) if count is None else count} filesystem contracts; no publish/recovery claim'])


class AcceptanceReportTest(unittest.TestCase):
    def test_real_valid_26_contract_logs(self):
        # Exact logs from original successful Nix artifact j79vs3sk..., not invented case labels.
        cases = report.matching_inventory((fixtures / 'jvm.log').read_text(), (fixtures / 'native.log').read_text())
        self.assertEqual(len(cases), 26)
        self.assertEqual(len(set(cases)), 26)

    def test_empty_registry_summary_cannot_count_as_case(self):
        for value in ['', log(), 'PASS: 0 filesystem contracts; no publish/recovery claim\n']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                report.matching_inventory(value, value)

    def test_duplicate_case_rejected_even_with_matching_count(self):
        with self.assertRaises(ValueError):
            report.inventory(log('one', 'one'))

    def test_summary_count_mismatch_rejected(self):
        for count in [0, 1, 3]:
            with self.subTest(count=count), self.assertRaises(ValueError):
                report.inventory(log('one', 'two', count=count))

    def test_different_inventories_rejected(self):
        with self.assertRaises(ValueError):
            report.matching_inventory(log('one', 'two'), log('one', 'other'))

    def test_inventory_is_order_independent(self):
        self.assertEqual(report.matching_inventory(log('one', 'two'), log('two', 'one')), ['one', 'two'])

    def test_malformed_missing_or_multiple_summaries_rejected(self):
        for text in ['PASS: one', log('one').replace('1 filesystem', '-1 filesystem'),
                     log('one').replace('1 filesystem', '01 filesystem'),
                     log('one').replace('1 filesystem', 'many filesystem'),
                     log('one').replace('no publish/recovery claim', 'all tests passed'),
                     log('one') + '\n' + log('two'), log('one') + '\nRUNTIME: late',
                     log('one').replace('PASS: one', 'PASS:'),
                     log('one').replace('PASS: one', 'PASS:   '),
                     log('one', '2 FILESYSTEM  contracts; no publish/recovery claim')]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                report.inventory(text)

    def test_failures_and_skips_rejected_anywhere(self):
        for marker in ['FAIL: bad', 'FAILED case', 'ERROR: bad', 'SKIP optional', '[SKIPPED] case',
                       'ignored case', 'Exception in thread main', 'Traceback (most recent call last):',
                       'WARNING in native method: JNI misuse']:
            for text in [marker + '\n' + log('one'), log('one') + '\n' + marker]:
                with self.subTest(marker=marker, text=text), self.assertRaises(ValueError):
                    report.inventory(text)

    def test_cli_receipt_binds_scope_sources_cases_artifacts_and_logs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            jvm, native, artifact, output = [root / name for name in ['jvm', 'native', 'elf', 'receipt.json']]
            jvm.write_text(log('one', 'two'))
            native.write_text(log('two', 'one'))
            artifact.write_bytes(b'synthetic-artifact-not-a-runtime-test')
            subprocess.run([sys.executable, str(report_path), '--jvm', str(jvm), '--native', str(native),
                            '--source', '/source', '--toolchain', '/graal', '--artifact', str(artifact),
                            '--output', str(output)], check=True)
            receipt = json.loads(output.read_text())
            self.assertEqual(receipt['caseCountPerRuntime'], 2)
            self.assertEqual(receipt['acceptanceSource'], '/source')
            self.assertEqual(receipt['artifacts'], [report.digest(artifact)])
            self.assertEqual(receipt['runtimeLogs']['native'], report.digest(native))
            self.assertEqual(receipt['skipped'], 0)
            self.assertFalse(receipt['claimsCompleteServer'])
            self.assertFalse(receipt['claimsPublishRecovery'])


if __name__ == '__main__':
    unittest.main()
