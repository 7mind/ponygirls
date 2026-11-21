#!/usr/bin/env python3
"""Verify and aggregate archive-policy-live JSON. Usage: archive-policy-report.py DIR_deepseek DIR_kimi DIR_sol NEW_REPORT.json
No network. Whole-block totals use only blocks in which all five arms passed protocol; all attempted cells remain enumerated.
"""
import itertools
import json
import sys
from pathlib import Path

ARMS = ('raw','fifo-stub','late-stub','fifo-edges','late-edges')
PHASES = ('control','edge','middle')
TOKENS = ('input','cacheRead','cacheWrite','output','totalTokens')
MODELS = {'deepseek':'deepseek-ai/DeepSeek-V4.1-Flash-1017','kimi':'moonshotai/Kimi-K3.1-Pro','sol':'gpt-6.2-sol'}
SCENARIOS = {'paged-handbook','counter-rollup'}

def read(path):
    return json.loads(path.read_text())

def require(flag, why):
    if not flag: raise ValueError(why)

def grade(row, phase):
    return next(p['score']['correct'] for p in row['phases'] if p['id']==phase)

def reported(request, key):
    return (request.get('providerUsage') or {}).get(key)

def sum_reported(requests, key):
    values = [reported(r, key) for r in requests]
    return sum(values) if values and all(x is not None for x in values) else None

def change(before, after, key):
    a,b = reported(before,key),reported(after,key)
    return b-a if a is not None and b is not None else None

def summarize(rows):
    requests = [r for x in rows for r in x['requests']]
    ctrl = [next(r for r in x['requests'] if r['phase']=='control') for x in rows]
    common = [r['payload']['warmToFirstControlPrefix']['identicalItemJsonBytes'] for r in ctrl]
    def sums(rs):
        return {k:sum(r['usage'][k] for r in rs) for k in TOKENS}
    return {
        'cells':len(rows),'correct':{p:sum(grade(r,p) for r in rows) for p in PHASES},'usage':sums(requests),
        'controlFirstUsage':sums(ctrl),'commonPrefixByteRange': [min(common),max(common)] if common else None,
        'controlReportedCacheRead':sum_reported(ctrl,'cacheRead'), 'controlReportedNonCacheRead':sum_reported(ctrl,'nonCacheReadPrompt'),
        'controlCacheReportingCells':sum(reported(r,'cacheRead') is not None for r in ctrl),
        'controlFirstMs':sum(r['postToResultMs'] for r in ctrl),'wallMs':sum(r['promptRunMs'] for r in rows),'requests':len(requests),
        'recallAttempts':sum(c['tool']=='context_recall' for r in rows for c in r['calls']),
        'undeclaredAttempts':sum(c['tool']!='context_recall' for r in rows for c in r['calls']),
        'recallErrors':sum(c['tool']=='context_recall' and c['status']=='error' for r in rows for c in r['calls']),
        'recallResultChars':sum(r['metrics']['resultChars'] for r in rows),
        'phase':{p: {'usage':sums([r for r in requests if r['phase']==p]),'prompts':sum(r['phase']==p for r in requests),
                       'recalls':sum(c['tool']=='context_recall' and c['phase']==p for r in rows for c in r['calls']),
                       'ms':sum(t['promptWallMs'] for r in rows for t in r['phases'] if t['id']==p)} for p in ('warm',*PHASES)},
        'sdkEstimatedUsd':sum(r['usage']['sdkCostUsd'] for r in requests) if requests and all(r['usage']['sdkCostUsd'] is not None for r in requests) else None,
    }

