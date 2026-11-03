#!/usr/bin/env python3
"""No empty inventory, failures/errors/skips, cached summary-only acceptance."""
import argparse
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
p=argparse.ArgumentParser()
for arg in ('service','artifact','runtime-source','test-source','xml','output','inventory'):
    p.add_argument('--'+arg,required=True)
a=p.parse_args()
root=ET.parse(a.xml).getroot()
cases=root.findall('.//testcase')
assert cases, 'empty native runtime inventory'
assert not root.findall('.//failure') and not root.findall('.//error') and not root.findall('.//skipped'), 'native runtime failure/error/skip'
expected=json.loads(Path(a.inventory).read_text())
assert sorted(c.get('name','') for c in cases)==sorted(expected), 'native runtime inventory mismatch'
names=[(c.get('classname',''),c.get('name','')) for c in cases]
assert len(names)==len(set(names)), 'duplicate native runtime case identity'
receipt={'service':a.service,'artifact':a.artifact,'artifactSHA256':hashlib.sha256(Path(a.artifact).read_bytes()).hexdigest(),
 'runtimeSource':a.runtime_source,'testSource':a.test_source,
 'cases':len(cases),'failures':0,'errors':0,'skips':0,'inventory':[{'suite':s,'case':n} for s,n in names],
 'scope':'Actual static-musl server native HTTP/MCP/WS/JDBC transport suites on owned shared PostgreSQL. Not full domain/browser/deployment acceptance.'}
Path(a.output).write_text(json.dumps(receipt,indent=2)+'\n')
print(f'{a.service}: {len(cases)} native cases, zero failures/errors/skips')
