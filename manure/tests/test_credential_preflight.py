"""BA/BG regression: ambiguous source configuration must precede secret I/O.

Every child starts with an explicit minimal environment, never inherited live
client/model/PostgreSQL settings. Only synthetic canonical tokens, missing paths
and owned FIFOs are injected. FIFO checks have a real subprocess deadline; no
writer is opened. Network entrypoints are forbidden before invoking public APIs.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

TOKEN='A'*43
ORIGIN='http://127.0.0.1:9'
PROJECT=Path(__file__).resolve().parents[1]
CHILD=r'''
import contextlib,io,json,os,socket,sys
from manure import client,cli,mcp
spec=json.load(sys.stdin)
def no_network(*a,**k):raise AssertionError('unexpected network')
socket.socket=no_network
socket.create_connection=no_network
client.StdlibTransport.request=no_network
try:
    if spec['action']=='pair':
        client.resolve_secret_pair(spec['direct'],spec['reference'],kind=spec['kind'])
        code='accepted'
    elif spec['action']=='constructor':
        client.ManureClient('http://127.0.0.1:9',token=spec['direct'],token_file=spec['reference'])
        code='accepted'
    elif spec['action']=='mcp':
        mcp._client_from_env()
        code='accepted'
    elif spec['action']=='cli':
        output=io.StringIO();error=io.StringIO()
        with contextlib.redirect_stdout(output),contextlib.redirect_stderr(error):
            exit_code=cli.main(spec.get('argv',['whoami']))
        code='ambiguous-credentials' if 'ambiguous-credentials:' in error.getvalue() else 'other-cli-error'
        print(json.dumps({'code':code,'exit':exit_code}));raise SystemExit(0)
except client.ManureError as error:code=error.code
print(json.dumps({'code':code}))
'''


class CredentialPreflightTests(unittest.TestCase):
    def run_child(self,tmp,spec,configuration=None,expected='ambiguous-credentials'):
        # Do not copy os.environ: no live tokens, model credentials, PG settings,
        # provider references, SDK configuration or ambient client URL can enter.
        env={'PATH':os.defpath,'PYTHONPATH':str(PROJECT),'HOME':tmp,
             'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TZ':'UTC'}
        env.update(configuration or {})
        try:
            result=subprocess.run([sys.executable,'-c',CHILD],input=json.dumps(spec),env=env,
                capture_output=True,text=True,timeout=2)
        except subprocess.TimeoutExpired:
            self.fail('credential preflight blocked on an owned synthetic FIFO')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertNotIn('SYNTHETIC-CANARY',result.stdout+result.stderr)
        observed=json.loads(result.stdout)
        self.assertEqual(observed['code'],expected,observed)
        if spec['action']=='cli':self.assertEqual(observed['exit'],2)

    @staticmethod
    def references(tmp):
        fifo=str(Path(tmp)/'unopened.fifo');os.mkfifo(fifo,0o600)
        return fifo,str(Path(tmp)/'missing-secret')

    def test_common_pairs_reject_fifo_before_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            fifo,_=self.references(tmp)
            for kind,direct in [('token',TOKEN),('password',TOKEN),('url',ORIGIN)]:
                with self.subTest(kind=kind):self.run_child(tmp,{'action':'pair','kind':kind,'direct':direct,'reference':fifo})

    def test_common_pairs_missing_file_and_invalid_direct_are_still_ambiguous(self):
        with tempfile.TemporaryDirectory() as tmp:
            _,missing=self.references(tmp)
            for kind in ['token','password','url']:
                for direct in [TOKEN if kind!='url' else ORIGIN,'SYNTHETIC-CANARY-invalid']:
                    with self.subTest(kind=kind,direct_valid=direct==TOKEN):
                        self.run_child(tmp,{'action':'pair','kind':kind,'direct':direct,'reference':missing})

    def test_constructor_checks_presence_before_direct_token_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            for reference in self.references(tmp):
                for direct in [TOKEN,'SYNTHETIC-CANARY-invalid']:
                    with self.subTest(reference=Path(reference).name,direct_valid=direct==TOKEN):
                        self.run_child(tmp,{'action':'constructor','direct':direct,'reference':reference})

    def test_cli_token_and_url_pairs_fail_before_fifo_or_missing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            for reference in self.references(tmp):
                for name,direct in [('TOKEN',TOKEN),('TOKEN','SYNTHETIC-CANARY-invalid'),('URL',ORIGIN),('URL','SYNTHETIC-CANARY-invalid')]:
                    config={'MANURE_URL':ORIGIN,'MANURE_TOKEN':TOKEN,
                            'MANURE_'+name:direct,'MANURE_'+name+'_FILE':reference}
                    with self.subTest(name=name,reference=Path(reference).name,direct_valid=direct in (TOKEN,ORIGIN)):
                        self.run_child(tmp,{'action':'cli'},config)

    def test_mcp_token_and_url_pairs_fail_before_fifo_or_missing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            for reference in self.references(tmp):
                for name,direct in [('TOKEN',TOKEN),('TOKEN','SYNTHETIC-CANARY-invalid'),('URL',ORIGIN),('URL','SYNTHETIC-CANARY-invalid')]:
                    config={'MANURE_URL':ORIGIN,'MANURE_TOKEN':TOKEN,
                            'MANURE_'+name:direct,'MANURE_'+name+'_FILE':reference}
                    with self.subTest(name=name,reference=Path(reference).name,direct_valid=direct in (TOKEN,ORIGIN)):
                        self.run_child(tmp,{'action':'mcp'},config)

    def test_all_pairs_are_preflighted_before_reading_another_pairs_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            fifo,missing=self.references(tmp)
            config={'MANURE_URL_FILE':fifo,'MANURE_TOKEN':TOKEN,'MANURE_TOKEN_FILE':missing}
            for action in ['cli','mcp']:
                with self.subTest(action=action):self.run_child(tmp,{'action':action},config)

    def test_cli_password_sources_preflight_before_token_file_read_or_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            fifo,missing=self.references(tmp)
            argv=['fetch','http://127.0.0.1:9/view/'+'a'*32,str(Path(tmp)/'out')]
            for direct,token_config in [(TOKEN,{'MANURE_TOKEN_FILE':fifo}),
                                        ('SYNTHETIC-CANARY-invalid',{'MANURE_TOKEN':TOKEN})]:
                config={'MANURE_URL':ORIGIN,'MANURE_EXTERNAL_PASSWORD':direct,
                        'MANURE_EXTERNAL_PASSWORD_FILE':missing,**token_config}
                with self.subTest(direct_valid=direct==TOKEN):self.run_child(tmp,{'action':'cli','argv':argv},config)
            self.run_child(tmp,{'action':'cli','argv':argv+['--password','SYNTHETIC-CANARY-invalid','--password-file',fifo]},
                           {'MANURE_URL':ORIGIN,'MANURE_TOKEN':TOKEN})

    def test_mcp_invalid_http_configuration_precedes_token_file_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            fifo,_=self.references(tmp)
            self.run_child(tmp,{'action':'mcp'},{'MANURE_URL':ORIGIN,'MANURE_TOKEN_FILE':fifo,
                'MANURE_ALLOW_INSECURE_HTTP':'invalid'},expected='bad-envelope')


if __name__=='__main__':unittest.main()
