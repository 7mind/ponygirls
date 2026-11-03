#!/usr/bin/env python3
"""Generate the stdlib typed bridge for the deliberately small current schema.

Baboon 0.0.198 remains authoritative for Scala/TS JSON. This bridge does not
introduce a Python server or an alternate wire format. Fail closed on syntax
outside this schema's enum/data/ADT/list/option subset. Codec goldens cross-check
this output against Baboon's generated TS/Scala codecs.
"""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / 'models/manure.baboon').read_text()
tokens = re.findall(r'"[^"\n]*"|[A-Za-z_][A-Za-z_0-9.]*|[{}:\[\]]|\S', source)
i = 0

def take(expected=None):
    global i
    value = tokens[i]
    i += 1
    if expected is not None and value != expected:
        raise ValueError(f'expected {expected}, got {value}')
    return value

def peek():
    return tokens[i] if i < len(tokens) else None

def typ():
    name = take()
    if name in ('lst', 'opt'):
        take('[')
        inner = typ()
        take(']')
        return ('list[' + inner + ']') if name == 'lst' else (inner + ' | None')
    return {'str': 'str', 'uid': 'UUID', 'i32': 'Int32', 'i64': 'Int64',
            'bit': 'bool', 'f64': 'float'}.get(name, name)

def fields():
    take('{')
    result = []
    while peek() != '}':
        name = take()
        take(':')
        result.append((name, typ()))
    take('}')
    return result

take('model'); take('manure.api'); take('version'); version = take().strip('"')
classes = []
groups = []
definitions = {}
while peek() is not None:
    kind = take()
    if kind == 'root':
        kind = take()
    name = take()
    if kind == 'enum':
        take('{'); values = []
        while peek() != '}': values.append(take())
        take('}')
        definitions[name] = {'enum': values}
        classes.append(f'class {name}(Enum):\n' + ''.join(f'    {v} = {v!r}\n' for v in values))
    elif kind == 'data':
        fs = fields()
        definitions[name] = {'fields': dict(fs)}
        classes.append('@dataclass(frozen=True)\nclass ' + name + ':\n' +
                       (''.join(f'    {n}: {t}\n' for n, t in fs) or '    pass\n'))
    elif kind == 'adt':
        take('{'); members = []
        classes.append(f'class {name}:\n    """Closed generated ADT base."""\n    pass\n')
        while peek() != '}':
            take('data'); variant = take(); fs = fields(); cls = name + '_' + variant
            members.append(cls)
            definitions[cls] = {'fields': dict(fs)}
            classes.append(f'@dataclass(frozen=True)\nclass {cls}({name}):\n' +
                           f'    _variant: ClassVar[str] = {variant!r}\n' +
                           ''.join(f'    {n}: {t}\n' for n, t in fs))
        take('}')
        groups.append((name, members))
        definitions[name] = {'variants': {m.removeprefix(name + '_'): m for m in members}}
    else:
        raise ValueError(f'unsupported schema definition {kind}')

