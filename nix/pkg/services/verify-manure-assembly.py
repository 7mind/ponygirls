#!/usr/bin/env python3
"""Bind actual assembly entries to selected sources before native compilation."""
import hashlib,json,pathlib,sys,zipfile
jar=pathlib.Path(sys.argv[1]);output=pathlib.Path(sys.argv[2]);root=pathlib.Path('manure/backend/src/main')
sha=lambda b:hashlib.sha256(b).hexdigest()
fold=root/'scala/manure/UnicodeCaseFold.scala'
assert fold.is_file() and fold.stat().st_size>0
entries={}
with zipfile.ZipFile(jar) as archive:
    for source in sorted((root/'resources').rglob('*.sql')):
        name=source.relative_to(root/'resources').as_posix()
        actual=archive.read(name)
        assert actual==source.read_bytes(), f'assembly SQL source mismatch: {name}'
        entries[name]=sha(actual)
    for name in ['manure/UnicodeCaseFold.class','manure/UnicodeCaseFold$.class']:
        actual=archive.read(name);assert actual
        entries[name]=sha(actual)
assert '003_catalogue.sql' in entries and 'manure-schema.sql' in entries
output.write_text(json.dumps({'assemblySha256':sha(jar.read_bytes()),'unicodeCaseFoldSourceSha256':sha(fold.read_bytes()),'assemblyEntrySha256':entries,'verification':'actual assembly SQL bytes equal filtered source; generated Scala class entries exist before native-image'},indent=2)+'\n')
