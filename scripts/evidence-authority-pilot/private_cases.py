"""Private DATA comparison outside candidate execution; no model/goal feedback."""
import builtins
from dataclasses import dataclass
import hashlib
import math
import re
from typing import Protocol, TypeAlias

from legacy_domain import Rejected, canonical, decode, fields, text
from process_control import ProcessOutcome

Json: TypeAlias = None | bool | int | float | str | list['Json'] | dict[str, 'Json']
CASE_JSON_BYTES = 4194304
FUNCTION_NAME = re.compile(r'[A-Za-z][A-Za-z0-9_]*\Z')
SHA256_TEXT = re.compile(r'[0-9a-f]{64}\Z')


class PrivateCaseError(ValueError):
    pass


def require(ok: bool, code: str) -> None:
    if not ok:
        raise PrivateCaseError(code)


def json_data(value: Json) -> None:
    pending = [value]
    while pending:
        current = pending.pop()
        if current is None or type(current) in (bool, int, str):
            if type(current) is str:
                current.encode('utf-8')
        elif type(current) is float:
            require(math.isfinite(current), 'nonfinite-json')
        elif type(current) is list:
            pending.extend(current)
        elif type(current) is dict:
            require(all(type(key) is str for key in current), 'json-key')
            for key in current:
                key.encode('utf-8')
            pending.extend(current.values())
        else:
            raise PrivateCaseError('json-type')


@dataclass(frozen=True)
class ValueExpectation:
    value_utf8: bytes


@dataclass(frozen=True)
class ExceptionExpectation:
    type_name: str


@dataclass(frozen=True)
class PrivateCase:
    identity: str
    function: str
    arguments_utf8: bytes
    expected: ValueExpectation | ExceptionExpectation


@dataclass(frozen=True)
class CaseAssessment:
    identity: str
    adequate: bool | None
    category: str
    actual_utf8: bytes | None
    stdout_sha256: str
    stderr_sha256: str
    execution_status: str
    exit_code: int | None
    arguments_mutated: bool | None
    argument_evidence: str


@dataclass(frozen=True)
class CaseReport:
    cases: tuple[CaseAssessment, ...]
    adequate: bool | None
    complete: bool


@dataclass(frozen=True)
class CasePolicyReport:
    case_adequacy: tuple[bool | None, ...]
    adequate: bool | None
    complete: bool


class CandidateInvoker(Protocol):
    def invoke(self, payload: bytes) -> ProcessOutcome: ...


def parse_case(raw: dict[str, Json]) -> PrivateCase:
    try:
        row = fields(raw, ('id', 'function', 'args', 'expected'))
        identity = text(row['id']); function = text(row['function'])
        require(FUNCTION_NAME.fullmatch(function) is not None, 'function-name')
        require(type(row['args']) is list, 'argument-array')
        json_data(row['args'])
        arguments = canonical(row['args']); require(len(arguments) <= CASE_JSON_BYTES, 'input-bound')
        expected = row['expected']; require(type(expected) is dict, 'expectation')
        if expected.get('kind') == 'value':
            fields(expected, ('kind', 'value')); json_data(expected['value'])
            body = canonical(expected['value']); require(len(body) <= CASE_JSON_BYTES, 'expectation-bound')
            expectation = ValueExpectation(body)
        elif expected.get('kind') == 'exception':
            fields(expected, ('kind', 'type')); name = text(expected['type'])
            builtin = getattr(builtins, name, None)
            require(type(builtin) is type and issubclass(builtin, Exception), 'exception-type')
            expectation = ExceptionExpectation(builtin.__name__)
        else:
            raise PrivateCaseError('expectation-kind')
        return PrivateCase(identity, function, arguments, expectation)
    except PrivateCaseError:
        raise
    except (Rejected, TypeError, KeyError, UnicodeError, ValueError) as error:
        raise PrivateCaseError('private-case-shape') from error


def call_bytes(case: PrivateCase) -> bytes:
    require(type(case) is PrivateCase, 'case-type')
    body = canonical({'function': case.function, 'args': decode(case.arguments_utf8, CASE_JSON_BYTES)})
    require(len(body) <= CASE_JSON_BYTES, 'input-bound')
    return body


