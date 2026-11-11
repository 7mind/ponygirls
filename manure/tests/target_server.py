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
    """Separate fixture administration from the actual runtime role.

    Release tests use the paired, registry-guarded owned-cluster helper. The
    direct CREATEDB branch is retained only for explicitly opted-in diagnostic
    clusters; it is NEVER a fallback after a helper error.
    """
    def __init__(self,directory):
        self.created=False;self.helper=None;self.passfile=None
        self.name='manure_browser_'+uuid4().hex
        helper=os.environ.get('MANURE_TEST_PROVISION_COMMAND')
        if helper:
            path=Path(helper)
            if not path.is_absolute() or not path.is_file() or not os.access(path,os.X_OK):
                raise RuntimeError('explicit executable test provision helper required')
            root=Path(_required('PONYGIRLS_OWNED_FIXTURE_ROOT'))
            if (not root.is_absolute() or root.resolve()!=root or not root.name.startswith('ponygirls-owned-pg-')
                    or (root/'.owned-test-only').read_bytes()!=b'ponygirls-owned-test-v1\n'):
                raise RuntimeError('owned disposable fixture binding required')
            self.helper=str(path);self.fixture_root=root
            cfg=json.loads((root/'provider.json').read_bytes())
            service=_required('PONYGIRLS_TEST_PROVISION_SERVICE')
            if service!='manure' or cfg['stateDirectory']!=str(root/'cluster'):
                raise RuntimeError('owned Manure provider binding required')
            self.provider=cfg
            try:
                result=self._helper(self.name)
                if not isinstance(result,dict) or set(result)!={'jdbcUrl','user','passwordFile'} or not all(isinstance(v,str) and v for v in result.values()):
                    raise RuntimeError('invalid test provision helper result')
                self.created=True
                self.jdbc=result['jdbcUrl'];self.user=result['user'];self.password_file=result['passwordFile']
                self.parsed=self._provider_url(self.jdbc)
                expected=cfg['databases']['manure']
                if (self.parsed.hostname!='127.0.0.1' or self.parsed.port!=cfg['port'] or self.parsed.path!='/'+self.name
                        or self.user!=expected['user'] or self.password_file!=expected['passwordFile']
                        or not Path(self.password_file).resolve().is_relative_to(root)):
                    raise RuntimeError('test provision helper connection binding differs')
                self.base=self.jdbc
                self.psql=shutil.which('psql')
                if not self.psql:raise RuntimeError('psql required for owned runtime-role verification')
                self._passfile(directory)
                self._verify_runtime_role()
            except BaseException:
                # No direct-admin fallback; the helper refuses drops outside its
                # exact registry. The enclosing owned-cluster fixture also drains.
                try:self._helper('--drop',self.name)
                except BaseException:pass
                self.created=False
                if self.passfile:self.passfile.unlink(missing_ok=True)
                raise
            return
        if os.environ.get('MANURE_TEST_ALLOW_CREATEDB')!='1':
            raise RuntimeError('MANURE_TEST_ALLOW_CREATEDB=1 is required for disposable target databases')
        self.psql=shutil.which('psql')
        if self.psql is None:raise RuntimeError('psql required for owned target database provisioning')
        self.base=_required('MANURE_TEST_JDBC_URL');self.parsed=self._provider_url(self.base)
        self.user=_required('MANURE_TEST_JDBC_USER')
        self.password_file=str(Path(_required('MANURE_TEST_JDBC_PASSWORD_FILE')).resolve(strict=True))
        self.jdbc='jdbc:'+urlunsplit((self.parsed.scheme,self.parsed.netloc,'/'+self.name,'',''))
        self._passfile(directory)
        try:self._sql('CREATE DATABASE '+self.name);self.created=True
        except BaseException:self.passfile.unlink(missing_ok=True);raise

    @staticmethod
    def _provider_url(url):
        if not url.startswith('jdbc:postgresql://'):raise RuntimeError('invalid test JDBC provider')
        parsed=urlsplit(url[5:])
        if (parsed.scheme!='postgresql' or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment):raise RuntimeError('owned target JDBC provider must be a plain PostgreSQL URL')
        return parsed

    def _passfile(self,directory):
        # Fixed explicit fixture reference, bounded actual read; reject FIFO before
        # opening. No token codec is applied to opaque database credentials.
        path=Path(self.password_file).resolve(strict=True)
        if not path.is_file():raise RuntimeError('invalid owned test credential file')
        with path.open('rb') as src:raw=src.read(16385)
        if len(raw)>16384:raise RuntimeError('invalid owned test credential file')
        if raw.endswith(b'\n'):raw=raw[:-1]
        if not raw or b'\n' in raw or b'\r' in raw or b'\x00' in raw:raise RuntimeError('invalid owned test credential file')
        def escape(value):return value.replace('\\','\\\\').replace(':','\\:')
        self.passfile=Path(directory)/('pgpass-'+self.name)
        descriptor=os.open(self.passfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(descriptor,'w',encoding='utf-8') as output:
            output.write(':'.join(escape(s) for s in [self.parsed.hostname,str(self.parsed.port or 5432),'*',self.user,raw.decode('utf-8')])+'\n')

    def _helper(self,*args):
        import selectors
        process=subprocess.Popen([self.helper,*args],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ,'out');selector.register(process.stderr,selectors.EVENT_READ,'err')
        buffers={'out':bytearray(),'err':bytearray()};deadline=time.monotonic()+120
        try:
            while selector.get_map():
                remaining=deadline-time.monotonic()
                if remaining<=0:raise RuntimeError('owned test provision helper deadline exceeded')
                for key,_ in selector.select(min(remaining,1)):
                    data=os.read(key.fileobj.fileno(),4096)
                    if not data:selector.unregister(key.fileobj);continue
                    buffers[key.data].extend(data)
                    if len(buffers[key.data])>(65536 if key.data=='out' else 8192):
                        raise RuntimeError('owned test provision helper output bound exceeded')
            if process.wait(timeout=max(.1,deadline-time.monotonic()))!=0:
                raise RuntimeError('owned test provision helper failed')
            def closed(pairs):
                result={}
                for key,value in pairs:
                    if key in result:raise ValueError('duplicate helper field')
                    result[key]=value
                return result
            result=json.loads(bytes(buffers['out']).decode('utf-8'),object_pairs_hook=closed)
            if args[0]=='--drop' and result!={}:raise RuntimeError('invalid test provision cleanup result')
            return result
        except (ValueError,UnicodeError) as error:
            raise RuntimeError('invalid test provision helper JSON') from None
        finally:
            selector.close()
            if process.poll() is None:process.kill()
            process.wait(timeout=10)
            process.stdout.close();process.stderr.close()

    def _verify_runtime_role(self):
        env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
        env.update(PGPASSFILE=str(self.passfile),PGCONNECT_TIMEOUT='10')
        query="SELECT (NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT has_database_privilege(current_user,current_database(),'CREATE') AND has_schema_privilege(current_user,'public','USAGE') AND has_schema_privilege(current_user,'public','CREATE') AND has_schema_privilege(current_user,'manure','USAGE') AND has_schema_privilege(current_user,'manure','CREATE')) FROM pg_roles WHERE rolname=current_user"
        result=subprocess.run([self.psql,'-X','-qAt','--no-password','-h',self.parsed.hostname,'-p',str(self.parsed.port),'-U',self.user,'-d',self.name,'-v','ON_ERROR_STOP=1','-c',query],env=env,capture_output=True,timeout=15)
        if result.returncode or result.stdout.strip()!=b't':raise RuntimeError('runtime role is not the scoped non-superuser fixture identity')

    def _sql(self,statement):
        if self.helper:raise RuntimeError('runtime fixture identity cannot administer databases')
        env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
        env.update(PGPASSFILE=str(self.passfile),PGCONNECT_TIMEOUT='10')
        result=subprocess.run([self.psql,'--no-psqlrc','--no-password','-h',self.parsed.hostname,
            '-p',str(self.parsed.port or 5432),'-U',self.user,'-d',self.parsed.path.lstrip('/') or 'postgres',
            '-v','ON_ERROR_STOP=1','-c',statement],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
        if result.returncode:raise RuntimeError('owned target database provisioning/cleanup failed')

    def runtime_sql(self,statement):
        """Fixed test-owned SQL only, under the SAME non-owner runtime identity.

        Used for exact PostgreSQL lock/trigger crash windows and readback; never
        provisions a role, widens permissions or falls back to an administrator.
        """
        if not self.created or not isinstance(statement,str) or len(statement)>16384:
            raise RuntimeError('invalid owned runtime SQL probe')
        env={k:v for k,v in os.environ.items() if not k.startswith('PG')}
        env.update(PGPASSFILE=str(self.passfile),PGCONNECT_TIMEOUT='10')
        result=subprocess.run([self.psql,'-X','-qAt','--no-password','-h',self.parsed.hostname,
            '-p',str(self.parsed.port or 5432),'-U',self.user,'-d',self.name,'-v','ON_ERROR_STOP=1','-c',statement],
            env=env,capture_output=True,timeout=30)
        if result.returncode or len(result.stdout)>65536 or len(result.stderr)>8192:
            raise RuntimeError('owned runtime SQL probe failed (private diagnostics withheld)')
        return result.stdout.decode('utf-8').strip()

    def migration_service(self,name):
        if not self.helper:
            return f'[{name}]\nhost={self.parsed.hostname}\nport={self.parsed.port or 5432}\ndbname={self.name}\nuser={self.user}\npassfile={self.passfile}\n'
        registry=json.loads((self.fixture_root/'created-databases.json').read_bytes())
        if registry.get(self.name)!='manure':raise RuntimeError('migration fixture database is not registered')
        # Only the synthetic import tool uses the explicit owned administrator.
        # HTTP/JDBC runtime still receives the non-superuser helper result.
        cfg=self.provider
        return f'[{name}]\nhost={self.fixture_root}/cluster/socket\nport={cfg["port"]}\ndbname={self.name}\nuser={cfg["adminRole"]}\n'

    def grant_import_runtime(self,pg):
        if not self.helper:return
        user='"'+self.user.replace('"','""')+'"'
        statements=['ALTER TABLE manure.'+name+' OWNER TO '+user for name in ('artifacts','artifact_tags','receipts','one_time_grants','content_grants','external_passwords')]
        statements+=['GRANT USAGE ON SCHEMA manure_offline TO '+user,'GRANT SELECT ON manure_offline.destination TO '+user]
        pg.run('BEGIN;'+(';'.join(statements))+';COMMIT;')

    def close(self):
        try:
            if self.created:
                if self.helper:self._helper('--drop',self.name)
                else:self._sql('DROP DATABASE '+self.name+' WITH (FORCE)')
                self.created=False
        finally:
            if self.passfile:self.passfile.unlink(missing_ok=True)

    def config(self):
        return {'jdbcUrl':self.jdbc,'user':self.user,'passwordFile':self.password_file,
            'limits':{'maxConnections':4,'maxQueued':16,'queueTimeoutMs':5000,'connectTimeoutMs':5000,
                'statementTimeoutMs':30000,'lockTimeoutMs':5000,'idleTransactionTimeoutMs':30000,'socketTimeoutMs':30000}}


def server_command():
    command=json.loads(_required('MANURE_TEST_SERVER_COMMAND_JSON'))
    if not isinstance(command,list) or not command or not all(isinstance(v,str) and v for v in command):
        raise RuntimeError('MANURE_TEST_SERVER_COMMAND_JSON must be a nonempty argv array')
    return command


class TargetServer:
    def __init__(self,config:dict,directory:str,*,owned_database=None,close_database=True,jdbc_limits=None):
        command=server_command()
        self.config=dict(config);self.process=None;self.database=None;self.closed=False
        self._stdout=deque(maxlen=100);self._stderr=deque(maxlen=100)
        if owned_database is not None and not isinstance(owned_database,OwnedDatabase):
            raise RuntimeError('existing fixture database must be an OwnedDatabase')
        self.database=owned_database if owned_database is not None else OwnedDatabase(directory)
        self.close_database=close_database
        self.config['database']=self.database.config()
        if jdbc_limits is not None:
            allowed=set(self.config['database']['limits'])
            if not isinstance(jdbc_limits,dict) or not set(jdbc_limits)<=allowed or any(type(v) is not int or v<=0 for v in jdbc_limits.values()):
                raise RuntimeError('invalid explicit owned JDBC limit override')
            self.config['database']['limits'].update(jdbc_limits)
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
