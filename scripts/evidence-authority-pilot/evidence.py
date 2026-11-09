"""Host-owned evidence primitives, not a malicious-in-process authentication boundary."""
from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import re
import stat
from typing import Literal, Protocol
import uuid


class EvidenceError(ValueError):
    pass


def require(condition: bool, code: str) -> None:
    if not condition:
        raise EvidenceError(code)


def nonempty(value: str) -> None:
    require(type(value) is str and bool(value) and '\x00' not in value, 'text')


def digest_valid(value: str) -> None:
    require(type(value) is str and re.fullmatch('[0-9a-f]{64}', value) is not None, 'digest')


def positive(value: int) -> None:
    require(type(value) is int and value > 0, 'positive-integer')


def logical_path(value: str) -> None:
    require(type(value) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', value) is not None and value not in ('.', '..'), 'logical-path')


@dataclass(frozen=True)
class Scope:
    trial_id: str
    branch_id: str
    epoch: int

    def __post_init__(self):
        nonempty(self.trial_id); nonempty(self.branch_id); positive(self.epoch)


@dataclass(frozen=True)
class FactRef:
    scope: Scope
    fact_id: str

    def __post_init__(self):
        require(type(self.scope) is Scope, 'scope-type'); nonempty(self.fact_id)


@dataclass(frozen=True)
class ArtifactVersion:
    path: str
    generation: int
    sha256: str
    byte_length: int

    def __post_init__(self):
        logical_path(self.path); positive(self.generation); digest_valid(self.sha256)
        require(type(self.byte_length) is int and self.byte_length >= 0, 'byte-length')


@dataclass(frozen=True)
class ArtifactFact:
    reference: FactRef
    event_id: str
    version: ArtifactVersion


@dataclass(frozen=True)
class ExecutionFact:
    reference: FactRef
    event_id: str
    contract_identity: str
    contract_revision: int
    tool: str
    argv: tuple[str, ...]
    checker_sha256: str
    artifacts: tuple[ArtifactVersion, ...]
    status: Literal['completed', 'interrupted', 'unknown', 'failed']
    exit_code: int | None
    stdout_sha256: str | None

    def __post_init__(self):
        nonempty(self.event_id); nonempty(self.contract_identity); positive(self.contract_revision)
        nonempty(self.tool); digest_valid(self.checker_sha256)
        require(type(self.argv) is tuple and bool(self.argv), 'argv')
        for arg in self.argv: nonempty(arg)
        require(type(self.artifacts) is tuple and all(type(v) is ArtifactVersion for v in self.artifacts), 'artifact-versions')
        require(len({v.path for v in self.artifacts}) == len(self.artifacts), 'duplicate-artifact')
        require(self.status in ('completed', 'interrupted', 'unknown', 'failed'), 'execution-status')
        require(self.exit_code is None or type(self.exit_code) is int, 'exit-code')
        if self.stdout_sha256 is not None: digest_valid(self.stdout_sha256)


Fact = ArtifactFact | ExecutionFact


class HostEvidence:
    def __init__(self, scope: Scope):
        require(type(scope) is Scope, 'scope-type')
        self.scope = scope
        self._facts: dict[str, Fact] = {}
        self._events: set[str] = set()
        self._current: dict[str, ArtifactVersion] = {}

    def check_event(self, event_id: str) -> None:
        nonempty(event_id)
        require(event_id not in self._events, 'event-reused')

    def _reference(self) -> FactRef:
        return FactRef(self.scope, 'f' + str(len(self._facts) + 1).zfill(6))

    def _append(self, fact: Fact) -> None:
        self.check_event(fact.event_id)
        self._facts[fact.reference.fact_id] = fact
        self._events.add(fact.event_id)

    def observe_artifact(self, event_id: str, version: ArtifactVersion) -> ArtifactFact:
        require(type(version) is ArtifactVersion, 'version-type')
        prior = self._current.get(version.path)
        if prior is not None:
            require(version == prior or version.generation == prior.generation + 1, 'artifact-generation')
        else:
            require(version.generation == 1, 'initial-generation')
        fact = ArtifactFact(self._reference(), event_id, version)
        self._append(fact)
        self._current[version.path] = version
        return fact

    def observe_execution(self, event_id: str, contract_identity: str, contract_revision: int,
                          tool: str, argv: tuple[str, ...], checker_sha256: str,
                          artifacts: tuple[ArtifactVersion, ...], status: str,
                          exit_code: int | None, stdout_sha256: str | None) -> ExecutionFact:
        fact = ExecutionFact(self._reference(), event_id, contract_identity, contract_revision,
                             tool, argv, checker_sha256, artifacts, status, exit_code, stdout_sha256)
        self._append(fact)
        return fact

    def resolve(self, reference: FactRef) -> Fact:
        require(type(reference) is FactRef and reference.scope == self.scope, 'fact-scope')
        require(reference.fact_id in self._facts, 'fact-missing')
        return self._facts[reference.fact_id]

    def current(self, path: str) -> ArtifactVersion | None:
        logical_path(path)
        return self._current.get(path)

    def facts(self) -> tuple[Fact, ...]:
        return tuple(self._facts.values())


class FileBytes(Protocol):
    def read(self, path: str) -> bytes: ...
    def replace(self, path: str, content: bytes) -> None: ...


class MemoryBytes:
    def __init__(self):
        self._files: dict[str, bytes] = {}

    def read(self, path: str) -> bytes:
        logical_path(path)
        require(path in self._files, 'artifact-missing')
        return self._files[path]

    def replace(self, path: str, content: bytes) -> None:
        logical_path(path); require(type(content) is bytes, 'content-type')
        self._files[path] = content


class DiskBytes:
    """Owned, stable directory; no hostile concurrent writer or universal ABA claim."""
    def __init__(self, root: Path):
        require(type(root) is type(Path()) and root.is_dir() and not root.is_symlink(), 'owned-root')
        require(not any(root.iterdir()), 'owned-root-not-empty')
        self.root = root

    def read(self, path: str) -> bytes:
        logical_path(path)
        try:
            descriptor = os.open(self.root / path, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError as error:
            raise EvidenceError('artifact-missing') from error
        except OSError as error:
            raise EvidenceError('artifact-open') from error
        with os.fdopen(descriptor, 'rb') as stream:
            require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), 'artifact-not-regular')
            return stream.read()

    def replace(self, path: str, content: bytes) -> None:
        logical_path(path); require(type(content) is bytes, 'content-type')
        destination = self.root / path
        if destination.exists() or destination.is_symlink():
            require(stat.S_ISREG(destination.lstat().st_mode), 'artifact-not-regular')
        temporary = self.root / ('.write-' + uuid.uuid4().hex)
        try:
            with temporary.open('xb') as stream:
                stream.write(content); stream.flush(); os.fsync(stream.fileno())
            os.replace(temporary, destination)
        finally:
            if temporary.exists(): temporary.unlink()


