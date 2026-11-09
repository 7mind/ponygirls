"""Specified input-only evaluation contracts; invented engineering data only."""
from dataclasses import replace
from pathlib import Path
import json
import sys
import tempfile
import unittest

from private_cases import (PrivateCaseError, assess, call_bytes, evaluate_cases,
                           parse_case)
from process_control import ProcessOutcome, ProcessRequest, ProcessRunner


def case(identity, function, args, expected):
    return parse_case({'id': identity, 'function': function, 'args': args, 'expected': expected})


def outcome(payload, stdout):
    return ProcessOutcome('completed', 0, stdout, b'', True, True, 12,
                          ('/fictional/runner',), '/work', 1, 2, 'start', 'end', len(payload), ())


class MemoryInvocation:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def invoke(self, payload):
        self.calls.append(payload)
        return outcome(payload, self.responses[payload])


class RealInvocation:
    def __init__(self, root, program):
        self.root = root
        self.module = root / 'solution.py'; self.module.write_text(program)
        self.calls = []

    def invoke(self, payload):
        self.calls.append(payload)
        child = Path(__file__).with_name('candidate_child.py').resolve()
        request = ProcessRequest((sys.executable, '-B', '-I', '-S', str(child), str(self.module)),
                                 str(self.root), (), payload, 5.0, 4194304)
        return ProcessRunner().run(request)


class InvocationContract:
    def test_private_expectations_and_ids_never_enter_child_input(self):
        spec = case('PRIVATE-IDENTITY', 'f', [1], {'kind': 'value', 'value': 2})
        invoker = self.invoker('def f(x):\n return x+1\n', {call_bytes(spec): b'{"kind":"value","value":2}'})
        report = evaluate_cases((spec,), invoker)
        self.assertTrue(report.adequate); self.assertTrue(report.complete)
        self.assertEqual(json.loads(invoker.calls[0]), {'function': 'f', 'args': [1]})
        self.assertNotIn(b'PRIVATE-IDENTITY', invoker.calls[0])
        self.assertNotIn(b'expected', invoker.calls[0])

    def test_function_exception_is_not_import_failure(self):
        spec = case('exception', 'f', [], {'kind': 'exception', 'type': 'ValueError'})
        invoker = self.invoker('def f():\n raise ValueError("ordinary")\n', {call_bytes(spec): b'{"kind":"exception","type":"ValueError"}'})
        report = evaluate_cases((spec,), invoker)
        self.assertTrue(report.adequate)
        bad = self.invoker('raise ValueError("import failed")\n', {call_bytes(spec): b'{"kind":"candidate_error","code":"load"}'})
        self.assertFalse(evaluate_cases((spec,), bad).adequate)

    def test_known_failure_is_preserved_when_another_case_is_unavailable(self):
        first = case('known-bad', 'f', [1], {'kind': 'value', 'value': 3})
        second = case('missing', 'f', [2], {'kind': 'value', 'value': 3})
        port = self.invoker('def f(x):\n return x+1\n', {call_bytes(first): b'{"kind":"value","value":2}'})
        delegate = port.invoke
        def invoke(payload):
            if payload == call_bytes(second):
                return replace(outcome(payload, b''), status='start-failed', exit_code=None,
                               process_id=None, stdout_eof=False, stderr_eof=False, input_bytes_sent=0)
            return delegate(payload)
        class Mixed:
            def invoke(self, payload):
                return invoke(payload)
        report = evaluate_cases((first, second), Mixed())
        self.assertFalse(report.adequate); self.assertFalse(report.complete)
        self.assertFalse(report.cases[0].adequate); self.assertIsNone(report.cases[1].adequate)


class MemoryCases(InvocationContract, unittest.TestCase):
    def invoker(self, program, responses):
        return MemoryInvocation(responses)


