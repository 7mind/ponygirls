"""Specified inventory/gate contracts; no target/PG/browser provisioning.

Behavioral-Active, Blackbox/Effectual Group. Synthetic skipped/failed inner cases
are checked as gate failures; none is omitted from the outer release inventory.
"""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
SPEC=importlib.util.spec_from_file_location('manure_current_test_gate',ROOT/'manure/scripts/target-suite.py')
GATE=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)


def synthetic_registry(root):
    directory=root/'manure/tests';directory.mkdir(parents=True)
    (directory/'test_registered.py').write_text('')
    return {'schemaVersion':1,'contract':'manure.api/1.0.0','pythonModules':[
        {'module':'test_registered','path':'manure/tests/test_registered.py','classification':'current','tests':['test_registered.Case.test_case']}],
        'diagnosticCoreModules':['test_registered']}


class CurrentTestInventoryTests(unittest.TestCase):
    def test_every_current_module_and_exact_declared_case_is_registered(self):
        registry=GATE.read_registry(ROOT)
        discovered=GATE.discover_current(ROOT,registry)
        GATE.validate_mappings(ROOT,registry,discovered)
        registered={entry['module'] for entry in registry['pythonModules']}
        self.assertEqual(registered,set(GATE.python_modules(ROOT)))
        self.assertIn('test_offline_conversion',discovered)
        self.assertIn('test_target_migration',discovered)
        self.assertIn('test_credential_preflight',discovered)
        self.assertIn('test_mcp_environment',discovered)

    def test_new_unregistered_test_module_fails_before_import(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);registry=synthetic_registry(root)
            (root/'manure/tests/test_new.py').write_text('raise AssertionError("must not import an unregistered module")')
            with self.assertRaisesRegex(GATE.InventoryError,'unregistered test modules'):
                GATE.validate_registration(root,registry)

    def test_new_nested_unregistered_test_module_also_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);registry=synthetic_registry(root)
            directory=root/'manure/tests/nested';directory.mkdir()
            (directory/'test_new.py').write_text('')
            with self.assertRaisesRegex(GATE.InventoryError,'nested.test_new'):
                GATE.validate_registration(root,registry)

    def test_new_unregistered_node_suite_fails_without_executing_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);registry=synthetic_registry(root)
            (root/'manure/tests/new.test.mjs').write_text('throw new Error("must not execute")')
            with self.assertRaisesRegex(GATE.InventoryError,'unregistered Node suites'):
                GATE.validate_registration(root,registry)

    def test_missing_registered_module_and_duplicate_registration_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);registry=synthetic_registry(root)
            registry['pythonModules'].append(dict(registry['pythonModules'][0]))
            with self.assertRaisesRegex(GATE.InventoryError,'duplicate'):
                GATE.validate_registration(root,registry)
            registry['pythonModules'].pop();(root/'manure/tests/test_registered.py').unlink()
            with self.assertRaisesRegex(GATE.InventoryError,'missing registered modules'):
                GATE.validate_registration(root,registry)

    def test_new_or_missing_case_and_duplicate_case_are_not_hidden(self):
        expected=['test_registered.Case.test_case']
        for actual in [[],expected+['test_registered.Case.test_new'],expected+expected]:
            with self.subTest(actual=actual),self.assertRaises(GATE.InventoryError):
                GATE.validate_declared_ids('test_registered',expected,actual)

    def test_retired_implementation_needs_explicit_retained_invariant_mapping(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);registry=synthetic_registry(root)
            registry['pythonModules'][0]['classification']='architecture-retired'
            with self.assertRaisesRegex(GATE.InventoryError,'retain mapped requirements'):
                GATE.validate_registration(root,registry)

    def test_full_selection_is_all_current_cli_client_mcp_browser_and_migration(self):
        registry=GATE.read_registry(ROOT);discovered=GATE.discover_current(ROOT,registry)
        modules,ids=GATE.select_tests(registry,discovered,'full')
        self.assertEqual(set(modules),set(discovered))
        self.assertEqual(sorted(ids),sorted(case for values in discovered.values() for case in values))
        for path in (ROOT/'manure/tests').glob('test_*.py'):
            if path.stem.startswith(('test_client_','test_cli_','test_mcp_','test_browser_')):
                self.assertIn(path.stem,modules)

    def test_focused_selection_refuses_retired_unknown_and_duplicate_cases(self):
        registry=GATE.read_registry(ROOT);discovered=GATE.discover_current(ROOT,registry)
        for selected in [['test_server_security'],['test_not_registered'],['test_current_client','test_current_client']]:
            with self.subTest(selected=selected),self.assertRaises(GATE.InventoryError):
                GATE.select_tests(registry,discovered,'focused',selected)

    def test_skipped_expected_failed_and_missing_cases_cannot_pass(self):
        class Skipped(unittest.TestCase):
            @unittest.skip('synthetic required prerequisite absent')
            def test_case(self):pass
        class ExpectedFailure(unittest.TestCase):
            @unittest.expectedFailure
            def test_case(self):self.fail('synthetic unresolved defect')
        for case in [Skipped('test_case'),ExpectedFailure('test_case')]:
            with self.subTest(case=type(case).__name__),tempfile.TemporaryDirectory() as tmp:
                result=GATE.run_python(unittest.TestSuite([case]),[case.id()],Path(tmp),io.StringIO())
                self.assertFalse(result['success'])
                self.assertTrue(result['inventoryMatches'])
        with tempfile.TemporaryDirectory() as tmp:
            result=GATE.run_python(unittest.TestSuite(),['not-executed'],Path(tmp),io.StringIO())
            self.assertFalse(result['success']);self.assertFalse(result['inventoryMatches'])

    def test_subtest_failure_trace_is_durable_before_final_summary(self):
        class FailedSubtest(unittest.TestCase):
            def test_case(self):
                with self.subTest(window='synthetic-window'):
                    self.fail('synthetic exact failure cause')
        case=FailedSubtest('test_case')
        with tempfile.TemporaryDirectory() as tmp:
            report=Path(tmp)
            result=GATE.run_python(unittest.TestSuite([case]),[case.id()],report,io.StringIO())
            outcomes=[json.loads(line) for line in (report/'outcomes.jsonl').read_text().splitlines()]
            self.assertFalse(result['success']);self.assertEqual(result['failures'],1)
            self.assertEqual(outcomes[0]['parent'],case.id())
            self.assertIn('synthetic exact failure cause',outcomes[0]['detail'])

    def test_existing_evidence_is_never_overwritten_or_filtered(self):
        with tempfile.TemporaryDirectory() as tmp:
            report=Path(tmp);old=b'{"immutable_previous_receipt":true}\n'
            (report/'summary.json').write_bytes(old)
            env={'PATH':os.defpath,'PYTHONPATH':str(ROOT/'manure')+os.pathsep+str(ROOT/'manure/tests')}
            result=subprocess.run([sys.executable,str(ROOT/'manure/scripts/target-suite.py'),'--scope','full','--report',str(report)],
                env=env,capture_output=True,timeout=10)
            self.assertNotEqual(result.returncode,0)
            self.assertEqual((report/'summary.json').read_bytes(),old)

    def test_full_release_gap_and_missing_helper_cannot_use_admin_fallback(self):
        self.assertFalse(GATE.release_acceptance('full',True,[{'group':'synthetic-gap'}]))
        self.assertEqual(GATE.gate_exit_status('full',True,[{'group':'synthetic-gap'}]),1)
        self.assertEqual(GATE.gate_exit_status('core',True,[{'group':'synthetic-gap'}]),0)
        self.assertFalse(GATE.release_acceptance('focused',True,[]))
        registry={'pythonModules':[{'module':'test_target','requires':['target']} ]}
        with patch.dict(os.environ,{'MANURE_TEST_JDBC_URL':'jdbc:postgresql://127.0.0.1/owned',
                'MANURE_TEST_JDBC_USER':'postgres','MANURE_TEST_JDBC_PASSWORD_FILE':'/synthetic',
                'MANURE_TEST_ALLOW_CREATEDB':'1','PATH':os.defpath},clear=True):
            _,errors=GATE.prerequisites(ROOT,registry,['test_target.Case.test_case'],'full')
            self.assertTrue(any('MANURE_TEST_PROVISION_COMMAND' in error for error in errors))
            self.assertTrue(any('provider.json' in error for error in errors))

    def test_hermetic_process_keeps_only_explicit_provider_tools_not_ambient_secrets(self):
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{
            'PATH':os.defpath,'MANURE_TOKEN':'SYNTHETIC','OPENAI_API_KEY':'SYNTHETIC',
            'PGHOST':'never-connect.invalid','PGPASSFILE':'/must-not-read',
            'MANURE_TEST_PROVISION_COMMAND':'synthetic-helper','PG_PROVIDER':'/trusted/provider.py',
            'MANURE_TEST_VIEWER_DIR':'/explicit/viewer','MANURE_VIEWER_ARTIFACTS':'/explicit/screenshots',
            'PONYGIRLS_OWNED_FIXTURE_ROOT':'/owned/root','PONYGIRLS_TEST_PROVISION_SERVICE':'manure',
            'MANURE_TEST_JDBC_URL':'jdbc:postgresql://127.0.0.1:1/owned'},clear=True):
            discarded=GATE.hermetic_environment(ROOT,Path(tmp))
            for name in ('MANURE_TOKEN','OPENAI_API_KEY','PGHOST','PGPASSFILE'):
                self.assertNotIn(name,os.environ);self.assertIn(name,discarded)
            for name in ('MANURE_TEST_PROVISION_COMMAND','PG_PROVIDER','PONYGIRLS_OWNED_FIXTURE_ROOT','PONYGIRLS_TEST_PROVISION_SERVICE','MANURE_TEST_JDBC_URL','MANURE_TEST_VIEWER_DIR','MANURE_VIEWER_ARTIFACTS'):
                self.assertIn(name,os.environ)
            self.assertEqual(Path(os.environ['HOME']),Path(tmp)/'runtime-home')


if __name__=='__main__':unittest.main()