class Artifacts:
    def __init__(self, port: FileBytes, evidence: HostEvidence, allowed: tuple[str, ...]):
        require(type(allowed) is tuple and bool(allowed) and len(set(allowed)) == len(allowed), 'allowed-paths')
        for path in allowed: logical_path(path)
        self.port = port
        self.evidence = evidence
        self.allowed = allowed

    def _path(self, path: str) -> None:
        logical_path(path); require(path in self.allowed, 'path-not-allowed')

    def _checked_content(self, path: str) -> tuple[bytes, ArtifactVersion]:
        self._path(path)
        raw = self.port.read(path)
        prior = self.evidence.current(path)
        require(prior is not None, 'artifact-unobserved')
        require(hashlib.sha256(raw).hexdigest() == prior.sha256 and len(raw) == prior.byte_length,
                'artifact-outside-owner-write')
        return raw, prior

    def write(self, event_id: str, path: str, content: bytes) -> ArtifactFact:
        self.evidence.check_event(event_id); self._path(path)
        require(type(content) is bytes, 'content-type')
        prior = self.evidence.current(path)
        if prior is not None: self._checked_content(path)
        generation = 1 if prior is None else prior.generation + 1
        self.port.replace(path, content)
        require(self.port.read(path) == content, 'write-readback')
        version = ArtifactVersion(path, generation, hashlib.sha256(content).hexdigest(), len(content))
        return self.evidence.observe_artifact(event_id, version)

    def read(self, event_id: str, path: str) -> ArtifactFact:
        self.evidence.check_event(event_id)
        _, version = self._checked_content(path)
        return self.evidence.observe_artifact(event_id, version)

    def versions(self) -> tuple[ArtifactVersion, ...]:
        return tuple(self._checked_content(path)[1] for path in self.allowed)


