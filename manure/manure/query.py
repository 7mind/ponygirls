"""Pure shared UI/MCP expression dialect; positions use UTF-16 code units."""
from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Literal, cast

MAX_QUERY_UTF16 = 4096
Mode = Literal['catalogue', 'lexical', 'semantic', 'hybrid']
Access = Literal['internal', 'external', 'public']
State = Literal['ready', 'uploading', 'publishing']
Kind = Literal['file', 'dir']
Direction = Literal['asc', 'desc']
CatalogueSort = Literal['name', 'created_at', 'expires_at', 'total_bytes', 'file_count',
                        'visibility', 'state', 'kind', 'created_by_user']
FIELDS = ('mode', 'access', 'state', 'expired', 'kind', 'owner', 'sort', 'direction', 'text')
SORTS = ('name', 'created_at', 'expires_at', 'total_bytes', 'file_count', 'visibility',
         'state', 'kind', 'created_by_user')
# ECMAScript whitespace, shared with the browser tokenizer (not Python isspace).
WHITESPACE = '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'


class QueryError(ValueError):
    def __init__(self, message: str, start: int, end: int):
        super().__init__(message)
        self.message = message
        self.start = start
        self.end = end


@dataclass(frozen=True)
class QueryPlan:
    q: str
    mode: Mode
    visibility: Access | None
    item_state: State | None
    include_expired: bool
    kind: Kind | None
    created_by_user: str | None
    sort: CatalogueSort
    direction: Direction

    def as_dict(self) -> dict[str, str | bool | None]:
        return {'q': self.q, 'mode': self.mode, 'visibility': self.visibility,
                'itemState': self.item_state, 'includeExpired': self.include_expired,
                'kind': self.kind, 'createdByUser': self.created_by_user,
                'sort': self.sort, 'direction': self.direction}


@dataclass(frozen=True)
class _Token:
    value: str
    raw: str
    start: int
    end: int


def _units(text: str) -> int:
    return len(text.encode('utf-16-le', 'surrogatepass')) // 2


def _error(source: str, message: str, start: int, end: int) -> QueryError:
    return QueryError(message, _units(source[:start]), _units(source[:end]))


def _scalars(text: str) -> str:
    try:
        return text.encode('utf-16-le', 'surrogatepass').decode('utf-16-le')
    except UnicodeError:
        raise QueryError('Query must contain valid Unicode scalar values.', 0, _units(text)) from None


def _value(source: str, start: int) -> _Token:
    if start == len(source) or source[start] in WHITESPACE:
        raise _error(source, 'Expected a value immediately after the colon.', start, start)
    if source[start] == '"':
        try:
            value, length = json.JSONDecoder().raw_decode(source[start:])
        except ValueError:
            raise _error(source, 'Use a complete JSON string with valid escapes.', start, len(source)) from None
        end = start + length
        try:
            value = _scalars(value)
        except QueryError:
            raise _error(source, 'Query must contain valid Unicode scalar values.', start, end) from None
    else:
        end = start
        while end < len(source) and source[end] not in WHITESPACE and source[end] not in '\":':
            end += 1
        value = source[start:end]
    if end < len(source) and source[end] not in WHITESPACE:
        raise _error(source, 'Separate tokens with whitespace; quote literal colons or quotes using a JSON string.', start, end + 1)
    return _Token(value, source[start:end], start, end)


def _closed(source: str, token: _Token, choices: tuple[str, ...], message: str) -> str:
    if token.value not in choices:
        raise _error(source, message, token.start, token.end)
    return token.value


def parse_expression(expression: str) -> QueryPlan:
    """Compile conjunction-only metadata and opaque search text, without I/O."""
    if not isinstance(expression, str):
        raise QueryError('Query must be a string.', 0, 0)
    source = _scalars(expression)
    if _units(source) > MAX_QUERY_UTF16:
        raise QueryError('Query exceeds 4096 UTF-16 code units.', 0, _units(source))
    fields: dict[str, _Token] = {}
    bare: list[_Token] = []
    index = 0
    while index < len(source):
        if source[index] in WHITESPACE:
            index += 1
            continue
        start = index
        if source[index] != '"':
            while index < len(source) and source[index] not in WHITESPACE and source[index] not in '\":':
                index += 1
        if index < len(source) and source[index] == ':':
            field = source[start:index].lower()
            if field not in FIELDS:
                end = index + 1
                while end < len(source) and source[end] not in WHITESPACE:
                    end += 1
                raise _error(source, 'Unknown field; use a supported query field.', start, end)
            if field in fields:
                raise _error(source, 'Duplicate field; specify each field once.', start, index)
            token = _value(source, index + 1)
            fields[field] = token
        else:
            token = _value(source, start)
            bare.append(token)
        index = token.end

    def option(field: str, choices: tuple[str, ...], fallback: str | None, message: str) -> str | None:
        return _closed(source, fields[field], choices, message) if field in fields else fallback

    mode = cast(Mode, option('mode', ('catalogue', 'lexical', 'semantic', 'hybrid'), 'catalogue',
                            'Invalid mode value; use catalogue, lexical, semantic or hybrid.'))
    visibility = cast(Access | None, option('access', ('internal', 'external', 'public'), None,
                                           'Invalid access value; use internal, external or public.'))
    state = cast(State | None, option('state', ('ready', 'uploading', 'publishing'), None,
                                     'Invalid state value; use ready, uploading or publishing.'))
    expired = option('expired', ('true', 'false'), 'false', 'Invalid expired value; use true or false.')
    kind = cast(Kind | None, option('kind', ('file', 'dir'), None, 'Invalid kind value; use file or dir.'))
    sort = cast(CatalogueSort, option('sort', SORTS, 'created_at',
                                     'Invalid sort value; use a supported underscore catalogue sort field.'))
    direction = cast(Direction, option('direction', ('asc', 'desc'), 'desc', 'Invalid direction value; use asc or desc.'))
    owner = fields['owner'].value if 'owner' in fields else None
    if owner is not None and not owner.strip(WHITESPACE):
        token = fields['owner']
        raise _error(source, 'Owner must not be blank.', token.start, token.end)
    forbidden = ('kind', 'owner') if mode == 'catalogue' else ('state', 'expired', 'sort', 'direction')
    for field in forbidden:
        if field in fields:
            token = fields[field]
            message = ('Retrieval-only fields require lexical, semantic or hybrid mode.' if mode == 'catalogue'
                       else 'Catalogue-only fields cannot be used in retrieval mode.')
            raise _error(source, message, token.start, token.end)
    if 'text' in fields and bare:
        raise _error(source, 'text: cannot be combined with bare search terms.', bare[0].start, bare[-1].end)
    text = fields['text'].value if 'text' in fields else ' '.join(
        token.value if mode == 'catalogue' else token.raw for token in bare)
    nonblank = text.strip(WHITESPACE) if 'text' in fields else any(token.value.strip(WHITESPACE) for token in bare)
    if mode != 'catalogue' and not nonblank:
        raise _error(source, 'Retrieval mode requires nonblank search text.', 0, len(source))
    return QueryPlan(text, mode, visibility, state, expired == 'true', kind, owner, sort, direction)
