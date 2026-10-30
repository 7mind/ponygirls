"""Owner-only helpers. Never expose SQL, ingestion, fixtures or proofs to agents."""
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
from typing import Callable, Protocol
from urllib.request import ProxyHandler, Request, build_opener
import uuid

from bridge import Bridge, NoRedirect, ownership, loopback
from assessment_v3 import decode, propositions_for
from source_observations_v3 import FrozenSources, normalized_source_text, observe_trace, scalar_range, utf8

POLICY = 'trusted-workflow-v3'
FINGERPRINT_POLICY = 'digest-state-v3'
MAX_BODY_BYTES = 8 * 1024 * 1024
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_MESSAGES = 10000
MAX_RECEIPT_BYTES = 4096
MAX_TOKEN_BYTES = 4096
INGEST_SECONDS = 30
MIN_ELIGIBLE_PIECES = 1001
PRINCIPALS = frozenset({'reader', 'restricted'})
MODES = frozenset({'lexical', 'semantic', 'hybrid'})


class SetupFailure(ValueError):
    """Unmet experiment prerequisite; not a product or semantic-quality failure."""


def require(condition, code):
    if not condition:
        raise SetupFailure(code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def save_bytes(path, raw):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as output:
        output.write(raw)


def save_json(path, value):
    save_bytes(path, json_bytes(value))


def fresh_directory(directory):
    require(directory.is_dir() and not directory.is_symlink() and not any(directory.iterdir()), 'fresh-real-output-directory-required')


def identifier(value):
    require(type(value) is str and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', value) is not None, 'unsafe-artifact-identity')
    return value


def uuid_text(value):
    require(type(value) is str, 'uuid-string-required')
    try:
        result = str(uuid.UUID(value))
    except ValueError as error:
        raise SetupFailure('invalid-uuid') from error
    require(result == value, 'canonical-uuid-required')
    return result


def structured(value, maximum):
    utf8(value)
    require(bool(value) and '\x00' not in value and len(value.encode('utf-16-le')) // 2 <= maximum, 'invalid-structured-field')
    return value


@dataclass(frozen=True)
class BoundFile:
    path: Path
    sha256: str

    def read(self):
        require(self.path.is_absolute() and self.path.is_file() and not self.path.is_symlink(), 'absolute-bound-regular-file-required')
        raw = self.path.read_bytes()
        require(re.fullmatch('[0-9a-f]{64}', self.sha256) is not None and digest(raw) == self.sha256, 'bound-file-hash-mismatch')
        return raw

    def json(self):
        return decode(self.read())


@dataclass(frozen=True)
class WorkflowManifest:
    owned: BoundFile
    native_config: BoundFile
    model_catalog: BoundFile
    fixture: BoundFile

    @property
    def fixture_sha256(self):
        return self.fixture.sha256

    def verify_fixture(self, value):
        require(canonical(value) == canonical(self.fixture.json()), 'caller-fixture-object-mismatch')

    def configuration(self):
        owned = self.owned.json(); config = self.native_config.json()
        require(owned['modelCatalogSha256'] == self.model_catalog.sha256, 'model-catalog-binding-mismatch')
        self.model_catalog.read(); self.fixture.read()
        loopback(owned['origin']); identifier(owned['runId'])
        require(re.fullmatch('[0-9a-f]{64}', self.fixture_sha256) is not None, 'fixture-hash-required')
        require(config['allowedOrigin'] == owned['origin'], 'bound-config-origin-mismatch')
        return owned, config


@dataclass(frozen=True)
class IngestLimits:
    max_body_bytes: int
    max_file_bytes: int
    max_files: int
    max_messages: int

    def __post_init__(self):
        require(all(type(n) is int and n > 0 for n in (self.max_body_bytes, self.max_file_bytes, self.max_files, self.max_messages)), 'positive-ingest-limits-required')
        require(self.max_body_bytes <= MAX_BODY_BYTES and self.max_file_bytes <= MAX_FILE_BYTES and self.max_messages <= MAX_MESSAGES, 'trusted-ingest-bound-exceeded')

    @classmethod
    def from_config(cls, config):
        return cls(config['maxBodyBytes'], config['maxFileBytes'], config['maxFiles'], config['maxMessages'])


@dataclass(frozen=True)
class SourceFingerprint:
    message_id: str
    position: int
    role: str
    bytes: int
    sha256: str

    def wire(self):
        return {'messageId': self.message_id, 'position': self.position, 'role': self.role, 'bytes': self.bytes, 'sha256': self.sha256}


def document_messages(document):
    padding = [{'id': f'padding-{n}', 'text': f'Routine heartbeat {n}; no decision recorded.'} for n in range(document.get('paddingBefore', 0))]
    return padding + document['messages']


def source_fingerprints(document):
    return tuple(SourceFingerprint(m['id'], position, m.get('role', 'user'), len(utf8(normalized_source_text(m['text']))),
                                   digest(utf8(normalized_source_text(m['text'])))) for position, m in enumerate(document_messages(document)))


@dataclass(frozen=True)
class PreparedIngest:
    document_id: str
    principal: str
    request_id: str
    body: bytes
    source_digest: str


@dataclass(frozen=True)
class IngestReceipt:
    request_id: str
    session_id: str
    revision: int
    job_id: str
    raw: bytes

    @classmethod
    def parse(cls, value, request_id):
        require(type(value) is dict and set(value) == {'requestId', 'sessionId', 'revision', 'jobId'}, 'exact-ingest-receipt-required')
        require(uuid_text(value['requestId']) == request_id and type(value['revision']) is int and value['revision'] == 1, 'fresh-ingest-receipt-mismatch')
        return cls(request_id, uuid_text(value['sessionId']), value['revision'], uuid_text(value['jobId']), json_bytes(value))

    @classmethod
    def parse_wire(cls, raw, request_id):
        parsed = cls.parse(decode(raw), request_id)
        return cls(parsed.request_id, parsed.session_id, parsed.revision, parsed.job_id, raw)

    def wire(self):
        return {'requestId': self.request_id, 'sessionId': self.session_id, 'revision': self.revision, 'jobId': self.job_id}


def prepare_ingest(document, run_id, limits, request_id):
    doc_id = identifier(document['id']); identifier(run_id); uuid_text(request_id)
    require(document['principal'] in PRINCIPALS, 'closed-synthetic-principal-required')
    messages = []
    for position, message in enumerate(document_messages(document)):
        mid = structured(message['id'], 256); role = structured(message.get('role', 'user'), 64); utf8(message['text'])
        messages.append({'id': mid, 'parentId': None, 'role': role, 'text': message['text'], 'timestamp': None, 'recordIndex': position})
    require(len({m['id'] for m in messages}) == len(messages), 'duplicate-message-identity')
    require(len(messages) <= limits.max_messages, 'message-limit-exceeded')
    raw = b''.join(json_bytes(m) + b'\n' for m in messages); sha = digest(raw)
    require(limits.max_files >= 1 and len(raw) <= limits.max_file_bytes, 'raw-file-limit-exceeded')
    title = document['title']; utf8(title)
    producer = structured(run_id + '-' + doc_id, 256)
    payload = {'requestId': request_id, 'source': {'collectorNamespace': 'context-eval-v3', 'discoveryRootId': 'synthetic',
        'format': 'Pi', 'producerSessionId': producer, 'subagentId': None}, 'expectedRevision': 0, 'digest': sha,
        'completion': 'Closed', 'redacted': False,
        'metadata': {'title': title, 'project': 'relevance-' + run_id, 'workdir': None, 'gitRemote': None, 'gitBranch': None,
            'gitCommit': None, 'producer': 'synthetic', 'model': None, 'startedAt': '2026-01-01T00:00:00Z', 'endedAt': None,
            'tags': ['synthetic-relevance']}, 'messages': messages,
        'files': [{'path': 'synthetic.jsonl', 'sha256': sha, 'content': raw.decode('utf-8')}]}
    body = json_bytes(payload)
    require(len(body) <= limits.max_body_bytes, 'native-body-limit-exceeded')
    return PreparedIngest(doc_id, document['principal'], request_id, body, sha)


def token_path(owned, config, principal, scope):
    require(principal in PRINCIPALS and scope in ('Read', 'Ingest'), 'closed-token-authority-required')
    path = Path(owned['tokenFiles' if scope == 'Read' else 'ingestTokenFiles'][principal])
    require(path.is_absolute() and not path.is_symlink(), 'absolute-nonsymlink-credential-required')
    bindings = [entry for entry in config['staticTokens'] if entry['userId'] == principal
                and Path(entry['tokenFile']) == path and entry['scopes'] == [scope]]
    require(len(bindings) == 1, 'bound-exact-token-scope-required')
    require(any(u['id'] == principal and u['enabled'] is True for u in config['users']), 'enabled-synthetic-owner-required')
    return path


def read_token(path):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600, 'credential-mode-0600-required')
        raw = source.read(MAX_TOKEN_BYTES + 1)
    require(len(raw) <= MAX_TOKEN_BYTES, 'credential-size-exceeded')
    token = raw.decode('utf-8').strip()
    require(bool(token) and '\n' not in token and '\r' not in token, 'invalid-credential-file')
    return token


class IngestClient(Protocol):
    def submit(self, prepared: PreparedIngest) -> IngestReceipt: ...


@contextmanager
def ingest_deadline():
    require(signal.getitimer(signal.ITIMER_REAL) == (0.0, 0.0), 'exclusive-main-thread-ingest-timer-required')
    def expired(signum, frame):
        raise TimeoutError('trusted-ingest-deadline')
    prior = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, INGEST_SECONDS)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0); signal.signal(signal.SIGALRM, prior)