class RealCases(InvocationContract, unittest.TestCase):
    def invoker(self, program, responses):
        base = Path(__file__).resolve().parents[2] / '.local/private-case-engineering'
        base.mkdir(parents=True, exist_ok=True)
        temporary = tempfile.TemporaryDirectory(dir=base); self.addCleanup(temporary.cleanup)
        return RealInvocation(Path(temporary.name), program)

    def test_incidental_prints_are_stderr_not_a_new_return_requirement(self):
        spec = case('prints', 'f', [], {'kind': 'value', 'value': {'x': 2}})
        port = self.invoker('print("import log")\ndef f():\n print("function log")\n return {"x":2}\n', {})
        result = port.invoke(call_bytes(spec))
        self.assertEqual(json.loads(result.stdout), {'kind': 'value', 'value': {'x': 2}})
        self.assertIn(b'import log', result.stderr); self.assertIn(b'function log', result.stderr)
        self.assertTrue(assess(spec, result).adequate)

    def test_invalid_input_shape_does_not_import_candidate(self):
        port = self.invoker('from pathlib import Path\nPath("unexpected-import").write_text("ran")\ndef f():\n return 2\n', {})
        result = port.invoke(b'{"function":"f","args":[],"expected":"must-not-be-in-child"}')
        self.assertEqual(json.loads(result.stdout), {'kind': 'protocol_error', 'code': 'call-input'})
        self.assertFalse((port.root / 'unexpected-import').exists())

    def test_non_json_return_is_a_candidate_error(self):
        spec = case('non-json', 'f', [], {'kind': 'value', 'value': None})
        for expression in ('{1,2}', 'float("nan")'):
            port = self.invoker('def f():\n return ' + expression + '\n', {})
            with self.subTest(expression=expression):
                result = port.invoke(call_bytes(spec))
                self.assertEqual(json.loads(result.stdout), {'kind': 'candidate_error', 'code': 'non-json-return'})
                self.assertFalse(assess(spec, result).adequate)

    def test_cyclic_return_is_rejected_not_an_execution_timeout(self):
        spec = case('cycle', 'f', [], {'kind': 'value', 'value': None})
        port = self.invoker('def f():\n value=[]\n value.append(value)\n return value\n', {})
        result = port.invoke(call_bytes(spec))
        self.assertEqual(result.status, 'completed')
        self.assertEqual(json.loads(result.stdout), {'kind': 'candidate_error', 'code': 'non-json-return'})
        self.assertFalse(assess(spec, result).adequate)

    def test_valid_dataclass_candidate_with_postponed_annotations_loads(self):
        spec = case('dataclass', 'f', [2], {'kind': 'value', 'value': 2})
        program = 'from __future__ import annotations\nfrom dataclasses import dataclass\n@dataclass\nclass Box:\n value:int\ndef f(x):\n return Box(x).value\n'
        port = self.invoker(program, {})
        self.assertTrue(assess(spec, port.invoke(call_bytes(spec))).adequate)

    def test_missing_function_is_inadequate_not_an_expected_exception(self):
        spec = case('missing-export', 'f', [], {'kind': 'exception', 'type': 'AttributeError'})
        port = self.invoker('def other():\n return 2\n', {})
        self.assertFalse(assess(spec, port.invoke(call_bytes(spec))).adequate)


class ComparisonControls(unittest.TestCase):
    def test_exact_flat_shape_and_immutable_json(self):
        raw = {'id': 'a', 'function': 'f', 'args': [{'x': 1}], 'expected': {'kind': 'value', 'value': {'x': 2}}}
        spec = parse_case(raw); raw['args'][0]['x'] = 99; raw['expected']['value']['x'] = 99
        self.assertEqual(json.loads(call_bytes(spec)), {'function': 'f', 'args': [{'x': 1}]})
        self.assertTrue(assess(spec, outcome(call_bytes(spec), b'{"kind":"value","value":{"x":2}}')).adequate)
        for change in ({'extra': True}, {'function': '__dict__'}, {'function': 'x.y'}, {'args': {}},
                       {'expected': {'kind': 'exception', 'type': 'NotABuiltin'}}, {'args': [float('nan')]}):
            with self.subTest(change=change), self.assertRaises(PrivateCaseError):
                parse_case({**raw, **change})

    def test_boolean_integer_float_are_not_equality_aliases(self):
        for expected, actual in ((False, 0), (0, False), (1, 1.0), (1.0, 1)):
            spec = case('typed', 'f', [], {'kind': 'value', 'value': expected})
            result = outcome(call_bytes(spec), json.dumps({'kind': 'value', 'value': actual}).encode())
            with self.subTest(expected=expected, actual=actual): self.assertFalse(assess(spec, result).adequate)

    def test_invalid_or_forged_response_is_not_success(self):
        spec = case('strict', 'f', [], {'kind': 'value', 'value': 2})
        for raw in (b'', b'not json', b'{"kind":"value","kind":"value","value":2}',
                    b'{"kind":"value","value":NaN}', b'{"kind":"value","value":2,"extra":true}',
                    b'\xff', b'{"kind":"exception","type":"ValueError"}'):
            with self.subTest(raw=raw): self.assertFalse(assess(spec, outcome(call_bytes(spec), raw)).adequate)

    def test_partial_input_or_capture_is_unavailable_not_observed_false(self):
        spec = case('partial', 'f', [2], {'kind': 'value', 'value': 2})
        good = outcome(call_bytes(spec), b'{"kind":"value","value":2}')
        for changed in (replace(good, input_bytes_sent=len(call_bytes(spec))-1),
                        replace(good, stdout_eof=False), replace(good, status='capture-failed'),
                        replace(good, status='timeout'), replace(good, process_id=None)):
            with self.subTest(changed=changed): self.assertIsNone(assess(spec, changed).adequate)

    def test_nonzero_exit_is_a_candidate_failure_not_a_passing_json(self):
        spec = case('exit', 'f', [], {'kind': 'value', 'value': 2})
        forged = replace(outcome(call_bytes(spec), b'{"kind":"value","value":2}'), exit_code=1)
        self.assertFalse(assess(spec, forged).adequate)

    def test_empty_case_set_and_duplicate_ids_do_not_manufacture_coverage(self):
        empty = evaluate_cases((), MemoryInvocation({}))
        self.assertIsNone(empty.adequate); self.assertFalse(empty.complete)
        spec = case('same', 'f', [], {'kind': 'value', 'value': 2})
        with self.assertRaises(PrivateCaseError): evaluate_cases((spec, spec), MemoryInvocation({}))


if __name__ == '__main__':
    unittest.main()
