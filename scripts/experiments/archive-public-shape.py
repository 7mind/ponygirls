#!/usr/bin/env python3
"""Measure the size distribution of public, already-rendered observations. No model call, no shelling out.
python3 scripts/experiments/archive-public-shape.py NEW_DIRECTORY [--frozen]
Only public object IDs, hashes and counts are saved. This is NOT a counterfactual task score.
"""
import concurrent.futures
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

# Public trace location specified by metadata.yaml in SWE-bench/experiments at 40f164d5b8f1d249bf95a6df8b74b577fd8e519d.
BUCKET = 'https://swe-bench-submissions.s3.amazonaws.com/'
PREFIX = 'bash-only/20250726_mini-v1.0.0_gpt-4.1-2025-04-14/trajs/'
REPOS = ('sympy__sympy', 'matplotlib__matplotlib', 'sphinx-doc__sphinx')
SALT = 'archive-shape-v1:'
SAMPLE = 8

def get(url, max_bytes):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'public-archive-shape-study'}), timeout=20) as response:
        data = response.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError('public source exceeds the qualified size bound')
    return data

def units(s):
    return len(s.encode('utf-16-le', 'surrogatepass')) // 2

def sha(b):
    return hashlib.sha256(b).hexdigest()

def summarize(key):
    data = get(BUCKET + key, 4 << 20)
    messages = json.loads(data)['messages']
    if not messages or messages[0]['role'] != 'system' or messages[1]['role'] != 'user':
        raise ValueError('not the expected mini v1 text-action transcript')
    if any(not isinstance(m.get('content'), str) or m['role'] not in ('system','user','assistant') for m in messages):
        raise ValueError('mixed or unsupported message schema')
    # v1's subsequent user-role responses follow assistant actions. Count *delivered* text, not unseen full command output.
    obs = [(i, units(m['content'])) for i, m in enumerate(messages[2:], 2) if m['role'] == 'user' and messages[i-1]['role'] == 'assistant']
    # Size opportunity at transcript end under a rough char/4 suffix estimate; no synthetic conversion of user/assistant actions into executable Pi calls.
    total = turns = 0
    cutoff = 0
    for i in range(len(messages)-1, -1, -1):
        total += math.ceil(units(messages[i]['content']) / 4)
        turns += messages[i]['role'] == 'assistant'
        if total >= 16000 and turns >= 6:
            cutoff = i
            break
    return dict(key=key, sha256=sha(data), messages=len(messages), observations=[s for _,s in obs],
                endColdLarge=sum(i < cutoff and s >= 4096 for i,s in obs), endCold12k=sum(i < cutoff and s >= 12000 for i,s in obs),
                fullTextChar4=sum(math.ceil(units(m['content']) / 4) for m in messages))

def main():
    if len(sys.argv) not in (2,3) or len(sys.argv)==3 and sys.argv[2]!='--frozen':
        raise SystemExit('usage: archive-public-shape.py NEW_DIRECTORY [--frozen]')
    out = Path(sys.argv[1]); out.mkdir(mode=0o700)
    frozen=json.loads(Path(__file__).with_name('archive-public-sample.json').read_text())
    expected={r['key']:r['sha256'] for r in frozen['objects']}
    if len(sys.argv)==3:
        selected=list(expected); eligible=frozen['samplingFrame']
    else:
        listing = get(BUCKET + '?' + urllib.parse.urlencode({'list-type':2, 'prefix':PREFIX, 'max-keys':1000}), 1 << 20)
        root = ET.fromstring(listing)
        if root.findtext('{*}IsTruncated') != 'false':
            raise ValueError('incomplete public object list')
        keys=[e.findtext('{*}Key') for e in root.findall('{*}Contents') if int(e.findtext('{*}Size'))>0]
        selected=[]; eligible={}
        for repo in REPOS:
            pool=[k for k in keys if re.fullmatch(re.escape(PREFIX) + r'(' + re.escape(repo) + r'-[0-9]+)/\1\.traj\.json', k)]
            if len(pool) < SAMPLE:
                raise ValueError('insufficient sampling frame')
            eligible[repo]=len(pool); selected+=sorted(pool, key=lambda k:sha((SALT+k).encode()))[:SAMPLE]
        if selected!=list(expected) or eligible!=frozen['samplingFrame']:
            raise ValueError('public sampling frame changed; use --frozen for the recorded sample')
    with concurrent.futures.ThreadPoolExecutor(4) as executor:
        rows=list(executor.map(summarize,selected))
    if {r['key']:r['sha256'] for r in rows} != expected:
        raise ValueError('public trace bytes differ from the frozen original')
    values=sorted(x for r in rows for x in r['observations'])
    result=dict(sourcePrefix=PREFIX, samplingFrame=eligible, sample=len(rows), rows=rows,
                observations=len(values), observationUTF16=sum(values), quantilesNearestRank={str(n):values[math.ceil(n*len(values)/100)-1] for n in (50,90,95,99,100)},
                byThreshold={str(t):dict(count=sum(x>=t for x in values), chars=sum(x for x in values if x>=t), sessionsWithAny=sum(any(x>=t for x in r['observations']) for r in rows)) for t in (4096,12000)},
                endFourColdLarge=sum(r['endColdLarge']>=4 for r in rows), endFourCold12k=sum(r['endCold12k']>=4 for r in rows),
                estimatedEndAbove70pct={str(w):sum(r['fullTextChar4']>=0.7*w for r in rows) for w in (65536,131072,500000,1048576)})
    (out/'shape.json').write_text(json.dumps(result,indent=2)+'\n'); print(json.dumps({k:v for k,v in result.items() if k!='rows'},indent=2))

if __name__=='__main__':
    main()