class TrustedIngestClient:
    def __init__(self, manifest, limits, opener, check_owned):
        self.manifest = manifest; self.limits = limits; self.opener = opener; self.check_owned = check_owned

    def submit(self, prepared):
        owned, config = self.manifest.configuration()
        require(IngestLimits.from_config(config) == self.limits, 'actual-config-limits-mismatch')
        require(len(prepared.body) <= self.limits.max_body_bytes, 'native-body-limit-exceeded')
        self.check_owned(owned)
        token = read_token(token_path(owned, config, prepared.principal, 'Ingest'))
        request = Request(owned['origin'].rstrip('/') + '/api/ingest', data=prepared.body,
                          headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token}, method='POST')
        try:
            with ingest_deadline(), self.opener.open(request, timeout=INGEST_SECONDS) as response:
                require(response.status == 200, 'trusted-ingest-http-status')
                raw = response.read(MAX_RECEIPT_BYTES + 1)
                require(len(raw) <= MAX_RECEIPT_BYTES, 'ingest-receipt-size-exceeded')
            receipt = IngestReceipt.parse_wire(raw, prepared.request_id)
        finally:
            self.check_owned(owned)
            self.manifest.configuration()
        return receipt


def provision_with_client(client, manifest, fixture, directory, limits):
    manifest.verify_fixture(fixture)
    owned, config = manifest.configuration()
    require(IngestLimits.from_config(config) == limits, 'actual-config-limits-mismatch')
    documents = fixture['documents']
    require(bool(documents), 'nonempty-fixture-required')
    require(len({d['id'] for d in documents}) == len(documents), 'duplicate-document-identity')
    prepared = [prepare_ingest(doc, owned['runId'], limits, str(uuid.uuid4())) for doc in documents]
    # Validate every credential before the first send; reread freshly per request too.
    for item in prepared:
        read_token(token_path(owned, config, item.principal, 'Ingest'))
    receipts = {}
    for item in prepared:
        save_bytes(directory / (item.document_id + '.request.json'), item.body)
        try:
            receipt = client.submit(item)
        except Exception as error:
            save_json(directory / 'setup-failure.json', {'policy': POLICY, 'document': item.document_id, 'stage': 'ingest',
                'errorType': type(error).__name__, 'requestSha256': digest(item.body), 'claim': 'setup failure; no automatic retry'})
            raise
        wire = receipt.wire(); save_bytes(directory / (item.document_id + '.receipt.json'), receipt.raw)
        receipts[item.document_id] = wire
        save_json(directory / (item.document_id + '.proof.json'), {'principal': item.principal, 'requestSha256': digest(item.body),
            'receiptSha256': digest(receipt.raw), 'sourceDigest': item.source_digest, 'bodyBytes': len(item.body)})
    save_json(directory / 'receipts.json', receipts)
    return receipts


