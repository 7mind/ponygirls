"""Specified nine-field action integration; fictional, no provider/heldout input."""
from dataclasses import replace
import hashlib
import json
import unittest

from action_contract import (ActionBinding, ActionError, PublicActionContract,
                             action_status, render_request)
from evidence import Artifacts, HostEvidence, MemoryBytes, Scope


class ActionContractTests(unittest.TestCase):
    def setUp(self):
        self.argv = ('/nix/store/fictional-python/bin/python3.14', '-B', '-I', '-S', '/checks/check.py')
        self.checker = b'# fictional public checker\n'
        self.raw = {'identity': 'engineering:P01:action', 'revision': 1,
                    'tool': 'run_tests', 'arguments': {}, 'argv': list(self.argv),
                    'cwd': '/work', 'checker_sha256': hashlib.sha256(self.checker).hexdigest(),
                    'ordering': 'after_latest_write', 'artifact_paths': ['solution.py']}
        self.evidence = HostEvidence(Scope('engineering', 'main', 1))
        self.artifacts = Artifacts(MemoryBytes(), self.evidence, ('solution.py', 'optional.json'))
        self.artifacts.write('seed', 'solution.py', b'fictional\n')

    def parse(self, raw=None):
        return PublicActionContract.parse(self.raw if raw is None else raw,
                   self.checker, self.artifacts.allowed, self.argv)

    def proof(self, contract):
        fact = self.evidence.observe_execution('execute', contract.identity, contract.revision,
            'run_tests', self.argv, contract.checker_sha256,
            self.artifacts.versions_for(contract.artifact_paths), 'completed', 0, 'a' * 64)
        return ActionBinding.capture(fact, {}, '/work', self.argv,
            ('fictional-bwrap', '--clearenv', '--chdir', '/work', *self.argv), contract.sha256)

    def test_same_nine_field_object_renders_and_binds_external_hash(self):
        contract = self.parse()
        rendered = json.loads(render_request('Fictional request', contract))
        self.assertEqual(rendered['completion_contract'], self.raw)
        self.assertEqual(len(rendered['completion_contract']), 9)
        expected = hashlib.sha256(json.dumps(self.raw, sort_keys=True, ensure_ascii=False,
                                separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        self.assertEqual(rendered['completion_contract_sha256'], expected)
        self.assertNotIn('sha256', rendered['completion_contract'])

    def test_parsed_object_does_not_alias_callers_mutable_containers(self):
        contract = self.parse()
        self.raw['argv'].append('wrong'); self.raw['artifact_paths'].append('wrong')
        self.raw['arguments']['wrong'] = True
        self.assertEqual(contract.argv, self.argv)
        self.assertEqual(contract.artifact_paths, ('solution.py',))
        self.assertEqual(contract.wire()['arguments'], {})
        emitted = contract.wire(); emitted['arguments']['also_wrong'] = True
        self.assertEqual(contract.wire()['arguments'], {})

    def test_exact_keys_types_and_values(self):
        for key in self.raw:
            raw = dict(self.raw); del raw[key]
            with self.subTest(missing=key), self.assertRaises(ActionError): self.parse(raw)
        for value in (False, True, 1.0, 0, -1):
            with self.subTest(revision=value), self.assertRaises(ActionError):
                self.parse({**self.raw, 'revision': value})
        for change in ({'extra': None}, {'arguments': []}, {'arguments': {'extra': 1}},
                       {'cwd': '/'}, {'tool': 'other'}, {'ordering': 'exact_content'},
                       {'artifact_paths': []}, {'artifact_paths': ['solution.py', 'solution.py']},
                       {'artifact_paths': ['unowned']}, {'checker_sha256': '0' * 64}):
            with self.subTest(change=change), self.assertRaises(ActionError): self.parse({**self.raw, **change})

    def test_B_flag_and_literal_inner_argv_are_not_silently_waived(self):
        for argv in ([x for x in self.argv if x != '-B'], [*self.argv, 'extra'],
                     ['/different/python', *self.argv[1:]]):
            with self.subTest(argv=argv), self.assertRaises(ActionError): self.parse({**self.raw, 'argv': argv})

    def test_current_action_is_not_whole_scenario_acceptance(self):
        contract = self.parse(); proof = self.proof(contract)
        self.assertEqual(action_status(contract, proof, self.artifacts), 'action_performed_current')
        self.assertNotEqual(proof.launcher_argv, contract.argv)
        self.assertEqual(proof.inner_argv, contract.argv)
        self.assertFalse(proof.full_scenario_acceptance)
        self.assertEqual(proof.process_identity_scope, 'host launcher/declared inner argv and requested cwd; not independent in-process Python PID/cwd')

    def test_required_subset_does_not_read_absent_optional_authorization(self):
        contract = self.parse()
        self.assertIsNone(self.evidence.current('optional.json'))
        self.assertEqual(action_status(contract, self.proof(contract), self.artifacts), 'action_performed_current')

    def test_actual_arguments_cwd_hash_and_inner_argv_are_discriminating(self):
        contract = self.parse(); proof = self.proof(contract)
        variants = [replace(proof, arguments_utf8=b'{"extra":true}'),
                    replace(proof, requested_cwd='/other'),
                    replace(proof, contract_sha256='0' * 64),
                    replace(proof, inner_argv=('not-the-observed-checker',))]
        for changed in variants:
            with self.subTest(changed=changed):
                self.assertEqual(action_status(contract, changed, self.artifacts), 'wrong_action_contract')

    def test_same_byte_write_makes_action_historical_without_erasing_proof(self):
        contract = self.parse(); proof = self.proof(contract)
        self.artifacts.write('later-write', 'solution.py', b'fictional\n')
        self.assertEqual(action_status(contract, proof, self.artifacts), 'action_historical')
        self.assertEqual(self.evidence.resolve(proof.fact.reference), proof.fact)

    def test_missing_and_failed_action_remain_qualified(self):
        contract = self.parse()
        self.assertEqual(action_status(contract, None, self.artifacts), 'not_observed')
        proof = self.proof(contract)
        failed = replace(proof, fact=replace(proof.fact, status='interrupted', exit_code=None))
        self.assertEqual(action_status(contract, failed, self.artifacts), 'execution_not_successful')

    def test_capture_arguments_are_immutable_typed_data(self):
        contract = self.parse(); proof = self.proof(contract); args = {}
        bound = ActionBinding.capture(proof.fact, args, '/work', self.argv, proof.launcher_argv, contract.sha256)
        args['changed'] = 1
        self.assertEqual(bound.arguments_utf8, b'{}')
        with self.assertRaises(ActionError):
            ActionBinding.capture(proof.fact, [], '/work', self.argv, proof.launcher_argv, contract.sha256)


if __name__ == '__main__':
    unittest.main()
