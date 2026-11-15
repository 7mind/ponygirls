"""Owned target startup refusals; not CSI or portable-migration acceptance."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import struct
import tempfile
import unittest

from manure import auth as A
from manure.client import ManureClient
from target_server import OwnedDatabase, TargetServer, server_command


class PortableRootStartupTests(unittest.TestCase):
    def setUp(self):
        if not os.environ.get('MANURE_TEST_PROVISION_COMMAND'):
            raise RuntimeError('registry-guarded owned PostgreSQL helper required')
        self.temporary = tempfile.TemporaryDirectory(prefix='manure-portable-startup-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = OwnedDatabase(str(self.root))
        self.addCleanup(self.database.close)
        self.payload = self.root / 'data'
        self.payload.mkdir(mode=0o700)
        self.token = A.generate_token()
        digest = self.root / 'operator.digest'
        digest.write_text(A.sha256_hex(self.token) + '\n')
        digest.chmod(0o600)
        self.config = {'api_origin': 'http://127.0.0.1:0', 'listen_address': '127.0.0.1',
            'port': 0, 'loopback_dev': True, 'content_mode': 'path', 'content_suffix': '',
            'data_dir': str(self.payload), 'dashboard_dir': None, 'unlock_shell_dir': None,
            'sweep_interval_s': 3600, 'users': [{'id': 'owner', 'type': 'human',
                'tokens': [{'id': 'owned', 'hashFile': str(digest)}]}]}
        self.portable = dict(self.config, root_authority={'kind': 'kubernetes-csi-v1', 'expected_csi_driver': 'storage.example.test',
            'api_origin': 'https://127.0.0.1:1', 'ca_file': str(self.root / 'absent-ca'),
            'token_file': str(self.root / 'absent-token'), 'pod_uid_file': str(self.root / 'absent-uid'),
            'namespace': 'owned', 'pod_name': 'core-0', 'container_name': 'manure'})

    def files(self):
        return tuple(sorted((str(path.relative_to(self.payload)),
            hashlib.sha256(path.read_bytes()).hexdigest())
            for path in self.payload.rglob('*') if path.is_file()))

    def test_opted_in_unbound_root_refuses_before_schema_or_adoption(self):
        before = tuple(self.payload.iterdir())
        with self.assertRaisesRegex(RuntimeError, 'code=migration-required'):
            with TargetServer(self.portable, str(self.root), owned_database=self.database, close_database=False):
                self.fail('authority-enabled unbound root served')
        self.assertEqual(self.database.runtime_sql("SELECT count(*) FROM pg_tables WHERE schemaname='manure'"), '0')
        self.assertEqual(tuple(self.payload.iterdir()), before)

    def test_opted_in_legacy_root_refuses_and_default_auth_payload_remain_usable(self):
        source = self.root / 'source.txt'
        source.write_bytes(b'owned portable startup boundary')
        with TargetServer(self.config, str(self.root), owned_database=self.database, close_database=False) as server:
            client = ManureClient(server.api_url, token=self.token, cache_dir=str(self.root / 'cache'))
            artifact = client.upload_path(str(source), access='internal')['artifact_id']
        before = self.database.runtime_sql("SELECT encode(identity,'hex') FROM manure.root_owner WHERE singleton")
        self.assertEqual(len(bytes.fromhex(before)), 16)
        before_files = self.files()
        with self.assertRaisesRegex(RuntimeError, 'code=migration-required'):
            with TargetServer(self.portable, str(self.root), owned_database=self.database, close_database=False):
                self.fail('authority-enabled legacy root served without migration')
        self.assertEqual(self.database.runtime_sql("SELECT encode(identity,'hex') FROM manure.root_owner WHERE singleton"), before)
        self.assertEqual(self.files(), before_files)
        with TargetServer(self.config, str(self.root), owned_database=self.database, close_database=False) as server:
            client = ManureClient(server.api_url, token=self.token, cache_dir=str(self.root / 'cache'))
            destination = self.root / 'fetched'
            client.fetch_to_dest(artifact, str(destination))
            self.assertEqual((destination / source.name).read_bytes(), source.read_bytes())

    def test_inode_anchored_device_drift_preserves_payload_binding_and_strict_refusal(self):
        source = self.root / 'source.txt'
        source.write_bytes(b'plain host retained payload')
        with TargetServer(self.config, str(self.root), owned_database=self.database, close_database=False) as server:
            client = ManureClient(server.api_url, token=self.token, cache_dir=str(self.root / 'cache'))
            artifact = client.upload_path(str(source), access='internal')['artifact_id']
        original = self.database.runtime_sql("SELECT encode(identity,'hex') FROM manure.root_owner WHERE singleton")
        device, inode = struct.unpack('>QQ', bytes.fromhex(original))
        drift = struct.pack('>QQ', device ^ 16, inode).hex()
        self.database.runtime_sql("UPDATE manure.root_owner SET identity=decode('" + drift + "','hex') WHERE singleton")
        opted = dict(self.config, root_binding={'mode': 'inode-anchored'})
        with TargetServer(opted, str(self.root), owned_database=self.database, close_database=False) as server:
            client = ManureClient(server.api_url, token=self.token, cache_dir=str(self.root / 'cache2'))
            destination = self.root / 'fetched'
            client.fetch_to_dest(artifact, str(destination))
            self.assertEqual((destination / source.name).read_bytes(), source.read_bytes())
        self.assertIn('manure warning root-binding-mode=inode-anchored', ''.join(server._stderr))
        self.assertEqual(self.database.runtime_sql("SELECT encode(identity,'hex') FROM manure.root_owner WHERE singleton"), drift)
        with self.assertRaisesRegex(RuntimeError, 'code=migration-required'):
            TargetServer(self.config, str(self.root), owned_database=self.database, close_database=False)
        changed = struct.pack('>QQ', device, inode ^ 16).hex()
        self.database.runtime_sql("UPDATE manure.root_owner SET identity=decode('" + changed + "','hex') WHERE singleton")
        with self.assertRaisesRegex(RuntimeError, 'code=migration-required'):
            TargetServer(opted, str(self.root), owned_database=self.database, close_database=False)
        self.assertEqual(self.database.runtime_sql("SELECT encode(identity,'hex') FROM manure.root_owner WHERE singleton"), changed)

    def test_unsafe_off_upload_fetch_restart_without_persistent_binding(self):
        source = self.root / 'source.txt'
        source.write_bytes(b'disposable deployment payload')
        opted = dict(self.config, root_binding={'mode': 'unsafe-off'})
        with TargetServer(opted, str(self.root), owned_database=self.database, close_database=False) as server:
            client = ManureClient(server.api_url, token=self.token, cache_dir=str(self.root / 'cache'))
            artifact = client.upload_path(str(source), access='internal')['artifact_id']
        self.assertIn('manure warning root-binding-mode=unsafe-off', ''.join(server._stderr))
        with TargetServer(opted, str(self.root), owned_database=self.database, close_database=False) as server:
            client = ManureClient(server.api_url, token=self.token, cache_dir=str(self.root / 'cache2'))
            destination = self.root / 'fetched'
            client.fetch_to_dest(artifact, str(destination))
            self.assertEqual((destination / source.name).read_bytes(), source.read_bytes())
        self.assertEqual(self.database.runtime_sql('SELECT count(*) FROM manure.root_owner'), '0')

    def test_non_strict_cannot_disable_configured_portable_authority(self):
        for mode in ('inode-anchored', 'unsafe-off'):
            with self.subTest(mode=mode), self.assertRaisesRegex(RuntimeError, 'code=root-binding-policy'):
                TargetServer(dict(self.portable, root_binding={'mode': mode}), str(self.root),
                    owned_database=self.database, close_database=False)
        self.assertEqual(self.database.runtime_sql("SELECT count(*) FROM pg_tables WHERE schemaname='manure'"), '0')

    def maintenance_failure(self, arguments, stage, code):
        library = os.environ.get('MANURE_POSIX_LIBRARY')
        config = dict(self.config, database=self.database.config(),
            native_mode='shared' if library else 'linked', posix_library=library)
        path = self.root / 'maintenance.json'
        path.write_text(json.dumps(config))
        path.chmod(0o600)
        result = subprocess.run(server_command() + [arguments[0], str(path)] + arguments[1:],
            stdin=subprocess.DEVNULL, capture_output=True, timeout=90)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('stage=' + stage + ' code=' + code, result.stderr.decode())
        self.assertEqual(self.database.runtime_sql("SELECT count(*) FROM pg_tables WHERE schemaname='manure'"), '0')
        self.assertEqual(tuple(self.payload.iterdir()), ())

    def test_plan_command_reports_its_own_error_stage(self):
        self.maintenance_failure(['plan-root-identity', str(self.root / 'plan.json'), 'owned test reference'],
            'plan-root-identity', 'authority-required')

    def test_apply_command_reports_its_own_error_stage(self):
        self.maintenance_failure(['migrate-root-identity', str(self.root / 'absent-plan.json'), '0' * 64],
            'migrate-root-identity', 'migration-plan-invalid')
