"""Actual current target executable over imported PG+matched payload snapshots.

Source Python store is used ONLY to build acknowledged pre-port state, never as
server/backend/protocol oracle. All post-import behavior is the configured JVM or
native executable + current owned client; old source and raw archive stay intact.
"""
from __future__ import annotations

import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import shutil
import subprocess
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit
from uuid import uuid4

from manure import auth as A,current_protocol as cp
from manure.client import ManureClient
from migration import offline as M
from target_server import OwnedDatabase,TargetServer
import test_offline_conversion as source_fixture


class TargetMigrationTests(unittest.TestCase):
    def test_first_adoption_rejects_replaced_payload_root_without_blessing(self):
        with tempfile.TemporaryDirectory(prefix='manure-target-replaced-import-') as tmp:
            root=Path(tmp)
            with patch.object(source_fixture,'NOW',time.time()):
                source,config_path,fixture=source_fixture.build_fixture(root)
            token=A.generate_token();hashfile=root/'operator.digest'
            hashfile.write_text(A.sha256_hex(token)+'\n');hashfile.chmod(0o600)
            sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
            config={'api_origin':f'http://127.0.0.1:{port}','listen_address':'127.0.0.1','port':port,
                'loopback_dev':True,'content_mode':'path','content_suffix':'','chunk_bytes':source_fixture.CHUNK,
                'dashboard_dir':None,'unlock_shell_dir':None,'sweep_interval_s':3600,
                'users':[{'id':source_fixture.OWNER,'type':'human','tokens':[{'id':'token\0λ','hashFile':str(hashfile)}]}]}
            config_path.write_text(json.dumps(config));original=M.inventory(source)
            bundle=root/'bundle';identity,_=M.snapshot(source,bundle,config_path,quiesced=True)
            database=OwnedDatabase(tmp)
            try:
                parts=urlsplit(database.jdbc[5:]);service='fixture_'+uuid4().hex
                servicefile=root/'pg_service.conf'
                servicefile.write_text(database.migration_service(service))
                servicefile.chmod(0o600)
                with patch.dict(os.environ,{'PGSERVICEFILE':str(servicefile)}):
                    pg=M.Psql(service);destination=root/'destination'
                    M.prepare_destination(destination,pg,disposable=True)
                    M.import_bundle(bundle,destination,pg,identity)
                    database.grant_import_runtime(pg)
                    M.verify_destination(bundle,destination,pg,identity)
                    M.mark_writable(destination,pg,identity)
                    # Replace AFTER a fully verified conversion/write-boundary but
                    # BEFORE the first target adoption. Keep the old copy intact.
                    preserved=destination/'original-data';os.rename(destination/'data',preserved)
                    shutil.copytree(preserved,destination/'data')
                    aid=fixture['ids']['external']
                    file=destination/'data'/'live'/aid/source_fixture.PATH
                    wrong=b'X'*len(source_fixture.PAYLOAD);file.write_bytes(wrong)
                    config.update(data_dir=str(destination/'data'),migration_receipt_dir=str(destination))
                    server=None;refused=False
                    try:
                        server=TargetServer(config,tmp,owned_database=database,close_database=False)
                        # This branch is a fail-first witness only: old backend
                        # serves same-sized wrong bytes under the original hash.
                        connection=http.client.HTTPConnection('127.0.0.1',server.bound_port,timeout=10)
                        from urllib.parse import quote
                        try:
                            connection.request('GET',f'/api/current/artifacts/{aid}/files/'+quote(source_fixture.PATH,safe='/')+'/content',headers={'Authorization':'Bearer '+token})
                            response=connection.getresponse();observed=response.read()
                            self.assertEqual(response.status,200);self.assertEqual(observed,wrong)
                        finally:connection.close()
                    except RuntimeError as error:
                        refused=True
                        self.assertIn('migration-required',str(error))
                    finally:
                        if server is not None:server.close()
                    self.assertTrue(refused,'target silently adopted a replaced, corrupted converted payload root')
                    table=pg.run("SELECT to_regclass('manure.root_owner') IS NOT NULL")
                    self.assertTrue(table=='f' or pg.run('SELECT count(*) FROM manure.root_owner')=='0')
                    self.assertEqual(pg.run('SELECT writes_started FROM manure_offline.destination'),'t')
                    # Restore original inode, then corrupt a file IN PLACE. Device/
                    # inode-only checks are not full snapshot adoption verification.
                    shutil.rmtree(destination/'data');os.rename(preserved,destination/'data')
                    file=destination/'data'/'live'/aid/source_fixture.PATH
                    file.write_bytes(wrong)
                    with self.assertRaisesRegex(RuntimeError,'migration-required'):
                        TargetServer(config,tmp,owned_database=database,close_database=False)
                    self.assertTrue(pg.run("SELECT to_regclass('manure.root_owner') IS NULL")=='t' or pg.run('SELECT count(*) FROM manure.root_owner')=='0')
                    file.write_bytes(source_fixture.PAYLOAD)
                    self.assertEqual(M.inventory(source),original)
                    self.assertEqual(M.verify_bundle(bundle,identity)[0],identity)
            finally:database.close()

    def test_actual_target_import_resume_crash_windows_original_grants_restart_and_fixforward(self):
        with tempfile.TemporaryDirectory(prefix='manure-target-import-') as tmp:
            root=Path(tmp)
            # Every datum is synthetic fixture-owned. Seed source timestamp near NOW,
            # preserving its exact source bits through import, never extending expiry.
            with patch.object(source_fixture,'NOW',time.time()):
                source,config_path,fixture=source_fixture.build_fixture(root)
            token=A.generate_token();digest=A.sha256_hex(token)
            credential_dir=root/'old-credentials';credential_dir.mkdir(mode=0o700)
            hashfile=credential_dir/'operator.digest';hashfile.write_text(digest+'\n');hashfile.chmod(0o600)
            with sqlite3.connect(source/'manure.db') as db:
                for table in ('one_time_grants','content_grants'):
                    db.execute('UPDATE '+table+' SET token_digest=? WHERE token_digest IS NOT NULL',(digest,))
                db.execute('UPDATE artifacts SET expires_at_s=?,expires_at=? WHERE id=?',
                    (time.time()-1,'2020-01-01T00:00:00Z',fixture['ids']['expired']))
            sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
            origin=f'http://127.0.0.1:{port}'
            config={'api_origin':origin,'listen_address':'127.0.0.1','port':port,'loopback_dev':True,
                'content_mode':'path','content_suffix':'','chunk_bytes':source_fixture.CHUNK,
                'dashboard_dir':None,'unlock_shell_dir':None,'sweep_interval_s':3600,
                'users':[{'id':source_fixture.OWNER,'type':'human','tokens':[{'id':'token\0λ','hashFile':str(hashfile)}]}]}
            config_path.write_text(json.dumps(config))
            original=M.inventory(source);credential_bytes=hashfile.read_bytes()
            bundle=root/'bundle';identity,manifest=M.snapshot(source,bundle,config_path,quiesced=True)
            database=OwnedDatabase(tmp)
            try:
                parts=urlsplit(database.jdbc[5:]);service='fixture_'+uuid4().hex
                servicefile=root/'pg_service.conf'
                servicefile.write_text(database.migration_service(service))
                servicefile.chmod(0o600)
                with patch.dict(os.environ,{'PGSERVICEFILE':str(servicefile)}):
                    pg=M.Psql(service)
                    destination=root/'destination';M.prepare_destination(destination,pg,disposable=True)
                    M.import_bundle(bundle,destination,pg,identity)
                    database.grant_import_runtime(pg)
                    runtime = "'" + database.user.replace("'", "''") + "'"
                    imported_tables = pg.run("SELECT tablename FROM pg_tables WHERE schemaname='manure' ORDER BY tablename").splitlines()
                    self.assertIn('artifact_tags', imported_tables)
                    for table in imported_tables:
                        relation = M.literal('manure.' + M.qname(table))
                        for privilege in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'):
                            self.assertEqual(pg.run('SELECT has_table_privilege(' + runtime + ', ' + relation + ", '" + privilege + "')"), 't',
                                'import handoff must grant runtime ' + privilege + ' on ' + table)
                    self.assertEqual(pg.run("SELECT bool_and(tableowner=" + runtime + ") FROM pg_tables WHERE schemaname='manure'"), 't',
                        'runtime must own every imported application table')
                    self.assertEqual(pg.run('SELECT has_table_privilege(' + runtime + ", 'manure_offline.destination', 'SELECT')"), 't')
                    if database.helper:
                        for privilege in ('INSERT', 'UPDATE', 'DELETE'):
                            self.assertEqual(pg.run('SELECT has_table_privilege(' + runtime + ", 'manure_offline.destination', '" + privilege + "')"), 'f',
                                'migration control state must remain read-only to runtime')
                        self.assertEqual(pg.run('SELECT has_schema_privilege(' + runtime + ", 'manure_offline', 'CREATE')"), 'f')
                        database._verify_runtime_role()
                    self.assertEqual(M.verify_destination(bundle,destination,pg,identity)[0],identity)
                    config['data_dir']=str(destination/'data');config['migration_receipt_dir']=str(destination)
                    # Before explicit boundary, serve refuses rather than mutating a
                    # supposedly immutable comparison destination during recovery.
                    with self.assertRaisesRegex(RuntimeError,'before readiness'):
                        TargetServer(config,tmp,owned_database=database,close_database=False)
                    self.assertEqual(M.verify_destination(bundle,destination,pg,identity)[0],identity)
                    migration_config=dict(config,database=database.config(),native_mode='shared' if os.environ.get('MANURE_POSIX_LIBRARY') else 'linked',posix_library=os.environ.get('MANURE_POSIX_LIBRARY'))
                    migration_path=root/'migration-only.json';migration_path.write_text(json.dumps(migration_config))
                    command=json.loads(os.environ['MANURE_TEST_SERVER_COMMAND_JSON'])
                    checked=subprocess.run(command+['migrate',str(migration_path)],stdin=subprocess.DEVNULL,capture_output=True,timeout=90)
                    self.assertEqual(checked.returncode,0,checked.stderr.decode()[-4096:])
                    self.assertEqual(pg.run('SELECT count(*) FROM manure.root_owner'),'0')
                    self.assertEqual(M.verify_destination(bundle,destination,pg,identity)[0],identity)
                    M.mark_writable(destination,pg,identity)
                    self.assertIn('fix-forward',M.rollback_policy(destination,pg))
                    ids=fixture['ids']
                    with TargetServer(config,tmp,owned_database=database,close_database=False) as server:
                        client=ManureClient(server.api_url,token=token,cache_dir=str(root/'cache'))
                        for window in ('pre_rename','post_rename'):
                            self.assertEqual(client.get_artifact(ids[window])['state'],'ready')
                            output=root/('fetched-'+window);client.fetch_to_dest(ids[window],output)
                            self.assertEqual((output/source_fixture.PATH).read_bytes(),source_fixture.PAYLOAD)
                        missing=client.get_upload_status(ids['missing'])
                        self.assertEqual(missing['state'],'uploading');self.assertEqual(missing['files'][0]['received_bytes'],0)
                        status=client.get_upload_status(ids['uploading'])
                        self.assertEqual(status['files'][0]['received_ranges'],[[0,source_fixture.CHUNK]])
                        client.put_chunk(ids['uploading'],source_fixture.PATH,source_fixture.CHUNK,source_fixture.PAYLOAD[source_fixture.CHUNK:])
                        self.assertEqual(client.publish(ids['uploading'])['state'],'ready')
                        # Old external cookie retains original binding/expiry; it
                        # cannot read a different artifact. No plaintext recovery.
                        def content_command(aid,command,cookie=None,origin_header=None):
                            rid=uuid4();conn=http.client.HTTPConnection('127.0.0.1',server.bound_port,timeout=15)
                            headers={'Content-Type':'application/json'}
                            if cookie:headers['Cookie']=f'mgrant-dev-{aid}='+cookie
                            if origin_header:headers['Origin']=origin_header
                            try:
                                conn.request('POST',f'/view/{aid}/__manure/current',cp.dumps(cp.ContentEnvelope(rid,cp.API_VERSION,command)),headers)
                                response=conn.getresponse();data=response.read(4194305)
                                return response.status,data
                            finally:conn.close()
                        code,data=content_command(ids['external'],cp.ContentCommand_GetManifest(),fixture['external_cookie'])
                        self.assertEqual(code,200);self.assertIn(source_fixture.PATH,data.decode())
                        code,_=content_command(ids['internal'],cp.ContentCommand_GetManifest(),fixture['external_cookie'])
                        self.assertEqual(code,401)
                        code,_=content_command(ids['internal'],cp.ContentCommand_RedeemGrant(fixture['unused']),origin_header=origin)
                        self.assertEqual(code,200)
                        code,_=content_command(ids['internal'],cp.ContentCommand_RedeemGrant(fixture['unused']),origin_header=origin)
                        self.assertEqual(code,403)
                        anon=ManureClient(server.api_url,cache_dir=str(root/'anon'))
                        output=root/'external-password-fetch'
                        anon.fetch_to_dest(server.content_url(ids['external']),output,password=fixture['password'])
                        self.assertEqual((output/source_fixture.PATH).read_bytes(),source_fixture.PAYLOAD)
                        newfile=root/'new-write.txt';newfile.write_bytes(b'new acknowledged state after import')
                        new=client.upload_path(newfile,access='public',fresh=True)
                        client.delete(ids['pre_rename'])
                    # Restart same target metadata/payload inode and source identity.
                    with TargetServer(config,tmp,owned_database=database,close_database=False) as server:
                        client=ManureClient(server.api_url,token=token,cache_dir=str(root/'cache2'))
                        self.assertEqual(client.get_artifact(new['artifact_id'])['state'],'ready')
                        self.assertEqual(client.get_artifact(ids['uploading'])['state'],'ready')
                        self.assertEqual(client.get_upload_status(ids['missing'])['files'][0]['received_bytes'],0)
                        with self.assertRaises(Exception):client.get_artifact(ids['pre_rename'])
                    with self.assertRaises(M.Refused):M.import_bundle(bundle,destination,pg,identity)
                    self.assertEqual(M.inventory(source),original)
                    self.assertEqual(hashfile.read_bytes(),credential_bytes)
                    self.assertEqual(M.verify_bundle(bundle,identity)[0],identity)
            finally:database.close()


if __name__=='__main__':unittest.main()
