"""Owned replacement-executable fixture; no Python server/storage imports.

Behavioral-Active / Effectual-GoodCommunication test infrastructure. Requires an
explicit CREATEDB opt-in and the disposable runner's PostgreSQL provider. Never
resets an existing DB; every instance gets a fresh database and physical root.
"""
from __future__ import annotations

from collections import deque
import json
import os
from pathlib import Path
import queue
import re
import shutil
import signal
import subprocess
import threading
import time
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from manure import current_protocol as cp


def _required(name):
    value=os.environ.get(name)
    if not value:raise RuntimeError('required target-test prerequisite missing: '+name)
    return value


class OwnedDatabase:
    def __init__(self,directory):
        if os.environ.get('MANURE_TEST_ALLOW_CREATEDB')!='1':
            raise RuntimeError('MANURE_TEST_ALLOW_CREATEDB=1 is required for disposable target databases')
        self.psql=shutil.which('psql')
        if self.psql is None:raise RuntimeError('psql required for owned target database provisioning')
        self.base=_required('MANURE_TEST_JDBC_URL')
        if not self.base.startswith('jdbc:postgresql://'):raise RuntimeError('invalid test JDBC provider')
        self.parsed=urlsplit(self.base[5:])
        if (self.parsed.scheme!='postgresql' or not self.parsed.hostname or self.parsed.username
                or self.parsed.password or self.parsed.query or self.parsed.fragment):
            raise RuntimeError('owned target JDBC provider must be a plain PostgreSQL URL')
        self.user=_required('MANURE_TEST_JDBC_USER')
        self.password_file=str(Path(_required('MANURE_TEST_JDBC_PASSWORD_FILE')).resolve(strict=True))
        self.name='manure_browser_'+uuid4().hex
        self.jdbc='jdbc:'+urlunsplit((self.parsed.scheme,self.parsed.netloc,'/'+self.name,'',''))
        raw=Path(self.password_file).read_bytes()
        if raw.endswith(b'\n'):raw=raw[:-1]
        if not raw or b'\n' in raw or b'\r' in raw or b'\x00' in raw:raise RuntimeError('invalid owned test credential file')
        def escape(value):return value.replace('\\','\\\\').replace(':','\\:')
        password=raw.decode('utf-8')
        self.passfile=Path(directory)/('pgpass-'+self.name)
        descriptor=os.open(self.passfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(descriptor,'w',encoding='utf-8') as output:
            output.write(':'.join(escape(s) for s in [self.parsed.hostname,str(self.parsed.port or 5432),'*',self.user,password])+'\n')
        self.created=False
        try:
            self._sql('CREATE DATABASE '+self.name)
            self.created=True
        except BaseException:
            self.passfile.unlink(missing_ok=True)
            raise

    def _sql(self,statement):
        env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
        env.update(PGPASSFILE=str(self.passfile),PGCONNECT_TIMEOUT='10')
        result=subprocess.run([self.psql,'--no-psqlrc','--no-password','-h',self.parsed.hostname,
            '-p',str(self.parsed.port or 5432),'-U',self.user,'-d',self.parsed.path.lstrip('/') or 'postgres',
            '-v','ON_ERROR_STOP=1','-c',statement],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
        if result.returncode:raise RuntimeError('owned target database provisioning/cleanup failed')

    def close(self):
        try:
            if self.created:
                self._sql('DROP DATABASE '+self.name+' WITH (FORCE)')
                self.created=False
        finally:self.passfile.unlink(missing_ok=True)

    def config(self):
        return {'jdbcUrl':self.jdbc,'user':self.user,'passwordFile':self.password_file,
            'limits':{'maxConnections':4,'maxQueued':16,'queueTimeoutMs':5000,'connectTimeoutMs':5000,
                'statementTimeoutMs':30000,'lockTimeoutMs':5000,'idleTransactionTimeoutMs':30000,'socketTimeoutMs':30000}}


class TargetServer:
    def __init__(self,config:dict,directory:str,*,owned_database=None,close_database=True):
        command=json.loads(_required('MANURE_TEST_SERVER_COMMAND_JSON'))
        if not isinstance(command,list) or not command or not all(isinstance(v,str) and v for v in command):
            raise RuntimeError('MANURE_TEST_SERVER_COMMAND_JSON must be a nonempty argv array')
        self.config=dict(config);self.process=None;self.database=None;self.closed=False
        self._stdout=deque(maxlen=100);self._stderr=deque(maxlen=100)
        if owned_database is not None and not isinstance(owned_database,OwnedDatabase):
            raise RuntimeError('existing fixture database must be an OwnedDatabase')
        self.database=owned_database if owned_database is not None else OwnedDatabase(directory)
        self.close_database=close_database
        self.config['database']=self.database.config()
        library=os.environ.get('MANURE_POSIX_LIBRARY')
        self.config['native_mode']='shared' if library else 'linked'
        self.config['posix_library']=library
        path=Path(directory)/('target-config-'+uuid4().hex+'.json')
        path.write_text(json.dumps(self.config));path.chmod(0o600);self.config_path=path
        try:
            self.process=subprocess.Popen(command+['serve',str(path)],stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',errors='replace',
                cwd=str(Path(__file__).resolve().parents[2]),start_new_session=True)
            ready=queue.Queue()
            def drain(stream,lines,notify=False):
                for line in stream:
                    if len(line)>1048576:
                        if notify:ready.put(RuntimeError('oversized target readiness output'))
                        continue
                    lines.append(line)
                    if notify and line.startswith('MANURE_READY '):ready.put(line[len('MANURE_READY '):])
            self.threads=[threading.Thread(target=drain,args=(self.process.stdout,self._stdout,True),daemon=True),
                          threading.Thread(target=drain,args=(self.process.stderr,self._stderr),daemon=True)]
            for thread in self.threads:thread.start()
            deadline=time.monotonic()+90
            while True:
                if self.process.poll() is not None:
                    for thread in self.threads:thread.join(timeout=5)
                    # Production adapter emits fixed stage/category diagnostics only.
                    raise RuntimeError('target executable exited before readiness: '+''.join(self._stderr)[-4096:])
                remaining=deadline-time.monotonic()
                if remaining<=0:raise RuntimeError('target executable readiness deadline exceeded')
                try:message=ready.get(timeout=min(0.1,remaining))
                except queue.Empty:continue
                if isinstance(message,Exception):raise message
                info=json.loads(message)
                if (set(info)!={'apiOrigin','port','pid'} or type(info['port']) is not int or not 0<info['port']<=65535
                        or type(info['pid']) is not int or info['pid']<=0):raise RuntimeError('invalid target readiness record')
                effective=urlsplit(info['apiOrigin']);configured=urlsplit(self.config['api_origin'])
                if (effective.scheme!=configured.scheme or effective.hostname!=configured.hostname or effective.port!=info['port']
                        or effective.path or effective.query or effective.fragment or effective.username or effective.password):
                    raise RuntimeError('target readiness origin does not match configuration')
                self.bound_port=info['port'];self.effective_api_origin=info['apiOrigin'];self.api_url=info['apiOrigin']
                break
            self._check_version()
        except BaseException:
            self.close()
            raise

    def _check_version(self):
        # Dial listen_address, but retain exact configured Host authority. TLS
        # fixtures establish their edge after bind, so readiness API is plain
        # loopback with the precise trusted-peer XFP header for HTTPS origins.
        import http.client
        rid=uuid4();origin=urlsplit(self.effective_api_origin)
        conn=http.client.HTTPConnection(self.config.get('listen_address','127.0.0.1'),self.bound_port,timeout=10)
        headers={'Host':origin.netloc,'Content-Type':'application/json'}
        if origin.scheme=='https':headers['X-Forwarded-Proto']='https'
        try:
            conn.request('POST','/api/current',body=cp.dumps(cp.ClientEnvelope(rid,cp.API_VERSION,cp.Command_Version())),headers=headers)
            response=conn.getresponse();payload=response.read(4194305)
            if response.status!=200 or len(payload)>4194304:raise RuntimeError('target Version readiness probe failed')
            result=cp.response(payload,rid,cp.Result_Version)
            if not isinstance(result,cp.Result_Version) or result.versions.current!=cp.API_VERSION or result.versions.supported!=[cp.API_VERSION]:
                raise RuntimeError('target does not expose the sole current API')
        finally:conn.close()

    def content_url(self,artifact_id):
        if not re.fullmatch('[0-9a-f]{32}',artifact_id):raise ValueError('invalid artifact id')
        if self.config.get('content_mode','subdomain')=='path':return self.effective_api_origin+'/view/'+artifact_id
        origin=urlsplit(self.effective_api_origin)
        port='' if self.bound_port==(443 if origin.scheme=='https' else 80) else ':'+str(self.bound_port)
        return origin.scheme+'://'+artifact_id+'.'+self.config['content_suffix']+port

    def close(self):
        if self.closed:return
        try:
            if self.process is not None:
                if self.process.poll() is None:
                    try:os.killpg(self.process.pid,signal.SIGTERM)
                    except ProcessLookupError:pass
                    try:self.process.wait(timeout=30)
                    except subprocess.TimeoutExpired:
                        os.killpg(self.process.pid,signal.SIGKILL);self.process.wait(timeout=10)
                        raise RuntimeError('target failed graceful-shutdown deadline')
                for thread in getattr(self,'threads',[]):thread.join(timeout=5)
                if self.process.stdout:self.process.stdout.close()
                if self.process.stderr:self.process.stderr.close()
        finally:
            if self.database is not None and getattr(self,'close_database',True):self.database.close()
            self.closed=True

    def __enter__(self):return self
    def __exit__(self,*_):self.close()
