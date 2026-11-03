#!/usr/bin/env python3
"""Behavioral/Active/Effectual/GoodCommunication; specified provider contract.
Only owned mkdtemp clusters. No live endpoint or private content is accepted.
"""
import argparse
import hashlib
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
        # Fail-first: reproduce the missing scoped schema grant before adding it.
        config['databases']['manure']['schemas'] = ['public']
        manifest = root/'provider.json'
        manifest.write_text(json.dumps(config))
        # Rewrite only paths/admin identity for the OWNED disposable cluster.
        hba = Path(os.environ['PG_HBA']).read_text().replace('local all nixbld peer', f'local all {admin} peer')
        hba = hba.replace('host all all 0.0.0.0/0 reject','host unicode_probe unicode_probe 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject')
        (root/'hba').write_text(hba)
        settings = Path(os.environ['PG_CONFIGURATION']).read_text()
        settings = settings.replace('/unused-evaluation-path/socket', str(root/'cluster'/'socket'))
        settings = settings.replace(os.environ['PG_HBA'], str(root/'hba')).replace('port = 15434', f'port = {port}')
        (root/'postgresql.conf').write_text(settings)
        run = lambda *a, **kw: subprocess.run(a, capture_output=True, timeout=90, **kw)
        def provision(key):
            result = run('python3', provider, 'provision', str(manifest), key)
            assert result.returncode == 0, f'provision {key}: {result.stderr!r}'
        socket_dir = str(root/'cluster'/'socket')
        def query(role, database, query, ok=True):
            env = dict(os.environ, PGCONNECT_TIMEOUT='3')
            if role != admin:
                env['PGPASSWORD'] = Path(config['databases'][role]['passwordFile']).read_text().strip()
            result = run(pg+'/psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket_dir if role == admin else '127.0.0.1', '-p', str(port), '-U', role, '-d', database, '-c', query, env=env)
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
            fail_env=dict(os.environ, PGHOST='127.0.0.1',PGPORT=str(port),PGUSER='manure',PGDATABASE='manure',PGPASSWORD=Path(config['databases']['manure']['passwordFile']).read_text().strip())
            failed_schema=run(pg+'/psql','-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-c','CREATE SCHEMA IF NOT EXISTS manure',env=fail_env)
            check('manure-schema-fail-first-sqlstate42501',failed_schema.returncode!=0 and b'42501' in failed_schema.stderr)
            config['databases']['manure']['schemas']=['public','manure']
            manifest.write_text(json.dumps(config));provision('manure')
            # PG checks database CREATE even for IF NOT EXISTS. Service schema
            # bootstrap must guard the CREATE itself, not broaden DB privileges.
            query('manure','manure','CREATE SCHEMA IF NOT EXISTS manure',ok=False)
            query('manure','manure',"DO $$ BEGIN IF to_regnamespace('manure') IS NULL THEN CREATE SCHEMA manure; END IF; END $$; CREATE TABLE manure.scoped_probe(id int);")
            check('manure-explicit-schema-grant-without-database-create',query('manure','manure',"SELECT has_database_privilege(current_user,current_database(),'CREATE')")=='f')
            check('three-independent-databases' , query(admin, 'postgres', "SELECT count(*) FROM pg_database WHERE datname IN ('haystack','manure','chronicle')") == '3')
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
            # SQL text AND server ERROR messages can include private values.
            # Exercise inline and extended-query bound-parameter conversion
            # failures for every role, then inspect real PostgreSQL logs.
            canary = 'private-' + __import__('secrets').token_hex(24)
            for role in config['databases']:
                query(role,role,f"SELECT '{canary}'::integer",ok=False)
                private_env = dict(os.environ, PGHOST='127.0.0.1', PGPORT=str(port), PGUSER=role, PGDATABASE=role, PGPASSWORD=hashes[role].decode().strip())
                failed = run(pg+'/psql','-X','-w','-qAt','-v','ON_ERROR_STOP=1',env=private_env,
                    input=f"SELECT $1::integer\n\\bind '{canary}'\n\\g\n",text=True)
                assert failed.returncode != 0 and 'invalid input syntax for type integer' in failed.stderr and canary in failed.stderr
                query(role,role,f"INSERT INTO isolation_probe VALUES (1, '{canary}')",ok=False)
                check(role+'-sql-errors-private',canary not in (root/'postgres.log').read_text())
                check(role+'-effective-sql-privacy',query(role,role,"SELECT current_setting('log_min_messages') || ',' || current_setting('log_min_error_statement') || ',' || current_setting('log_statement') || ',' || current_setting('log_duration') || ',' || current_setting('log_min_duration_statement') || ',' || current_setting('log_parameter_max_length_on_error')") == 'panic,panic,none,off,-1,0')
            check('administrator-sql-diagnostics-not-downgraded',query(admin,'postgres',"SHOW log_min_messages") == 'warning')
            # Actual lock deadline, not merely a SHOW assertion.
            lockenv = dict(os.environ, PGHOST='127.0.0.1', PGPORT=str(port), PGUSER='haystack', PGDATABASE='haystack', PGPASSWORD=hashes['haystack'].decode().strip())
            locker = subprocess.Popen([pg+'/psql','-X','-w','-qAt'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=lockenv, text=True)
            try:
                locker.stdin.write('BEGIN; LOCK TABLE isolation_probe IN ACCESS EXCLUSIVE MODE; SELECT 123;\n')
                locker.stdin.flush()
                assert locker.stdout.readline().strip() == '123'
                before = time.monotonic()
                query('haystack','haystack','SELECT * FROM isolation_probe',ok=False)
                check('lock-deadline-executed',time.monotonic()-before < 2)
            finally:
                locker.communicate('ROLLBACK;\n',timeout=5)
            # Idle transaction timeout kills an actual idle session.
            idle = subprocess.Popen([pg+'/psql','-X','-w','-qAt'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=lockenv, text=True)
            idle.stdin.write('BEGIN; SELECT 456;\n'); idle.stdin.flush()
            assert idle.stdout.readline().strip() == '456'
            time.sleep(1.3)
            _, idle_error = idle.communicate('SELECT 1;\n',timeout=5)
            check('idle-transaction-deadline-executed',idle.returncode != 0 and 'idle-in-transaction timeout' in idle_error)
            check('durability-settings' , query(admin,'postgres',"SELECT current_setting('fsync') || ',' || current_setting('full_page_writes') || ',' || current_setting('synchronous_commit')") == 'on,on,on')
            check('capacity-budget', int(query(admin,'postgres',"SHOW max_connections")) >= sum(d['maxConnections'] for d in config['databases'].values()) + config['adminReserve'])
            # Exercise the shipped backup implementation, not only raw CLI
            # rehearsals below. Matched payload snapshots claim BOTH roots.
            backup_spec=importlib.util.spec_from_file_location('backup',os.environ['PG_BACKUP_TOOL'])
            backup_module=importlib.util.module_from_spec(backup_spec);backup_spec.loader.exec_module(backup_module)
            backup_module.backup(config,root/'tool-backup')
            check('shipped-logical-backup-tool',all((root/'tool-backup'/(key+'.dump')).stat().st_size>0 for key in config['databases']) and (root/'tool-backup'/'globals.sql').stat().st_mode & 0o777 == 0o600)
            payload=root/'payload';payload.mkdir();(payload/'live').mkdir();(payload/'staging').mkdir();(payload/'live'/'fixture').write_bytes(b'owned-payload\x00bytes')
            control=root/'control';control.mkdir();(control/'COMPLETE').write_text('owned-control-receipt')
            config_path=root/'service-config.json';config_path.write_text('{"data_dir":"synthetic-owned-root"}')
            try:
                backup_module.matched(config,root/'forbidden-snapshot',payload,control,config_path,os.environ['PG_OFFLINE_TOOL'],False)
                raise AssertionError('unquiesced snapshot accepted')
            except ValueError: pass
            backup_module.matched(config,root/'matched-snapshot',payload,control,config_path,os.environ['PG_OFFLINE_TOOL'],True)
            check('shipped-matched-pg-payload-control-snapshot',(root/'matched-snapshot'/'COMPLETE').is_file() and (root/'matched-snapshot'/'payload'/'live'/'fixture').read_bytes()==b'owned-payload\x00bytes' and (root/'matched-snapshot'/'migration-control'/'COMPLETE').read_text()=='owned-control-receipt' and (root/'matched-snapshot'/'postgres'/'manure.dump').stat().st_size>0)
            check('shipped-matched-snapshot-requires-quiescence',not (root/'forbidden-snapshot').exists())
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
            # Prove SCRAM preparation against PG18/libpq, including Unicode3.2
            # normalization and PostgreSQL's raw fallback for prohibited/unassigned
            # and bidi-invalid passwords. Never log values or verifiers.
            unicode_cases = ['p\u00e4ss','a\u00a0b','\u00adIX','\u2168pass','\u0007raw','\u0221raw','\u0627abc','\u0627\u0628']
            for number, value in enumerate(unicode_cases):
                entry = dict(config['databases']['haystack'],name='unicode_probe',user='unicode_probe',passwordFile=str(root/'secrets'/'unicode_probe'),createPassword=False,maxConnections=1)
                config['databases']['unicode_probe']=entry
                manifest.write_text(json.dumps(config))
                unicode_file = Path(entry['passwordFile'])
                unicode_file.write_text(value+'\n'); unicode_file.chmod(0o600)
                provision('unicode_probe')
                check('unicode-scram-pg18-'+str(number),query('unicode_probe','unicode_probe','SELECT 1') == '1')
                before = sql_hash = query(admin,'postgres',"SELECT rolpassword FROM pg_authid WHERE rolname='unicode_probe'")
                provision('unicode_probe')
                check('existing-unicode-secret-preserved-'+str(number),query(admin,'postgres',"SELECT rolpassword FROM pg_authid WHERE rolname='unicode_probe'") == before and unicode_file.read_text() == value+'\n')
                query(admin,'postgres','DROP DATABASE unicode_probe')
                query(admin,'postgres','DROP ROLE unicode_probe')
                del config['databases']['unicode_probe']
            manifest.write_text(json.dumps(config))
        finally:
            stop()
        # Fresh-host logical restore: restore all managed roles/password verifiers
        # and all complete databases into a SECOND empty owned cluster. Only the
        # initdb-created admin CREATE statement is omitted, explicitly by name.
        config['stateDirectory'] = str(root/'restored')
        manifest.write_text(json.dumps(config))
        check('fresh-host-init',run('python3',provider,'init',str(manifest)).returncode == 0)
        data = str(root/'restored'/'data')
        socket_dir = str(root/'restored'/'socket')
        (root/'postgresql.conf').write_text(settings.replace(str(root/'cluster'/'socket'),socket_dir))
        env['PGHOST'] = socket_dir
        start()
        try:
            globals_sql = (root/'globals.sql').read_text()
            admin_create = f'CREATE ROLE {admin};'
            assert globals_sql.count(admin_create) == 1
            globals_sql = globals_sql.replace(admin_create,'-- initdb already created the same administrator',1)
            result = run(pg+'/psql','-X','-w','-qAt','-v','ON_ERROR_STOP=1','-d','postgres',env=env,input=globals_sql,text=True)
            assert result.returncode == 0, 'fresh-host global-role restore failed'
            for key in config['databases']:
                result=run(pg+'/pg_restore','-C','-d','postgres',str(dumps[key]),env=env)
                assert result.returncode == 0
            check('fresh-host-globals-and-all-databases-logical-restore',all(query(k,k,'SELECT payload FROM isolation_probe') == k for k in config['databases']))
            for role in config['databases']:
                for other in config['databases']:
                    if role != other:
                        query(role,other,'SELECT 1',ok=False)
            check('fresh-host-cross-database-isolation-retained',True)
        finally:
            stop()
        config['stateDirectory'] = str(root/'cluster')
        manifest.write_text(json.dumps(config))
        # Ownership/cross-major protections are tested without starting anything.
        (root/'cluster'/'ponygirls-provider-v1').unlink()
        check('unmarked-existing-cluster-rejected',run('python3',provider,'init',str(manifest)).returncode != 0)
        (root/'cluster'/'ponygirls-provider-v1').write_text('postgresql-18\n')
        (root/'cluster'/'data'/'PG_VERSION').write_text('17\n')
        check('cross-major-reuse-rejected',run('python3',provider,'init',str(manifest)).returncode != 0)
    binding = {name: hashlib.sha256(Path(os.environ[key]).read_bytes()).hexdigest() for name,key in [('provider','PG_PROVIDER'),('policy','PG_POLICY'),('configuration','PG_CONFIGURATION'),('hba','PG_HBA')]}
    binding['test'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    binding['postgresBin'] = pg
    receipt = {'sourceBinding':binding,'scope':'Disposable provider DB isolation/settings/durability/provisioning/logical restore/restart; not application or deployment acceptance', 'tests':passed,'cases':len(passed),'failures':0,'errors':0,'skips':0}
    (output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt))

if __name__ == '__main__':
    main()