def main():
    if len(sys.argv)!=5:raise SystemExit(__doc__)
    kept=[]; attempts=[]; blocks=[]; nonces=set(); seen=set(); fingerprints=[]; totals={}; effects={}
    for root in map(Path,sys.argv[1:4]):
        m=read(root/'manifest.json'); c=m['cohort']; require(m['action']=='run','not a live run'); require(c in MODELS and m['catalog']['id']==MODELS[c],'wrong model route'); fingerprints.append(tuple(m[k] for k in ('runnerSha256','fixtureAndGraderSha256','stockSourceSha256','candidateSourceSha256')))
        comparisons=read(root/'comparisons.json'); require(len(comparisons)==2 and {s['scenario'] for s in comparisons}==SCENARIOS,'wrong scenario set');
        for b in comparisons:
            sc=b['scenario']; rows=[read(root/f'{c}-{sc}-{a}.json') for a in ARMS];blocks.append({'cohort':c,**b})
            for a,r in zip(ARMS,rows):
                key=c,sc,a
                require(key not in seen,'duplicate scheduled cell'); seen.add(key)
                require((r['arm'],r['cohort'],r['scenario'],r['model'],r['provider'])==(a,c,sc,MODELS[c],m['catalog']['provider']),'cell identity mismatch');require(r['nonceSha256'] not in nonces,'nonce collision');nonces.add(r['nonceSha256'])
                attempts.append({k:r.get(k) for k in ('label','status','error','promptRunMs','metrics')})
                for s in r['requests']:
                    if not s.get('usage'):continue
                    u=s['usage'];require(u['totalTokens']==sum(u[k] for k in TOKENS[:-1]),'SDK usage does not balance'); raw=s.get('providerUsage') or {}
                    if raw.get('prompt') is not None and raw.get('output') is not None:
                        require(raw['output']==u['output'] and raw['prompt']==u['input']+u['cacheRead']+u['cacheWrite'],'raw stream usage differs from SDK')
                    if raw.get('cacheRead') is not None:
                        require(raw['cacheRead']==u['cacheRead'],'reported cache read differs from SDK')
                        require(raw.get('prompt') is not None and raw['nonCacheReadPrompt']==raw['prompt']-raw['cacheRead'],'wrong reported non-cache-read input')
                    if raw.get('cacheWrite') is not None: require(raw['cacheWrite']==u['cacheWrite'],'reported cache write differs from SDK')
                if r['status']!='completed':continue
                require(all(s['posts']==1 and s['httpStatus']==200 for s in r['requests']),'incomplete HTTP request'); require(r['localRecallAudit'] and all(type(grade(r,p)) is bool for p in PHASES),'missing local audit or grades');
                q=r['requests'][1];require(q['phase']=='control' and q['payload']['warmToFirstControlPrefix'] is not None,'missing first post-edit comparison')
                slots=[] if a=='raw' else [2,3] if a.startswith('late-') else [0,1]; require(r['afterWarm']['selectedSlots']==slots,'wrong target placement');require(r['metrics']['usage']['totalTokens']==sum(s['usage']['totalTokens'] for s in r['requests']),'cell ledger mismatch')
            if b['comparable']:
                require(all(r['status']=='completed' for r in rows),'incomplete as comparable');require(b['sameSeedExceptNonce'] and b['sameTools'] and b['sameWireTools'] and b['sameWarmRequestExceptNonce'], 'bad blocking'); kept.extend(rows)
    require(len(set(fingerprints))==1 and len(nonces)==30 and seen==set(itertools.product(MODELS,SCENARIOS,ARMS)),'mixed run identities or incomplete scheduled cells')
    cohorts=sorted({r['cohort'] for r in kept}); lookup={(r['cohort'],r['scenario'],r['arm']):r for r in kept}
    for group in ['all',*cohorts]:
        subset=[r for r in kept if group=='all' or r['cohort']==group];totals[group]={a:summarize([r for r in subset if r['arm']==a]) for a in ARMS}
    comparisons=[('fifo-stub','late-stub'),('fifo-edges','late-edges'),('fifo-stub','fifo-edges'),('late-stub','late-edges')]
    for a,b in comparisons:
        gains=[];losses=[];deltas=[]
        for (c,s,arm),base in lookup.items():
            if arm!=a:continue
            other=lookup[c,s,b]
            for p in PHASES:
                if grade(base,p)!=grade(other,p):(losses if grade(base,p) else gains).append([c,s,p]);
            old=base['requests'][1];new=other['requests'][1];deltas.append({'cohort':c,'scenario':s,'firstReportedNonCacheReadDelta':change(old,new,'nonCacheReadPrompt'),
                'firstReportedHitDelta':change(old,new,'cacheRead'),'edgeRecallDelta':sum(x['tool']=='context_recall' and x['phase']=='edge' for x in other['calls'])-sum(x['tool']=='context_recall' and x['phase']=='edge' for x in base['calls']),
                'totalTokenDelta':other['metrics']['usage']['totalTokens']-base['metrics']['usage']['totalTokens'],'wallDeltaMs':other['promptRunMs']-base['promptRunMs']})
        effects[a+' => '+b]=dict(losses=losses,gains=gains,deltas=deltas)
    out=Path(sys.argv[4]); data=dict(fingerprints=fingerprints[0],matchedBlocks=len(kept)//5,blocks=blocks,attempts=attempts,totals=totals,effects=effects)
    with out.open('x') as f:json.dump(data,f,indent=2);f.write('\n')
    for a,n in totals['all'].items(): print(a, 'cells',n['cells'],'correct',n['correct'],'first reported non-cache-read/hit',n['controlReportedNonCacheRead'],n['controlReportedCacheRead'],'coverage',n['controlCacheReportingCells'],'range common bytes',n['commonPrefixByteRange'],'tokens',n['usage']['totalTokens'],'requests',n['requests'],'recall',n['recallAttempts'],'sec',round(n['wallMs']/1000,1))
    for k,e in effects.items():print(k,'losses',e['losses'],'gains',e['gains'])
    print('matched five-way blocks',len(kept)//5,'of',len(blocks));
    if len(kept)!=30:raise SystemExit(2)

if __name__=='__main__':main()
