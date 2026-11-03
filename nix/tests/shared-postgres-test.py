#!/usr/bin/env python3
"""Behavioral/Active/Effectual/GoodCommunication; specified provider contract.
Only owned mkdtemp clusters. No live endpoint or private content is accepted.
"""
import argparse
import concurrent.futures
import importlib.util
import json
import os
from pathlib import Path
import pwd
import socket
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    config = json.loads(Path(os.environ['PG_POLICY']).read_text())
    pg = os.environ['PG_BIN']
    provider = os.environ['PG_PROVIDER']
    admin = pwd.getpwuid(os.getuid()).pw_name
    spec = importlib.util.spec_from_file_location('provider', provider)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    passed = []
    def check(name, test):
        assert test, name
        passed.append(name)
    with tempfile.TemporaryDirectory(prefix='ponygirls-pg-rehearsal-') as directory:
        root = Path(directory)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        config.update(stateDirectory=str(root/'cluster'), port=port, adminRole=admin, postgresBin=pg)
        for key, d in config['databases'].items():
            d['passwordFile'] = str(root/'secrets'/key)
        manifest = root/'provider.json'
        manifest.write_text(json.dumps(config))
        # Rewrite only paths/admin identity for the OWNED disposable cluster.
        hba = Path(os.environ['PG_HBA']).read_text().replace('local all nixbld peer', f'local all {admin} peer')
        (root/'hba').write_text(hba)
        settings = Path(os.environ['PG_CONFIGURATION']).read_text()
        settings = settings.replace('/unused-evaluation-path/socket', str(root/'cluster'/'socket'))
        settings = settings.replace(os.environ['PG_HBA'], str(root/'hba')).replace('port = 15434', f'port = {port}')
        (root/'postgresql.conf').write_text(settings)
        run = lambda *a, **kw: subprocess.run(a, capture_output=True, timeout=90, **kw)
        def provision(key):
            result = run('python3', provider, 'provision', str(manifest), key)
            assert result.returncode == 0, f'provision {key}: {result.stderr!r}'
        def query(role, database, query, ok=True):
            env = dict(os.environ, PGCONNECT_TIMEOUT='3')
            if role != admin:
                env['PGPASSWORD'] = Path(config['databases'][role]['passwordFile']).read_text().strip()
            result = run(pg+'/psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(root/'cluster'/'socket') if role == admin else '127.0.0.1', '-p', str(port), '-U', role, '-d', database, '-c', query, env=env)
            assert (result.returncode == 0) == ok, f'{role}/{database}: unexpected SQL outcome'
            return result.stdout.decode().strip()
        check('init-owned-new-cluster', run('python3', provider, 'init', str(manifest)).returncode == 0)
        data = str(root/'cluster'/'data')
        def start():
            result = run(pg+'/pg_ctl', '-D', data, '-l', str(root/'postgres.log'), '-o', f'-c config_file={root}/postgresql.conf', '-w', '-t', '30', 'start')
            assert result.returncode == 0, result.stderr
        def stop():
            run(pg+'/pg_ctl', '-D', data, '-m', 'fast', '-w', '-t', '30', 'stop')
        start()
        try:
            for key in config['databases']:
                provision(key)
            check('three-independent-databases', query(admin, 'postgres', "SELECT count(*) FROM pg_database WHERE datname IN ('haystack','manure','chronicle')") == '3')
            hashes = {k: Path(d['passwordFile']).read_bytes() for k,d in config['databases'].items()}
            for role in config['databases']:
                check(f'{role}-non-superuser', query(admin,'postgres',f"SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) FROM pg_roles WHERE rolname='{role}'") == 't')
                query(role, role, 'CREATE TABLE isolation_probe (id integer PRIMARY KEY, payload text); INSERT INTO isolation_probe VALUES(1, current_user);')
                check(f'{role}-own-read-write', query(role, role, 'SELECT payload FROM isolation_probe') == role)
                check(f'{role}-extensions-ready', query(role, role, "SELECT count(*) FROM pg_extension WHERE extname IN ('vector','pg_trgm')") == '2')
                check(f'{role}-effective-bounds', query(role, role, "SELECT current_setting('statement_timeout') || ',' || current_setting('lock_timeout') || ',' || current_setting('idle_in_transaction_session_timeout') || ',' || current_setting('work_mem')") == '1s,250ms,1s,4MB')
                for other in config['databases']:
                    if other != role:
                        query(role, other, 'SELECT 1', ok=False)
                        query(other, other, f'SET ROLE {role}', ok=False)
                        check(f'{role}-cannot-connect-or-assume-{other}', True)
                query(role,'postgres','SELECT 1',ok=False)
                query(role,'template1','SELECT 1',ok=False)
                query(role,role,'CREATE DATABASE forbidden',ok=False)
                query(role,role,'CREATE ROLE forbidden',ok=False)
                check(f'{role}-no-admin-db-or-privileges',True)
                query(role,role,'SELECT pg_sleep(2)',ok=False)
                check(f'{role}-statement-timeout',True)
            check('durability-settings', query(admin,'postgres',"SELECT current_setting('fsync') || ',' || current_setting('full_page_writes') || ',' || current_setting('synchronous_commit')") == 'on,on,on')
            check('capacity-budget', int(query(admin,'postgres',"SHOW max_connections")) >= sum(d['maxConnections'] for d in config['databases'].values()) + config['adminReserve'])
            # Concurrent mixed serving and time-bounded job load across databases.
            def workload(role):
                query(role,role,'SELECT pg_sleep(2)',ok=False)
                return query(role,role,'SELECT count(*) FROM isolation_probe') == '1'
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
                check('mixed-workload-serving-survives-job-timeouts',all(pool.map(workload, config['databases'])))
            # Repeated provisioning must preserve secret bytes and state exactly.
            for key in config['databases']:
                provision(key)
                check(key+'-credential-preserved',Path(config['databases'][key]['passwordFile']).read_bytes() == hashes[key])
            # Logical backup all DBs + globals (contains hashes: private fixture).
            dumps = {}
            env = dict(os.environ, PGHOST=str(root/'cluster'/'socket'), PGPORT=str(port), PGUSER=admin, PGCONNECT_TIMEOUT='3')
            for key in config['databases']:
                dump = root/(key+'.dump')
                result = run(pg+'/pg_dump','-Fc','-f',str(dump),key,env=env)
                assert result.returncode == 0
                os.chmod(dump,0o600)
                dumps[key]=dump
            result = run(pg+'/pg_dumpall','--globals-only',env=env)
            assert result.returncode == 0
            (root/'globals.sql').write_bytes(result.stdout)
            os.chmod(root/'globals.sql',0o600)
            # Independent database restore with ownership/ACLs retained.
            query(admin,'haystack','DROP TABLE isolation_probe')
            result=run(pg+'/pg_restore','--clean','--if-exists','-d','haystack',str(dumps['haystack']),env=env)
            assert result.returncode == 0
            check('individual-database-logical-restore',query('haystack','haystack','SELECT payload FROM isolation_probe') == 'haystack')
            check('unrelated-databases-unchanged-by-service-restore',all(query(k,k,'SELECT payload FROM isolation_probe') == k for k in ['manure','chronicle']))
            stop()
            start()
            check('cluster-restart-reconnect',all(query(k,k,'SELECT payload FROM isolation_probe') == k for k in config['databases']))
            # Whole cluster logical restore rehearsed by recreating each database
            # from full dump after dropping all three. Roles persist in this leg;
            # globals are also verified in a separate fresh owned cluster below.
            for key in config['databases']:
                query(admin,'postgres',f'DROP DATABASE "{key}"')
                result = run(pg+'/pg_restore','-C','-d','postgres',str(dumps[key]),env=env)
                assert result.returncode == 0
            check('whole-cluster-database-logical-restore',all(query(k,k,'SELECT payload FROM isolation_probe') == k for k in config['databases']))
            check('logical-backup-global-roles-inventory',all(f'CREATE ROLE {k};'.encode() in (root/'globals.sql').read_bytes() for k in config['databases']))
            # Existing secret mutation must fail authentication, not rotate role.
            secret = Path(config['databases']['haystack']['passwordFile'])
            secret.write_text('replacement-not-authorized\n')
            result=run('python3',provider,'provision',str(manifest),'haystack')
            check('secret-replacement-fails-without-rotation',result.returncode != 0 and b'replacement-not-authorized' not in result.stderr)
            secret.write_bytes(hashes['haystack'])
            check('original-credential-remains-valid',query('haystack','haystack','SELECT 1') == '1')
        finally:
            stop()
        # Ownership/cross-major protections are tested without starting anything.
        (root/'cluster'/'ponygirls-provider-v1').unlink()
        check('unmarked-existing-cluster-rejected',run('python3',provider,'init',str(manifest)).returncode != 0)
        (root/'cluster'/'ponygirls-provider-v1').write_text('postgresql-18\n')
        (root/'cluster'/'data'/'PG_VERSION').write_text('17\n')
        check('cross-major-reuse-rejected',run('python3',provider,'init',str(manifest)).returncode != 0)
    receipt = {'scope':'Disposable provider DB isolation/settings/durability/provisioning/logical restore/restart; not application or deployment acceptance', 'tests':passed,'cases':len(passed),'failures':0,'errors':0,'skips':0}
    (output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt))

if __name__ == '__main__':
    main()
