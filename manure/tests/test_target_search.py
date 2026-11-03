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
import os
from pathlib import Path
import socket
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
        self.lock=threading.Lock();self.calls=[];self.document_started=threading.Event()
        self.fail_documents=False;self.fail_all=False;self.slow_document_once=4.0
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
                    delay=owner.slow_document_once if document and not failure else 0
                    if delay:owner.slow_document_once=0
                if document:owner.document_started.set()
                if delay:time.sleep(delay)
                if failure:
                    payload=b'{"error":"controlled fixture outage"}';status=503
                else:
                    vectors=[{'index':i,'embedding':[1.0,.125,0.0] if 'hayneedle' in text.lower() else [.125,1.0,.25]} for i,text in enumerate(inputs)]
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
                    {'kind':'file','path':'catalogue/hayneedle.bin','size':len(payload),'sha256':sha},{'kind':'dir','path':'empty'}])
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
                lexical=client.search('hayneedle','lexical')
                self.assertEqual(lexical['count_scope'],'exactmatches');self.assertEqual(lexical['hits'][0]['embedding_space'],None)
                semantic=eventually(client,'semantic');hybrid=eventually(client,'hybrid')
                hit=semantic['hits'][0]
                self.assertEqual(hit['artifact']['artifact_id'],aid)
                for key in ('embedding_profile','embedding_space','source_version'):self.assertRegex(hit[key],r'^[0-9a-f]{64}$')
                self.assertNotEqual(hit['embedding_profile'],hit['embedding_space'])
                self.assertEqual(hit['policy_id'],'manure-metadata-paths-v1');self.assertTrue(hit['generation_id'])
                self.assertEqual(hybrid['hits'][0]['embedding_space'],hit['embedding_space'])
                encoded=json.dumps(model.snapshot(),ensure_ascii=False)
                for secret in (token,password,sha,'BINARY_SECRET_NOT_APPROVED_FOR_EMBEDDING'):
                    self.assertNotIn(secret,encoded)
                self.assertTrue(all(call['authorization'] is None for call in model.snapshot()))
                # Unauthenticated management search must reject BEFORE model IO.
                count=len(model.snapshot());rid=uuid4();connection=http.client.HTTPConnection('127.0.0.1',port,timeout=10)
                try:
                    command=cp.Command_Search(cp.SearchQuery('hayneedle',cp.SearchMode.Semantic,cp.SearchFilter(None,None,None),20,None))
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
                client.delete(aid)
                self.assertEqual(client.search('hayneedle','semantic')['hits'],[])
            finally:
                if server is not None:server.close()
                database.close();model.close()


if __name__=='__main__':unittest.main()
