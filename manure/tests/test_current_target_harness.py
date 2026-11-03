"""BA specified fixture safety, not target server/PostgreSQL acceptance."""
import os
import tempfile
import unittest
from unittest.mock import patch

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

    def test_empty_or_non_argv_launcher_never_starts_a_process(self):
        for command in ['[]','"shell command"','[null]','[""]']:
            with self.subTest(command=command),tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'MANURE_TEST_SERVER_COMMAND_JSON':command},clear=True),patch('subprocess.Popen') as spawn:
                with self.assertRaises(RuntimeError):TargetServer({},tmp)
                spawn.assert_not_called()


if __name__=='__main__':unittest.main()
