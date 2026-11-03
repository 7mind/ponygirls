#!/usr/bin/env python3
"""Specified codec vectors, not semantic-domain or service acceptance fixtures."""
from dataclasses import fields
from pathlib import Path
from types import UnionType
from typing import get_args, get_origin, get_type_hints
from uuid import UUID
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from manure import current_protocol as p

REQUEST_ID = UUID('01234567-89ab-4def-8123-456789abcdef')

def sample(t, field='', options=False):
    origin, args = get_origin(t), get_args(t)
    if origin is UnionType: return sample(args[0], field, options) if options else None
    if origin is list:
        inner = args[0]
        if inner is p.ManifestEntry:
            return [p.ManifestEntry_File('é/𐐀.txt', 9007199254740993, 'a'*64), p.ManifestEntry_Directory('empty')]
        return [sample(inner, field, options)]
    if t is str:
        return {'apiVersion':p.API_VERSION, 'artifactId':'a'*32, 'sha256':'a'*64,
                'createdAt':'2026-11-03T00:00:00Z', 'expiresAt':'2026-11-04T00:00:00Z',
                'contentUrl':'https://'+'a'*32+'.example.invalid', 'current':p.API_VERSION,
                'supported':p.API_VERSION, 'query':'Straße Σ İ E\u0301',
                'name':'é𐐀\u0000name'}.get(field, 'fixture-'+field)
    if t is UUID: return REQUEST_ID
    if t is p.Int32: return 50
    if t is p.Int64: return 9007199254740993
    if t is bool: return True
    if t is float: return 0.625
    if issubclass(t, p.Enum): return list(t)[0]
    if t in p._ADTS: return sample(next(iter(p._ADTS[t].values())), field, options)
    hints = get_type_hints(t)
    return t(**{f.name:sample(hints[f.name], f.name, options) for f in fields(t)})

commands=[]
for cls in p._ADTS[p.Command].values():
    commands.append(p.ClientEnvelope(REQUEST_ID,p.API_VERSION,sample(cls)))
for expiry in [p.ExpiryChange_Keep(),p.ExpiryChange_Clear(),p.ExpiryChange_Set(60)]:
    commands.append(p.ClientEnvelope(REQUEST_ID,p.API_VERSION,p.Command_PatchArtifact('a'*32,p.ArtifactPatch('é',p.Visibility.External,expiry))))
commands.append(p.ClientEnvelope(REQUEST_ID,p.API_VERSION,sample(p.Command_Search,options=True)))
results=[p.ServerEnvelope(REQUEST_ID,sample(cls,options=True)) for cls in p._ADTS[p.Result].values()]
results += [p.ServerEnvelope(REQUEST_ID,p.Result_Error(p.Failure(code,'safe-code-only',None))) for code in p.ErrorCode]
results.append(p.ServerEnvelope(REQUEST_ID,p.Result_ArtifactInfo(sample(p.Artifact,options=False))))
content=[p.ContentEnvelope(REQUEST_ID,p.API_VERSION,sample(cls)) for cls in p._ADTS[p.ContentCommand].values()]
chunk=[p.ChunkReceipt('é/𐐀.txt',9007199254740993,262144,9223372036854775807)]
output=ROOT/'models/fixtures';output.mkdir(exist_ok=True)
for name,values in [('commands',commands),('results',results),('content',content),('chunks',chunk)]:
    (output/(name+'.json')).write_text(json.dumps([p.encode(v) for v in values],ensure_ascii=True,separators=(',',':'))+'\n')
