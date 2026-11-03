#!/usr/bin/env python3
"""Run a bounded test command against ONLY a new disposable provider cluster.
No connection argument accepted: fixtures can never select a live database.
"""
import json
import os
from pathlib import Path
import pwd
import signal
import socket
import subprocess
import sys
import tempfile


def main():
    os.umask(0o077)
    template=json.loads(Path(os.environ['PG_POLICY']).read_text())
    pg=os.environ['PG_BIN']
    with tempfile.TemporaryDirectory(prefix='ponygirls-owned-pg-') as name:
        root=Path(name)
        (root/'.owned-test-only').write_text('ponygirls-owned-test-v1\n')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
        admin=pwd.getpwuid(os.getuid()).pw_name
        template.update(stateDirectory=str(root/'cluster'),port=port,adminRole=admin,postgresBin=pg)
        for key,d in template['databases'].items():
            d['passwordFile']=str(root/'secrets'/key)
            # Behavioral native tests have finite <=30s statements. Module policy
            # rehearsal separately executes the short real deadline cases.
            d.update(createPassword=True,statementTimeoutMs=30000,lockTimeoutMs=35000 if key=="chronicle" else 5000,idleTransactionTimeoutMs=60000 if key=="chronicle" else 30000)
        manifest=root/'provider.json';manifest.write_text(json.dumps(template))
        hba=Path(os.environ['PG_HBA']).read_text().replace('local all "nixbld" peer',f'local all "{admin}" peer')
        (root/'hba').write_text(hba)
        settings=Path(os.environ['PG_CONFIGURATION']).read_text().replace('/unused-evaluation-path/socket',str(root/'cluster'/'socket')).replace(os.environ['PG_HBA'],str(root/'hba')).replace('port = 15434',f'port = {port}')
        (root/'postgresql.conf').write_text(settings)
        def run(*args):
            subprocess.run(args,check=True,stdout=subprocess.DEVNULL,timeout=180)
        run(sys.executable,os.environ['PG_PROVIDER'],'init',str(manifest))
        data=str(root/'cluster'/'data')
        run(pg+'/pg_ctl','-D',data,'-l',str(root/'postgres.log'),'-o',f'-c config_file={root}/postgresql.conf','-w','-t','30','start')
        try:
            env=dict(os.environ,PONYGIRLS_OWNED_FIXTURE_ROOT=str(root))
            for key,d in template['databases'].items():
                run(sys.executable,os.environ['PG_PROVIDER'],'provision',str(manifest),key)
                env['PONYGIRLS_TEST_DATABASE_'+key.upper()]=json.dumps({
                    'jdbcUrl':f'jdbc:postgresql://127.0.0.1:{port}/{d["name"]}',
                    'user':d['user'],'passwordFile':d['passwordFile'],
                    'limits':{'maxConnections':8,'maxQueued':32,'queueTimeoutMs':5000,'connectTimeoutMs':5000,'statementTimeoutMs':d['statementTimeoutMs'],'lockTimeoutMs':d['lockTimeoutMs'],'idleTransactionTimeoutMs':d['idleTransactionTimeoutMs'],'socketTimeoutMs':35000 if key=='chronicle' else 40000}})
            haystack=json.loads(env['PONYGIRLS_TEST_DATABASE_HAYSTACK'])
            manure=json.loads(env['PONYGIRLS_TEST_DATABASE_MANURE'])
            env.update(HAYSTACK_OWNED_TEST_DB='1',HAYSTACK_TEST_JDBC=haystack['jdbcUrl'],
                HAYSTACK_TEST_DB_USER=haystack['user'],HAYSTACK_TEST_DB_PASSWORD_FILE=haystack['passwordFile'],
                HAYSTACK_TEST_PG=haystack['jdbcUrl'].removeprefix('jdbc:'),
                HAYSTACK_FIXTURE_WORK_DIR=str(root),HAYSTACK_OWNED_PGDATA=data,
                MANURE_TEST_JDBC_URL=manure['jdbcUrl'],MANURE_TEST_JDBC_USER=manure['user'],
                MANURE_TEST_JDBC_PASSWORD_FILE=manure['passwordFile'],MANURE_TEST_ALLOW_CREATEDB='1')
            child=subprocess.Popen(sys.argv[1:],env=env,start_new_session=True)
            try:
                return child.wait(timeout=3600)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid,signal.SIGTERM)
                try: child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid,signal.SIGKILL);child.wait()
                return 124
        finally:
            run(pg+'/pg_ctl','-D',data,'-m','fast','-w','-t','30','stop')

if __name__=='__main__':
    sys.exit(main())
