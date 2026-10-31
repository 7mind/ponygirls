"""Frozen, authorized UTF-8 source observations; evaluator-only, never agent input."""
from dataclasses import dataclass
from typing import Literal
from text_presentation_v1 import PresentationIntegrityError, source_arguments

MAX_ANCHOR = 2048
MAX_SIDE = 2048
MAX_NEIGHBORS = 4
MAX_EXCERPTS = 9
MAX_RESULT_BYTES = 131072
DEFAULT_LEGACY_PAGE_OFFSET = 0
DEFAULT_LEGACY_PAGE_LIMIT = 20
MAX_LEGACY_PAGE_LIMIT = 100
MAX_LEGACY_PAGE_OFFSET = 2147483647
UTF8_CONTINUATION_MASK = 0xC0
UTF8_CONTINUATION_PREFIX = 0x80


class EvidenceIntegrityError(ValueError):
    """A recognized successful source result contradicts its frozen source."""


def require(condition, message):
    if not condition:
        raise EvidenceIntegrityError(message)


def utf8(text):
    require(type(text) is str, 'source text must be a string')
    try:
        return text.encode('utf-8')
    except UnicodeEncodeError as error:
        raise EvidenceIntegrityError('source contains a non-scalar Unicode value') from error


def normalized_source_text(text):
    utf8(text)
    return text.replace('\x00', r'\u0000')


def scalar_range(text, start, end):
    raw = utf8(text)
    require(type(start) is int and type(end) is int and 0 <= start <= end <= len(raw), 'invalid UTF-8 range')
    # Decoding an empty slice alone cannot detect an interior scalar endpoint.
    require(all(point == len(raw) or (raw[point] & UTF8_CONTINUATION_MASK) != UTF8_CONTINUATION_PREFIX
                for point in (start, end)), 'range cuts a Unicode scalar')
    try:
        return raw[start:end].decode('utf-8')
    except UnicodeDecodeError as error:
        raise EvidenceIntegrityError('range cuts a Unicode scalar') from error


@dataclass(frozen=True)
class View:
    revision: int
    generation_id: str | None

    @classmethod
    def parse(cls, value):
        require(type(value) is dict and set(value) == {'revision', 'generationId'}, 'exact ContentView required')
        require(type(value['revision']) is int and value['revision'] > 0, 'positive view revision required')
        generation = value['generationId']
        require(generation is None or type(generation) is str and bool(generation), 'explicit generationId required')
        return cls(value['revision'], generation)

    def wire(self):
        return {'revision': self.revision, 'generationId': self.generation_id}


@dataclass(frozen=True)
class FrozenMessage:
    document: str
    session_id: str
    view: View
    message_id: str
    position: int
    role: str
    text: str


@dataclass(frozen=True)
class FrozenSources:
    principal: str
    messages: tuple[FrozenMessage, ...]
    # Keep unauthorized identities for explicit ACL diagnostics, never evidence.
    unauthorized_sessions: frozenset[str]

    @classmethod
    def from_fixture(cls, fixture, catalog, principal):
        require(principal in {doc['principal'] for doc in fixture['documents']}, 'unknown principal')
        messages = []; unauthorized = set(); sessions = set()
        require(set(catalog) == {doc['id'] for doc in fixture['documents']}, 'exact catalog document set required')
        for doc in fixture['documents']:
            published = catalog[doc['id']]; sid = published['sessionId']; view = View.parse(published['view'])
            require(type(sid) is str and sid and sid not in sessions, 'unique catalog session identity required')
            sessions.add(sid)
            if doc['principal'] != principal:
                unauthorized.add(sid)
                continue
            padding = [{'id': f'padding-{n}', 'text': f'Routine heartbeat {n}; no decision recorded.'}
                       for n in range(doc.get('paddingBefore', 0))]
            ids = set()
            for position, message in enumerate(padding + doc['messages']):
                mid = message['id']; role = message.get('role', 'user')
                require(type(mid) is str and mid and mid not in ids, 'unique message identity required')
                ids.add(mid)
                require(type(role) is str and bool(role), 'nonempty source role required')
                text = normalized_source_text(message['text'])
                utf8(text)
                messages.append(FrozenMessage(doc['id'], sid, view, mid, position, role, text))
        return cls(principal, tuple(messages), frozenset(unauthorized))

    def session(self, session_id, view):
        require(session_id not in self.unauthorized_sessions, 'unauthorized source session')
        result = tuple(m for m in self.messages if m.session_id == session_id and m.view == view)
        require(bool(result), 'unknown source session or wrong exact pin')
        return result

    def message(self, session_id, view, message_id):
        return next((m for m in self.session(session_id, view) if m.message_id == message_id), None)

    def resolve(self, session_id, view, message_id):
        message = self.message(session_id, view, message_id)
        require(message is not None, 'unknown source message')
        return message


