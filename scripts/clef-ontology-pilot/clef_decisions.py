"""Source-bound, text-only native decision requests. No graph writes or retries."""
from dataclasses import asdict, dataclass
import hashlib
import http.client
import ipaddress
import json
import math
import socket
import threading
import time
from typing import Protocol
from urllib.parse import urlsplit

MODEL = 'Cloudflare/clef'
MAX_CHOICE_OPTIONS = 255
MASS_TOLERANCE = 1e-6
SYSTEM = ('Read the complete state and schema. Decide every field jointly. Each answer '
          "must be exactly one of that field's allowed options.")
PREFIX = f'<|im_start|>system\n{SYSTEM}<|im_end|>\n<|im_start|>user\nSTATE:\n'
SUFFIX = '\n<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\nJOINT SCHEMA DECISIONS:'

class InvalidDecision(ValueError):
    pass

class InputTooLarge(InvalidDecision):
    pass

class Tokenizer(Protocol):
    def encode(self, text: str, *, add_special_tokens: bool) -> list[int]: ...

@dataclass(frozen=True)
class Binding:
    scope: str
    frontier: str
    graph_revision: int
    candidates_revision: str
    schema_revision: str
    source_sha256: str

@dataclass(frozen=True)
class Option:
    id: str
    description: str

@dataclass(frozen=True)
class Question:
    id: str
    instructions: str
    options: tuple[Option, ...]

@dataclass(frozen=True)
class DecisionBatch:
    binding: Binding
    evidence: str
    questions: tuple[Question, ...]

@dataclass(frozen=True)
class Limits:
    prompt_tokens: int
    timeout_seconds: float
    response_bytes: int

@dataclass(frozen=True)
class Prepared:
    batch: DecisionBatch
    body: bytes
    sha256: str
    untruncated_input_tokens: int

@dataclass(frozen=True)
class HttpResult:
    status: int | None
    body: bytes
    elapsed_ns: int
    error: str | None

class Transport(Protocol):
    def send(self, body: bytes) -> HttpResult: ...

@dataclass(frozen=True)
class Capture:
    prepared: Prepared
    http: HttpResult

@dataclass(frozen=True)
class Probability:
    option: str
    value: float

@dataclass(frozen=True)
class Answer:
    question: str
    selected: str
    probabilities: tuple[Probability, ...]
    backend_confidence: float
    maximum_probability: float
    margin: float

@dataclass(frozen=True)
class DecisionAssessment:
    binding: Binding
    request_sha256: str
    response_sha256: str
    answers: tuple[Answer, ...]
    input_tokens: int
    output_tokens: int
    eligible: bool


def render(value: object) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def nonempty(value: object) -> bool:
    return type(value) is str and bool(value.strip()) and '\x00' not in value


def validate(batch: DecisionBatch, limits: Limits, current: Binding) -> None:
    if batch.binding != current:
        raise InvalidDecision('stale-binding')
    if type(limits.prompt_tokens) is not int or limits.prompt_tokens <= 0 or type(limits.response_bytes) is not int or limits.response_bytes <= 0:
        raise InvalidDecision('invalid-limits')
    if type(limits.timeout_seconds) not in (int, float) or not math.isfinite(limits.timeout_seconds) or limits.timeout_seconds <= 0:
        raise InvalidDecision('invalid-deadline')
    b = batch.binding
    if not all(nonempty(v) for v in (b.scope, b.frontier, b.candidates_revision, b.schema_revision)) or type(b.graph_revision) is not int or b.graph_revision < 0:
        raise InvalidDecision('invalid-binding')
    if type(batch.evidence) is not str or hashlib.sha256(batch.evidence.encode()).hexdigest() != b.source_sha256:
        raise InvalidDecision('source-binding')
    if not batch.questions or len({q.id for q in batch.questions}) != len(batch.questions):
        raise InvalidDecision('question-identity')
    for q in batch.questions:
        if not nonempty(q.id) or not nonempty(q.instructions) or not 1 <= len(q.options) <= MAX_CHOICE_OPTIONS:
            raise InvalidDecision('question-shape')
        if len({o.id for o in q.options}) != len(q.options) or not all(nonempty(o.id) and nonempty(o.description) for o in q.options):
            raise InvalidDecision('option-shape')


def pieces(batch: DecisionBatch) -> tuple[str, ...]:
    state = render({'binding': asdict(batch.binding), 'evidence': batch.evidence})
    schema = ['\n\nSCHEMA FIELDS:\n']
    for index, q in enumerate(batch.questions):
        schema.extend([f'\nFIELD {index + 1}\nID: {q.id}\nTYPE: choice\nINSTRUCTION: ', q.instructions, '\nALLOWED OPTIONS:\n'])
        for option_index, option in enumerate(sorted(q.options, key=lambda o: o.id)):
            schema.extend([f'OPTION {option_index + 1}: ', render({'option_id': option.id, 'description': option.description}), '\n'])
        schema.append('END FIELD\n')
    return (PREFIX, state, *schema, SUFFIX)


