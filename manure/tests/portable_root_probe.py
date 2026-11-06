#!/usr/bin/env python3
"""Owned native/PG/TLS/mount-namespace probe, never a live migration runbook."""
from __future__ import annotations
import base64
import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import threading
from unittest.mock import patch

from manure import auth as auth
from manure.client import ManureClient, ManureError
from target_server import OwnedDatabase, TargetServer, server_command


def require(value, message):
    if not value:
        raise RuntimeError(message)


def main():
    require(os.environ.get('MANURE_TEST_PROVISION_COMMAND'), 'owned registry-guarded provider helper required; no direct-admin fallback')
    command = server_command()
    require(len(command) == 1 and Path(command[0]).is_absolute(), 'one explicit native ELF required')
    require(Path(command[0]).read_bytes()[:4] == b'\x7fELF', 'JVM/script is not native acceptance')
    bwrap = shutil.which('bwrap')
    openssl = shutil.which('openssl')
    require(bwrap and openssl, 'pinned bubblewrap and openssl required')
    volume_source = Path(os.environ['MANURE_OWNED_PORTABLE_VOLUME'])
    require(volume_source.is_absolute() and volume_source.is_dir(), 'explicit owned fixture volume required')
    with tempfile.TemporaryDirectory(prefix='manure-owned-portable-native-') as name:
        root = Path(name).resolve()
        credentials = root / 'authority'
        credentials.mkdir(mode=0o700)
        payload = root / 'payloads'
        payload.mkdir(mode=0o700)
        volume = root / 'volume'
        volume.mkdir(mode=0o700)
        output = root / 'plans'
        output.mkdir(mode=0o700)
        token = auth.generate_token()
        manager = root / 'manager.digest'
        manager.write_text(auth.sha256_hex(token) + '\n')
        manager.chmod(0o600)
        key, cert = credentials / 'key.pem', credentials / 'ca.pem'
        subprocess.run([openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(key),
                        '-out', str(cert), '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
                        '-days', '1'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
        requests = []
        completed: set[str] = set()
        state = {'podUid': '11111111-1111-4111-8111-111111111111', 'handle': 'computedisk-ownednative'}
        token_file, uid_file = credentials / 'token', credentials / 'pod-uid'

        def renew_projection():
            def encoded(value):
                return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).decode().rstrip('=')
            state['token'] = encoded({'alg': 'owned-fixture'}) + '.' + encoded({'kubernetes.io': {
                'namespace': 'owned', 'pod': {'name': 'core-0', 'uid': state['podUid']}}}) + '.signature'
            token_file.write_text(state['token'])
            uid_file.write_text(state['podUid'])

        renew_projection()
        require(payload.is_relative_to(volume_source), 'fixture temporary paths must be within the owned volume')
        mounted_payload = volume / payload.relative_to(volume_source)

        def metadata(resource_name, uid):
            return {'name': resource_name, 'namespace': 'owned', 'uid': uid}

        def documents():
            modes = ['ReadWriteOnce']
            return {
                '/api/v1/namespaces/owned/pods/core-0': {
                    'apiVersion': 'v1', 'kind': 'Pod', 'metadata': metadata('core-0', state['podUid']), 'spec': {
                        'containers': [{'name': 'manure', 'volumeMounts': [
                            {'name': 'data', 'mountPath': str(volume)},
                            {'name': 'authority', 'mountPath': str(credentials), 'readOnly': True}]}],
                        'volumes': [{'name': 'data', 'persistentVolumeClaim': {'claimName': 'artifacts'}},
                                    {'name': 'authority', 'projected': {'sources': [
                                        {'serviceAccountToken': {'path': 'token'}},
                                        {'downwardAPI': {'items': [{'path': 'pod-uid', 'fieldRef': {'fieldPath': 'metadata.uid'}}]}}]}}]}},
                '/api/v1/namespaces/owned/persistentvolumeclaims/artifacts': {
                    'apiVersion': 'v1', 'kind': 'PersistentVolumeClaim',
                    'metadata': metadata('artifacts', '22222222-2222-4222-8222-222222222222'),
                    'status': {'phase': 'Bound'}, 'spec': {'volumeName': 'pv-owned', 'accessModes': modes}},
                '/api/v1/persistentvolumes/pv-owned': {
                    'apiVersion': 'v1', 'kind': 'PersistentVolume',
                    'metadata': metadata('pv-owned', '33333333-3333-4333-8333-333333333333'),
                    'status': {'phase': 'Bound'}, 'spec': {'accessModes': modes,
                        'claimRef': metadata('artifacts', '22222222-2222-4222-8222-222222222222'),
                        'csi': {'driver': 'storage.example.test', 'volumeHandle': state['handle']}}}}

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                requests.append(self.path)
                value = documents().get(self.path)
                code = 200 if value is not None and self.headers.get('Authorization') == 'Bearer ' + state['token'] else 403
                body = json.dumps(value if code == 200 else {}).encode()
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(cert, key)
        server.socket = tls.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        database = None
        try:
            database = OwnedDatabase(name)
            config = {'data_dir': str(payload), 'api_origin': 'http://127.0.0.1:0', 'listen_address': '127.0.0.1',
                      'port': 0, 'loopback_dev': True, 'content_mode': 'path', 'content_suffix': '',
                      'dashboard_dir': None, 'unlock_shell_dir': None, 'sweep_interval_s': 3600,
                      'users': [{'id': 'owned', 'type': 'human', 'tokens': [{'id': 'original', 'hashFile': str(manager)}]}]}
            with TargetServer(config, name, owned_database=database, close_database=False) as initial:
                client = ManureClient(initial.api_url, token=token, cache_dir=str(root / 'cache'))
                source = root / 'source.txt'
                source.write_bytes(b'owned portable native payload\x00\xe9\xa6\xac')
                uploaded = client.upload_path(str(source), access='internal')
                artifact_id = uploaded['artifact_id']
            original = database.runtime_sql("SELECT encode(identity,'hex') FROM manure.root_owner WHERE singleton")
            require(len(original) == 32, 'legitimate preexisting V1 binding required')
            portable_config = dict(config, data_dir=str(mounted_payload), database=database.config(), native_mode='linked',
                root_authority={'kind': 'kubernetes-csi-v1', 'expected_csi_driver': 'storage.example.test', 'api_origin': 'https://127.0.0.1:' + str(server.server_port),
                                'ca_file': str(cert), 'token_file': str(token_file), 'pod_uid_file': str(uid_file),
                                'namespace': 'owned', 'pod_name': 'core-0', 'container_name': 'manure'})
            config_file = root / 'portable.json'
            config_file.write_text(json.dumps(portable_config))
            config_file.chmod(0o600)
            # The containing VM makes only its disposable volume private. No host
            # policy change/capability is requested; inner bubblewrap drops capabilities.
            prefix = [bwrap, '--unshare-user', '--unshare-pid', '--die-with-parent', '--ro-bind', '/', '/',
                      '--bind', str(volume_source), str(volume), '--ro-bind', str(credentials), str(credentials),
                      '--bind', str(output), str(output), '--proc', '/proc', '--dev', '/dev', '--']

            diagnostic = """import json,os,pathlib,sys
p=pathlib.Path(sys.argv[1]);result=[]
for line in pathlib.Path('/proc/self/mountinfo').read_text().splitlines():
 left,right=line.split(' - ');fields=left.split()
 if p.is_relative_to(pathlib.Path(fields[4])):
  result.append({'root':fields[3],'mount':fields[4],'options':fields[5],'optional':fields[6:],'filesystem':right.split()[0],'super':right.split()[2]})
print(json.dumps({'coveringMounts':result,'device':os.stat(p).st_dev,'inode':os.stat(p).st_ino}))
"""
            measured = subprocess.run(prefix + [os.sys.executable, '-c', diagnostic, str(mounted_payload)],
                                      capture_output=True, timeout=15)
            require(measured.returncode == 0, 'owned namespace diagnostic unavailable: ' + measured.stderr.decode()[-512:])
            print(measured.stdout.decode().strip(), flush=True)

            def invoke(arguments):
                return subprocess.run(prefix + command + list(arguments), stdin=subprocess.DEVNULL,
                                      capture_output=True, timeout=90)

            def native(*arguments):
                result = invoke(arguments)
                require(result.returncode == 0, 'native maintenance exit differs: ' + result.stderr.decode()[-512:] + ' API paths=' + json.dumps(requests))
                return json.loads(result.stdout)

            def denied(stage, codes, *arguments):
                result = invoke(arguments)
                diagnostic = result.stderr.decode()[-512:]
                require(result.returncode != 0 and any('stage=' + stage + ' code=' + code in diagnostic for code in codes),
                        'native refusal differs: ' + diagnostic)

            wrong_key, wrong_cert = credentials / 'wrong.key', credentials / 'wrong.pem'
            subprocess.run([openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(wrong_key),
                            '-out', str(wrong_cert), '-subj', '/CN=wrong.example', '-addext', 'subjectAltName=DNS:wrong.example',
                            '-days', '1'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
            wrong_config = dict(portable_config, root_authority=dict(portable_config['root_authority'], ca_file=str(wrong_cert)))
            wrong_config_file = root / 'wrong-ca.json'
            wrong_config_file.write_text(json.dumps(wrong_config))
            wrong_config_file.chmod(0o600)
            before_tls = len(requests)
            denied('plan-root-identity', {'authority-unavailable'}, 'plan-root-identity', str(wrong_config_file), str(output / 'bad-ca-plan.json'), 'owned TLS refusal')
            require(len(requests) == before_tls, 'unknown CA reached HTTP handler')
            wrong_tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            wrong_tls.load_cert_chain(wrong_cert, wrong_key)
            wrong_server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            wrong_server.socket = wrong_tls.wrap_socket(wrong_server.socket, server_side=True)
            wrong_thread = threading.Thread(target=wrong_server.serve_forever, daemon=True)
            wrong_thread.start()
            try:
                wrong_config['root_authority']['api_origin'] = 'https://127.0.0.1:' + str(wrong_server.server_port)
                wrong_config_file.write_text(json.dumps(wrong_config))
                denied('plan-root-identity', {'authority-unavailable'}, 'plan-root-identity', str(wrong_config_file), str(output / 'bad-san-plan.json'), 'owned SAN refusal')
                require(len(requests) == before_tls, 'wrong SAN reached HTTP handler')
            finally:
                wrong_server.shutdown()
                wrong_server.server_close()
                wrong_thread.join(timeout=10)

            completed.add('nativeUnknownCaAndWrongSanDenied')
            plan_file = output / 'plan.json'
            planned = native('plan-root-identity', str(config_file), str(plan_file), 'owned controlled API + real filesystem namespace; NOT real CSI acceptance')
            require(planned['status'] == 'planned-not-applied', 'plan status differs')
            require(database.runtime_sql("SELECT encode(identity,'hex') FROM manure.root_owner WHERE singleton") == original, 'planning changed V1 binding')
            require(not (payload / '.manure-root-owner-v2').exists(), 'planning created a marker')
            require(database.runtime_sql("SELECT to_regclass('manure.root_identity_migrations') IS NULL") == 't', 'planning created receipt schema')
            completed.add('planOnlyNonAdopting')
            applied = native('migrate-root-identity', str(config_file), str(plan_file), planned['planSha256'])
            require(applied['status'] == 'applied' and not applied['contextRefreshed'], 'native apply result differs')
            require(len(database.runtime_sql("SELECT encode(identity,'hex') FROM manure.root_owner WHERE singleton")) == 152, 'V2 binding length differs')
            completed.add('applied')
            schema_result = invoke(['migrate', str(config_file)])
            require(schema_result.returncode == 0, 'schema-only migrate after portable application failed: ' + schema_result.stderr.decode()[-512:])
            completed.add('schemaMigrateAfterApplied')
            state['podUid'] = '44444444-4444-4444-8444-444444444444'
            renew_projection()
            replay = native('migrate-root-identity', str(config_file), str(plan_file), planned['planSha256'])
            require(replay['status'] == 'replayed' and replay['contextRefreshed'], 'native fresh-pod replay differs')
            completed.add('freshPodExactReplay')
            portable_binding = database.runtime_sql("SELECT encode(identity,'hex') FROM manure.root_owner WHERE singleton")
            with patch.dict(os.environ, {'MANURE_TEST_SERVER_COMMAND_JSON': json.dumps(prefix + command)}):
                with TargetServer(portable_config, name, owned_database=database, close_database=False) as active:
                    live = ManureClient(active.api_url, token=token, cache_dir=str(root / 'portable-cache'))
                    fetched = root / 'portable-fetch'
                    live.fetch_to_dest(artifact_id, str(fetched))
                    require((fetched / source.name).read_bytes() == source.read_bytes(), 'portable native startup changed payload')
                    completed.add('portableNativeServeAndContent')
                    rejected = ManureClient(active.api_url, token=auth.generate_token(), cache_dir=str(root / 'wrong-cache'))
                    try:
                        rejected.get_artifact(artifact_id)
                    except ManureError as failure:
                        require(failure.code == 'unauthorized', 'wrong credential refusal differs')
                    else:
                        raise RuntimeError('wrong credential accepted after portable startup')
                    connection = http.client.HTTPConnection('127.0.0.1', active.bound_port, timeout=10)
                    try:
                        connection.request('GET', '/api/current/artifacts/' + artifact_id + '/files/' + source.name + '/content')
                        response = connection.getresponse()
                        response.read(len(source.read_bytes()) + 1)
                        require(response.status in (401, 403), 'missing credential read internal portable payload')
                    finally:
                        connection.close()
                    completed.add('nativeAuthDenials')
                    denied('plan-root-identity', {'io', 'root-locked'}, 'plan-root-identity', str(config_file), str(output / 'while-active.json'), 'owned lock contender')
                    completed.add('nativeHeldRootDenial')
                    isolated = subprocess.run(prefix[:-1] + ['--unshare-net', '--'] + command + [
                        'serve', str(config_file)], stdin=subprocess.DEVNULL, capture_output=True, timeout=30)
                    require(isolated.returncode != 0 and b'code=root-locked' in isolated.stderr,
                            'native cross-network-namespace serve exclusion differs: ' + isolated.stderr.decode()[-512:])
                    completed.add('nativeCrossNetworkNamespaceRootDenial')
                def refused_root(label):
                    try:
                        with TargetServer(portable_config, name, owned_database=database, close_database=False):
                            raise RuntimeError(label + ' accepted')
                    except RuntimeError as failure:
                        require('authority-mismatch' in str(failure), label + ' refusal differs')

                original_handle = state['handle']
                state['handle'] = 'computedisk-ownedclone'
                try:
                    refused_root('modeled foreign volume')
                finally:
                    state['handle'] = original_handle
                completed.add('modeledForeignVolumeDenied')
                marker = payload / '.manure-root-owner-v2'
                original_marker = marker.read_bytes()
                try:
                    marker.write_bytes(bytes([original_marker[0] ^ 1]) + original_marker[1:])
                    refused_root('owned marker tamper')
                finally:
                    marker.write_bytes(original_marker)
                completed.add('nativeMarkerTamperDenied')
                original_inode = payload.stat().st_ino
                backup = root / 'original-payloads'
                payload.rename(backup)
                try:
                    shutil.copytree(backup, payload)
                    require(payload.stat().st_ino != original_inode, 'owned directory copy did not change inode')
                    require((payload / marker.name).read_bytes() == original_marker, 'owned copy changed marker')
                    refused_root('same-volume copied inode')
                finally:
                    if payload.exists():
                        payload.rename(root / 'rejected-copy')
                    backup.rename(payload)
                completed.add('sameVolumeInodeCopyDenied')
                with TargetServer(portable_config, name, owned_database=database, close_database=False) as restored:
                    restored_client = ManureClient(restored.api_url, token=token, cache_dir=str(root / 'restored-cache'))
                    destination = root / 'restored-fetch'
                    restored_client.fetch_to_dest(artifact_id, str(destination))
                    require((destination / source.name).read_bytes() == source.read_bytes(), 'restored owned root did not reopen')
            require(database.runtime_sql("SELECT encode(identity,'hex') FROM manure.root_owner WHERE singleton") == portable_binding, 'native refusal rewrote portable binding')
            completed.add('nativeRestoredRootReopens')
            report = {'scope': 'owned native static-musl portable CLI/runtime/PG/TLS/private-mount probe; NOT real Kubernetes/node handoff',
                      'bindingBytes': [16, 76], 'artifactId': artifact_id,
                      'nativeElfSha256': hashlib.sha256(Path(command[0]).read_bytes()).hexdigest()}
            report.update(dict.fromkeys(completed, True))
            print(json.dumps(report))
        finally:
            try:
                if database is not None:
                    database.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=10)


if __name__ == '__main__':
    main()
