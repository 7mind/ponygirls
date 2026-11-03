#!/usr/bin/env python3
"""Actual sandbox closure + least-privileged helper contract, no live inputs."""
import hashlib,json,os,pathlib,secrets,subprocess,sys
out=pathlib.Path(sys.argv[1]);out.mkdir()
root_snapshot=os.environ['UNDECLARED_ROOT_SNAPSHOT']
assert root_snapshot not in pathlib.Path('fixture-closure').read_text().splitlines()
assert not pathlib.Path(root_snapshot).exists(), 'whole Git flake source must not be mounted as a substitute'
provider=pathlib.Path(os.environ['PG_PROVIDER'])
assert provider.is_file() and provider.name.endswith('-provider.py')
assert hashlib.sha256(provider.read_bytes()).hexdigest()==os.environ['EXPECTED_PROVIDER_SHA256']
name='haystack_current_'+secrets.token_hex(8)
helper=os.environ['HAYSTACK_TEST_PROVISION_COMMAND']
d=json.loads(subprocess.check_output([helper,name],text=True,timeout=10))
assert set(d)=={'jdbcUrl','user','passwordFile'}
info=json.loads((pathlib.Path(os.environ['PONYGIRLS_OWNED_FIXTURE_ROOT'])/'provider.json').read_text())
env={**os.environ,'PGPASSWORD':pathlib.Path(d['passwordFile']).read_text().rstrip('\n')}
args=[os.environ['PG_BIN']+'/psql','-X','-Atq','-h','127.0.0.1','-p',str(info['port']),'-U',d['user'],'-d',name]
result=subprocess.check_output(args+['-c',"SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,has_database_privilege(current_user,current_database(),'CREATE'),EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') FROM pg_roles WHERE rolname=current_user"],env=env,text=True,timeout=10).strip()
assert result=='f|f|f|f|f|t'
assert json.loads(subprocess.check_output([helper,'--drop',name],text=True,timeout=10))=={}
for variable in ['HAYSTACK_CHROMIUM','HAYSTACK_NGINX']:
    assert pathlib.Path(os.environ[variable]).is_file()
(out/'receipt.json').write_text(json.dumps({'cases':['whole-flake-root-not-an-input','actual-provider-leaf-source-and-sha256','wrapper-starts-owned-provider-in-sandbox','paired-helper-protocol','real-SCRAM-NOSUPERUSER-NOCREATEDB-NOCREATEROLE-NOBYPASSRLS-no-DB-CREATE','admin-preinstalled-vector','registered-drop','pinned-browser-tool-closure'],'skips':0},indent=2)+'\n')