runtime = '''
# Strict JSON boundary. Tags: Behavioral-Active / Blackbox-Group; specified.
# Unlike primitive generated codecs, reject unknown/missing/duplicate fields,
# malformed numbers, noncanonical UUIDs, invalid UTF-8/surrogates and extra ADTs.
class ProtocolError(ValueError):
    def __init__(self):
        super().__init__("invalid current-protocol envelope")


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ProtocolError()
        result[key] = value
    return result


def loads(payload: bytes):
    try:
        return json.loads(payload.decode("utf-8"), object_pairs_hook=_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(ProtocolError()))
    except (ValueError, UnicodeError, RecursionError):
        raise ProtocolError() from None


def encode(value):
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, UUID):
        return str(value)
    if is_dataclass(value):
        hints = get_type_hints(type(value))
        result = {f.name: _encode_as(hints[f.name], getattr(value, f.name))
                  for f in fields(value)}
        return {value._variant: result} if hasattr(value, "_variant") else result
    raise ProtocolError()


def _encode_as(expected, value):
    origin, args = get_origin(expected), get_args(expected)
    if origin is UnionType:
        return None if value is None else _encode_as(args[0], value)
    if origin is list:
        if type(value) is not list: raise ProtocolError()
        return [_encode_as(args[0], v) for v in value]
    if expected is Int64:
        if type(value) is not int or not -(2**63) <= value < 2**63: raise ProtocolError()
        return str(value)
    if expected is Int32:
        if type(value) is not int or not -(2**31) <= value < 2**31: raise ProtocolError()
        return value
    if expected is str:
        if type(value) is not str: raise ProtocolError()
        value.encode("utf-8")
        return value
    if expected is bool:
        if type(value) is not bool: raise ProtocolError()
        return value
    if expected is float:
        if type(value) not in (int, float) or not math.isfinite(value): raise ProtocolError()
        return float(value)
    if not isinstance(value, expected): raise ProtocolError()
    return encode(value)


def decode(expected, value):
    try:
        return _decode(expected, value)
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError, RecursionError):
        raise ProtocolError() from None


def _decode(expected, value):
    origin, args = get_origin(expected), get_args(expected)
    if origin is UnionType:
        return None if value is None else _decode(args[0], value)
    if origin is list:
        if type(value) is not list: raise ProtocolError()
        return [_decode(args[0], v) for v in value]
    if expected is Int64:
        if type(value) is not str or not re.fullmatch(r"0|-?[1-9][0-9]*", value): raise ProtocolError()
        number = int(value)
        if not -(2**63) <= number < 2**63: raise ProtocolError()
        return number
    if expected is Int32:
        if type(value) is not int or not -(2**31) <= value < 2**31: raise ProtocolError()
        return value
    if expected is str:
        if type(value) is not str: raise ProtocolError()
        value.encode("utf-8")
        return value
    if expected is bool:
        if type(value) is not bool: raise ProtocolError()
        return value
    if expected is float:
        if type(value) not in (int, float) or not math.isfinite(value): raise ProtocolError()
        return float(value)
    if expected is UUID:
        if type(value) is not str or str(UUID(value)) != value: raise ProtocolError()
        return UUID(value)
    if issubclass(expected, Enum):
        return expected(value)
    if expected in _ADTS:
        if type(value) is not dict or len(value) != 1: raise ProtocolError()
        name = next(iter(value))
        member = _ADTS[expected].get(name)
        if member is None: raise ProtocolError()
        return _decode(member, value[name])
    if type(value) is not dict: raise ProtocolError()
    fs = fields(expected)
    if set(value) != {f.name for f in fs}: raise ProtocolError()
    hints = get_type_hints(expected)
    return expected(**{f.name: _decode(hints[f.name], value[f.name]) for f in fs})


def dumps(value) -> bytes:
    try:
        return json.dumps(encode(value), ensure_ascii=True, allow_nan=False,
                          separators=(",", ":")).encode("utf-8")
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise ProtocolError() from None


def response(payload: bytes, request_id: UUID, expected):
    envelope = decode(ServerEnvelope, loads(payload))
    if envelope.requestId != request_id or not isinstance(envelope.result, (expected, Result_Error)):
        raise ProtocolError()
    return envelope.result


def local(value):
    """Map typed current DTOs into client-local resume/cache algorithm values.

    Not an HTTP compatibility endpoint. Only the in-process dictionary API is
    kept; no obsolete wire decoder or alternate legacy request is retained.
    """
    if isinstance(value, Enum):
        return "dir" if value.value == "Directory" else value.value.lower()
    if isinstance(value, UUID): return str(value)
    if isinstance(value, list): return [local(v) for v in value]
    if is_dataclass(value):
        obj = {re.sub(r"(?<!^)(?=[A-Z])", "_", f.name).lower(): local(getattr(value, f.name))
               for f in fields(value)}
        if isinstance(value, (ManifestEntry_File, ManifestEntry_Directory)):
            obj["kind"] = "file" if isinstance(value, ManifestEntry_File) else "dir"
        if isinstance(value, ByteRange): return [value.start, value.endExclusive]
        if isinstance(value, Principal):
            obj["type"] = obj.pop("principal_type")
        if "expires_in_seconds" in obj: obj["expires_in_s"] = obj.pop("expires_in_seconds")
        return obj
    return value
'''
header = '''# Generated by scripts/generate-python.py from models/manure.baboon.
# Current-contract stdlib client bridge, checked against Baboon JSON goldens.
from __future__ import annotations
from dataclasses import dataclass, fields, is_dataclass
from enum import Enum
from types import UnionType
from typing import ClassVar, NewType, get_args, get_origin, get_type_hints
from uuid import UUID
import json
import math
import re

Int32 = NewType("Int32", int)
Int64 = NewType("Int64", int)
'''
output = header + f'API_VERSION = {version!r}\n\n' + '\n\n'.join(classes)
output += '\n_ADTS = {\n' + ''.join(f'    {name}: {{' + ', '.join(f'{m}._variant: {m}' for m in members) + '},\n' for name, members in groups) + '}\n'
output += runtime
(ROOT / 'manure/current_protocol.py').write_text(output)

(ROOT / 'web/dashboard/current-schema.js').write_text('// Generated by scripts/generate-python.py from the sole current Baboon schema.\nexport const schema = ' + json.dumps(definitions, separators=(',', ':')) + ';\n')