@contextmanager
def phase_output(directory, manifest, phase):
    fresh_directory(directory)
    save_json(directory/'attempt.json', {'policy':POLICY,'phase':phase,'declaredInputs':{
        'owned':manifest.owned.sha256,'nativeConfig':manifest.native_config.sha256,
        'modelCatalog':manifest.model_catalog.sha256,'fixture':manifest.fixture.sha256},
        'claim':'declared bindings; validated by phase, not presumed verified'})
    try:
        yield
    except Exception as error:
        if not (directory/'setup-failure.json').exists():
            save_json(directory/'setup-failure.json',{'policy':POLICY,'stage':phase,'errorType':type(error).__name__,
                'code':str(error) if isinstance(error,SetupFailure) else 'external-I/O-or-integrity-error',
                'claim':'setup failure; no automatic retry or agent start'})
        raise


def provision_documents(manifest, fixture, directory, limits):
    with phase_output(directory,manifest,'provision'):
        client = TrustedIngestClient(manifest, limits, build_opener(ProxyHandler({}), NoRedirect()), ownership)
        return provision_with_client(client, manifest, fixture, directory, limits)


@dataclass(frozen=True)
class FingerprintTable:
    label: str
    table: str
    order: str
    columns: str


FINGERPRINT_TABLES = (
    FingerprintTable('sources','ch_sources','id','*'), FingerprintTable('generations','ch_generations','id','*'),
    FingerprintTable('chunks','ch_chunks','id','*'), FingerprintTable('searchChunks','ch_search_chunks','id','*'),
    FingerprintTable('profiles','ch_index_profiles','profile','*'), FingerprintTable('spaces','ch_embedding_spaces','id','*'),
    FingerprintTable('jobs','ch_jobs','id','id,session_id,revision,profile,state,run_id'),
    FingerprintTable('revisions','ch_revisions','session_id,revision','*'), FingerprintTable('revisionInfo','ch_revision_info','session_id,revision','*'),
    FingerprintTable('messages','ch_messages','session_id,revision,position','*'), FingerprintTable('passages','ch_problem_passages','generation,ordinal','*'),
    FingerprintTable('problemSpans','ch_problem_spans','generation,passage_id,ordinal','*'),
    FingerprintTable('contextSpans','ch_context_spans','generation,ordinal','*'), FingerprintTable('pieces','ch_problem_pieces','generation,piece_ordinal','*'),
    FingerprintTable('ownerTargets','ch_owner_targets','owner','*'), FingerprintTable('generationTags','ch_generation_tags','generation,tag','*'))


