"""Specified BG/Effectual-Group current transport, real client filesystem algorithms.

A typed controlled transport is not a legacy Python HTTP server or PostgreSQL
oracle. Real replacement executable/browser/native acceptance is separate.
"""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import parse_qs, unquote, urlsplit
from uuid import UUID

from manure import current_protocol as p
from manure.client import ManureClient, ManureError

TOKEN='A'*43
PASSWORD='B'*42+'A'
AID='a'*32
ORIGIN='http://127.0.0.1:47329'
CONTENT='http://'+AID+'.artifacts.localhost:47329'
CHUNK=262144


class CurrentTransport:
    def __init__(self, content_base=CONTENT):
        self.requests=[];self.commands=[];self.files=[];self.received={};self.state=p.ArtifactState.Uploading
        self.visibility=p.Visibility.Internal;self.content_base=content_base;self.name='fixture'
        self.override=None

    def artifact(self):
        return p.Artifact(AID,self.name,p.ArtifactKind.Directory,self.visibility,self.state,'u',
            '2026-11-03T00:00:00Z',None,sum(f.size for f in self.files if isinstance(f,p.ManifestEntry_File)),
            sum(isinstance(f,p.ManifestEntry_File) for f in self.files),self.content_base)

    def request(self,method,url,headers,body):
        self.requests.append((method,url,dict(headers),body));path=urlsplit(url).path
        if self.override is not None:
            result=self.override(method,url,headers,body)
            if result is not None:return result
        if method=='POST' and path.endswith('/__manure/current'):
            self.assert_content(headers)
            req=p.decode(p.ContentEnvelope,p.loads(body));command=req.command;extra={}
            if isinstance(command,p.ContentCommand_Unlock):
                assert command.password==PASSWORD
                assert headers['Origin']==ORIGIN if self.content_base.startswith(ORIGIN) else headers['Origin']==CONTENT
                extra={'Set-Cookie':'mgrant-dev=grant-cookie; Path=/; HttpOnly; SameSite=Lax'}
                result=p.Result_Ok()
            elif isinstance(command,p.ContentCommand_GetManifest):
                if self.visibility is not p.Visibility.Public:assert headers.get('Cookie')=='mgrant-dev=grant-cookie'
                result=p.Result_ArtifactManifest(p.Manifest(AID,self.state,self.files))
            else:result=p.Result_Ok()
            return 200,extra,p.dumps(p.ServerEnvelope(req.requestId,result))
        if method=='POST' and path=='/api/current':
            req=p.decode(p.ClientEnvelope,p.loads(body));assert req.apiVersion==p.API_VERSION
            command=req.command;self.commands.append(command)
            assert headers.get('Authorization')=='Bearer '+TOKEN
            assert 'Cookie' not in headers
            if isinstance(command,p.Command_InitUpload):
                self.files=command.files;self.name=command.name;self.visibility=command.visibility
                result=p.Result_UploadInitialized(AID,CHUNK,self.content_base,PASSWORD if command.visibility is p.Visibility.External else None)
            elif isinstance(command,p.Command_GetArtifact):result=p.Result_ArtifactInfo(self.artifact())
            elif isinstance(command,p.Command_GetManifest):result=p.Result_ArtifactManifest(p.Manifest(AID,self.state,self.files))
            elif isinstance(command,p.Command_GetUploadStatus):
                progress=[]
                for f in self.files:
                    if isinstance(f,p.ManifestEntry_File):
                        data=self.received.get(f.path,b'');progress.append(p.FileProgress(f.path,f.size,len(data),[p.ByteRange(0,len(data))] if data else []))
                result=p.Result_UploadProgress(p.UploadStatus(AID,self.state,CHUNK,progress))
            elif isinstance(command,p.Command_FinishUpload):
                for f in self.files:
                    if isinstance(f,p.ManifestEntry_File):assert hashlib.sha256(self.received.get(f.path,b'')).hexdigest()==f.sha256
                self.state=p.ArtifactState.Ready;result=p.Result_UploadFinished(AID,self.state,self.content_base)
            elif isinstance(command,p.Command_PatchArtifact):
                if command.patch.name is not None:self.name=command.patch.name
                if command.patch.visibility is not None:self.visibility=command.patch.visibility
                result=p.Result_ArtifactPatched(self.artifact(),PASSWORD if self.visibility is p.Visibility.External else None)
            elif isinstance(command,p.Command_ListArtifacts):result=p.Result_Catalogue(p.CataloguePage([self.artifact()],None))
            elif isinstance(command,p.Command_Whoami):result=p.Result_Identity(p.Principal('u','t',p.PrincipalType.Agent))
            elif isinstance(command,p.Command_RotateExternalPassword):result=p.Result_PasswordRotated(PASSWORD)
            elif isinstance(command,p.Command_CreateGrant):result=p.Result_GrantCreated('handoff',60)
            elif isinstance(command,p.Command_Search):result=p.Result_SearchResults(p.SearchPage([],0,p.SearchCountScope.ExactMatches,None,None))
            else:result=p.Result_Ok()
            return 200,{},p.dumps(p.ServerEnvelope(req.requestId,result))
        if method=='PUT' and path==f'/api/current/artifacts/{AID}/chunks':
            assert headers['Authorization']=='Bearer '+TOKEN
            q=parse_qs(urlsplit(url).query);name=q['path'][0];offset=int(q['offset'][0])
            assert hashlib.sha256(body).hexdigest()==headers['X-Chunk-Sha256']
            data=self.received.get(name,b'')
            if offset < len(data):assert data[offset:offset+len(body)]==body
            else:assert offset==len(data);self.received[name]=data+body
            return 200,{},p.dumps(p.ChunkReceipt(name,offset,len(body),len(self.received[name])))
        if method=='GET' and path.endswith('/content'):
            if '/__manure/files/' in path:self.assert_content(headers);enc=path.split('/__manure/files/')[1][:-8]
            else:
                assert headers['Authorization']=='Bearer '+TOKEN
                assert path.startswith(f'/api/current/artifacts/{AID}/files/')
                enc=path.split('/files/')[1][:-8]
            data=self.received[unquote(enc)]
            if 'Range' not in headers:return 200,{},data
            start,end=map(int,headers['Range'][6:].split('-'));end=min(end,len(data)-1)
            return 206,{'Content-Range':f'bytes {start}-{end}/{len(data)}'},data[start:end+1]
        raise AssertionError((method,path))

    @staticmethod
    def assert_content(headers):
        assert not any(k.lower()=='authorization' for k in headers)


