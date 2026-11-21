"""Offline scoring/accounting for one frozen 27-cell live repair round (Linux + cases.py sandbox).
Usage: python3 score-run.py UPSTREAM_CACHE ROUND_DIRECTORY NEW_SCORE_DIRECTORY
Only trusted cases.py may launch the isolated test execution; this process never imports a proposed patch.
"""
import csv
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ARMS = ('raw', 'fifo', 'log-preview')
CASES = ('case-a', 'case-b', 'case-c')
MODELS = {'deepseek': 'deepseek-ai/DeepSeek-V4.1-Flash-1017', 'kimi': 'moonshotai/Kimi-K3.1-Pro', 'sol': 'gpt-6.2-sol'}
TOKENS = ('input', 'cacheRead', 'cacheWrite', 'output', 'totalTokens')


def need(predicate, reason):
    if not predicate:
        raise ValueError(reason)


def read(path):
    return json.loads(path.read_bytes())


def collect(cache, directory, out):
    records, block_signatures = [], {}
    rounds, distinct, fingerprints = set(), set(), set()
    for cohort, model in MODELS.items():
        root = directory / cohort
        m = read(root / 'manifest.json')
        need(m['action']=='run' and m['cohort']==cohort and m['catalog']['id']==model and m.get('finishedAt'), 'wrong provider or unfinished run')
        need(len(m['plan'])==9 and {(x['caseId'],x['arm']) for x in m['plan']}=={(c,a) for c in CASES for a in ARMS}, 'unmatched planned arms')
        fingerprints.add((m['runnerSha256'], m['stockSourceSha256'], m['candidateSourceSha256'], m['casesSha256']))
        for case in CASES:
            for arm in ARMS:
                label = f"r{m['round']}-{cohort}-{case}-{arm}"
                row = read(root / (label + '.json'))
                need((row['label'], row['cohort'], row['model'], row['caseId'], row['arm'], row['round']) == (label,cohort,model,case,arm,m['round']), 'cell identity mismatch')
                need(row['nonceSha256'] not in distinct, 'reused cache nonce'); distinct.add(row['nonceSha256']); rounds.add(row['round'])
                usage = row['metrics'].get('usage') or {}
                q = {'round':row['round'], 'cohort':cohort, 'model':model, 'case':case, 'arm':arm, 'status':row['status'], 'outcome':'unavailable', 'reason':row.get('error', ''), 'tests_run':None,
                     'hash':None, 'requests':len(row['requests']), **{k:usage.get(k) for k in TOKENS}, 'session_ms':row.get('promptRunMs'),
                     'source_calls':sum(c['tool']=='repair_source' for c in row['calls']), 'recall_calls':sum(c['tool']=='context_recall' for c in row['calls']), 'reported_warm_usage':(row.get('admission') or {}).get('used'), 'context_window':row['contextWindow']}
                logged = (row['metrics'].get('byEvidence') or {}).get('log') or {}
                q.update(log_reads=logged.get('reads'), log_find_with_hits=logged.get('findCallsWithHits'), log_read_chars=logged.get('readChars'),
                         repair_ms=next((ph.get('promptWallMs') for ph in row['phases'] if ph['id']=='repair'),None), natural70=(row.get('admission') or {}).get('natural70'))
                if row['status']=='completed':
                    need(row['provider']==m['catalog']['provider'] and row['phases'][-1]['status']=='completed', 'repair or routing not verified')
                    projection = row['afterWarm']['payloads']; versions = {'raw':[None,None],'fifo':[1,1],'log-preview':[2,1]}[arm]
                    need([s['kind'] for s in projection]==['log','nonlog'] and [s['version'] for s in projection]==versions, 'incorrect per-slot treatment')
                    need(arm!='log-preview' or (0 < projection[0]['retainedChars'] <= 320 and projection[1]['retainedChars']==0), 'wrong preview surface')
                    canonical = (row['seed'], row['contextWindow'], row['thinkingLevel'], row['declared'], row['wireToolsSha256'], row['requests'][0]['payload']['normalizedTranscriptSha256'], tuple(x['sha256'] for x in projection))
                    need(block_signatures.setdefault((cohort,case), canonical)==canonical, 'unmatched seed, targets, tools, capacity, or pre-edit wire content')
                    need(len(row['requests'])>=2 and all(s['posts']==1 and s['httpStatus']==200 and s.get('usage') for s in row['requests']), 'incomplete HTTP ledger')
                    need(all(sum(s['usage'][k] for s in row['requests'])==usage[k] for k in TOKENS) and sum(usage[k] for k in TOKENS[:-1])==usage['totalTokens'], 'unbalanced token ledger')
                    name=row['finalArtifact']; need(type(name) is str and Path(name).name==name and name not in ('.','..'), 'invalid answer path')
                    path=root/name;need(path.is_file() and not path.is_symlink() and path.stat().st_size==row['finalBytes']<=256*1024, 'invalid answer size/file')
                    digest=hashlib.sha256(path.read_bytes()).hexdigest(); need(digest==row['finalSha256'], 'answer digest mismatch');q['hash']=digest
                    g=subprocess.run([sys.executable,'-E','-s','-B',str(Path(__file__).with_name('cases.py').resolve()),'grade',str(cache.resolve()),case,str(path.resolve())],env={k:os.environ[k] for k in ('PATH','HOME','TMPDIR','NIX_REMOTE') if k in os.environ},capture_output=True,timeout=120,check=False)
                    need(len(g.stdout)<=256*1024 and len(g.stderr)<=64*1024, 'overlong grader output')
                    receipt=json.loads(g.stdout); need(receipt['caseId']==case and receipt['outcome'] in ('pass','fail','invalid','unknown'), 'bad grade receipt');
                    need(g.returncode==0,'grader process failed')
                    if receipt['outcome']=='pass':
                        count = {'case-a':55,'case-b':36,'case-c':66}[case]
                        need(receipt['ran']==receipt['passed']==count and all(receipt[k]==0 for k in ('errors','failures','extras')),'incomplete positive behavioral oracle')
                    (out/(label+'.grade.json')).write_bytes(g.stdout)
                    q.update(outcome=receipt['outcome'],reason=receipt.get('reason',''),tests_run=receipt.get('ran'))
                records.append(q)
    need(len(records)==len(distinct)==27 and len(rounds)==1 and len(fingerprints)==1,'wrong coverage or mixed case/runner identities')
    return records, next(iter(fingerprints))


