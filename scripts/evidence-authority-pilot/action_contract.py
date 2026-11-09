"""Nine-field public action source and protected host binding, not goal acceptance.

This composes the narrower shared evidence primitives; it does not authenticate a
malicious in-process caller or claim an independently observed child PID/cwd.
"""
from dataclasses import dataclass
import hashlib

from evidence import (Artifacts, CompletionContract, EvidenceError, ExecutionFact,
                      completion_status, digest_valid, logical_path, positive)
from legacy_domain import Rejected, canonical, decode, fields, text


class ActionError(EvidenceError):
    pass


def require(ok: bool, code: str) -> None:
    if not ok:
        raise ActionError(code)


def string_tuple(value: tuple[str, ...]) -> None:
    require(type(value) is tuple and bool(value), 'action-argv')
    for part in value:
        text(part)


@dataclass(frozen=True)
class PublicActionContract:
    identity: str
    revision: int
    tool: str
    arguments_utf8: bytes
    argv: tuple[str, ...]
    cwd: str
    checker_sha256: str
    ordering: str
    artifact_paths: tuple[str, ...]

    @classmethod
    def parse(cls, raw: dict, checker_bytes: bytes, writable_paths: tuple[str, ...],
              required_inner_argv: tuple[str, ...]) -> 'PublicActionContract':
        try:
            row = fields(raw, ('identity', 'revision', 'tool', 'arguments', 'argv',
                              'cwd', 'checker_sha256', 'ordering', 'artifact_paths'))
            text(row['identity']); positive(row['revision'])
            require(type(checker_bytes) is bytes, 'checker-bytes')
            require(type(row['tool']) is str and row['tool'] == 'run_tests', 'action-tool')
            require(type(row['arguments']) is dict and not row['arguments'], 'action-arguments')
            string_tuple(required_inner_argv)
            require(type(row['argv']) is list and all(type(x) is str for x in row['argv'])
                    and tuple(row['argv']) == required_inner_argv, 'action-inner-argv')
            require(type(row['cwd']) is str and row['cwd'] == '/work', 'action-cwd')
            digest_valid(row['checker_sha256'])
            require(row['checker_sha256'] == hashlib.sha256(checker_bytes).hexdigest(), 'action-checker')
            require(type(row['ordering']) is str and row['ordering'] == 'after_latest_write', 'action-ordering')
            require(type(writable_paths) is tuple and bool(writable_paths)
                    and len(set(writable_paths)) == len(writable_paths), 'owned-paths')
            for path in writable_paths:
                logical_path(path)
            paths = row['artifact_paths']
            require(type(paths) is list and bool(paths) and all(type(x) is str for x in paths)
                    and len(set(paths)) == len(paths) and set(paths) <= set(writable_paths), 'action-artifacts')
            return cls(row['identity'], row['revision'], row['tool'], canonical(row['arguments']),
                       tuple(row['argv']), row['cwd'], row['checker_sha256'], row['ordering'], tuple(paths))
        except ActionError:
            raise
        except (Rejected, EvidenceError, KeyError, TypeError, UnicodeError) as error:
            raise ActionError('action-contract-shape') from error

    def wire(self) -> dict:
        return {'identity': self.identity, 'revision': self.revision, 'tool': self.tool,
                'arguments': decode(self.arguments_utf8, len(self.arguments_utf8)),
                'argv': list(self.argv), 'cwd': self.cwd, 'checker_sha256': self.checker_sha256,
                'ordering': self.ordering, 'artifact_paths': list(self.artifact_paths)}

    @property
    def sha256(self) -> str:
        return hashlib.sha256(canonical(self.wire())).hexdigest()

    def narrow(self) -> CompletionContract:
        return CompletionContract(self.identity, self.revision, self.tool, self.argv,
                                  self.checker_sha256, self.ordering, self.artifact_paths)


def render_request(request: str, contract: PublicActionContract) -> str:
    text(request)
    require(type(contract) is PublicActionContract, 'action-contract-type')
    return canonical({'request': request, 'completion_contract': contract.wire(),
                      'completion_contract_sha256': contract.sha256}).decode('utf-8')


@dataclass(frozen=True)
class ActionBinding:
    """Trusted adapter captures actual fields; model-facing input cannot mint it."""
    fact: ExecutionFact
    arguments_utf8: bytes
    requested_cwd: str
    inner_argv: tuple[str, ...]
    launcher_argv: tuple[str, ...]
    contract_sha256: str

    def __post_init__(self) -> None:
        try:
            require(type(self.fact) is ExecutionFact, 'action-fact-type')
            require(type(self.arguments_utf8) is bytes, 'action-argument-bytes')
            arguments = decode(self.arguments_utf8, len(self.arguments_utf8))
            require(type(arguments) is dict and canonical(arguments) == self.arguments_utf8, 'action-arguments')
            text(self.requested_cwd); string_tuple(self.inner_argv); string_tuple(self.launcher_argv)
            digest_valid(self.contract_sha256)
        except ActionError:
            raise
        except (Rejected, EvidenceError, UnicodeError) as error:
            raise ActionError('action-binding-shape') from error

    @classmethod
    def capture(cls, fact: ExecutionFact, actual_arguments: dict, requested_cwd: str,
                inner_argv: tuple[str, ...], launcher_argv: tuple[str, ...],
                contract_sha256: str) -> 'ActionBinding':
        require(type(actual_arguments) is dict, 'action-arguments')
        return cls(fact, canonical(actual_arguments), requested_cwd, inner_argv,
                   launcher_argv, contract_sha256)

    @property
    def full_scenario_acceptance(self) -> bool:
        return False

    @property
    def process_identity_scope(self) -> str:
        return 'host launcher/declared inner argv and requested cwd; not independent in-process Python PID/cwd'


def action_status(contract: PublicActionContract, binding: ActionBinding | None,
                  artifacts: Artifacts) -> str:
    require(type(contract) is PublicActionContract, 'action-contract-type')
    if binding is None:
        return 'not_observed'
    require(type(binding) is ActionBinding, 'action-binding-type')
    if (binding.arguments_utf8 != contract.arguments_utf8
            or binding.requested_cwd != contract.cwd
            or binding.contract_sha256 != contract.sha256
            or binding.inner_argv != contract.argv
            or binding.fact.argv != binding.inner_argv):
        return 'wrong_action_contract'
    return completion_status(contract.narrow(), binding.fact, artifacts)
