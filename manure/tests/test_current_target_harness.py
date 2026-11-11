"""BA specified fixture safety, not target server/PostgreSQL acceptance."""
import os
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import Mock, patch

from target_server import OwnedDatabase,TargetServer


class TargetHarnessSafetyTests(unittest.TestCase):
    def test_missing_launcher_fails_not_skips_or_python_fallback(self):
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{},clear=True),patch('subprocess.Popen') as spawn:
            with self.assertRaisesRegex(RuntimeError,'MANURE_TEST_SERVER_COMMAND_JSON'):TargetServer({},tmp)
            spawn.assert_not_called()

    def test_database_requires_explicit_createdb_opt_in_before_any_process(self):
        for flag in [None,'','0','true']:
            env={} if flag is None else {'MANURE_TEST_ALLOW_CREATEDB':flag}
            with self.subTest(flag=flag),tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,env,clear=True),patch('subprocess.run') as run:
                with self.assertRaisesRegex(RuntimeError,'MANURE_TEST_ALLOW_CREATEDB=1'):OwnedDatabase(tmp)
                run.assert_not_called()

    def test_unsafe_provider_urls_never_provision_or_reset_any_database(self):
        for url in ['jdbc:sqlite:production.db','jdbc:postgresql://user:SECRET@localhost/prod','jdbc:postgresql://localhost/db?password=SECRET','jdbc:postgresql://localhost/db#other']:
            env={'MANURE_TEST_ALLOW_CREATEDB':'1','MANURE_TEST_JDBC_URL':url}
            with self.subTest(url=url),tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,env,clear=True),patch('shutil.which',return_value='/psql'),patch('subprocess.run') as run:
                with self.assertRaises(RuntimeError) as error:OwnedDatabase(tmp)
                self.assertNotIn('SECRET',str(error.exception));run.assert_not_called()

    def test_tools_descriptor_control_characters_refuse_before_owned_fixture_invocation(self):
        launcher=Path(__file__).resolve().parents[1]/'scripts/run-owned-target.sh'
        with tempfile.TemporaryDirectory(prefix='manure-tools-descriptor-') as tmp:
            root=Path(tmp);marker=root/'fixture-invoked'
            wrapper=root/'with-owned.py';wrapper.write_text('from pathlib import Path\nPath('+repr(str(marker))+').write_text("owned fixture invoked")\nraise SystemExit(3)\n')
            helper=root/'provision.py';helper.write_text('raise SystemExit(99)\n')
            provider=root/'provider.json';provider.write_text(json.dumps({k:'/unused-owned-fixture' for k in ('PG_BIN','PG_CONFIGURATION','PG_HBA','PG_POLICY','PG_PROVIDER')}))
            tools=json.loads((launcher.parent/'acceptance-tools-x86_64-linux.json').read_text())
            descriptor=root/'tools.json'
            env={'PATH':os.environ.get('PATH',os.defpath),'HOME':tmp,'TMPDIR':tmp,'MANURE_ACCEPTANCE_TOOLS_JSON':str(descriptor)}
            for value in ('/invalid\0path','/invalid\npath'):
                with self.subTest(control='NUL' if '\0' in value else 'LF'):
                    descriptor.write_text(json.dumps(dict(tools,MANURE_CHROMIUM_BIN=value)))
                    marker.unlink(missing_ok=True)
                    result=subprocess.run([shutil.which('bash') or '/bin/bash',str(launcher),str(provider),str(wrapper),str(helper),'jvm','full'],env=env,capture_output=True,timeout=10)
                    self.assertEqual((result.returncode,marker.exists()),(2,False),'invalid public tools path reached an owned fixture')
            # Positive controller: the SAME launcher must actually dispatch our
            # harmless owned wrapper for the unchanged valid five tool pins.
            descriptor.write_text(json.dumps(tools));marker.unlink(missing_ok=True)
            result=subprocess.run([shutil.which('bash') or '/bin/bash',str(launcher),str(provider),str(wrapper),str(helper),'jvm','full'],env=env,capture_output=True,timeout=10)
            self.assertEqual((result.returncode,marker.exists()),(3,True))

    def test_browser_fixture_metadata_defaults_use_current_schema(self):
        """Fixture construction only; no browser, secrecy or real-target acceptance."""
        import browser_fixtures as bf
        from test_browser_unlock import UnlockSeparateCase

        artifact_id = 'a' * 32
        api = 'http://127.0.0.1:9'
        identity = SimpleNamespace(token='fixture-token')
        expected_metadata = {'tags': [], 'hostname': None, 'projectPath': None}
        commands = []
        with self.subTest(helper='init_command'):
            commands.append(bf.init_command({'name': 'fixture', 'kind': 'dir',
                'visibility': 'public', 'files': [{'kind': 'dir', 'path': 'empty'}]}))
        with self.subTest(helper='upload_fixture'):
            http = Mock()
            http.current.return_value = SimpleNamespace(status=200, json=lambda: {
                'artifact_id': artifact_id, 'chunk_bytes': 4, 'content_url': api + '/view/' + artifact_id})
            fix = SimpleNamespace(http=http, identity=identity, api_base=api)
            result = bf.upload_fixture(fix, name='fixture', kind='dir', visibility='public',
                files={}, empty_dirs=['empty'])
            self.assertEqual(result['artifact_id'], artifact_id)
            self.assertEqual(http.current.call_count, 2)
            commands.append(http.current.call_args_list[0].args[1])
            self.assertIsInstance(http.current.call_args_list[1].args[1], bf.cp.Command_FinishUpload)
        with self.subTest(helper='unlock_listing'):
            case = UnlockSeparateCase('test_b3_no_password_appears_in_listings_or_manifest')
            case.fix = SimpleNamespace(identity=identity)
            case.api = api
            case.http = Mock()
            case.http.current.return_value = SimpleNamespace(status=200, body=b'{}')
            case._external_artifact = Mock(return_value=(artifact_id, 'fixture-password', api))
            case.test_b3_no_password_appears_in_listings_or_manifest()
            self.assertEqual(case.http.current.call_count, 3)
            commands.append(case.http.current.call_args_list[0].args[1])
        for command in commands:
            with self.subTest(command=type(command).__name__):
                envelope = bf.cp.ClientEnvelope(uuid4(), bf.cp.API_VERSION, command)
                wire = bf.cp.encode(envelope)
                self.assertEqual(bf.cp.decode(bf.cp.ClientEnvelope, wire), envelope)
                body = wire['command'][command._variant]
                metadata = body['query'] if isinstance(command, bf.cp.Command_ListArtifacts) else body
                self.assertEqual({key: metadata[key] for key in expected_metadata}, expected_metadata)
                if isinstance(command, bf.cp.Command_InitUpload):
                    self.assertEqual(command.files, [bf.cp.ManifestEntry_Directory('empty')])

    def test_empty_or_non_argv_launcher_never_starts_a_process(self):
        for command in ['[]','"shell command"','[null]','[""]']:
            with self.subTest(command=command),tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'MANURE_TEST_SERVER_COMMAND_JSON':command},clear=True),patch('subprocess.Popen') as spawn:
                with self.assertRaises(RuntimeError):TargetServer({},tmp)
                spawn.assert_not_called()


if __name__=='__main__':unittest.main()