class CurrentClientTests(unittest.TestCase):
    def test_full_upload_fetch_empty_dirs_hashes_ranges_and_secret_free_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);src=root/'source';src.mkdir();(src/'empty').mkdir()
            data=b'hello\x00current'*40000;(src/'é.bin').write_bytes(data)
            transport=CurrentTransport();client=ManureClient(ORIGIN,TOKEN,cache_dir=root/'cache',transport=transport)
            result=client.upload_path(src,'external')
            self.assertEqual(result['external_password'],PASSWORD)
            self.assertEqual(result['access'],'external')
            self.assertEqual(list((root/'cache/uploads').glob('*.json')),[])
            client.fetch_to_dest(AID,root/'dest')
            self.assertEqual((root/'dest/é.bin').read_bytes(),data)
            self.assertTrue((root/'dest/empty').is_dir())
            self.assertTrue(any(m=='PUT' for m,*_ in transport.requests))
            self.assertTrue(all('/api/v1' not in url for _,url,_,_ in transport.requests))

    def test_restart_resume_uses_committed_ranges_without_restart_or_secret_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);src=root/'source.bin';src.write_bytes(b'x'*(CHUNK+41));transport=CurrentTransport()
            count=0
            def interrupt(method,url,headers,body):
                nonlocal count
                if method=='PUT':
                    count+=1
                    if count==2:raise OSError('canary-network-detail')
            transport.override=interrupt
            client=ManureClient(ORIGIN,TOKEN,cache_dir=root/'cache',transport=transport)
            with self.assertRaises(ManureError) as error:client.upload_path(src,'external')
            self.assertNotIn('canary',str(error.exception))
            cache=(root/'cache/uploads'/f'{AID}.json').read_text()
            self.assertNotIn(TOKEN,cache);self.assertNotIn(PASSWORD,cache)
            transport.override=None;transport.requests=[]
            restarted=ManureClient(ORIGIN,TOKEN,cache_dir=root/'cache',transport=transport)
            result=restarted.upload_path(src,'external',resume_id=AID)
            puts=[r for r in transport.requests if r[0]=='PUT']
            self.assertEqual(len(puts),1);self.assertIn('offset='+str(CHUNK),puts[0][1])
            self.assertIsNone(result['external_password']);self.assertIn('rotate-password',result['password_note'])
            self.assertEqual(list((root/'cache/uploads').glob('*.json')),[])

    def test_typed_catalogue_patch_management_and_search(self):
        transport=CurrentTransport();client=ManureClient(ORIGIN,TOKEN,transport=transport)
        self.assertEqual(client.whoami(),{'user_id':'u','token_id':'t','type':'agent'})
        page=client.list_artifacts(query='Straße',sort_by='name',direction='asc')
        self.assertEqual(page['artifacts'][0]['artifact_id'],AID)
        command=transport.commands[-1]
        self.assertIsInstance(command,p.Command_ListArtifacts);self.assertEqual(command.query.query,'Straße')
        for kwargs,kind in [({},p.ExpiryChange_Keep),({'expires_in_s':None},p.ExpiryChange_Clear),({'expires_in_s':60},p.ExpiryChange_Set)]:
            client.patch_artifact(AID,**kwargs);self.assertIsInstance(transport.commands[-1].patch.expiry,kind)
        self.assertEqual(client.search('content','hybrid')['count_scope'],'exactmatches')
        self.assertIs(transport.commands[-1].query.mode,p.SearchMode.Hybrid)
        self.assertEqual(client.create_grant(AID)['expires_in_s'],60)
        self.assertEqual(client.rotate_password(AID)['external_password'],PASSWORD)
        self.assertEqual(client.delete(AID),{'ok':True})

    def test_content_external_token_free_and_path_grant_scope(self):
        for content in [CONTENT,ORIGIN+'/view/'+AID]:
            with self.subTest(content=content),tempfile.TemporaryDirectory() as tmp:
                transport=CurrentTransport(content);transport.state=p.ArtifactState.Ready;transport.visibility=p.Visibility.External
                transport.files=[p.ManifestEntry_File('f',4,hashlib.sha256(b'data').hexdigest()),p.ManifestEntry_Directory('empty')]
                transport.received={'f':b'data'}
                client=ManureClient(ORIGIN,TOKEN,transport=transport)
                client.fetch_to_dest(content,Path(tmp)/'dest',password=PASSWORD)
                self.assertEqual((Path(tmp)/'dest/f').read_bytes(),b'data')
                for method,url,headers,body in transport.requests:
                    self.assertNotIn('Authorization',headers)
                    self.assertNotIn(PASSWORD,url)
                    if body:
                        env=p.decode(p.ContentEnvelope,p.loads(body))
                        self.assertIsInstance(env.command,(p.ContentCommand_Unlock,p.ContentCommand_GetManifest))
                self.assertEqual(len(client._grants),1)

    def test_untrusted_current_faults_and_protocol_shapes_do_not_echo_secrets(self):
        for status,payload in [(200,b'{"requestId":"bad","result":{"Ok":{}}}'),
                               (200,b'{"result":{"Ok":{}},"result":{"Ok":{}}}'),
                               (503,b'canary-'+TOKEN.encode())]:
            with self.subTest(status=status):
                transport=CurrentTransport();transport.override=lambda *_:(status,{},payload)
                client=ManureClient(ORIGIN,TOKEN,transport=transport)
                with self.assertRaises(ManureError) as error:client.whoami()
                self.assertNotIn(TOKEN,str(error.exception));self.assertNotIn('canary',str(error.exception))

    def test_domain_error_retry_after_and_chunk_receipt_mismatch(self):
        transport=CurrentTransport()
        def fail(method,url,headers,body):
            if method=='POST':
                req=p.decode(p.ClientEnvelope,p.loads(body))
                return 429,{'Retry-After':'7'},p.dumps(p.ServerEnvelope(req.requestId,p.Result_Error(p.Failure(p.ErrorCode.RateLimited,TOKEN,7))))
            return 200,{},p.dumps(p.ChunkReceipt('other',0,1,1))
        transport.override=fail;client=ManureClient(ORIGIN,TOKEN,transport=transport)
        with self.assertRaises(ManureError) as error:client.whoami()
        self.assertEqual(error.exception.code,'rate-limited');self.assertEqual(error.exception.retry_after,'7')
        self.assertNotIn(TOKEN,str(error.exception))
        with self.assertRaises(ManureError) as error:client.put_chunk(AID,'f',0,b'x')
        self.assertEqual(error.exception.code,'bad-envelope')


if __name__=='__main__':unittest.main()
