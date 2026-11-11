"""Actual JVM/native application + least-privilege PG + controlled embedding HTTP.

No live provider, no content extraction: deliberately synthetic payload secrets
must never enter model requests. Slow document IO exceeds a three-second durable
lease, exercising the application's shared worker heartbeat and root lifecycle.
"""
from __future__ import annotations

import hashlib
import http.client
import http.server
import json
import math
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from uuid import uuid4

from manure import auth as A,current_protocol as cp
from manure.client import ManureClient,ManureError
from target_server import OwnedDatabase,TargetServer


class ControlledEmbedding:
    def __init__(self):
        self.lock=threading.Lock();self.calls=[];self.document_started=threading.Event();self.query_started=threading.Event()
        self.fail_documents=False;self.fail_all=False;self.slow_document_once=4.0;self.slow_query_once=0
        owner=self
        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version='HTTP/1.1'
            def log_message(self,*args):pass
            def do_POST(self):
                length=int(self.headers.get('Content-Length','0'))
                if self.path!='/v1/embeddings' or not 0<length<=65536:
                    self.send_error(400);return
                value=json.loads(self.rfile.read(length))
                inputs=value['input'];document=all(s.startswith('doc: ') for s in inputs)
                with owner.lock:
                    owner.calls.append({'model':value['model'],'inputs':list(inputs),'authorization':self.headers.get('Authorization')})
                    failure=owner.fail_all or owner.fail_documents and document
                    delay=(owner.slow_document_once if document else owner.slow_query_once) if not failure else 0
                    if delay:
                        if document:owner.slow_document_once=0
                        else:owner.slow_query_once=0
                if document:owner.document_started.set()
                else:owner.query_started.set()
                if delay:time.sleep(delay)
                if failure:
                    payload=b'{"error":"controlled fixture outage"}';status=503
                else:
                    vectors=[{'index':i,'embedding':[.125,1.0,0.0] if 'catalogue/hayneedle.bin' in text.lower() else [1.0,.125,0.0] if 'hayneedle' in text.lower() else [.125,1.0,.25]} for i,text in enumerate(inputs)]
                    payload=json.dumps({'data':list(reversed(vectors))}).encode();status=200
                try:
                    self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)))
                    self.end_headers();self.wfile.write(payload)
                except (BrokenPipeError,ConnectionResetError):pass
        self.http=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.http.daemon_threads=True
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
        self.url=f'http://127.0.0.1:{self.http.server_port}/v1/embeddings'
    def snapshot(self):
        with self.lock:return list(self.calls)
    def close(self):
        self.http.shutdown();self.http.server_close();self.thread.join(timeout=5)
        if self.thread.is_alive():raise RuntimeError('owned model fixture shutdown deadline')


