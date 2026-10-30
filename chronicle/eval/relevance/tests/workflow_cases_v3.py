"""Manual controlled stores/transports. No SQL engine, provider or native process."""
import hashlib
import json
import math
from pathlib import Path
import uuid
from workflow_v3 import BoundFile, WorkflowManifest, IngestLimits, IngestReceipt, FINGERPRINT_TABLES, canonical


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def bound_file(root, name, value):
    path = root / name; raw = json.dumps(value, ensure_ascii=False).encode(); path.write_bytes(raw)
    return BoundFile(path, sha(raw))


def fixture():
    return {'fixtureId':'workflow-synthetic','factFormat':'ordered-string-values-v1','factNormalization':'casefold-and-collapse-whitespace-only',
      'fixedQueryPolicy':'lexical-curated-keywords-semantic-hybrid-natural-question-v1',
      'documents':[{'id':'a','principal':'reader','title':'Synthetic ledger','expectedProblem':['fact'],'expectedContext':['bootstrap'],
        'messages':[{'id':'bootstrap','role':'system','text':'Context-only setup instruction.'},
          {'id':'fact','role':'assistant','text':'Approved port 4319. '+ 'ledger detail. '*1200 + '\x00😀'}]},
        {'id':'b','principal':'restricted','title':'Private synthetic','expectedProblem':['seal'],'expectedContext':[],
         'messages':[{'id':'seal','role':'user','text':'Seal OPAL.'}]}],
      'tasks':[{'id':'q','principal':'reader','split':'holdout','question':'Which approved port?', 'query':'Which approved port?',
        'facts':{'values':['4319']},'factAliases':[[]],'relevant':['a'],
        'evidence':[{'document':'a','messageId':'fact','quote':'Approved port 4319.'}],
        'fixedQueries':{'lexical':'approved port','semantic':'Which approved port?','hybrid':'Which approved port?'}}]}


class Case:
    def __init__(self, root):
        self.root = root; self.fixture = fixture(); fixture_binding = bound_file(root,'fixture.json',self.fixture)
        self.rubric = {'policy':'evidence-assessment-v3','fixtureSha256':fixture_binding.sha256,'tasks':{'q':{'principal':'reader','propositions':[
          {'id':'port','valueIndex':0,'anchorsAny':[{'document':'a','messageId':'fact','start':14,'end':18}],
           'qualifiersAll':[{'document':'a','messageId':'fact','start':0,'end':19}], 'factualCriteria':'4319 is approved port.'}]}}}
        embedding = {'endpoint':'http://127.0.0.1:9/embed','model':'embedding','revision':'pinned','dimensions':2,'sendDimensions':True,'queryPrefix':'','documentPrefix':''}
        annotation = {'endpoint':'http://127.0.0.1:9/annotate','model':'annotation','revision':'pinned','maxResponseBytes':65536}
        space_desc = ['embedding-space-v1',sha(embedding['endpoint'].encode()),'embedding','pinned',2,True,'','','cosine']
        self.space = sha(json.dumps(space_desc,separators=(',',':')).encode())
        profile_desc = ['index-profile-descriptor-v1',[sha(annotation['endpoint'].encode()),'annotation','pinned','request-policy','65536'],'source-policy']
        self.profile = sha(json.dumps(['context-aware-problems-profile-v1',self.space,profile_desc],separators=(',',':')).encode())
        catalog = bound_file(root,'models.json',{'spaces':[{'id':self.space,'descriptor':space_desc}],
          'profiles':[{'profile':self.profile,'embedding_space':self.space,'policy':'ContextAwareProblemsV1','descriptor':profile_desc}]})
        tokens = {}; ingest_tokens = {}; static = []
        for principal in ('reader','restricted'):
            for scope, store in [('Read',tokens),('Ingest',ingest_tokens)]:
                path = root/(principal+'-'+scope); path.write_text('synthetic-'+principal+'-'+scope); path.chmod(0o600); store[principal] = str(path)
                static.append({'id':str(uuid.uuid5(uuid.NAMESPACE_URL,principal+scope)),'userId':principal,'tokenFile':str(path),'scopes':[scope]})
        self.config = {'allowedOrigin':'http://127.0.0.1:12345','maxBodyBytes':8388608,'maxFileBytes':4194304,'maxFiles':1,'maxMessages':10000,
          'staticTokens':static,'users':[{'id':p,'enabled':True} for p in ('reader','restricted')],'embedding':embedding,'annotation':annotation}
        config = bound_file(root,'config.json',self.config)
        self.owned = {'origin':'http://127.0.0.1:12345','pid':123,'executable':'/not-executed','elfSha256':'a'*64,'runId':'synthetic-run',
          'profileSha256':'b'*64,'modelCatalogSha256':catalog.sha256,'tokenFiles':tokens,'ingestTokenFiles':ingest_tokens}
        owned = bound_file(root,'owned.json',self.owned)
        self.manifest = WorkflowManifest(owned,config,catalog,fixture_binding)
        self.limits = IngestLimits.from_config(self.config)
        self.receipts = {d['id']:{'requestId':str(uuid.uuid5(uuid.NAMESPACE_URL,'req/'+d['id'])),
          'sessionId':str(uuid.uuid5(uuid.NAMESPACE_URL,'sid/'+d['id'])),'revision':1,'jobId':str(uuid.uuid5(uuid.NAMESPACE_URL,'job/'+d['id']))} for d in self.fixture['documents']}
        self.generations = {d['id']:str(uuid.uuid5(uuid.NAMESPACE_URL,'gen/'+d['id'])) for d in self.fixture['documents']}

    def output(self, name):
        result = self.root/name; result.mkdir(mode=0o700); return result