@dataclass(frozen=True)
class DigestAssertion:
    reference: FactRef
    expected_sha256: str

    def __post_init__(self):
        require(type(self.reference) is FactRef, 'fact-reference'); digest_valid(self.expected_sha256)


@dataclass(frozen=True)
class ModelAssertion:
    identity: str
    text: str
    evidence_refs: tuple[FactRef, ...]
    digest_assertions: tuple[DigestAssertion, ...]

    def __post_init__(self):
        nonempty(self.identity); nonempty(self.text)
        require(type(self.evidence_refs) is tuple and all(type(ref) is FactRef for ref in self.evidence_refs), 'fact-references')
        require(len(set(self.evidence_refs)) == len(self.evidence_refs), 'duplicate-fact-reference')
        require(type(self.digest_assertions) is tuple and all(type(item) is DigestAssertion for item in self.digest_assertions), 'typed-assertions')


@dataclass(frozen=True)
class Qualification:
    coverage: str
    evidence_origin: str
    applicability: str
    conflicts: tuple[str, ...]
    body_verified: bool


def qualify(assertion: ModelAssertion, evidence: HostEvidence, coverage: str) -> Qualification:
    require(coverage in ('current', 'lagging'), 'coverage')
    facts = [evidence.resolve(ref) for ref in assertion.evidence_refs]
    versions = [fact.version for fact in facts if type(fact) is ArtifactFact]
    for fact in facts:
        if type(fact) is ExecutionFact: versions.extend(fact.artifacts)
    states = {version == evidence.current(version.path) for version in versions}
    applicability = 'unbound' if not versions else ('mixed_versions' if len(states) > 1 else ('current_version' if True in states else 'historical_version'))
    conflicts = []
    for predicate in assertion.digest_assertions:
        require(predicate.reference in assertion.evidence_refs, 'predicate-not-cited')
        fact = evidence.resolve(predicate.reference)
        require(type(fact) is ArtifactFact, 'predicate-fact-kind')
        if predicate.expected_sha256 != fact.version.sha256:
            conflicts.append('digest-mismatch:' + assertion.identity)
    return Qualification(coverage, 'model_assertion', applicability, tuple(conflicts), False)


@dataclass(frozen=True)
class CompletionContract:
    identity: str
    revision: int
    tool: str
    argv: tuple[str, ...]
    checker_sha256: str
    ordering: Literal['after_latest_write', 'exact_content']
    artifact_paths: tuple[str, ...]

    def __post_init__(self):
        nonempty(self.identity); positive(self.revision); nonempty(self.tool); digest_valid(self.checker_sha256)
        require(type(self.argv) is tuple and bool(self.argv), 'argv')
        for arg in self.argv: nonempty(arg)
        require(self.ordering in ('after_latest_write', 'exact_content'), 'ordering')
        require(type(self.artifact_paths) is tuple and bool(self.artifact_paths) and len(set(self.artifact_paths)) == len(self.artifact_paths), 'contract-artifacts')
        for path in self.artifact_paths: logical_path(path)


def completion_status(contract: CompletionContract, proof: ExecutionFact | None, artifacts: Artifacts) -> str:
    if proof is None: return 'not_observed'
    require(type(proof) is ExecutionFact, 'execution-fact-type')
    if proof.reference.scope != artifacts.evidence.scope: return 'wrong_scope'
    if (proof.contract_identity, proof.contract_revision, proof.tool, proof.argv, proof.checker_sha256) != (contract.identity, contract.revision, contract.tool, contract.argv, contract.checker_sha256):
        return 'wrong_action_contract'
    if proof.status != 'completed' or proof.exit_code != 0: return 'execution_not_successful'
    if proof.stdout_sha256 is None: return 'evidence_incomplete'
    observed = {version.path: version for version in proof.artifacts}
    if set(observed) != set(contract.artifact_paths): return 'artifact_set_mismatch'
    current = {version.path: version for version in artifacts.versions()}
    require(set(contract.artifact_paths) <= set(current), 'contract-path-not-owned')
    for path, old in observed.items():
        new = current[path]
        if contract.ordering == 'after_latest_write':
            if old != new: return 'action_historical'
        elif (old.path, old.sha256, old.byte_length) != (new.path, new.sha256, new.byte_length):
            return 'action_historical'
    return 'action_performed_current'