class TargetSearchTests(unittest.TestCase):
    def test_metadata_only_heartbeat_publication_modes_outage_and_profile_space(self):
        with tempfile.TemporaryDirectory(prefix='manure-target-search-') as tmp:
            root=Path(tmp);data=root/'data';data.mkdir(mode=0o700)
            token=A.generate_token();hashfile=root/'operator.digest';hashfile.write_text(A.sha256_hex(token)+'\n');hashfile.chmod(0o600)
            credential=root/'empty-model-credential';credential.write_text('');credential.chmod(0o600)
            model=ControlledEmbedding();database=OwnedDatabase(tmp)
            sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
            endpoint={'operationUrl':model.url,'model':'fixture-model','revision':'immutable-v1','dimensions':3,'sendDimensions':True,
                'documentPrefix':'doc: ','queryPrefix':'query: ','normalization':'cosine','credentialFile':str(credential),
                'deadlineMs':10000,'maxResponseBytes':65536,'maxBatch':8,'maxInputBytes':16384,'maxRequestBytes':65536,
                'maxConcurrent':2,'maxQueued':4,'batchSize':1,'leaseSeconds':3,'pollIntervalMs':500}
            config={'data_dir':str(data),'api_origin':f'http://127.0.0.1:{port}','listen_address':'127.0.0.1','port':port,
                'content_mode':'path','content_suffix':'','loopback_dev':True,'chunk_bytes':262144,'sweep_interval_s':3600,
                'dashboard_dir':None,'unlock_shell_dir':None,'embedding':endpoint,
                'users':[{'id':'search-manager','type':'human','tokens':[{'id':'primary','hashFile':str(hashfile)}]}]}
            def eventually(client,mode):
                deadline=time.monotonic()+25;last=None
                while time.monotonic()<deadline:
                    try:
                        page=client.search('hayneedle',mode,visibility='external',kind='dir',created_by_user='search-manager')
                        if page['hits']:return page
                        self.fail('semantic ready query silently returned an empty complete page')
                    except ManureError as error:
                        self.assertEqual(error.code,'search-unavailable');last=error.code
                    time.sleep(.1)
                self.fail('publication did not complete before bounded deadline: '+str(last))
            server=None
            try:
                server=TargetServer(config,tmp,owned_database=database,close_database=False)
                client=ManureClient(server.api_url,token=token,cache_dir=str(root/'cache'))
                self.assertEqual(client.capabilities()['search_modes'],['lexical','semantic','hybrid'])
                self.assertEqual(model.snapshot(),[])
                payload=b'BINARY_SECRET_NOT_APPROVED_FOR_EMBEDDING\0'*9000
                sha=hashlib.sha256(payload).hexdigest()
                initialized=client.init_upload('metadata hayneedle','dir','external',[
                    {'kind':'file','path':'catalogue/hayneedle.bin','size':len(payload),'sha256':sha},{'kind':'dir','path':'empty'}],expires_in_s=60,
                    tags=['taghayneedle','Release'],hostname='hosthayneedle',project_path='/projecthayneedle/path')
                aid=initialized['artifact_id'];password=initialized['external_password']
                for offset in range(0,len(payload),262144):client.put_chunk(aid,'catalogue/hayneedle.bin',offset,payload[offset:offset+262144])
                self.assertEqual(model.snapshot(),[],'ordinary upload called the model')
                start=time.monotonic();client.publish(aid)
                self.assertLess(time.monotonic()-start,2,'publish waited for external model IO')
                self.assertTrue(model.document_started.wait(timeout=5))
                # Query embedding is available while document work is incomplete:
                # explicit not-ready/unavailable, never lexical-mode fallback.
                with self.assertRaises(ManureError) as waiting:client.search('hayneedle','semantic')
                self.assertEqual(waiting.exception.code,'search-unavailable')
                start=time.monotonic();self.assertEqual(client.get_artifact(aid)['state'],'ready')
                self.assertLess(time.monotonic()-start,2,'model call held the authoritative transaction/root monitor')
                info=client.get_artifact(aid)
                self.assertEqual((info['tags'],info['hostname'],info['project_path']),
                    (['taghayneedle','Release'],'hosthayneedle','/projecthayneedle/path'))
                for text,field in [('taghayneedle','tag'),('hosthayneedle','hostname'),('projecthayneedle','projectpath')]:
                    catalogue=client.list_artifacts(query=text)
                    self.assertEqual([item['artifact_id'] for item in catalogue['artifacts']],[aid])
                    page=client.search(text,'lexical')
                    self.assertEqual([item['artifact']['artifact_id'] for item in page['hits']],[aid])
                    self.assertIn(field,[e['field'] for e in page['hits'][0]['evidence']])
                lexical=client.search('hayneedle','lexical')
                self.assertEqual(lexical['count_scope'],'exactmatches');self.assertEqual(lexical['hits'][0]['embedding_space'],None)
                semantic=eventually(client,'semantic');hybrid=eventually(client,'hybrid')
                # MCP expressions use the actual typed client and owned provider;
                # rejected syntax must not reach either transport or model IO.
                from unittest.mock import patch
                from manure import mcp
                count=len(model.snapshot())
                with patch.object(mcp,'_client_from_env',return_value=client):
                    with patch.object(client,'_current',wraps=client._current) as current:
                        rejected=mcp.handle_tools_call('search',{'query':'mode:semantic unknown:private-secret'})
                        self.assertTrue(rejected['isError']);current.assert_not_called()
                    self.assertEqual(len(model.snapshot()),count)
                    self.assertNotIn('private-secret',json.dumps(rejected))
                    result=mcp.handle_tools_call('search',{'query':'mode:semantic access:external kind:dir owner:search-manager hayneedle','limit':5})
                    self.assertNotIn('isError',result,result)
                    page=json.loads(result['content'][0]['text'])
                    self.assertEqual(page['hits'][0]['artifact']['artifact_id'],aid)
                hit=semantic['hits'][0]
                self.assertEqual(hit['artifact']['artifact_id'],aid)
                for key in ('embedding_profile','embedding_space','source_version'):self.assertRegex(hit[key],r'^[0-9a-f]{64}$')
                self.assertNotEqual(hit['embedding_profile'],hit['embedding_space'])
                self.assertEqual(hit['policy_id'],'manure-metadata-paths-v2');self.assertTrue(hit['generation_id'])
                self.assertEqual(hybrid['hits'][0]['embedding_space'],hit['embedding_space'])
                path_page=client.search('catalogue/hayneedle.bin','semantic')
                evidence_hits=semantic['hits']+path_page['hits']
                coordinates={(e['field'],e['text'],e['path']) for item in evidence_hits for e in item['evidence']}
                self.assertIn(('name','metadata hayneedle',None),coordinates)
                self.assertIn(('manifestpath','catalogue/hayneedle.bin','catalogue/hayneedle.bin'),coordinates)
                for item in evidence_hits:
                    self.assertEqual(item['source_version'],hit['source_version'])
                    self.assertEqual(item['generation_id'],hit['generation_id'])
                    self.assertEqual(item['embedding_space'],hit['embedding_space'])
                    for evidence in item['evidence']:
                        self.assertIn(evidence['field'],('name','manifestpath','tag','hostname','projectpath'));self.assertTrue(math.isfinite(evidence['score']))
                        if evidence['field']=='manifestpath':
                            self.assertIn(evidence['path'],('catalogue/hayneedle.bin','empty'));self.assertEqual(evidence['text'],evidence['path'])
                        else:
                            self.assertIsNone(evidence['path'])
                            expected={'name':['metadata hayneedle'],'tag':['taghayneedle','Release'],
                                'hostname':['hosthayneedle'],'projectpath':['/projecthayneedle/path']}
                            self.assertIn(evidence['text'],expected[evidence['field']])
                for mode in ('lexical','semantic','hybrid'):
                    page=client.search('hayneedle',mode,tags=['Release','taghayneedle'],hostname='hosthayneedle',project_path='/projecthayneedle/path')
                    self.assertEqual([item['artifact']['artifact_id'] for item in page['hits']],[aid])
                catalogue=client.list_artifacts(tags=['Release','taghayneedle'],hostname='hosthayneedle',project_path='/projecthayneedle/path')
                self.assertEqual([item['artifact_id'] for item in catalogue['artifacts']],[aid])
                for filters in ({'visibility':'public'},{'kind':'file'},{'created_by_user':'not-the-creator'},
                        {'tags':['Release','missing']},{'tags':['release']},{'hostname':'HOSTHAYNEEDLE'},
                        {'hostname':'hosthay'},{'project_path':'/Projecthayneedle/path'},{'project_path':'/projecthayneedle'}):
                    for mode in ('lexical','semantic','hybrid'):
                        self.assertEqual(client.search('hayneedle',mode,**filters)['hits'],[])
                    if 'kind' not in filters and 'created_by_user' not in filters:
                        self.assertEqual(client.list_artifacts(**filters)['artifacts'],[])
                encoded=json.dumps(model.snapshot(),ensure_ascii=False)
                documents='\n'.join(text for call in model.snapshot() for text in call['inputs'] if text.startswith('doc: '))
                for metadata in ('taghayneedle','Release','hosthayneedle','/projecthayneedle/path'):
                    self.assertIn(metadata,documents)
                for secret in (token,password,sha,'BINARY_SECRET_NOT_APPROVED_FOR_EMBEDDING'):
                    self.assertNotIn(secret,encoded)
                self.assertTrue(all(call['authorization'] is None for call in model.snapshot()))
                # Unauthenticated management search must reject BEFORE model IO.
                count=len(model.snapshot());rid=uuid4();connection=http.client.HTTPConnection('127.0.0.1',port,timeout=10)
                try:
                    command=cp.Command_Search(cp.SearchQuery('hayneedle',cp.SearchMode.Semantic,cp.SearchFilter(None,None,None,[],None,None),20,None))
                    connection.request('POST','/api/current',cp.dumps(cp.ClientEnvelope(rid,cp.API_VERSION,command)),{'Content-Type':'application/json'})
                    response=connection.getresponse();response.read();self.assertEqual(response.status,401)
                finally:connection.close()
                self.assertEqual(len(model.snapshot()),count)
                model.fail_all=True
                with self.assertRaises(ManureError) as outage:client.search('hayneedle','hybrid')
                self.assertEqual(outage.exception.code,'search-unavailable')
                self.assertEqual(client.search('hayneedle','lexical')['hits'][0]['artifact']['artifact_id'],aid)
                self.assertEqual(client.get_artifact(aid)['name'],'metadata hayneedle')
                server.close();server=None
                # Same dimensionality/URL is NOT profile or vector-space identity.
                model.fail_all=False;model.fail_documents=True
                config['embedding']=dict(endpoint,revision='immutable-v2')
                server=TargetServer(config,tmp,owned_database=database,close_database=False)
                client=ManureClient(server.api_url,token=token,cache_dir=str(root/'cache2'))
                with self.assertRaises(ManureError) as incompatible:client.search('hayneedle','semantic')
                self.assertEqual(incompatible.exception.code,'search-unavailable')
                model.fail_documents=False
                replacement=eventually(client,'semantic')['hits'][0]
                self.assertNotEqual(replacement['embedding_profile'],hit['embedding_profile'])
                self.assertNotEqual(replacement['embedding_space'],hit['embedding_space'])
                self.assertNotEqual(replacement['generation_id'],hit['generation_id'])
                self.assertEqual(replacement['source_version'],hit['source_version'])
                # Real API TTL (minimum sixty seconds), real elapsed wall time:
                # no metadata/projection mutation or fake service clock. Read the
                # exact owned timestamp only to schedule a model call spanning it.
                expires=float(database.runtime_sql(f"SELECT expires_at_s_value FROM manure.artifacts WHERE id=convert_to('{aid}','UTF8')"))
                remaining=expires-time.time();self.assertGreater(remaining,3);self.assertLessEqual(remaining,60)
                time.sleep(max(0,remaining-3))
                model.query_started.clear();model.slow_query_once=5;delivered=[]
                def expiring_query():
                    try:delivered.append(client.search('hayneedle','semantic'))
                    except BaseException as error:delivered.append(type(error).__name__)
                query_thread=threading.Thread(target=expiring_query,daemon=True);query_thread.start()
                self.assertTrue(model.query_started.wait(timeout=5))
                self.assertLess(time.time(),expires,'fixture query did not start before the real expiry')
                query_thread.join(timeout=10);self.assertFalse(query_thread.is_alive())
                self.assertEqual(len(delivered),1);self.assertIsInstance(delivered[0],dict)
                self.assertEqual(delivered[0]['hits'],[],'stale pre-provider clock delivered expired metadata')
                self.assertEqual(client.search('hayneedle','lexical')['hits'],[])
                client.delete(aid)
                self.assertEqual(client.search('hayneedle','semantic')['hits'],[])
            finally:
                if server is not None:server.close()
                database.close();model.close()


    def test_dashboard_retrieval_real_browser_controlled_provider_and_no_provider(self):
        with tempfile.TemporaryDirectory(prefix='manure-dashboard-retrieval-') as tmp:
            root=Path(tmp);data=root/'data';data.mkdir(mode=0o700)
            token=A.generate_token();hashfile=root/'operator.digest';hashfile.write_text(A.sha256_hex(token)+'\n');hashfile.chmod(0o600)
            credential=root/'empty-model-credential';credential.write_text('');credential.chmod(0o600)
            model=ControlledEmbedding();model.slow_document_once=0
            database=OwnedDatabase(tmp)
            sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
            endpoint={'operationUrl':model.url,'model':'fixture-model','revision':'immutable-browser-v1','dimensions':3,'sendDimensions':True,
                'documentPrefix':'doc: ','queryPrefix':'query: ','normalization':'cosine','credentialFile':str(credential),
                'deadlineMs':10000,'maxResponseBytes':65536,'maxBatch':8,'maxInputBytes':16384,'maxRequestBytes':65536,
                'maxConcurrent':2,'maxQueued':4,'batchSize':1,'leaseSeconds':3,'pollIntervalMs':500}
            config={'data_dir':str(data),'api_origin':f'http://127.0.0.1:{port}','listen_address':'127.0.0.1','port':port,
                'content_mode':'path','content_suffix':'','loopback_dev':True,'chunk_bytes':262144,'sweep_interval_s':3600,
                'dashboard_dir':str(Path(__file__).resolve().parents[1]/'web/dashboard'),'unlock_shell_dir':None,'embedding':endpoint,
                'users':[{'id':'search-manager','type':'human','tokens':[{'id':'primary','hashFile':str(hashfile)}]}]}
            server=None
            def browser(stage):
                payload={'base':server.api_url,'token':token,'stage':stage,'browser':os.environ['MANURE_CHROMIUM_BIN'],
                    'core':os.environ['MANURE_PLAYWRIGHT_CORE_PATH'],'artifacts':os.environ.get('MANURE_UX_ARTIFACTS','')}
                result=subprocess.run([os.environ.get('MANURE_NODE_BIN','node'),str(Path(__file__).resolve().parent/'browser/dashboard-retrieval.mjs')],
                    input=json.dumps(payload).encode(),capture_output=True,timeout=120)
                self.assertEqual(result.returncode,0,result.stderr.decode()[-2000:])
                return json.loads(result.stdout)
            try:
                server=TargetServer(config,tmp,owned_database=database,close_database=False)
                client=ManureClient(server.api_url,token=token,cache_dir=str(root/'cache'))
                payload=b'BINARY_SECRET_NOT_APPROVED_FOR_EMBEDDING\x00'*100
                sha=hashlib.sha256(payload).hexdigest()
                initialized=client.init_upload('<img src=x onerror=alert(1)> hayneedle','dir','external',
                    [{'kind':'file','path':'catalogue/hayneedle.bin','size':len(payload),'sha256':sha}])
                aid=initialized['artifact_id']
                client.put_chunk(aid,'catalogue/hayneedle.bin',0,payload);client.publish(aid)
                deadline=time.monotonic()+25
                while time.monotonic()<deadline:
                    try:
                        if client.search('hayneedle','semantic')['hits']:break
                    except ManureError as error:self.assertEqual(error.code,'search-unavailable')
                    time.sleep(.1)
                else:self.fail('controlled provider publication exceeded 25 seconds')
                before=len(model.snapshot())
                self.assertEqual(browser('lexical')['requests'].count('Lexical'),1)
                self.assertEqual(len(model.snapshot()),before,'lexical browser request called embedding provider')
                semantic=browser('semantic')
                self.assertEqual(semantic['requests'].count('Semantic'),1)
                self.assertEqual(semantic['requests'].count('Hybrid'),2,'explicit submit and recovered Enter after canceled pointer only')
                calls=model.snapshot()[before:]
                self.assertGreaterEqual(len(calls),2)
                self.assertTrue(all('BINARY_SECRET_NOT_APPROVED_FOR_EMBEDDING' not in str(call) for call in calls))
                model.fail_all=True
                previous=len(model.snapshot())
                outage=browser('outage')
                self.assertEqual(outage['requests'].count('Hybrid'),1)
                self.assertEqual(outage['requests'].count('Lexical'),1)
                self.assertEqual(len(model.snapshot()),previous+1,'outage fallback or lexical requested an embedding')
                model.fail_all=False
                server.close();server=None
                config['embedding']=None
                server=TargetServer(config,tmp,owned_database=database,close_database=False)
                self.assertEqual(browser('no-provider')['requests'].count('Lexical'),1)
                self.assertEqual(len(model.snapshot()),previous+1,'no-provider browser caused model request')
            finally:
                if server is not None:server.close()
                database.close();model.close()


if __name__=='__main__':unittest.main()
