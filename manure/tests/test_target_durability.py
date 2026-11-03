"""Actual target-process durability/lifecycle, owned PG and descriptor-backed FS.

No Python backend or production test switch. A fixture-owned PostgreSQL trigger
pauses the ready-row commit only to expose an exact new-server publish crash
window after the real filesystem rename/fsync; it is removed before recovery.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import hashlib
import http.client
import json
import os
from pathlib import Path
import signal
import socket
import tempfile
import threading
import time
import unittest
from urllib.parse import urlencode
from uuid import uuid4

from manure import auth as A,current_protocol as cp
from manure.client import ManureClient,ManureError
from target_server import OwnedDatabase,TargetServer


@contextmanager
def fixture(**overrides):
    with tempfile.TemporaryDirectory(prefix='manure-target-durability-') as tmp:
        root=Path(tmp);(root/'data').mkdir(mode=0o700)
        token=A.generate_token();digest=root/'operator.digest';digest.write_text(A.sha256_hex(token)+'\n');digest.chmod(0o600)
        other=A.generate_token();other_digest=root/'other.digest';other_digest.write_text(A.sha256_hex(other)+'\n');other_digest.chmod(0o600)
        sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
        config={'data_dir':str(root/'data'),'api_origin':f'http://127.0.0.1:{port}','listen_address':'127.0.0.1','port':port,
            'content_mode':'path','content_suffix':'','loopback_dev':True,'chunk_bytes':262144,'sweep_interval_s':3600,
            'dashboard_dir':None,'unlock_shell_dir':None,'users':[
                {'id':'owner','type':'human','tokens':[{'id':'primary','hashFile':str(digest)}]},
                {'id':'other','type':'agent','tokens':[{'id':'primary','hashFile':str(other_digest)}]}]}
        config.update(overrides);database=OwnedDatabase(tmp)
        try:yield root,config,database,token,other
        finally:database.close()


def client(server,token,root,suffix='cache'):
    return ManureClient(server.api_url,token=token,cache_dir=str(root/suffix))


def upload(c,data,name='file.bin',visibility='public'):
    initialized=c.init_upload('durability','file',visibility,[{'path':name,'kind':'file','size':len(data),'sha256':hashlib.sha256(data).hexdigest()}])
    for offset in range(0,len(data),262144):c.put_chunk(initialized['artifact_id'],name,offset,data[offset:offset+262144])
    return initialized


def kill(server):
    os.killpg(server.process.pid,signal.SIGKILL);server.process.wait(timeout=10);server.close()


def response_head(sock):
    head=b''
    while b'\r\n\r\n' not in head:
        block=sock.recv(4096)
        if not block:raise AssertionError('target closed before response head')
        head+=block
        if len(head)>65536:raise AssertionError('response header bound exceeded')
    header,_,body=head.partition(b'\r\n\r\n')
    fields={}
    for line in header.decode('latin-1').split('\r\n')[1:]:
        key,_,value=line.partition(':');fields[key.lower()]=value.strip()
    return int(header.split(b' ',2)[1]),fields,body


class TargetDurabilityTests(unittest.TestCase):
    def test_reverse_and_concurrent_receipts_server_sigkill_after_ack_resume(self):
        with fixture() as (root,config,database,token,other):
            data=bytes(range(251))*3200;size=len(data);server=TargetServer(config,str(root),owned_database=database,close_database=False)
            try:
                c=client(server,token,root)
                initialized=c.init_upload('reverse','file','public',[{'path':'file.bin','kind':'file','size':size,'sha256':hashlib.sha256(data).hexdigest()}])
                aid=initialized['artifact_id'];tail=(size//262144)*262144
                first=c.put_chunk(aid,'file.bin',tail,data[tail:]);self.assertEqual(first['received_bytes'],size-tail)
                # Real receipt ACK observed by the client, then actual server death.
                kill(server);server=None
                server=TargetServer(config,str(root),owned_database=database,close_database=False);c=client(server,token,root,'restart-cache')
                status=c.get_upload_status(aid);self.assertEqual(status['files'][0]['received_ranges'],[[tail,size]])
                offsets=list(reversed(range(0,tail,262144)));barrier=threading.Barrier(len(offsets))
                def put(offset):
                    local=client(server,token,root,'worker-'+str(offset));barrier.wait(timeout=15)
                    return local.put_chunk(aid,'file.bin',offset,data[offset:offset+262144])
                with ThreadPoolExecutor(max_workers=len(offsets)) as executor:
                    futures=[executor.submit(put,o) for o in offsets]
                    for future in futures:self.assertGreater(future.result(timeout=15)['received_bytes'],0)
                self.assertEqual(c.get_upload_status(aid)['files'][0]['received_ranges'],[[0,size]])
                for _ in range(3):self.assertEqual(c.put_chunk(aid,'file.bin',0,data[:262144])['received_bytes'],size)
                wrong=bytes([data[0]^1])+data[1:262144]
                with self.assertRaises(ManureError) as conflict:c.put_chunk(aid,'file.bin',0,wrong)
                self.assertEqual(conflict.exception.code,'chunk-conflict')
                self.assertEqual(c.publish(aid)['state'],'ready')
                destination=root/'download';c.fetch_to_dest(aid,destination)
                self.assertEqual((destination/'file.bin').read_bytes(),data)
                # Shared incomplete catalogue/read/abort with owner-only mutations.
                incomplete=c.init_upload('shared','file','external',[{'path':'pending','kind':'file','size':1,'sha256':hashlib.sha256(b'x').hexdigest()}])
                b=client(server,other,root,'other-cache');pending=incomplete['artifact_id']
                self.assertEqual(b.get_artifact(pending)['state'],'uploading');self.assertEqual(b.get_upload_status(pending)['state'],'uploading')
                self.assertIn(pending,[a['artifact_id'] for a in b.list_artifacts()['artifacts']])
                for mutation in (lambda:b.put_chunk(pending,'pending',0,b'x'),lambda:b.publish(pending),lambda:b.patch_artifact(pending,name='not-owner')):
                    with self.assertRaises(ManureError) as denied:mutation()
                    self.assertEqual(denied.exception.code,'session-not-owned')
                self.assertTrue(b.rotate_password(pending)['external_password']);b.delete(pending)
                with self.assertRaises(ManureError) as missing:c.get_artifact(pending)
                self.assertEqual(missing.exception.code,'not-found')
                self.assertFalse((root/'data'/'manure.db').exists())
            finally:
                if server is not None:server.close()

    def test_server_sigkill_after_rename_before_ready_commit_recovers(self):
        with fixture() as (root,config,database,token,_):
            data=b'new-server-publish-window'*16000
            server=TargetServer(config,str(root),owned_database=database,close_database=False);thread=None
            try:
                c=client(server,token,root);aid=upload(c,data)['artifact_id']
                sql=f"""CREATE FUNCTION manure.pause_ready_fixture() RETURNS trigger LANGUAGE plpgsql AS $fixture$
                BEGIN IF NEW.id=convert_to('{aid}','UTF8') AND OLD.state=convert_to('publishing','UTF8') AND NEW.state=convert_to('ready','UTF8')
                THEN PERFORM pg_sleep(20); END IF; RETURN NEW; END $fixture$;
                CREATE TRIGGER pause_ready_fixture AFTER UPDATE ON manure.artifacts FOR EACH ROW EXECUTE FUNCTION manure.pause_ready_fixture();"""
                database.runtime_sql(sql);outcome=[]
                def publish():
                    try:outcome.append(c.publish(aid))
                    except ManureError:outcome.append('unacknowledged')
                thread=threading.Thread(target=publish,daemon=True);thread.start()
                deadline=time.monotonic()+10
                while time.monotonic()<deadline:
                    if database.runtime_sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND wait_event='PgSleep'")=='1':break
                    time.sleep(.05)
                else:self.fail('did not observe exact ready-commit pause')
                self.assertEqual(database.runtime_sql(f"SELECT convert_from(state,'UTF8') FROM manure.artifacts WHERE id=convert_to('{aid}','UTF8')"),'publishing')
                self.assertEqual((root/'data'/'live'/aid/'file.bin').read_bytes(),data)
                kill(server);server=None;thread.join(timeout=10);self.assertFalse(thread.is_alive())
                self.assertEqual(outcome,['unacknowledged'])
                database.runtime_sql('DROP TRIGGER pause_ready_fixture ON manure.artifacts; DROP FUNCTION manure.pause_ready_fixture();')
                server=TargetServer(config,str(root),owned_database=database,close_database=False);c=client(server,token,root,'recovered-cache')
                self.assertEqual(c.get_artifact(aid)['state'],'ready')
                output=root/'recovered';c.fetch_to_dest(aid,output);self.assertEqual((output/'file.bin').read_bytes(),data)
                self.assertEqual(c.get_upload_status(aid)['files'][0]['received_bytes'],0)
            finally:
                if server is not None:server.close()
                if thread is not None:thread.join(timeout=10)

    def test_shutdown_drains_active_chunk_and_stream_and_releases_claim(self):
        with fixture() as (root,config,database,token,_):
            server=TargetServer(config,str(root),owned_database=database,close_database=False);closer=None
            errors=[]
            def close_active():
                try:server.close()
                except BaseException as error:errors.append(type(error).__name__)
            try:
                c=client(server,token,root);data=b'a'*262144
                aid=c.init_upload('active-body','file','public',[{'path':'file.bin','kind':'file','size':len(data),'sha256':hashlib.sha256(data).hexdigest()}])['artifact_id']
                sock=socket.create_connection(('127.0.0.1',server.bound_port),timeout=10);sock.settimeout(10)
                query=urlencode({'path':'file.bin','offset':0})
                head=(f'PUT /api/current/artifacts/{aid}/chunks?{query} HTTP/1.1\r\nHost: 127.0.0.1:{server.bound_port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/octet-stream\r\nContent-Length: {len(data)}\r\nX-Chunk-Sha256: {hashlib.sha256(data).hexdigest()}\r\nConnection: close\r\n\r\n').encode()
                sock.sendall(head+data[:65536]);time.sleep(.1)
                closer=threading.Thread(target=close_active,daemon=True);closer.start();time.sleep(.1)
                sock.sendall(data[65536:]);status,fields,body=response_head(sock)
                while len(body)<int(fields['content-length']):
                    part=sock.recv(65536)
                    if not part:raise AssertionError('target closed before acknowledged chunk receipt body')
                    body+=part
                sock.close();self.assertEqual(status,200)
                receipt=cp.decode(cp.ChunkReceipt,cp.loads(body));self.assertEqual(receipt.receivedBytes,len(data))
                closer.join(timeout=30);self.assertFalse(closer.is_alive());self.assertEqual(errors,[]);server=None
                server=TargetServer(config,str(root),owned_database=database,close_database=False);c=client(server,token,root,'after-close')
                self.assertEqual(c.get_upload_status(aid)['files'][0]['received_bytes'],len(data));c.publish(aid)
                large=bytes(range(251))*40000;large_id=upload(c,large,name='large.bin')['artifact_id'];c.publish(large_id)
                stream=socket.create_connection(('127.0.0.1',server.bound_port),timeout=10);stream.settimeout(10)
                stream.sendall(f'GET /api/current/artifacts/{large_id}/files/large.bin/content HTTP/1.1\r\nHost: 127.0.0.1:{server.bound_port}\r\nConnection: close\r\n\r\n'.encode())
                status,fields,body=response_head(stream);self.assertEqual(status,200);self.assertEqual(int(fields['content-length']),len(large))
                closer=threading.Thread(target=close_active,daemon=True);closer.start();time.sleep(.2)
                while len(body)<len(large):
                    part=stream.recv(65536)
                    if not part:break
                    body+=part
                stream.close();self.assertEqual(body,large)
                closer.join(timeout=30);self.assertFalse(closer.is_alive());self.assertEqual(errors,[]);server=None
                server=TargetServer(config,str(root),owned_database=database,close_database=False)
                self.assertEqual(client(server,token,root,'final-cache').get_artifact(large_id)['state'],'ready')
            finally:
                if server is not None:server.close()
                if closer is not None:closer.join(timeout=30)

    def test_connection_admission_returns_503_while_body_worker_active(self):
        with fixture(max_connections=1) as (root,config,database,token,_):
            server=TargetServer(config,str(root),owned_database=database,close_database=False);stalled=None
            try:
                rid=uuid4();payload=cp.dumps(cp.ClientEnvelope(rid,cp.API_VERSION,cp.Command_InitUpload('pending',cp.ArtifactKind.Directory,cp.Visibility.Internal,None,[])))
                stalled=socket.create_connection(('127.0.0.1',server.bound_port),timeout=10)
                head=(f'POST /api/current HTTP/1.1\r\nHost: 127.0.0.1:{server.bound_port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {len(payload)}\r\n\r\n').encode()
                stalled.sendall(head+payload[:1]);time.sleep(.2)
                probe=http.client.HTTPConnection('127.0.0.1',server.bound_port,timeout=5)
                try:
                    version=cp.dumps(cp.ClientEnvelope(uuid4(),cp.API_VERSION,cp.Command_Version()))
                    probe.request('POST','/api/current',version,{'Content-Type':'application/json','Connection':'close'})
                    response=probe.getresponse();wire=response.read();self.assertEqual(response.status,503)
                    self.assertEqual(response.getheader('Retry-After'),'5')
                    result=cp.decode(cp.ServerEnvelope,cp.loads(wire));self.assertIsInstance(result.result,cp.Result_Error)
                    self.assertEqual(result.result.failure.code,cp.ErrorCode.Unavailable)
                finally:probe.close()
                stalled.close();stalled=None
                self.assertEqual(client(server,token,root).list_artifacts()['artifacts'],[])
            finally:
                if stalled is not None:stalled.close()
                server.close()


if __name__=='__main__':unittest.main()
