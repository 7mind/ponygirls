"""Actual target-binary CLI SIGKILL/resume and range-fetch acceptance.

Behavioral-Active / Effectual-GoodCommunication, specified/regression scenarios.
Only the child client's transport is delayed/audited; the server is the configured
replacement executable over real PostgreSQL and the descriptor-safe payload root.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

from test_client_realserver import _make_server

# Audit only route/range/status and ACK after a real successful response. No
# headers, bodies, passwords or tokens are written. Delay AFTER the first real
# receipt ACK exposes a deterministic kill window without test server hooks.
TRACE_CLIENT = r'''
import json, os, sys, time
from manure.client import StdlibTransport
from manure.cli import main
original=StdlibTransport.request
log=os.environ['MANURE_TRACE_FILE']
delay=float(os.environ.get('MANURE_TRACE_ACK_DELAY','0'))
def traced(self,method,url,headers,body):
    status,response_headers,payload=original(self,method,url,headers,body)
    entry={'method':method,'url':url,'range':next((v for k,v in headers.items() if k.lower()=='range'),None),'status':status}
    with open(log,'a',encoding='utf-8') as output:
        output.write(json.dumps(entry)+'\n');output.flush();os.fsync(output.fileno())
    if method=='PUT' and status==200 and delay:time.sleep(delay)
    return status,response_headers,payload
StdlibTransport.request=traced
raise SystemExit(main(sys.argv[1:]))
'''


def _env_for(server,td,token):
    env={k:v for k,v in os.environ.items() if not k.startswith('MANURE_')}
    env.update(MANURE_URL=server.effective_api_origin,MANURE_TOKEN=token,
        MANURE_CACHE_DIR=str(Path(td)/'cache'),MANURE_TRACE_FILE=str(Path(td)/'transport.jsonl'),
        PYTHONPATH=os.pathsep.join([str(Path(__file__).resolve().parents[1]),env.get('PYTHONPATH','')]).rstrip(os.pathsep))
    return env


def _records(env):
    path=Path(env['MANURE_TRACE_FILE'])
    if not path.exists():return []
    return [json.loads(line) for line in path.read_text().splitlines(keepends=True) if line.endswith('\n')]


def _clear(env):Path(env['MANURE_TRACE_FILE']).write_text('')


def _wait_for_acks(proc,env,n,timeout=15):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if len([r for r in _records(env) if r['method']=='PUT' and r['status']==200])>=n:return True
        if proc.poll() is not None:return False
        time.sleep(0.005)
    return False


def _cli(env,*args):
    return subprocess.run([sys.executable,'-c',TRACE_CLIENT,*args],env=env,capture_output=True,text=True,timeout=60)


class TestSubprocessKillResume(unittest.TestCase):
    def _kill_resume(self,manual):
        with tempfile.TemporaryDirectory() as td:
            server,token=_make_server(td)
            try:
                src=Path(td)/('m.bin' if manual else 'big.bin');payload=(b'M' if manual else b'Q')*2500000;src.write_bytes(payload)
                env=_env_for(server,td,token);env['MANURE_TRACE_ACK_DELAY']='2'
                proc=subprocess.Popen([sys.executable,'-c',TRACE_CLIENT,'upload',str(src),'--access','internal','--json'],
                    env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                try:
                    self.assertTrue(_wait_for_acks(proc,env,1),msg='no durable real-service chunk ACK observed')
                    proc.kill();proc.communicate(timeout=10)
                finally:
                    if proc.poll() is None:proc.kill();proc.communicate(timeout=10)
                self.assertNotEqual(proc.returncode,0)
                records=list(Path(td,'cache').rglob('*.json'));self.assertEqual(len(records),1)
                text=records[0].read_text();self.assertNotIn(token,text);self.assertNotIn('external_password',text.lower())
                aid=json.loads(text)['artifact_id'];_clear(env);env['MANURE_TRACE_ACK_DELAY']='0'
                args=['upload',str(src),'--access','internal','--json']
                if manual:args+=['--resume',aid]
                result=_cli(env,*args);self.assertEqual(result.returncode,0,msg=result.stderr)
                self.assertEqual(json.loads(result.stdout)['artifact_id'],aid)
                puts=[r for r in _records(env) if r['method']=='PUT']
                offsets=sorted(int(r['url'].split('offset=')[1]) for r in puts)
                self.assertNotIn(0,offsets);self.assertLess(len(puts),10);self.assertEqual(offsets[0],262144)
                self.assertFalse(records[0].exists())
                dest=Path(td)/'out';fetched=_cli(env,'fetch',aid,str(dest))
                self.assertEqual(fetched.returncode,0,msg=fetched.stderr)
                self.assertEqual((dest/src.name).read_bytes(),payload)
            finally:server.close()

    def test_kill_auto_resume(self):self._kill_resume(False)
    def test_kill_manual_resume(self):self._kill_resume(True)


class TestOwnedFetchResumeRange(unittest.TestCase):
    def test_interrupted_fetch_resumes_exact_range(self):
        from manure.client import ManureClient,StdlibTransport,FETCH_RANGE_BYTES
        with tempfile.TemporaryDirectory() as td:
            server,token=_make_server(td)
            try:
                src=Path(td)/'f.bin';payload=b'F'*2500000;src.write_bytes(payload)
                base=server.effective_api_origin
                client=ManureClient(base,token,cache_dir=Path(td)/'cache0')
                aid=client.upload_path(src,'internal',fresh=True)['artifact_id']
                class FailOnce:
                    def __init__(self):self.inner=StdlibTransport();self.gets=0
                    def request(self,method,url,headers,body):
                        if method=='GET' and url.endswith('/content'):
                            self.gets+=1
                            if self.gets>1:raise ConnectionError('controlled interrupted fetch')
                        return self.inner.request(method,url,headers,body)
                dest=Path(td)/'out';first=ManureClient(base,token,cache_dir=Path(td)/'cache1',transport=FailOnce())
                with self.assertRaises(Exception):first.fetch_to_dest(aid,dest)
                stages=[p for p in dest.rglob('*') if '.manure-stage-' in str(p)]
                self.assertTrue(stages,msg='no owned staging preserved')
                parts=list(dest.rglob('*.part'));self.assertTrue(parts)
                partial=max(p.stat().st_size for p in parts);self.assertGreater(partial,0)
                class Audit:
                    def __init__(self):self.inner=StdlibTransport();self.ranges=[]
                    def request(self,method,url,headers,body):
                        if method=='GET' and url.endswith('/content'):
                            self.ranges.extend(v for k,v in headers.items() if k.lower()=='range')
                        return self.inner.request(method,url,headers,body)
                audit=Audit();second=ManureClient(base,token,cache_dir=Path(td)/'cache2',transport=audit)
                second.fetch_to_dest(aid,dest)
                self.assertEqual((dest/'f.bin').read_bytes(),payload)
                self.assertTrue(audit.ranges,msg='no real Range observed on resume')
                end=min(partial+FETCH_RANGE_BYTES-1,len(payload)-1)
                self.assertIn(f'bytes={partial}-{end}',audit.ranges)
            finally:server.close()


if __name__=='__main__':unittest.main()