def fingerprint(sql: Callable[[str], str]):
    fields = []
    for table in FINGERPRINT_TABLES:
        row_hash = "encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex')"
        query = f"SELECT json_build_object('table','{table.table}','count',count(*),'sha256',encode(sha256(convert_to(COALESCE(string_agg({row_hash},'' ORDER BY {table.order}),''),'UTF8')),'hex')) FROM (SELECT {table.columns} FROM {table.table}) t"
        fields.append(f"'{table.label}',({query})")
    tables = decode(sql('SELECT /* workflow-v3:fingerprint */ json_build_object(' + ','.join(fields) + ');'))
    require(set(tables) == {t.label for t in FINGERPRINT_TABLES}, 'fingerprint-table-set-mismatch')
    for table in FINGERPRINT_TABLES:
        item = tables[table.label]
        require(set(item) == {'table','count','sha256'} and item['table'] == table.table and type(item['count']) is int and item['count'] >= 0
                and re.fullmatch('[0-9a-f]{64}', item['sha256']) is not None, 'invalid-table-digest')
    result = {'policy': FINGERPRINT_POLICY, 'tables': tables}
    return dict(result, sha256=digest(canonical(result)))


@dataclass(frozen=True)
class CoverageSpan:
    kind: str
    message_id: str
    position: int
    start: int
    end: int


def contains_range(start, end, ranges):
    cursor = start
    for low, high in sorted(ranges):
        if low > cursor:
            break
        cursor = max(cursor, high)
        if cursor >= end:
            return True
    return cursor >= end


def validate_coverage(document, required, spans):
    messages = document_messages(document)
    locations = {m['id']: (position, normalized_source_text(m['text'])) for position, m in enumerate(messages)}
    parsed = []
    for item in spans:
        require(item['kind'] in ('problem','context','chunk','search') and item['messageId'] in locations, 'unknown-coverage-source')
        position, text = locations[item['messageId']]
        require(type(item['messagePosition']) is int and item['messagePosition'] == position, 'coverage-position-mismatch')
        scalar_range(text, item['start'], item['end'])
        require(item['end'] > item['start'], 'nonempty-coverage-span-required')
        parsed.append(CoverageSpan(item['kind'], item['messageId'], position, item['start'], item['end']))
    def ranges(kind, mid):
        return [(s.start,s.end) for s in parsed if s.kind == kind and s.message_id == mid]
    for item in required:
        require(item['messageId'] in locations, 'unknown-required-source')
        _, text = locations[item['messageId']]; scalar_range(text,item['start'],item['end'])
        for kind in ('problem','chunk','search'):
            require(contains_range(item['start'],item['end'],ranges(kind,item['messageId'])), 'required-Problem-or-piece-coverage-missing')
    for mid in document['expectedProblem']:
        require(mid in locations and all(ranges(kind,mid) for kind in ('problem','chunk','search')), 'expected-Problem-message-unindexed')
    for mid in document['expectedContext']:
        require(mid in locations, 'unknown-expected-Context-message')
        _, text = locations[mid]; end = len(utf8(text))
        require(contains_range(0,end,ranges('context',mid)), 'expected-Context-coverage-missing')
        require(not any(low < end and high > 0 for kind in ('problem','chunk','search') for low,high in ranges(kind,mid)), 'Context-overlaps-Problem-or-search-piece')
    for context in (s for s in parsed if s.kind == 'context'):
        require(not any(s.message_id == context.message_id and s.start < context.end and context.start < s.end
                        for s in parsed if s.kind != 'context'), 'actual-Context-Problem-overlap')
    return {'requiredRanges': len(required), 'expectedContextMessages': len(document['expectedContext']),
            'spanCounts': {kind: sum(s.kind == kind for s in parsed) for kind in ('problem','context','chunk','search')}}


def validate_candidate_stats(stats):
    keys = {'eligiblePieces','poolPieces','badDimensions','badVectors','badLinks','distinctVectors','sessions'}
    require(set(stats) == keys and all(type(stats[k]) is int and stats[k] >= 0 for k in keys), 'invalid-candidate-counts')
    require(stats['eligiblePieces'] >= MIN_ELIGIBLE_PIECES, 'fewer-than-1001-eligible-Problem-pieces')
    require(stats['poolPieces'] >= stats['eligiblePieces'] and 1 <= stats['distinctVectors'] <= stats['eligiblePieces'], 'inconsistent-candidate-counts')
    require(stats['badDimensions'] == stats['badVectors'] == stats['badLinks'] == 0, 'invalid-vector-or-publication-links')


