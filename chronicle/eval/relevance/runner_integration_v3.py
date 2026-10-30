"""Explicit experiment bindings and dispatch; never starts processes or providers."""
from dataclasses import dataclass
from pathlib import Path
import re

from assessment_v3 import decode
import workflow_v3 as trusted

PROTOCOL_POLICY = 'evidence-navigation-v3'
LEGACY_SOURCE_POLICY = 'archived-bridge-v1'
LEGACY_FINGERPRINT_POLICY = 'full-state-v1'
MAX_OUTPUT_TOKENS = 65536
SCHEDULE_FIELDS = {'batchId', 'arm', 'repeat', 'mode', 'taskId', 'ordinal'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def exact(value, keys):
    require(type(value) is dict and set(value) == set(keys), 'closed explicit fields required: ' + ','.join(sorted(keys)))


def nonempty(value):
    return type(value) is str and bool(value) and value == value.strip()


def bound_file(value):
    exact(value, {'path', 'sha256'})
    require(nonempty(value['path']) and Path(value['path']).is_absolute(), 'absolute bound path required')
    require(type(value['sha256']) is str and re.fullmatch('[0-9a-f]{64}', value['sha256']) is not None, 'SHA256 required')
    return trusted.BoundFile(Path(value['path']), value['sha256'])


def codec_declarations(files):
    require(type(files) is list and bool(files), 'nonempty codec file set required')
    paths = set()
    for entry in files:
        exact(entry, {'relativePath', 'sha256'})
        relative = entry['relativePath']
        require(nonempty(relative), 'relative codec path required')
        path = Path(relative)
        require(not path.is_absolute() and '..' not in path.parts and path.as_posix() == relative
                and relative.startswith('generated/typescript/') and path.suffix == '.ts', 'invalid codec relative path')
        require(relative not in paths, 'duplicate codec path'); paths.add(relative)
        require(type(entry['sha256']) is str and re.fullmatch('[0-9a-f]{64}', entry['sha256']) is not None, 'codec SHA256 required')
    return {entry['relativePath']: entry['sha256'] for entry in files}


@dataclass(frozen=True)
class ExecutorCodecs:
    project: Path
    files: tuple[tuple[str, str], ...]

    def declarations(self):
        return [{'relativePath': name, 'sha256': sha} for name, sha in self.files]


@dataclass(frozen=True)
class BatchBinding:
    batch_id: str
    arm: str
    repeat: int
    schedule: trusted.BoundFile


@dataclass(frozen=True)
class WorkflowBinding:
    source_policy: str
    fingerprint_policy: str
    protocol_policy: str
    catalog_variant: str
    executor_codecs: ExecutorCodecs
    rubric: trusted.BoundFile
    batch: BatchBinding | None

    @classmethod
    def parse(cls, value, phase):
        exact(value, {'sourcePolicy', 'fingerprintPolicy', 'protocolPolicy', 'catalogVariant', 'executorCodecs', 'rubric', 'batch'})
        pair = (value['sourcePolicy'], value['fingerprintPolicy'])
        require(pair in ((LEGACY_SOURCE_POLICY, LEGACY_FINGERPRINT_POLICY), (trusted.POLICY, trusted.FINGERPRINT_POLICY)), 'unsupported source/fingerprint policy pair')
        require(value['protocolPolicy'] == PROTOCOL_POLICY and value['catalogVariant'] in ('baseline', 'context'), 'explicit V3 protocol and catalog variant required')
        codecs = value['executorCodecs']; exact(codecs, {'project', 'files'})
        require(nonempty(codecs['project']) and Path(codecs['project']).is_absolute(), 'absolute executor codec project required')
        files = codec_declarations(codecs['files'])
        rubric = bound_file(value['rubric'])
        require(phase in ('prepare', 'run'), 'known execution phase required')
        batch = value['batch']
        if phase == 'prepare':
            require(batch is None, 'prepare requires batch null')
        else:
            exact(batch, {'batchId', 'arm', 'repeat', 'schedule'})
            require(nonempty(batch['batchId']) and nonempty(batch['arm']) and type(batch['repeat']) is int and batch['repeat'] > 0, 'explicit batch/arm/positive repeat required')
            batch = BatchBinding(batch['batchId'], batch['arm'], batch['repeat'], bound_file(batch['schedule']))
        return cls(*pair, value['protocolPolicy'], value['catalogVariant'],
                   ExecutorCodecs(Path(codecs['project']), tuple(sorted(files.items()))), rubric, batch)


def validate_workflow_bindings(bindings, phase):
    require('workflow' in bindings, 'required explicit workflow binding missing')
    policy = WorkflowBinding.parse(bindings['workflow'], phase)
    require(bindings['agentReasoningPolicy'] == 'max' and type(bindings['agentMaximumOutputTokens']) is int
            and bindings['agentMaximumOutputTokens'] == MAX_OUTPUT_TOKENS, 'V3 requires max reasoning and exactly 65536 output tokens')
    validate_codec_files(policy.executor_codecs.project, policy.executor_codecs.declarations())
    if phase == 'prepare':
        require(codec_declarations(bindings['generatedFiles']) == dict(policy.executor_codecs.files), 'fresh publisher/executor codec declarations differ')
        validate_codec_files(Path(bindings['generatedProject']), bindings['generatedFiles'])
    return policy


def validate_codec_files(project, files):
    declared = codec_declarations(files)
    require(project.is_absolute() and project.is_dir() and not project.is_symlink(), 'absolute real codec project required')
    generated = project / 'generated/typescript'
    require(generated.is_dir() and not any(p.is_symlink() for p in (project/'generated', generated)), 'real generated codec directory required')
    actual = list(generated.rglob('*'))
    require(not any(p.is_symlink() for p in actual), 'codec symlinks forbidden')
    require({str(p.relative_to(project)) for p in actual if p.is_file() and p.suffix == '.ts'} == set(declared), 'exact executor codec file set required')
    for name, sha in declared.items():
        trusted.BoundFile(project / name, sha).read()


def validate_seed_policy(proof, prior, policy):
    if 'fingerprintPolicy' not in proof:
        require('workflow' not in prior and policy.source_policy == LEGACY_SOURCE_POLICY
                and policy.fingerprint_policy == LEGACY_FINGERPRINT_POLICY, 'unlabelled seed requires explicit archived legacy policy')
        evidence_format = 'historical-unlabelled-seed'
    else:
        require(proof['fingerprintPolicy'] == policy.fingerprint_policy, 'prepared fingerprint policy differs')
        require('workflow' in prior and prior['workflow']['sourcePolicy'] == policy.source_policy
                and prior['workflow']['fingerprintPolicy'] == policy.fingerprint_policy, 'prepared source/fingerprint binding differs')
        require(proof['sourcePolicy'] == policy.source_policy, 'prepared source policy differs')
        evidence_format = 'policy-labelled-seed'
    return {'fingerprintPolicy': policy.fingerprint_policy, 'sourcePolicy': policy.source_policy, 'evidenceFormat': evidence_format}


def bound_schedule(policy, fixture, modes, split):
    require(policy.batch is not None, 'run batch required')
    batch = policy.batch; master = decode(batch.schedule.read())
    require(type(master) is dict and type(master['trials']) is list and bool(master['trials']), 'nonempty bound master schedule required')
    identities = set()
    for row in master['trials']:
        exact(row, SCHEDULE_FIELDS)
        require(all(nonempty(row[key]) for key in ('batchId', 'arm', 'taskId')) and row['mode'] in ('lexical', 'semantic', 'hybrid'), 'invalid master schedule identity')
        require(type(row['repeat']) is int and row['repeat'] > 0 and type(row['ordinal']) is int and row['ordinal'] >= 0, 'invalid master schedule integer')
        identity = (row['batchId'], row['arm'], row['repeat'], row['ordinal'])
        require(identity not in identities, 'duplicate master schedule ordinal'); identities.add(identity)
    rows = [row for row in master['trials'] if (row['batchId'], row['arm'], row['repeat']) == (batch.batch_id, batch.arm, batch.repeat)]
    expected = {(task['id'], mode) for task in fixture['tasks'] if task['split'] == split for mode in modes}
    require(bool(expected) and len(rows) == len(expected) and {(row['taskId'], row['mode']) for row in rows} == expected,
            'master schedule must exactly cover selected split/modes once')
    return rows


def publication_fingerprint(policy, sql, legacy):
    if policy.source_policy == LEGACY_SOURCE_POLICY:
        return dict(legacy(sql), policy=LEGACY_FINGERPRINT_POLICY)
    return trusted.fingerprint(sql)


def trusted_manifest(directory, fixture_path):
    def bind(path):
        return trusted.BoundFile(path, trusted.digest(path.read_bytes()))
    return trusted.WorkflowManifest(bind(directory/'owned.json'), bind(directory/'config.json'),
                                    bind(directory/'model-catalog.json'), bind(fixture_path))


def trusted_preflight(backend, sql, manifest, fixture, receipts, output, rubric):
    catalog, proof = backend.verify_publication(sql, manifest, fixture, manifest.fixture_sha256, receipts, output, rubric)
    require(proof['status'] == 'Eligible' and proof['policy'] == trusted.POLICY, 'trusted publication eligibility required before trials')
    trusted.validate_candidate_stats(proof['candidateStats'])
    return catalog