def argument_observation(case: PrivateCase, raw: Json, present: bool) -> tuple[bool | None, str]:
    if not present:
        return None, 'missing'
    if raw is None:
        return None, 'null'
    try:
        row = fields(raw, ('before_bytes', 'before_sha256', 'after_bytes', 'after_sha256', 'after_status', 'mutated'))
        require(type(row['before_bytes']) is int and row['before_bytes'] == len(case.arguments_utf8), 'argument-before-length')
        require(row['before_sha256'] == hashlib.sha256(case.arguments_utf8).hexdigest(), 'argument-before-source')
        require(type(row['mutated']) is bool, 'argument-mutation-type')
        if row['after_status'] == 'json':
            require(type(row['after_bytes']) is int and row['after_bytes'] >= 0, 'argument-after-length')
            require(type(row['after_sha256']) is str and SHA256_TEXT.fullmatch(row['after_sha256']) is not None, 'argument-after-digest')
            changed = row['before_bytes'] != row['after_bytes'] or row['before_sha256'] != row['after_sha256']
            require(row['mutated'] == changed, 'argument-mutation-consistency')
            return changed, 'observed_json'
        require(row['after_status'] == 'non-json' and row['after_bytes'] is None
                and row['after_sha256'] is None and row['mutated'] is True, 'argument-after-status')
        return True, 'observed_non_json'
    except (PrivateCaseError, Rejected, KeyError, TypeError, ValueError):
        return None, 'invalid'


def assess(case: PrivateCase, outcome: ProcessOutcome) -> CaseAssessment:
    require(type(case) is PrivateCase and type(outcome) is ProcessOutcome, 'assessment-types')
    mutation: bool | None = None
    mutation_evidence = 'unavailable'
    def result(adequate: bool | None, category: str, actual: bytes | None) -> CaseAssessment:
        return CaseAssessment(case.identity, adequate, category, actual,
                              hashlib.sha256(outcome.stdout).hexdigest(), hashlib.sha256(outcome.stderr).hexdigest(),
                              outcome.status, outcome.exit_code, mutation, mutation_evidence)
    if (outcome.status != 'completed' or outcome.process_id is None or outcome.exit_code is None
            or not outcome.stdout_eof or not outcome.stderr_eof or outcome.error_codes
            or outcome.input_bytes_sent != len(call_bytes(case))):
        return result(None, 'unavailable_execution', None)
    if outcome.exit_code != 0:
        return result(False, 'candidate_exit', None)
    try:
        raw = decode(outcome.stdout, CASE_JSON_BYTES)
        require(type(raw) is dict and type(raw.get('kind')) is str, 'response-shape')
        mutation, mutation_evidence = argument_observation(case, raw.get('argument_observation'), 'argument_observation' in raw)
        raw = {key: value for key, value in raw.items() if key != 'argument_observation'}
        kind = raw['kind']
        if kind == 'value':
            fields(raw, ('kind', 'value')); json_data(raw['value']); actual = canonical(raw)
            adequate = type(case.expected) is ValueExpectation and canonical(raw['value']) == case.expected.value_utf8
            return result(adequate, 'matched' if adequate else 'mismatch', actual)
        if kind == 'exception':
            fields(raw, ('kind', 'type')); text(raw['type']); actual = canonical(raw)
            adequate = type(case.expected) is ExceptionExpectation and raw['type'] == case.expected.type_name
            return result(adequate, 'matched' if adequate else 'mismatch', actual)
        if kind in ('candidate_error', 'protocol_error'):
            fields(raw, ('kind', 'code')); text(raw['code'])
            return result(False if kind == 'candidate_error' else None, kind, canonical(raw))
        return result(False, 'invalid_output', None)
    except (Rejected, PrivateCaseError, TypeError, KeyError, UnicodeError, ValueError):
        return result(False, 'invalid_output', None)


def evaluate_cases(cases: tuple[PrivateCase, ...], invoker: CandidateInvoker) -> CaseReport:
    require(type(cases) is tuple and all(type(case) is PrivateCase for case in cases), 'case-array')
    require(len({case.identity for case in cases}) == len(cases), 'duplicate-case-id')
    assessments = tuple(assess(case, invoker.invoke(call_bytes(case))) for case in cases)
    complete = bool(assessments) and all(item.adequate is not None for item in assessments)
    if any(item.adequate is False for item in assessments):
        adequate = False
    elif complete:
        adequate = True
    else:
        adequate = None
    return CaseReport(assessments, adequate, complete)


def apply_policy(report: CaseReport, require_unchanged_arguments: bool) -> CasePolicyReport:
    require(type(report) is CaseReport and type(require_unchanged_arguments) is bool, 'policy-types')
    values = []
    for item in report.cases:
        if item.adequate is False or require_unchanged_arguments and item.arguments_mutated is True:
            values.append(False)
        elif item.adequate is None or require_unchanged_arguments and item.arguments_mutated is None:
            values.append(None)
        else:
            values.append(True)
    adequate = False if any(value is False for value in values) else True if values and all(value is True for value in values) else None
    return CasePolicyReport(tuple(values), adequate, bool(values) and all(value is not None for value in values))