def literal(value):
    require(type(value) is str and '\x00' not in value, 'safe-SQL-string-required')
    return "'" + value.replace("'", "''") + "'"


def models(manifest):
    owned, config = manifest.configuration(); catalog = manifest.model_catalog.json()
    require(len(catalog['spaces']) == len(catalog['profiles']) == 1, 'single-bound-model-profile-required')
    embedding = config['embedding']; annotation = config['annotation']
    descriptor = ['embedding-space-v1',digest(utf8(embedding['endpoint'])),embedding['model'],embedding['revision'],embedding['dimensions'],
                  embedding['sendDimensions'],embedding['queryPrefix'],embedding['documentPrefix'],'cosine']
    require(type(embedding['dimensions']) is int and 1 <= embedding['dimensions'] <= 4000, 'invalid-embedding-dimensions')
    space = catalog['spaces'][0]; profile = catalog['profiles'][0]
    require(space['descriptor'] == descriptor and space['id'] == digest(json_bytes(descriptor)), 'bound-embedding-space-mismatch')
    require(profile['embedding_space'] == space['id'] and profile['policy'] == 'ContextAwareProblemsV1', 'bound-profile-policy-mismatch')
    desc = profile['descriptor']
    require(len(desc) == 3 and desc[0] == 'index-profile-descriptor-v1' and type(desc[2]) is str and bool(desc[2]), 'bound-profile-descriptor-mismatch')
    require(desc[1][:3] == [digest(utf8(annotation['endpoint'])),annotation['model'],annotation['revision']]
            and len(desc[1]) == 5 and desc[1][4] == str(annotation['maxResponseBytes']), 'bound-annotation-descriptor-mismatch')
    require(profile['profile'] == digest(json_bytes(['context-aware-problems-profile-v1',space['id'],desc])), 'bound-profile-identity-mismatch')
    return owned, config, profile, space


def publication_query(sid, job_id, request_id):
    return f"""SELECT /* workflow-v3:publication:{sid} */ json_build_object(
      'sessionId',s.id,'owner',s.owner,'revision',s.revision,'generationId',g.id,'publishedRevision',g.revision,
      'retired',g.retired,'tombstone',s.tombstone,'profile',g.profile,'format',g.passage_format,
      'project',r.metadata->>'project','source',r.source,'messageCount',r.message_count,
      'ownerEnabled',u.enabled,'ownerTarget',t.profile,'jobId',j.id,'jobState',j.state,'jobRevision',j.revision,
      'jobProfile',j.profile,'runId',j.run_id,'generationRunId',g.run_id,'completedWindows',j.completed_windows,'totalWindows',j.total_windows,
      'receiptMatches',EXISTS(SELECT 1 FROM ch_ingest_receipts ir WHERE ir.owner=s.owner AND ir.source_key=s.source_key
        AND ir.request_id={literal(request_id)}::uuid AND ir.result->>'sessionId'=s.id::text
        AND ir.result->>'jobId'=j.id::text AND (ir.result->>'revision')::int=g.revision),
      'chunkCount',(SELECT count(*) FROM ch_chunks c WHERE c.generation=g.id),
      'searchCount',(SELECT count(*) FROM ch_search_chunks sc WHERE sc.generation=g.id),
      'pieceCount',(SELECT count(*) FROM ch_problem_pieces pp WHERE pp.generation=g.id))
      FROM ch_sources s JOIN ch_generations g ON g.id=s.published AND g.session_id=s.id
      JOIN ch_revision_info r ON r.session_id=s.id AND r.revision=g.revision
      JOIN ch_users u ON u.id=s.owner JOIN ch_owner_targets t ON t.owner=s.owner
      JOIN ch_jobs j ON j.id={literal(job_id)}::uuid AND j.session_id=s.id
      WHERE s.id={literal(sid)}::uuid;"""


def source_query(sid, revision):
    return f"""SELECT /* workflow-v3:source:{sid} */ COALESCE(json_agg(json_build_object(
      'messageId',message_id,'valueId',value->>'id','position',position,'recordIndex',(value->>'recordIndex')::int,
      'role',value->>'role','bytes',octet_length(value->>'text'),
      'sha256',encode(sha256(convert_to(value->>'text','UTF8')),'hex')) ORDER BY position),'[]')
      FROM ch_messages WHERE session_id={literal(sid)}::uuid AND revision={revision};"""