def describe(rows):
    return {'cells':len(rows), 'solved':sum(r['outcome']=='pass' for r in rows), 'usage':{k:sum(r[k] for r in rows) for k in TOKENS},
            'ms':sum(r['session_ms'] for r in rows),'requests':sum(r['requests'] for r in rows),'recall':sum(r['recall_calls'] for r in rows),'source':sum(r['source_calls'] for r in rows)}


def main():
    if len(sys.argv)!=4: raise SystemExit(__doc__)
    cache,directory,out=map(Path,sys.argv[1:]);os.umask(0o077);out.mkdir(mode=0o700)
    rows,frozen=collect(cache,directory,out);lookup={(r['cohort'],r['case'],r['arm']):r for r in rows}; good=lambda r:r['outcome'] in ('pass','fail','invalid')
    pairs=[(c,s) for c in MODELS for s in CASES if all(good(lookup[c,s,a]) for a in ('fifo','log-preview'))]; triples=[(c,s) for c,s in pairs if good(lookup[c,s,'raw'])]
    paired={a:describe([lookup[c,s,a] for c,s in pairs]) for a in ('fifo','log-preview')};three={a:describe([lookup[c,s,a] for c,s in triples]) for a in ARMS}
    losses=[];gains=[];unresolved=[]
    for c in MODELS:
        for s in CASES:
            a,b=[lookup[c,s,x] for x in ('fifo','log-preview')]
            if not (good(a) and good(b)):
                if a['outcome']=='pass' and not good(b):unresolved.append([c,s]);
            elif (a['outcome']=='pass')!=(b['outcome']=='pass'):(losses if a['outcome']=='pass' else gains).append([c,s])
    result={'fingerprints':frozen,'pairedCells':pairs,'completeTriples':triples,'paired':paired,'three':three,'gains':gains,'losses':losses,'unresolvedStockSolves':unresolved,'unknownCells':[r for r in rows if not good(r)]}
    with (out/'metrics.csv').open('x',newline='') as stream:
        w=csv.DictWriter(stream,fieldnames=rows[0].keys(),lineterminator='\n');w.writeheader();w.writerows(rows)
    (out/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ['paired','three','gains','losses','unresolvedStockSolves']},indent=2))

if __name__=='__main__':main()