@dataclass(frozen=True)
class SourceObservation:
    task_id: str
    trace_index: int
    tool: str
    session_id: str
    view: View
    message_id: str
    message_position: int
    role: str
    start: int
    end: int
    text: str
    kind: Literal['whole-message', 'context-excerpt', 'verbatim-snippet']

    def wire(self):
        return {'taskId': self.task_id, 'traceIndex': self.trace_index, 'tool': self.tool, 'sessionId': self.session_id,
                'view': self.view.wire(), 'messageId': self.message_id, 'messagePosition': self.message_position,
                'role': self.role, 'start': self.start, 'end': self.end, 'text': self.text, 'kind': self.kind}


@dataclass(frozen=True)
class SourceDiagnostic:
    trace_index: int
    tool: str
    code: str
    detail: str


@dataclass(frozen=True)
class ObservationSet:
    observations: tuple[SourceObservation, ...]
    diagnostics: tuple[SourceDiagnostic, ...]


@dataclass(frozen=True)
class CitationOccurrence:
    session_id: str
    view: View
    message_id: str
    start: int
    end: int
    trace_indices: tuple[int, ...]

    def wire(self):
        return {'sessionId': self.session_id, 'view': self.view.wire(), 'messageId': self.message_id,
                'start': self.start, 'end': self.end, 'traceIndices': list(self.trace_indices)}


def observation(task_id, index, tool, source, start, end, text, role, kind):
    require(role == source.role, 'source role mismatch')
    require(scalar_range(source.text, start, end) == text, 'source text/range mismatch')
    return SourceObservation(task_id, index, tool, source.session_id, source.view, source.message_id,
                             source.position, role, start, end, text, kind)


def validate_span(value, resolved):
    keys = {'messageId', 'start', 'end'} | ({'messagePosition'} if resolved else set())
    require(type(value) is dict and set(value) == keys, 'exact source span fields required')
    require(type(value['messageId']) is str and bool(value['messageId']), 'nonempty span message identity required')
    require(all(type(value[key]) is int for key in ('start', 'end')), 'integer source endpoints required')
    require(0 <= value['start'] <= value['end'], 'invalid source span order')
    if resolved:
        require(type(value['messagePosition']) is int and value['messagePosition'] >= 0, 'integer messagePosition required')


def span(source, start, end, position):
    result = {'messageId': source.message_id, 'start': start, 'end': end}
    if position:
        result['messagePosition'] = source.position
    return result


def take_suffix(text, end, budget):
    start = end
    for char in reversed(scalar_range(text, 0, end)):
        size = len(utf8(char))
        if size > budget:
            break
        budget -= size; start -= size
    return start, budget


def take_prefix(text, start, budget):
    end = start
    for char in scalar_range(text, start, len(utf8(text))):
        size = len(utf8(char))
        if size > budget:
            break
        budget -= size; end += size
    return end, budget


def expected_context(messages, anchor, before, after):
    """Pure fixture oracle for scalar-bounded nearest-first navigation."""
    source = next((m for m in messages if m.message_id == anchor['messageId']), None)
    require(source is not None, 'unknown anchor message')
    start = anchor['start']; end = anchor['end']; scalar_range(source.text, start, end)
    require(end - start <= MAX_ANCHOR, 'anchor exceeds context bound')
    left, left_budget = take_suffix(source.text, start, before)
    right, right_budget = take_prefix(source.text, end, after)
    excerpts = [(source, left, right)]
    if before and left == 0:
        for neighbor in reversed(messages[max(0, source.position - MAX_NEIGHBORS):source.position]):
            low, left_budget = take_suffix(neighbor.text, len(utf8(neighbor.text)), left_budget)
            # A non-fitting scalar is not skipped to reach a farther message.
            if low == len(utf8(neighbor.text)) and neighbor.text:
                break
            excerpts.insert(0, (neighbor, low, len(utf8(neighbor.text))))
            if low > 0:
                break
    if after and right == len(utf8(source.text)):
        for neighbor in messages[source.position + 1:source.position + MAX_NEIGHBORS + 1]:
            high, right_budget = take_prefix(neighbor.text, 0, right_budget)
            if high == 0 and neighbor.text:
                break
            excerpts.append((neighbor, 0, high))
            if high < len(utf8(neighbor.text)):
                break
    first, low, _ = excerpts[0]; last, _, high = excerpts[-1]
    previous = span(first, low, low, False) if low > 0 or first.position > 0 else None
    following = span(last, high, high, False) if high < len(utf8(last.text)) or last.position + 1 < len(messages) else None
    return source, excerpts, previous, following


