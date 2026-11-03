#!/usr/bin/env python3
"""Behavioral-Active/Blackbox-Atomic manual-chain contract + typed API guards.
These controlled driver tests do not claim actual user-manager/PG acceptance.
"""
import ast
import importlib.machinery
import importlib.util
import inspect
import json
import os
import pathlib
import sys
import tempfile
import textwrap
import unittest

ROOT = pathlib.Path(os.environ['HM_GRAPH_TEST_SOURCE_DIR'])
spec = importlib.util.spec_from_file_location('hm_fixture', ROOT / 'hm-service-unit-graph-vm.py')
fixture = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = fixture
spec.loader.exec_module(fixture)

class ManualGuest:
    """Small stateful manual-stop/start adapter; rejects unsupported commands.

    Not a systemd emulator or a substitute for the seven-cell real VM matrix.
    """
    def __init__(self, leaked_unit):
        self.leaked_unit = leaked_unit
        self.state = {u: {'ActiveState': 'active', 'InvocationID': 'owned-' + u,
                         'adapterStartedInvocations': ['owned-' + u],
                         'probeSuccessByInvocation': {'owned-' + u: 0}}
                      for u in fixture.HmLifecycle.UNITS}

    def succeed(self, command):
        prefix = fixture.HmLifecycle.PREFIX
        if not command.startswith(prefix):
            raise AssertionError('unexpected non-user command')
        command = command[len(prefix):]
        if command.startswith('/etc/unit-graph-user/snapshot '):
            return json.dumps(self.state)
        if command == 'systemctl --user stop ponygirls-postgres.service':
            for value in self.state.values():
                value['ActiveState'] = 'inactive'
        elif command == 'systemctl --user start ponygirls-postgres.service':
            self.state[fixture.HmLifecycle.PROVIDER]['ActiveState'] = 'active'
        elif command == 'systemctl --user start chronicle.service ivm-haystack.service':
            for unit in fixture.HmLifecycle.APPS[:2] + fixture.HmLifecycle.MIGRATIONS[:2] + fixture.HmLifecycle.DATABASES[:2]:
                self.state[unit]['ActiveState'] = 'active'
            if self.leaked_unit is not None:
                self.state[self.leaked_unit]['ActiveState'] = 'active'
        elif command == 'systemctl --user kill --kill-whom=main --signal=USR1 chronicle.service ivm-haystack.service':
            for unit in fixture.HmLifecycle.APPS[:2]:
                value = self.state[unit]
                value['probeSuccessByInvocation'][value['InvocationID']] += 1
        else:
            raise AssertionError('unexpected controlled user command')
        return ''

    def wait_for_unit(self, unit, *, timeout):
        raise AssertionError('manual contract must not launch/activate a VM')

class UnusedController:
    def run_case(self, *args, **kwargs):
        raise AssertionError('not used by manual contract')
    def run_matrix(self, *args, **kwargs):
        raise AssertionError('not used by manual contract')

