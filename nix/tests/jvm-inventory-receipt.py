#!/usr/bin/env python3
"""Complete discovered JVM module inventories; no summary-only or skipped XML."""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET

p=argparse.ArgumentParser()
p.add_argument('--module',action='append',required=True)
p.add_argument('--source',required=True);p.add_argument('--output',required=True)
a=p.parse_args();modules={}
for module in a.module:
    root=Path(module)
    expected=(root/'target/validation-inventory.txt').read_text().splitlines()
    assert expected and len(expected)==len(set(expected))
    observed={}
    for path in sorted((root/'target/test-reports').glob('*.xml')):
        xml=ET.parse(path).getroot();name=xml.attrib['name'];cases=list(xml.iter('testcase'))
        assert name not in observed and cases and int(xml.attrib['tests'])==len(cases)
        assert all(int(xml.attrib.get(k,0))==0 for k in ['failures','errors','skipped'])
        assert not any(list(xml.iter(tag)) for tag in ['failure','error','skipped'])
        observed[name]=[c.attrib['name'] for c in cases]
    assert sorted(observed)==sorted(expected)
    modules[module]={'suites':len(observed),'cases':sum(map(len,observed.values())),'inventory':observed}
receipt={'source':a.source,'modules':modules,'failures':0,'errors':0,'skips':0,
 'scope':'Complete discovered Manure JVM backend and filesystem suites; real owned PostgreSQL plus in-memory domain contracts. JVM fixture administrator creates per-test databases; least-privileged runtime acceptance is separately mandatory in manure-native.'}
Path(a.output).write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({m:{'suites':v['suites'],'cases':v['cases']} for m,v in modules.items()}))