def context_observations(task_id, index, args, result, sources):
    import json
    require(set(args) == {'sessionId', 'view', 'anchor', 'beforeBytes', 'afterBytes'}, 'exact context arguments required')
    require(set(result) == {'sessionId', 'view', 'anchor', 'excerpts', 'previous', 'next'}, 'exact context result required')
    validate_span(args['anchor'], False)
    validate_span(result['anchor'], True)
    for key in ('beforeBytes', 'afterBytes'):
        value = args[key]
        require(type(value) is int and (value == 0 or 4 <= value <= MAX_SIDE), 'invalid context side budget')
    view = View.parse(args['view']); sid = args['sessionId']
    require(result['sessionId'] == sid and View.parse(result['view']) == view, 'context request/result identity mismatch')
    require(len(utf8(json.dumps(result, ensure_ascii=False, separators=(',', ':')))) <= MAX_RESULT_BYTES, 'context result exceeds serialized bound')
    source, expected, previous, following = expected_context(sources.session(sid, view), args['anchor'], args['beforeBytes'], args['afterBytes'])
    require(result['anchor'] == span(source, args['anchor']['start'], args['anchor']['end'], True), 'resolved anchor mismatch')
    require(type(result['excerpts']) is list and 1 <= len(result['excerpts']) <= MAX_EXCERPTS, 'invalid excerpt count')
    require(len(result['excerpts']) == len(expected), 'context omitted or fabricated excerpt')
    observations = []
    for excerpt, (message, start, end) in zip(result['excerpts'], expected):
        require(set(excerpt) == {'source', 'role', 'text'}, 'exact excerpt fields required')
        validate_span(excerpt['source'], True)
        require(excerpt['source'] == span(message, start, end, True), 'context ordering/range/position mismatch')
        observations.append(observation(task_id, index, 'read_message_context', message, start, end,
                                        excerpt['text'], excerpt['role'], 'context-excerpt'))
    for boundary in (result['previous'], result['next']):
        if boundary is not None:
            validate_span(boundary, False)
    require(result['previous'] == previous and result['next'] == following, 'invalid context continuation metadata')
    return observations


def legacy_read_view(tool, args, returned_view):
    allowed = {'sessionId', 'revision', 'generationId'}
    if tool in ('get_messages', 'get_chunks'):
        allowed |= {'offset', 'limit'}
    require(type(args) is dict and set(args).issubset(allowed), 'unknown legacy read argument; nested view is not a legacy MCP selector')
    require(type(args.get('sessionId')) is str and bool(args['sessionId']), 'legacy sessionId required')
    require('generationId' not in args or 'revision' in args, 'generationId requires revision')
    if 'generationId' in args:
        require(type(args['generationId']) is str and bool(args['generationId']), 'explicit legacy generationId must be a string')
    result_view = View.parse(returned_view)
    if 'revision' in args:
        requested = View.parse({'revision': args['revision'], 'generationId': args['generationId'] if 'generationId' in args else None})
        require(requested == result_view, 'legacy request/result pin mismatch')
    return result_view


def legacy_page(args, result, items):
    offset = args['offset'] if 'offset' in args else DEFAULT_LEGACY_PAGE_OFFSET
    limit = args['limit'] if 'limit' in args else DEFAULT_LEGACY_PAGE_LIMIT
    require(type(offset) is int and 0 <= offset <= MAX_LEGACY_PAGE_OFFSET
            and type(limit) is int and 1 <= limit <= MAX_LEGACY_PAGE_LIMIT, 'invalid legacy paging arguments')
    require(type(result['offset']) is int and result['offset'] == offset, 'legacy page offset mismatch')
    require(type(items) is list and len(items) <= limit, 'legacy page exceeds requested limit')
    require(type(result['total']) is int and result['total'] >= 0 and (not items or result['total'] >= offset + len(items)), 'invalid legacy page total')
    return offset