def spans_query(sid, generation, revision):
    return f"""SELECT /* workflow-v3:spans:{sid} */ COALESCE(json_agg(row_to_json(q) ORDER BY kind,\"messagePosition\",start,\"end\"),'[]') FROM (
      SELECT 'problem' AS kind,message_id AS \"messageId\",message_position AS \"messagePosition\",start_byte AS start,end_byte AS \"end\"
        FROM ch_problem_spans WHERE generation={literal(generation)}::uuid
      UNION ALL SELECT 'context',message_id,message_position,start_byte,end_byte FROM ch_context_spans WHERE generation={literal(generation)}::uuid
      UNION ALL SELECT 'chunk',sp->>'messageId',m.position,(sp->>'start')::int,(sp->>'end')::int
        FROM ch_chunks c CROSS JOIN LATERAL jsonb_array_elements(c.value->'spans') sp
        LEFT JOIN ch_messages m ON m.session_id={literal(sid)}::uuid AND m.revision={revision} AND m.message_id=sp->>'messageId'
        WHERE c.generation={literal(generation)}::uuid
      UNION ALL SELECT 'search',sp->>'messageId',m.position,(sp->>'start')::int,(sp->>'end')::int
        FROM ch_search_chunks sc JOIN ch_chunks c ON c.id=sc.id AND c.generation=sc.generation
        CROSS JOIN LATERAL jsonb_array_elements(c.value->'spans') sp
        LEFT JOIN ch_messages m ON m.session_id={literal(sid)}::uuid AND m.revision={revision} AND m.message_id=sp->>'messageId'
        WHERE sc.generation={literal(generation)}::uuid) q;"""


def checkpoints_query(sid, job, run_id):
    return f"""SELECT /* workflow-v3:checkpoints:{sid} */ COALESCE(json_agg(row_to_json(q) ORDER BY stage),'[]') FROM (
      SELECT stage,count(*) AS parts,count(DISTINCT window_ordinal) AS windows,min(window_ordinal) AS first,max(window_ordinal) AS last,
        sum(CASE WHEN stage='Embedding' THEN jsonb_array_length(value::jsonb) ELSE 0 END) AS vectors
      FROM ch_index_checkpoints WHERE job_id={literal(job)}::uuid AND run_id={literal(run_id)}::uuid GROUP BY stage) q;"""


def candidate_query(project, profile, space, dimensions, session_ids):
    known = ','.join(literal(sid) + '::uuid' for sid in session_ids)
    return f"""WITH /* workflow-v3:candidates */ pool AS (
      SELECT sc.id,sc.session_id,sc.embedding,vector_dims(sc.embedding) AS dims,vector_dims(c.embedding) AS source_dims,
        vector_norm(sc.embedding) AS norm,vector_norm(c.embedding) AS source_norm,g.retired,
        p.embedding_space={literal(space)} AS compatible,
        (c.id IS NULL OR pp.chunk_id IS NULL OR c.generation<>sc.generation OR sc.profile<>g.profile
         OR p.embedding_space IS DISTINCT FROM {literal(space)} OR g.profile<>{literal(profile)} OR g.retired
         OR sc.embedding::text IS DISTINCT FROM c.embedding::text OR s.id NOT IN ({known})) AS bad_link
      FROM ch_search_chunks sc JOIN ch_sources s ON s.id=sc.session_id AND s.published=sc.generation
      JOIN ch_generations g ON g.id=sc.generation AND g.session_id=s.id AND g.revision=sc.revision
      JOIN ch_revision_info r ON r.session_id=s.id AND r.revision=sc.revision
      LEFT JOIN ch_chunks c ON c.id=sc.id LEFT JOIN ch_problem_pieces pp ON pp.generation=sc.generation AND pp.chunk_id=sc.id
      LEFT JOIN ch_index_profiles p ON p.profile=sc.profile
      WHERE EXISTS(SELECT 1 FROM ch_users ou WHERE ou.id=s.owner AND ou.enabled)
        AND EXISTS(SELECT 1 FROM ch_users ru WHERE ru.id='reader' AND ru.enabled)
        AND (s.owner='reader' OR EXISTS(SELECT 1 FROM ch_members a JOIN ch_members b ON a.group_id=b.group_id WHERE a.user_id='reader' AND b.user_id=s.owner))
        AND NOT s.tombstone AND r.metadata->>'project'={literal(project)})
      SELECT json_build_object('poolPieces',count(*),
        'eligiblePieces',count(*) FILTER(WHERE compatible AND dims={dimensions} AND NOT retired),
        'badDimensions',count(*) FILTER(WHERE dims<>{dimensions} OR source_dims IS DISTINCT FROM {dimensions}),
        'badVectors',count(*) FILTER(WHERE norm IS NULL OR NOT(norm>0 AND norm<'Infinity'::float8) OR source_norm IS NULL OR NOT(source_norm>0 AND source_norm<'Infinity'::float8)),
        'badLinks',count(*) FILTER(WHERE bad_link),
        'distinctVectors',count(DISTINCT embedding::text) FILTER(WHERE compatible AND dims={dimensions} AND NOT retired),
        'sessions',count(DISTINCT session_id) FILTER(WHERE compatible AND dims={dimensions} AND NOT retired)) FROM pool;"""


class ReadBridge(Protocol):
    def call(self, name: str, arguments: dict, principal: str) -> dict: ...