class MemoryIngest:
    def __init__(self):
        self.requests = []; self.sources = set()

    def submit(self, prepared):
        value = json.loads(prepared.body); key = (prepared.principal,value['source']['producerSessionId'])
        if key in self.sources:
            raise ValueError('no automatic revision retry')
        self.sources.add(key); self.requests.append(prepared)
        receipt = {'requestId':prepared.request_id,'sessionId':str(uuid.uuid5(uuid.NAMESPACE_URL,'ingested/'+key[1])),
                   'revision':1,'jobId':str(uuid.uuid5(uuid.NAMESPACE_URL,'ingested-job/'+key[1]))}
        return IngestReceipt.parse(receipt,prepared.request_id)


class MemoryResponse:
    def __init__(self, raw): self.raw = raw; self.status = 200
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self, maximum): return self.raw[:maximum]


class MemoryOpener:
    def __init__(self): self.requests = []; self.raw_reply = None
    def open(self, request, timeout):
        if request.full_url != 'http://127.0.0.1:12345/api/ingest' or request.method != 'POST':
            raise AssertionError('unbounded route')
        self.requests.append((request.full_url,request.data,timeout))
        value = json.loads(request.data)
        raw = self.raw_reply if self.raw_reply is not None else json.dumps({'requestId':value['requestId'],
          'sessionId':str(uuid.uuid5(uuid.NAMESPACE_URL,'http-session')),'revision':1,'jobId':str(uuid.uuid5(uuid.NAMESPACE_URL,'http-job'))},indent=2).encode()
        self.last_raw = raw
        return MemoryResponse(raw)


