"""Specified contract controls; shared memory/filesystem behavior, no model quality claim."""
from pathlib import Path
import tempfile
import unittest

from evidence import (Artifacts, CompletionContract, DigestAssertion, DiskBytes,
                      EvidenceError, HostEvidence, MemoryBytes, ModelAssertion,
                      Scope, completion_status, qualify)


class EvidenceContract:
    def setUp(self):
        self.scope = Scope('trial-fictional', 'main', 1)
        self.ledger = HostEvidence(self.scope)
        self.port = self.make_port()
        self.artifacts = Artifacts(self.port, self.ledger, ('solution.py', 'side.txt'))
        self.first = self.artifacts.write('e1', 'solution.py', b'first\n')
        self.side = self.artifacts.write('e2', 'side.txt', b'draft\n')

    def contract(self, ordering):
        return CompletionContract('phase-contract', 1, 'run_tests',
                                  ('python3', '-I', '-S', '/checks/check.py'),
                                  'a' * 64, ordering, ('solution.py', 'side.txt'))

    def execution(self, contract, versions, status, exit_code):
        return self.ledger.observe_execution('execution-1', contract.identity,
                   contract.revision, contract.tool, contract.argv,
                   contract.checker_sha256, versions, status, exit_code, 'b' * 64)

    def assertion(self, refs, predicates):
        return ModelAssertion('claim-1', 'Curator interpretation, not host truth', refs, predicates)

    def test_host_fact_is_immutable_and_scoped(self):
        self.assertEqual(self.first.version.generation, 1)
        self.assertEqual(self.first.version.byte_length, 6)
        self.assertEqual(self.ledger.resolve(self.first.reference), self.first)
        foreign = type(self.first.reference)(Scope('foreign', 'main', 1), self.first.reference.fact_id)
        with self.assertRaisesRegex(EvidenceError, 'fact-scope'):
            self.ledger.resolve(foreign)

    def test_unknown_fact_is_not_minted_from_reference(self):
        ref = type(self.first.reference)(self.scope, 'made-up')
        with self.assertRaisesRegex(EvidenceError, 'fact-missing'):
            qualify(self.assertion((ref,), ()), self.ledger, 'current')

    def test_read_same_version_records_another_observation(self):
        observed = self.artifacts.read('e3', 'solution.py')
        self.assertEqual(observed.version, self.first.version)
        self.assertNotEqual(observed.reference, self.first.reference)
        self.assertEqual(self.ledger.resolve(self.first.reference), self.first)

    def test_write_invalidates_current_applicability_not_old_fact(self):
        before = self.assertion((self.first.reference,), ())
        self.assertEqual(qualify(before, self.ledger, 'current').applicability, 'current_version')
        self.artifacts.write('e3', 'solution.py', b'changed\n')
        after = qualify(before, self.ledger, 'current')
        self.assertEqual(after.applicability, 'historical_version')
        self.assertEqual(after.coverage, 'current')
        self.assertEqual(self.ledger.resolve(self.first.reference), self.first)

    def test_same_bytes_still_advance_write_generation(self):
        new = self.artifacts.write('e3', 'solution.py', b'first\n')
        self.assertEqual(new.version.sha256, self.first.version.sha256)
        self.assertEqual(new.version.generation, 2)
        self.assertNotEqual(new.version, self.first.version)

    def test_digest_conflict_is_not_hidden_by_current_coverage(self):
        assertion = self.assertion((self.first.reference,), (DigestAssertion(self.first.reference, '0' * 64),))
        result = qualify(assertion, self.ledger, 'current')
        self.assertEqual(result.conflicts, ('digest-mismatch:claim-1',))
        self.assertEqual(result.evidence_origin, 'model_assertion')
        self.assertFalse(result.body_verified)

    def test_matching_typed_digest_does_not_verify_prose(self):
        predicate = DigestAssertion(self.first.reference, self.first.version.sha256)
        result = qualify(self.assertion((self.first.reference,), (predicate,)), self.ledger, 'current')
        self.assertEqual(result.conflicts, ())
        self.assertFalse(result.body_verified)

    def test_unbound_assertion_stays_unbound(self):
        result = qualify(self.assertion((), ()), self.ledger, 'lagging')
        self.assertEqual(result.applicability, 'unbound')
        self.assertEqual(result.coverage, 'lagging')
        self.assertFalse(result.body_verified)

    def test_predicate_cannot_hide_uncited_fact_dependency(self):
        claim = self.assertion((), (DigestAssertion(self.first.reference, '0' * 64),))
        with self.assertRaisesRegex(EvidenceError, 'predicate-not-cited'):
            qualify(claim, self.ledger, 'current')

    def test_mixed_applicability_is_explicit(self):
        current = self.artifacts.write('e3', 'solution.py', b'new\n')
        result = qualify(self.assertion((self.first.reference, current.reference), ()), self.ledger, 'current')
        self.assertEqual(result.applicability, 'mixed_versions')

    def test_duplicate_event_refuses_before_artifact_mutation(self):
        with self.assertRaisesRegex(EvidenceError, 'event-reused'):
            self.artifacts.write('e1', 'solution.py', b'changed')
        self.assertEqual(self.artifacts.read('e3', 'solution.py').version, self.first.version)

    def test_non_allowlisted_path_refuses(self):
        for path in ('../escape', '/absolute', 'missing.py', 'a/b'):
            with self.subTest(path=path), self.assertRaises(EvidenceError):
                self.artifacts.write('unspent', path, b'no')
        valid = self.artifacts.write('unspent', 'solution.py', b'allowed')
        self.assertEqual(valid.version.generation, 2)

    def test_missing_file_read_is_not_a_zero_length_fact(self):
        empty = Artifacts(self.make_port(), HostEvidence(self.scope), ('other.py',))
        with self.assertRaisesRegex(EvidenceError, 'artifact-missing'):
            empty.read('e1', 'other.py')

    def test_after_latest_write_execution_is_current(self):
        contract = self.contract('after_latest_write')
        proof = self.execution(contract, self.artifacts.versions(), 'completed', 0)
        self.assertEqual(completion_status(contract, proof, self.artifacts), 'action_performed_current')

    def test_latest_write_reopens_action_even_for_identical_bytes(self):
        contract = self.contract('after_latest_write')
        proof = self.execution(contract, self.artifacts.versions(), 'completed', 0)
        self.artifacts.write('e3', 'solution.py', b'first\n')
        self.assertEqual(completion_status(contract, proof, self.artifacts), 'action_historical')
        self.assertEqual(self.ledger.resolve(proof.reference), proof)

    def test_content_policy_can_reuse_identical_bytes_not_different_bytes(self):
        contract = self.contract('exact_content')
        proof = self.execution(contract, self.artifacts.versions(), 'completed', 0)
        self.artifacts.write('e3', 'solution.py', b'first\n')
        self.assertEqual(completion_status(contract, proof, self.artifacts), 'action_performed_current')
        self.artifacts.write('e4', 'solution.py', b'last\n')
        self.assertEqual(completion_status(contract, proof, self.artifacts), 'action_historical')

    def test_wrong_contract_revision_action_or_checker_is_not_completion(self):
        contract = self.contract('after_latest_write')
        from dataclasses import replace
        proof = self.execution(contract, self.artifacts.versions(), 'completed', 0)
        for field, value in (('contract_identity', 'foreign'), ('contract_revision', 2),
                             ('tool', 'other'), ('argv', ('wrong',)), ('checker_sha256', 'c' * 64)):
            with self.subTest(field=field):
                self.assertEqual(completion_status(contract, replace(proof, **{field: value}), self.artifacts), 'wrong_action_contract')

    def test_failed_interrupted_missing_execution_not_success(self):
        contract = self.contract('after_latest_write')
        self.assertEqual(completion_status(contract, None, self.artifacts), 'not_observed')
        for index, (status, code) in enumerate((('completed', 1), ('interrupted', None), ('unknown', None))):
            proof = self.ledger.observe_execution('failed-' + str(index), contract.identity, 1, contract.tool, contract.argv, contract.checker_sha256, self.artifacts.versions(), status, code, None)
            self.assertEqual(completion_status(contract, proof, self.artifacts), 'execution_not_successful')

    def test_omitted_or_extra_snapshot_file_is_not_complete_action(self):
        from dataclasses import replace
        contract = self.contract('after_latest_write')
        extra = replace(self.first.version, path='extra.py')
        for index, versions in enumerate(((self.first.version,), self.artifacts.versions() + (extra,))):
            proof = self.ledger.observe_execution('set-' + str(index), contract.identity, 1, contract.tool, contract.argv, contract.checker_sha256, versions, 'completed', 0, 'b' * 64)
            self.assertEqual(completion_status(contract, proof, self.artifacts), 'artifact_set_mismatch')

    def test_missing_output_capture_is_not_complete_evidence(self):
        contract = self.contract('after_latest_write')
        proof = self.ledger.observe_execution('partial', contract.identity, 1, contract.tool, contract.argv, contract.checker_sha256, self.artifacts.versions(), 'completed', 0, None)
        self.assertEqual(completion_status(contract, proof, self.artifacts), 'evidence_incomplete')

    def test_foreign_execution_scope_is_not_current(self):
        from dataclasses import replace
        contract = self.contract('after_latest_write')
        proof = self.execution(contract, self.artifacts.versions(), 'completed', 0)
        foreign = type(proof.reference)(Scope('foreign', 'main', 1), proof.reference.fact_id)
        self.assertEqual(completion_status(contract, replace(proof, reference=foreign), self.artifacts), 'wrong_scope')

    def test_boolean_lengths_and_contract_revisions_refuse(self):
        from dataclasses import replace
        for value in (False, True, 6.0, -1):
            with self.subTest(value=value), self.assertRaises(EvidenceError):
                replace(self.first.version, byte_length=value)
        for value in (False, True, 1.0, 0):
            with self.subTest(value=value), self.assertRaises(EvidenceError):
                replace(self.contract('after_latest_write'), revision=value)

    def test_boolean_generation_and_exit_code_are_not_integer_aliases(self):
        from dataclasses import replace
        for value in (True, False, 1.0, 0):
            with self.subTest(value=value), self.assertRaises(EvidenceError):
                replace(self.first.version, generation=value)
        contract = self.contract('after_latest_write')
        with self.assertRaises(EvidenceError):
            self.execution(contract, self.artifacts.versions(), 'completed', False)


class MemoryEvidence(EvidenceContract, unittest.TestCase):
    def make_port(self):
        return MemoryBytes()


class DiskEvidence(EvidenceContract, unittest.TestCase):
    def make_port(self):
        base = Path(__file__).resolve().parents[2] / '.local' / 'evidence-control-work'
        base.mkdir(parents=True, exist_ok=True)
        temporary = tempfile.TemporaryDirectory(dir=base)
        self.addCleanup(temporary.cleanup)
        return DiskBytes(Path(temporary.name))

    def test_out_of_band_rewrite_is_an_observable_fault(self):
        (self.port.root / 'solution.py').write_bytes(b'outside')
        with self.assertRaisesRegex(EvidenceError, 'artifact-outside-owner-write'):
            self.artifacts.read('e3', 'solution.py')

    def test_symlink_is_not_followed(self):
        path = self.port.root / 'solution.py'
        path.unlink()
        path.symlink_to('side.txt')
        with self.assertRaises(EvidenceError):
            self.artifacts.read('e3', 'solution.py')
        self.assertEqual((self.port.root / 'side.txt').read_bytes(), b'draft\n')


if __name__ == '__main__':
    unittest.main()