def observe_trace(task_id, trace, sources):
    observations = []; diagnostics = []
    for index, event in enumerate(trace):
        require(event['taskId'] == task_id, 'opaque trace task identity mismatch')
        require(not ('result' in event and 'error' in event), 'ambiguous successful/failed result')
        if 'error' in event:
            if type(event['error']) is dict or 'presentation' in event:
                try:
                    source_arguments(event)
                except PresentationIntegrityError as error:
                    raise EvidenceIntegrityError(str(error)) from error
            continue
        require('result' in event, 'trace result or explicit error required')
        tool = event['tool']; result = event['result']
        try:
            args = source_arguments(event)
        except PresentationIntegrityError as error:
            raise EvidenceIntegrityError(str(error)) from error
        if tool == 'read_message_context':
            observations.extend(context_observations(task_id, index, args, result, sources))
        elif tool == 'get_messages':
            view = legacy_read_view(tool, args, result['view']); sid = args['sessionId']
            messages = sources.session(sid, view)
            offset = legacy_page(args, result, result['messages'])
            require(result['total'] == len(messages), 'message page total/source mismatch')
            for ordinal, message in enumerate(result['messages']):
                source = sources.resolve(sid, view, message['id'])
                require(source.position == offset + ordinal, 'message ordinal mismatch')
                observations.append(observation(task_id, index, tool, source, 0, len(utf8(source.text)),
                                                message['text'], message['role'], 'whole-message'))
        elif tool in ('search_sessions', 'get_chunks', 'get_session', 'related_sessions'):
            if tool in ('search_sessions', 'related_sessions'):
                hits = result['hits'] if tool == 'search_sessions' else result['sessions']
                groups = [(hit['session']['id'], View.parse(hit['session']['view']), hit['chunks']) for hit in hits]
            elif tool == 'get_session':
                view = legacy_read_view(tool, args, result['session']['view'])
                require(args['sessionId'] == result['session']['id'], 'session request/result identity mismatch')
                groups = [(result['session']['id'], view, result['chunks'])]
            else:
                view = legacy_read_view(tool, args, result['view'])
                legacy_page(args, result, result['chunks'])
                groups = [(args['sessionId'], view, result['chunks'])]
            for sid, view, chunks in groups:
                sources.session(sid, view)
                for chunk in chunks:
                    require(chunk['sessionId'] == sid, 'chunk/session mismatch')
                    spans = chunk['spans']
                    require(type(spans) is list and bool(spans), 'nonempty chunk source spans required')
                    for item in spans:
                        validate_span(item, False)
                        source = sources.resolve(sid, view, item['messageId'])
                        scalar_range(source.text, item['start'], item['end'])
                    if len(spans) != 1:
                        diagnostics.append(SourceDiagnostic(index, tool, 'unsupported-source-encoding', 'legacy multi-span aggregate requires a source read'))
                        continue
                    item = spans[0]; source = sources.resolve(sid, view, item['messageId'])
                    observations.append(observation(task_id, index, tool, source, item['start'], item['end'],
                                                    chunk['text'], source.role, 'verbatim-snippet'))
    return ObservationSet(tuple(observations), tuple(diagnostics))


def citation_occurrences(citation, observations, sources):
    """All absolute occurrences inside one slice; never join slices for a quote."""
    if not isinstance(citation, dict) or set(citation) != {'sessionId', 'view', 'messageId', 'quote'}:
        return ()
    try:
        view = View.parse(citation['view']); quote = utf8(citation['quote'])
        source = sources.resolve(citation['sessionId'], view, citation['messageId'])
    except EvidenceIntegrityError:
        return ()
    if not quote:
        return ()
    found = {}
    for observed in observations.observations:
        if (observed.session_id, observed.view, observed.message_id) != (source.session_id, view, source.message_id):
            continue
        raw = utf8(observed.text); offset = 0
        while True:
            local = raw.find(quote, offset)
            if local == -1:
                break
            start = observed.start + local; end = start + len(quote)
            require(utf8(source.text)[start:end] == quote, 'citation frozen-source mismatch')
            found.setdefault((start, end), set()).add(observed.trace_index)
            offset = local + 1
    return tuple(CitationOccurrence(source.session_id, view, source.message_id, start, end, tuple(sorted(indices)))
                 for (start, end), indices in sorted(found.items()))