class MemoryPublication:
    def __init__(self, case):
        self.case = case; self.queries = []; self.messages = {}; self.spans = {}; self.metadata = {}; self.pieces = []
        for doc in case.fixture['documents']:
            did = doc['id']; sid = case.receipts[did]['sessionId']; rows = []; spans = []
            for pos,m in enumerate(doc['messages']):
                text = m['text'].replace(chr(0),'\\u0000'); raw = text.encode()
                rows.append({'messageId':m['id'],'valueId':m['id'],'position':pos,'recordIndex':pos,'role':m['role'],'bytes':len(raw),'sha256':sha(raw)})
                if m['id'] in doc['expectedContext']:
                    spans.append({'kind':'context','messageId':m['id'],'messagePosition':pos,'start':0,'end':len(raw)})
                else:
                    spans.append({'kind':'problem','messageId':m['id'],'messagePosition':pos,'start':0,'end':len(raw)})
                    count = 1001 if doc['principal']=='reader' else 1
                    chars = list(text); base,extra = divmod(len(chars),count); start = 0; char_start = 0
                    for n in range(count):
                        char_end = char_start + base + (n<extra); part = ''.join(chars[char_start:char_end]); end = start+len(part.encode())
                        piece = {'document':did,'sessionId':sid,'messageId':m['id'],'position':pos,'start':start,'end':end,'text':part,
                                 'vector':[1.0,float(n%3+1)],'owner':doc['principal'],'badLink':False}
                        self.pieces.append(piece)
                        for kind in ('chunk','search'): spans.append({'kind':kind,'messageId':m['id'],'messagePosition':pos,'start':start,'end':end})
                        char_start = char_end; start = end
            self.messages[sid] = rows; self.spans[sid] = spans
            count = sum(p['sessionId']==sid for p in self.pieces); receipt=case.receipts[did]
            run = str(uuid.uuid5(uuid.NAMESPACE_URL,'run/'+did))
            self.metadata[sid] = {'sessionId':sid,'owner':doc['principal'],'revision':1,'generationId':case.generations[did],'publishedRevision':1,
              'retired':False,'tombstone':False,'profile':case.profile,'format':'ContextAwareProblems','project':'relevance-synthetic-run',
              'source':{'collectorNamespace':'context-eval-v3','discoveryRootId':'synthetic','format':'Pi','producerSessionId':'synthetic-run-'+did,'subagentId':None},
              'messageCount':len(rows),'ownerEnabled':True,'ownerTarget':case.profile,'jobId':receipt['jobId'],'jobState':'Complete','jobRevision':1,
              'jobProfile':case.profile,'runId':run,'generationRunId':run,'completedWindows':1,'totalWindows':1,'receiptMatches':True,
              'chunkCount':count,'searchCount':count,'pieceCount':count}

    def __call__(self, statement):
        self.queries.append(statement)
        if 'workflow-v3:candidates' in statement:
            pieces = [p for p in self.pieces if p['owner']=='reader']; eligible = [p for p in pieces if len(p['vector'])==2]
            result = {'poolPieces':len(pieces),'eligiblePieces':len(eligible),'badDimensions':sum(len(p['vector'])!=2 for p in pieces),
              'badVectors':sum(not all(math.isfinite(v) for v in p['vector']) or not any(p['vector']) for p in pieces),
              'badLinks':sum(p['badLink'] for p in pieces),'distinctVectors':len({tuple(p['vector']) for p in eligible}),
              'sessions':len({p['sessionId'] for p in eligible})}
        else:
            match = re_query(statement)
            kind,sid=match
            if sid not in self.metadata: raise AssertionError('unknown publication source')
            if kind=='publication': result=self.metadata[sid]
            elif kind=='source': result=self.messages[sid]
            elif kind=='spans': result=self.spans[sid]
            elif kind=='checkpoints': result=[{'stage':'Annotation','parts':1,'windows':1,'first':0,'last':0,'vectors':0}, {'stage':'Embedding','parts':math.ceil(self.metadata[sid]['pieceCount']/16),'windows':1,'first':0,'last':0,'vectors':self.metadata[sid]['pieceCount']}]
            else: raise AssertionError('unsupported read statement')
        return json.dumps(result)


def re_query(statement):
    import re
    match=re.search(r'workflow-v3:(publication|source|spans|checkpoints):([0-9a-f-]+)',statement)
    if match is None: raise AssertionError('non-allowlisted SQL statement')
    return match.groups()


class MemoryReadBridge:
    def __init__(self, case, publication):
        self.case=case; self.publication=publication; self.calls=[]; self.events=[]
        self.identities={p:{'id':p,'scopes':['Read']} for p in ('reader','restricted')}
    def call(self,name,arguments,principal):
        self.calls.append((name,dict(arguments),principal))
        if name=='whoami': return {'user':self.identities[principal]}
        if name=='get_chunks':
            sid=arguments['sessionId']; meta=self.publication.metadata[sid]
            piece=next(p for p in self.publication.pieces if p['sessionId']==sid)
            chunk={'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'chunk/'+sid)),'sessionId':sid,'text':piece['text'],'summary':'annotation, not source','tags':[],
                   'spans':[{'messageId':piece['messageId'],'start':piece['start'],'end':piece['end']}],'score':0}
            result={'view':{'revision':1,'generationId':meta['generationId']},'offset':0,'total':meta['pieceCount'],'chunks':[chunk]}
        elif name=='search_sessions': result={'hits':[],'total':0,'countScope':'ExactMatches','rankingLimit':None}
        else: raise AssertionError('forbidden whole message/session/provider call')
        self.events.append({'taskId':'trusted-preflight','tool':name,'arguments':arguments,'result':result})
        return result


class MemoryFingerprint:
    def __init__(self): self.rows={t.label:[] for t in FINGERPRINT_TABLES}; self.statements=[]
    def __call__(self,statement):
        if 'workflow-v3:fingerprint' not in statement: raise AssertionError('unexpected SQL')
        self.statements.append(statement); tables={}
        for table in FINGERPRINT_TABLES:
            rows=self.rows[table.label]
            ordered=sorted(rows,key=lambda row:tuple(row[k] for k in table.order.split(',')))
            hashes=[]
            for row in ordered:
                projected=row if table.columns=='*' else {k:row[k] for k in table.columns.split(',')}
                hashes.append(sha(json.dumps(projected,separators=(',',':')).encode()))
            tables[table.label]={'table':table.table,'count':len(ordered),'sha256':sha(''.join(hashes).encode())}
        return json.dumps(tables)