class HmFixtureContract(unittest.TestCase):
    def make(self, root, leaked_unit):
        manifest = root / 'manifest'
        manifest.write_text('controlled source identity\n')
        out = root / 'out'
        return fixture.HmLifecycle(ManualGuest(leaked_unit), UnusedController(),
                                   fixture.Source('controlled-revision', manifest), out,
                                   lambda: self.fail('controlled contract cannot launch a VM'))

    def test_constructor_dependencies_and_selection_have_no_defaults(self):
        for fn in (fixture.HmLifecycle.__init__, fixture.HmLifecycle.ready_chains,
                   fixture.HmLifecycle.probes, fixture.HmLifecycle.wait, fixture.run_hm_graph):
            for name, parameter in inspect.signature(fn).parameters.items():
                if name != 'self':
                    self.assertIs(parameter.default, inspect.Parameter.empty)
        for name in ('home', 'controller', 'source', 'out', 'start_all'):
            self.assertIn(name, fixture.HmLifecycle.__init__.__annotations__)

    def test_instances_keep_independent_receipt_and_baseline_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / 'a').mkdir(); (root / 'b').mkdir()
            a = self.make(root / 'a', None); b = self.make(root / 'b', None)
            a.results.append({'name': 'controlled', 'status': 'pass', 'faultEntered': True})
            a.save(); b.save()
            self.assertEqual(json.loads((b.out / 'lifecycle-receipt.json').read_text())['cases'], [])
            self.assertIsNone(a.base); self.assertIsNone(b.base)
            self.assertIsNot(a.results, b.results)

    def test_selected_two_chains_recover_and_unselected_whole_chain_stays_inactive(self):
        with tempfile.TemporaryDirectory() as directory:
            instance = self.make(pathlib.Path(directory), None)
            instance.manual({})
            self.assertTrue(all(instance.home.state[u]['ActiveState'] == 'inactive' for u in
                                (instance.APPS[2], instance.MIGRATIONS[2], instance.DATABASES[2])))

    def test_any_unselected_database_migration_or_app_activation_is_rejected(self):
        for unit in (fixture.HmLifecycle.APPS[2], fixture.HmLifecycle.MIGRATIONS[2], fixture.HmLifecycle.DATABASES[2]):
            with self.subTest(unit=unit), tempfile.TemporaryDirectory() as directory:
                instance = self.make(pathlib.Path(directory), unit)
                with self.assertRaises(AssertionError):
                    instance.manual({})

    def entry_loader(self):
        source = (ROOT / 'hm-service-unit-graph-vm.nix').read_text()
        chunk = '    def load_module' + source.split('    def load_module', 1)[1].split('    fixture=load_module', 1)[0]
        tree = ast.parse(textwrap.dedent(chunk))
        namespace = {'importlib': importlib, 'sys': sys}
        exec(compile(tree, 'actual-hm-nix-entry-loader', 'exec'), namespace)
        return tree.body[0], namespace['load_module']

    def test_actual_entry_loader_rejects_none_spec_without_fallback(self):
        _tree, load = self.entry_loader()
        with self.assertRaisesRegex(AssertionError, 'file-backed spec'):
            load('controlled_none_spec', '/not-a-module.unsupported_fixture_suffix')

    def test_actual_entry_none_loader_guard_precedes_module_creation(self):
        tree, _load = self.entry_loader()
        guard = next(node for node in tree.body if isinstance(node, ast.Assert)
                     and ast.unparse(node.test) == 'loader is not None')
        creation = next(node for node in tree.body if isinstance(node, ast.Assign)
                        and isinstance(node.value, ast.Call)
                        and ast.unparse(node.value.func) == 'importlib.util.module_from_spec')
        self.assertLess(tree.body.index(guard), tree.body.index(creation))
        namespace_spec = importlib.machinery.ModuleSpec('controlled_namespace', loader=None)
        # Execute the actual guard unchanged, with a genuine loader-less spec.
        # No module monkeypatch, alternate loader or typecheck suppression.
        with self.assertRaisesRegex(AssertionError, 'executable loader'):
            exec(compile(ast.Module(body=[guard], type_ignores=[]), 'actual-hm-none-loader-guard', 'exec'),
                 {'loader': namespace_spec.loader})

    def test_exact_seven_case_inventory_survives_refactor(self):
        with tempfile.TemporaryDirectory() as directory:
            instance = self.make(pathlib.Path(directory), None)
            self.assertEqual([name for name, _ in instance.plans()], [
                'HM-boot-three-consumers-one-user-provider',
                'HM-own-app-restart-isolates-provider-others',
                'HM-explicit-provider-restart-recovers-active-chain',
                'HM-provider-crash-autorestart-fresh-role-reconnect',
                'HM-stopped-consumer-stays-stopped',
                'HM-intentional-manual-stop-start-selected-recovery',
                'HM-actual-disabled-module-stays-disabled',
            ])

if __name__ == '__main__':
    unittest.main()