def provenance(manifest):
    owned, _ = manifest.configuration()
    return {'policy': POLICY, 'manifestSha256': manifest.owned.sha256, 'configSha256': manifest.native_config.sha256,
            'modelCatalogSha256': manifest.model_catalog.sha256, 'profileSha256': owned['profileSha256'],
            'sourceProofScope': 'trusted owner source fingerprints; NOT agent-observed source evidence'}


def verify_with_bridge(sql, manifest, fixture, fixture_sha, receipts, output, rubric, bridge):
    manifest.verify_fixture(fixture)
    require(bool(fixture['documents']), 'nonempty-fixture-required')
    require(fixture_sha == manifest.fixture_sha256 and rubric['fixtureSha256'] == fixture_sha
            and rubric['policy'] == 'evidence-assessment-v3', 'fixture-rubric-binding-mismatch')
    require(set(receipts) == {d['id'] for d in fixture['documents']}, 'exact-receipt-set-required')
    owned, config, profile, space = models(manifest); project = 'relevance-' + owned['runId']
    for principal in sorted(PRINCIPALS):
        read_token(token_path(owned,config,principal,'Read'))
        user = bridge.call('whoami',{},principal)['user']
        require(user['id'] == principal and user['scopes'] == ['Read'], 'public-Read-principal-scope-mismatch')
    catalog = {}; documents = {}; sessions = set(); probes = []
    for doc in fixture['documents']:
        identifier(doc['id']); require(doc['principal'] in PRINCIPALS, 'closed-document-principal-required')
        receipt = IngestReceipt.parse(receipts[doc['id']],uuid_text(receipts[doc['id']]['requestId']))
        require(receipt.session_id not in sessions, 'duplicate-receipt-session'); sessions.add(receipt.session_id)
        meta_sql = publication_query(receipt.session_id,receipt.job_id,receipt.request_id)
        meta = decode(sql(meta_sql)); require(meta is not None, 'publication-not-ready')
        generation = uuid_text(meta['generationId'])
        require(meta['sessionId'] == receipt.session_id and meta['owner'] == doc['principal'] and meta['ownerEnabled'] is True
                and meta['revision'] == meta['publishedRevision'] == meta['jobRevision'] == receipt.revision
                and meta['retired'] is False and meta['tombstone'] is False and meta['receiptMatches'] is True, 'publication-source-receipt-mismatch')
        require(meta['profile'] == meta['jobProfile'] == meta['ownerTarget'] == profile['profile']
                and meta['format'] == 'ContextAwareProblems' and meta['project'] == project
                and meta['jobId'] == receipt.job_id and meta['jobState'] == 'Complete', 'publication-profile-job-project-mismatch')
        expected_source = {'collectorNamespace':'context-eval-v3','discoveryRootId':'synthetic','format':'Pi',
                           'producerSessionId':owned['runId']+'-'+doc['id'],'subagentId':None}
        require(meta['source'] == expected_source, 'source-namespace-mismatch')
        require(type(meta['totalWindows']) is int and meta['totalWindows'] >= 0 and meta['completedWindows'] == meta['totalWindows']
                and uuid_text(meta['runId']) == uuid_text(meta['generationRunId']), 'accepted-window-progress-mismatch')
        require(meta['chunkCount'] == meta['searchCount'] == meta['pieceCount'], 'Problem-piece-projection-count-mismatch')
        actual = decode(sql(source_query(receipt.session_id,receipt.revision)))
        expected = [f.wire() for f in source_fingerprints(doc)]
        require(meta['messageCount'] == len(expected) and len(actual) == len(expected), 'source-message-count-mismatch')
        for row, wanted in zip(actual,expected):
            require(row['valueId'] == wanted['messageId'] and row['recordIndex'] == wanted['position']
                    and {k:row[k] for k in wanted} == wanted, 'source-fingerprint-role-order-mismatch')
        spans = decode(sql(spans_query(receipt.session_id,generation,receipt.revision)))
        required = [r for entry in rubric['tasks'].values() for prop in entry['propositions']
                    for key in ('anchorsAny','qualifiersAll') for r in prop[key] if r['document'] == doc['id']]
        coverage = validate_coverage(doc,required,spans)
        checkpoints = decode(sql(checkpoints_query(receipt.session_id,receipt.job_id,meta['runId'])))
        annotation = [c for c in checkpoints if c['stage'] == 'Annotation']
        require(len(annotation) == 1 and annotation[0]['windows'] == annotation[0]['parts'] == meta['totalWindows']
                and annotation[0]['first'] == 0 and annotation[0]['last'] == meta['totalWindows']-1, 'accepted-annotation-checkpoints-mismatch')
        embedding = [c for c in checkpoints if c['stage'] == 'Embedding']
        require(all(c['stage'] in ('Annotation','Embedding') for c in checkpoints), 'unknown-accepted-checkpoint-stage')
        if meta['pieceCount']:
            require(len(embedding) == 1 and embedding[0]['vectors'] == meta['pieceCount']
                    and embedding[0]['parts'] >= embedding[0]['windows'] > 0
                    and 0 <= embedding[0]['first'] <= embedding[0]['last'] < meta['totalWindows'], 'accepted-embedding-checkpoints-mismatch')
        else:
            require(not embedding, 'unexpected-empty-publication-embedding-work')
        view = {'revision':receipt.revision,'generationId':generation}
        args = {'sessionId':receipt.session_id,'revision':view['revision'],'generationId':generation,'offset':0,'limit':1}
        page = bridge.call('get_chunks',args,doc['principal'])
        probes.append((doc['principal'], {'taskId':'trusted-preflight','tool':'get_chunks','arguments':args,'result':page}))
        require(page['view'] == view and page['offset'] == 0 and page['total'] == meta['chunkCount'], 'public-MCP-pin-piece-count-mismatch')
        catalog[doc['id']] = {'sessionId':receipt.session_id,'view':view,'principal':doc['principal'],'jobId':receipt.job_id}
        documents[doc['id']] = {'sourceFingerprints':expected,'coverage':coverage,'acceptedCheckpoints':checkpoints,
                              'totalWindows':meta['totalWindows'],'pieceCount':meta['pieceCount']}
        # Ensure current publication did not change while its projections were checked.
        require(decode(sql(meta_sql)) == meta, 'publication-changed-during-preflight')
    try:
        for task in fixture['tasks']:
            propositions_for(fixture,rubric,task,FrozenSources.from_fixture(fixture,catalog,task['principal']),catalog,fixture_sha)
    except (ValueError,KeyError,TypeError) as error:
        raise SetupFailure('frozen-rubric-source-binding-invalid') from error
    stats = decode(sql(candidate_query(project,profile['profile'],space['id'],config['embedding']['dimensions'],sorted(sessions))))
    validate_candidate_stats(stats)
    frozen = FrozenSources.from_fixture(fixture,catalog,'reader')
    # Validate actual small MCP probes separately from model traces and source proofs.
    for owner,event in probes:
        observe_trace('trusted-preflight',[event],frozen if owner == 'reader' else FrozenSources.from_fixture(fixture,catalog,owner))
    proof = {'policy':POLICY,'status':'Eligible','candidateStats':stats,'documents':documents,'project':project,
             'profile':profile['profile'],'embeddingSpace':space['id'],'embeddingDimensions':config['embedding']['dimensions'],
             'modelCatalogSha256':manifest.model_catalog.sha256,'limits':{'minimumEligiblePieces':MIN_ELIGIBLE_PIECES},
             'claim':'setup source/index eligibility only; not model quality, general ACL or HNSW physical-index proof'}
    published = {'fixtureSha256':fixture_sha,'documents':catalog,'indexCoverage':1.0,'provenance':provenance(manifest)}
    save_json(output/'catalog.json',published); save_json(output/'eligibility.json',proof)
    return published,proof


