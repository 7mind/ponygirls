"""Behavioral/Active Effectual-Group regression: bounded file references.

Only owned synthetic files/FIFOs and child processes, never real credentials or
network. Two-second children are killed AND reaped on timeout. CLI/MCP/public
helpers share the same boundary; ambiguity remains an earlier, pure preflight.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

PROJECT = Path(__file__).resolve().parents[1]
TOKEN = 'A' * 43
ORIGIN = 'http://127.0.0.1:9'
URL_FILE_BYTES = 65536  # Conservative existing transport ceiling; see README.
CHILD = r'''
import contextlib,io,json,os,socket,sys
from pathlib import Path
from manure import client,cli,mcp
spec=json.load(sys.stdin)
reference=spec['reference'];kind=spec.get('kind','token')
counts={'opens':0,'reads':0,'readBytes':0,'maxReadRequest':0,'network':0}
def audit(event,args):
    if event=='open' and args and isinstance(args[0],str) and args[0].startswith(spec['root']):counts['opens']+=1
sys.addaudithook(audit)
def no_network(*a,**k):
    counts['network']+=1
    raise AssertionError('network forbidden')
socket.socket=no_network;socket.create_connection=no_network
client.StdlibTransport.request=no_network
original_read=os.read;original_open=os.open;original_fstat=os.fstat
raced=False;grown=False
if spec.get('race'):
    def race_open(path,flags,*a,**kw):
        global raced
        if not raced and str(path)==reference:
            raced=True;os.rename(reference,reference+'.previous');os.mkfifo(reference,0o600)
        return original_open(path,flags,*a,**kw)
    client.os.open=race_open
if spec.get('grow'):
    def grow_after_fstat(fd):
        global grown
        result=original_fstat(fd)
        if not grown:
            grown=True
            with open(reference,'ab') as output:output.write(b'x'*(spec['limit']+1))
        return result
    client.os.fstat=grow_after_fstat
# Count actual bytes, not just Python read() arguments. Production must use
# unbuffered os.read; a buffered .read(45) may prefetch much more than 45 bytes.
def counted_read(fd,n):
    counts['reads']+=1;counts['maxReadRequest']=max(counts['maxReadRequest'],n)
    block=original_read(fd,n);counts['readBytes']+=len(block);return block
client.os.read=counted_read
try:
    action=spec['action']
    if action=='helper':
        value=client.resolve_secret_pair(spec.get('direct'),reference,kind=kind)
        if 'value' in spec:assert value==spec['value']
    elif action=='constructor':
        client.ManureClient('http://127.0.0.1:9',token=spec.get('direct'),token_file=reference)
    elif action=='mcp':mcp._client_from_env()
    elif action=='cli':
        output=io.StringIO();error=io.StringIO()
        argv=spec.get('argv',['whoami'])
        with contextlib.redirect_stdout(output),contextlib.redirect_stderr(error):exit_code=cli.main(argv)
        text=error.getvalue()
        code=next((name for name in ['ambiguous-credentials','missing-credentials','invalid-url','unauthorized'] if name+':' in text),'unexpected-cli-result')
        print(json.dumps({'code':code,'exit':exit_code,**counts}));raise SystemExit(0)
    else:raise AssertionError('unknown action')
    code='accepted';message=''
except client.ManureError as error:code=error.code;message=error.message
except Exception as error:code='unexpected-'+type(error).__name__;message=''
print(json.dumps({'code':code,'message':message,**counts}))
'''


class ClientSecretFileTests(unittest.TestCase):
    def child(self, root, reference, *, action='helper', kind='token', expected='missing-credentials',
              configuration=None, **options):
        # Deliberately no os.environ copy or provider/PG/model/tool references.
        env={'PATH':os.defpath,'PYTHONPATH':str(PROJECT),'HOME':str(root),
             'XDG_CONFIG_HOME':str(root/'config'),'XDG_CACHE_HOME':str(root/'cache'),
             'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TZ':'UTC'}
        env.update(configuration or {})
        spec={'root':str(root),'reference':str(reference),'action':action,'kind':kind,**options}
        process=subprocess.Popen([sys.executable,'-c',CHILD],stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env,cwd=PROJECT)
        try:
            out,err=process.communicate(json.dumps(spec),timeout=2)
        except subprocess.TimeoutExpired:
            process.kill();process.communicate(timeout=2)
            self.fail('owned no-writer credential reference blocked beyond 2s; child killed/reaped')
        self.assertEqual(process.returncode,0,err)
        self.assertNotIn(TOKEN,out+err)
        self.assertNotIn('SYNTHETIC-CREDENTIAL-CANARY',out+err)
        result=json.loads(out);self.assertEqual(result['code'],expected,result)
        self.assertEqual(result['network'],0)
        if action=='cli':self.assertEqual(result['exit'],2)
        return result

    def test_sole_fifo_reference_rejects_helpers_constructor_cli_and_mcp(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);fifo=root/'owned-no-writer';os.mkfifo(fifo,0o600)
            for kind in ('token','password','url'):
                with self.subTest(action='helper',kind=kind):self.child(root,fifo,kind=kind)
            with self.subTest(action='constructor'):self.child(root,fifo,action='constructor')
            for action in ('cli','mcp'):
                for kind in ('token','url'):
                    configuration={'MANURE_URL':ORIGIN,'MANURE_TOKEN_FILE':str(fifo)} if kind=='token' else {'MANURE_URL_FILE':str(fifo),'MANURE_TOKEN':TOKEN}
                    with self.subTest(action=action,kind=kind):self.child(root,fifo,action=action,kind=kind,configuration=configuration)
            self.child(root,fifo,action='cli',kind='password',
                argv=['fetch',ORIGIN+'/view/'+'a'*32,str(root/'out'),'--password-file',str(fifo)],
                configuration={'MANURE_URL':ORIGIN,'MANURE_TOKEN':TOKEN})

    def test_symlink_to_fifo_rejects_but_managed_regular_symlinks_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);fifo=root/'owned-no-writer';os.mkfifo(fifo,0o600)
            link=root/'managed-reference';link.symlink_to(fifo.name)
            for kind in ('token','password','url'):
                with self.subTest(kind=kind):self.child(root,link,kind=kind)
            link.unlink();regular=root/'owned-regular';regular.write_bytes(TOKEN.encode()+b'\n');link.symlink_to(regular.name)
            self.child(root,link,expected='accepted',value=TOKEN)
            self.child(root,link,action='constructor',expected='accepted')
            self.child(root,link,action='mcp',expected='accepted',configuration={'MANURE_URL':ORIGIN,'MANURE_TOKEN_FILE':str(link)})
            regular.write_bytes(b' \thttp://127.0.0.1:9\n')
            self.child(root,link,kind='url',expected='accepted',value=ORIGIN)
            self.child(root,link,action='mcp',kind='url',expected='accepted',configuration={'MANURE_URL_FILE':str(link),'MANURE_TOKEN':TOKEN})

    def test_nonregular_missing_and_dangling_references_are_sanitized(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);directory=root/'directory';directory.mkdir();dangling=root/'dangling';dangling.symlink_to('missing')
            for reference in (directory,dangling,root/'missing'):
                for kind in ('token','url'):
                    with self.subTest(reference=reference.name,kind=kind):
                        result=self.child(root,reference,kind=kind)
                        self.assertNotIn(str(reference),result['message'])

    def test_token_exact_ascii_codec_and_single_optional_lf(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);path=root/'synthetic-token'
            for raw in (TOKEN.encode(),TOKEN.encode()+b'\n'):
                path.write_bytes(raw);result=self.child(root,path,expected='accepted',value=TOKEN)
                self.assertLessEqual(result['readBytes'],45)
            for raw in (b'',b' '+TOKEN.encode(),TOKEN.encode()+b' ',TOKEN.encode()+b'\r\n',TOKEN.encode()+b'\n\n',
                        b'A'*42+b'B',b'A'*42,b'A'*44,b'\0'+b'A'*42,b'\xff'+b'A'*42):
                with self.subTest(size=len(raw),ending=raw[-2:].hex()):
                    path.write_bytes(raw);self.child(root,path,expected='unauthorized')

    def test_url_reference_transport_bound_utf8_and_strip_semantics(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);path=root/'synthetic-url'
            for raw,value in ((b'',None),(b' \t\n',None),((' \u2003'+ORIGIN+'\n').encode(),ORIGIN),
                              (ORIGIN.encode()+b' '*(URL_FILE_BYTES-len(ORIGIN)),ORIGIN)):
                path.write_bytes(raw);self.child(root,path,kind='url',expected='accepted',value=value)
            for raw in (b'\xff',b'http://127.0.0.1:9\0'):
                path.write_bytes(raw);self.child(root,path,kind='url',expected='invalid-url')
            path.write_bytes(ORIGIN.encode()+b' '*(URL_FILE_BYTES+1-len(ORIGIN)))
            result=self.child(root,path,kind='url',expected='invalid-url');self.assertIn('oversized',result['message'])

    def test_growth_after_fstat_still_has_bounded_actual_reads(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);path=root/'growing-owned-file'
            for kind,raw,limit,expected in (('token',TOKEN.encode()+b'\n',44,'unauthorized'),('url',ORIGIN.encode(),URL_FILE_BYTES,'invalid-url')):
                with self.subTest(kind=kind):
                    path.write_bytes(raw)
                    result=self.child(root,path,kind=kind,grow=True,limit=limit,expected=expected)
                    self.assertIn('oversized',result['message']);self.assertGreater(result['readBytes'],0)
                    self.assertLessEqual(result['readBytes'],limit+1);self.assertLessEqual(result['maxReadRequest'],limit+1)

    def test_resolved_regular_leaf_raced_to_fifo_never_blocks_or_reads(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for kind in ('token','password','url'):
                path=root/('raced-'+kind);path.write_bytes(ORIGIN.encode() if kind=='url' else TOKEN.encode())
                with self.subTest(kind=kind):
                    result=self.child(root,path,kind=kind,race=True);self.assertEqual(result['readBytes'],0)

    def test_ambiguity_still_precedes_any_file_open(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);fifo=root/'owned-no-writer';os.mkfifo(fifo,0o600)
            for kind in ('token','password','url'):
                with self.subTest(kind=kind):
                    result=self.child(root,fifo,kind=kind,direct=ORIGIN if kind=='url' else TOKEN,expected='ambiguous-credentials')
                    self.assertEqual(result['opens'],0)
            for action in ('cli','mcp'):
                result=self.child(root,fifo,action=action,expected='ambiguous-credentials',
                    configuration={'MANURE_URL':ORIGIN,'MANURE_TOKEN':TOKEN,'MANURE_TOKEN_FILE':str(fifo)})
                self.assertEqual(result['opens'],0)


if __name__=='__main__':unittest.main()