def prepare(batch: DecisionBatch, tokenizer: Tokenizer, limits: Limits, current: Binding) -> Prepared:
    validate(batch, limits, current)
    count = sum(len(tokenizer.encode(piece, add_special_tokens=False)) for piece in pieces(batch))
    if count > limits.prompt_tokens:
        raise InputTooLarge('full-input-exceeds-deployed-prompt-cap')
    state = render({'binding': asdict(batch.binding), 'evidence': batch.evidence})
    questions = {q.id: {'type': 'choice', 'instructions': q.instructions, 'criteria': {o.id: o.description for o in q.options}} for q in batch.questions}
    body = json.dumps({'model': MODEL, 'state': state, 'questions': questions}, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    return Prepared(batch, body, hashlib.sha256(body).hexdigest(), count)


class LoopbackTransport:
    def __init__(self, endpoint: str, limits: Limits):
        parsed = urlsplit(endpoint)
        if parsed.scheme != 'http' or parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment or parsed.path != '/v1/systemone':
            raise InvalidDecision('endpoint')
        try:
            if not ipaddress.ip_address(parsed.hostname).is_loopback:
                raise InvalidDecision('not-loopback')
            port = parsed.port
        except (ValueError, TypeError) as error:
            raise InvalidDecision('endpoint-address') from error
        if port is None:
            raise InvalidDecision('explicit-port-required')
        self.host, self.port, self.limits = parsed.hostname, port, limits

    def send(self, body: bytes) -> HttpResult:
        start = time.monotonic_ns()
        connection = http.client.HTTPConnection(self.host, self.port, timeout=self.limits.timeout_seconds)
        status = None
        raw = b''
        error = None
        deadline = start + int(self.limits.timeout_seconds * 1_000_000_000)
        expired = threading.Event()
        timer = None
        cancellation_socket = None
        try:
            connection.connect()
            if time.monotonic_ns() >= deadline:
                raise TimeoutError('request deadline')
            # HTTPResponse may retain the socket after HTTPConnection releases it.
            cancellation_socket = connection.sock.dup()
            def expire():
                expired.set()
                try:
                    cancellation_socket.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            timer = threading.Timer((deadline - time.monotonic_ns()) / 1_000_000_000, expire)
            timer.start()
            connection.request('POST', '/v1/systemone', body, {'Content-Type': 'application/json', 'Connection': 'close'})
            response = connection.getresponse()
            status = response.status
            while len(raw) <= self.limits.response_bytes:
                block = response.read1(min(65536, self.limits.response_bytes + 1 - len(raw)))
                if not block:
                    if response.length is not None and response.length > 0:
                        raise http.client.IncompleteRead(raw)
                    break
                raw += block
            if len(raw) > self.limits.response_bytes:
                raw = raw[:self.limits.response_bytes]
                error = 'response-size-bound'
        except (OSError, http.client.HTTPException) as failure:
            error = type(failure).__name__
        finally:
            if timer is not None:
                timer.cancel()
                timer.join()
            if cancellation_socket is not None:
                cancellation_socket.close()
            connection.close()
        if expired.is_set() or time.monotonic_ns() >= deadline:
            error = 'request-deadline'
        return HttpResult(status, raw, time.monotonic_ns() - start, error)


class DecisionClient:
    def __init__(self, transport: Transport, tokenizer: Tokenizer, limits: Limits):
        self.transport, self.tokenizer, self.limits = transport, tokenizer, limits

    def invoke(self, batch: DecisionBatch, current: Binding) -> Capture:
        prepared = prepare(batch, self.tokenizer, self.limits, current)
        return Capture(prepared, self.transport.send(prepared.body))


def unique(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result = {}
    for key, value in pairs:
        if key in result:
            raise InvalidDecision('duplicate-json-key')
        result[key] = value
    return result


def constant(value: str) -> object:
    raise InvalidDecision('nonfinite-json')


def number(value: object) -> float:
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
        raise InvalidDecision('probability-domain')
    return float(value)


def assess(capture: Capture, current: Binding) -> DecisionAssessment:
    prepared, http = capture.prepared, capture.http
    if prepared.batch.binding != current:
        raise InvalidDecision('stale-binding')
    if http.error is not None or http.status != 200:
        raise InvalidDecision('transport-unavailable')
    try:
        obj = json.loads(http.body, object_pairs_hook=unique, parse_constant=constant)
        if type(obj) is not dict or obj['model'] != MODEL or type(obj['answers']) is not dict or set(obj['answers']) != {q.id for q in prepared.batch.questions}:
            raise InvalidDecision('response-identity')
        usage = obj['usage']
        if type(usage) is not dict or type(usage['input_tokens']) is not int or usage['input_tokens'] != prepared.untruncated_input_tokens or type(usage['output_tokens']) is not int or usage['output_tokens'] != 0:
            raise InvalidDecision('input-completeness-or-usage-unavailable')
        answers = []
        for q in prepared.batch.questions:
            answer = obj['answers'][q.id]
            if type(answer) is not dict or answer['type'] != 'choice' or type(answer['probabilities']) is not dict or set(answer['probabilities']) != {o.id for o in q.options}:
                raise InvalidDecision('answer-shape')
            scores = tuple(Probability(o.id, number(answer['probabilities'][o.id])) for o in q.options)
            if abs(math.fsum(p.value for p in scores) - 1) > MASS_TOLERANCE:
                raise InvalidDecision('probability-mass')
            ranked = sorted((p.value for p in scores), reverse=True)
            if answer['choice'] not in {p.option for p in scores if p.value == ranked[0]}:
                raise InvalidDecision('choice-not-argmax')
            confidence = number(answer['confidence'])
            margin = ranked[0] - ranked[1] if len(ranked) > 1 else ranked[0]
            answers.append(Answer(q.id, answer['choice'], scores, confidence, ranked[0], margin))
        return DecisionAssessment(current, prepared.sha256, hashlib.sha256(http.body).hexdigest(), tuple(answers), usage['input_tokens'], usage['output_tokens'], False)
    except (KeyError, TypeError, ValueError, OverflowError, RecursionError) as failure:
        if isinstance(failure, InvalidDecision):
            raise
        raise InvalidDecision('invalid-response') from failure