def verify_publication(sql, manifest, fixture, fixture_sha, receipts, output, rubric):
    with phase_output(output,manifest,'publication'):
        manifest.verify_fixture(fixture); owned,_ = manifest.configuration()
        bridge = Bridge(owned,output,'trusted-preflight',False,search_mode='lexical',related_policy='deny')
        try:
            return verify_with_bridge(sql,manifest,fixture,fixture_sha,receipts,output,rubric,bridge)
        finally:
            bridge.close()


def fixed_with_bridge(bridge, manifest, fixture, task, mode, catalog, output):
    manifest.verify_fixture(fixture)
    owned,config = manifest.configuration()
    require(mode in MODES and task in fixture['tasks'] and task['principal'] in PRINCIPALS, 'explicit-fixed-task-mode-required')
    require(catalog['fixtureSha256'] == manifest.fixture_sha256 and catalog['provenance'] == provenance(manifest), 'fixed-catalog-binding-mismatch')
    require(fixture['fixedQueryPolicy'] == 'lexical-curated-keywords-semantic-hybrid-natural-question-v1'
            and set(task['fixedQueries']) == MODES, 'explicit-mode-specific-fixed-query-required')
    read_token(token_path(owned,config,task['principal'],'Read'))
    request = {'query':task['fixedQueries'][mode],'mode':mode,'limit':5,'offset':0,'project':'relevance-'+owned['runId']}
    result = bridge.call('search_sessions',request,task['principal'])
    wrapper = {'request':request,'result':result}
    save_json(output/'fixed-retrieval-v3.json',wrapper); save_json(output/'retrieval.json',result); save_json(output/'request.json',request)
    return wrapper


def fixed_retrieval(manifest, fixture, task, mode, catalog, output):
    with phase_output(output,manifest,'fixed-retrieval'):
        manifest.verify_fixture(fixture); owned,_ = manifest.configuration()
        bridge = Bridge(owned,output,task['id'],False,search_mode=mode,related_policy='deny')
        try:
            return fixed_with_bridge(bridge,manifest,fixture,task,mode,catalog,output)
        finally:
            bridge.close()
