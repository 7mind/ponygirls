#!/usr/bin/env python3
"""TEST-ONLY synthetic CLI for actual module/systemd graph, not an app fallback.
The VM uses real PostgreSQL, actual generated configs/credentials/role grants.
No HTTP/model endpoint is synthesized. Native app semantics have separate gates.
"""
import hashlib,json,os,pathlib,signal,subprocess,sys,time,urllib.parse
service,tag,mode,filename=sys.argv[1:]
assert service in ('chronicle','haystack','manure') and mode in ('migrate','serve','--config')
raw=pathlib.Path(filename).read_bytes();config=json.loads(raw)
# Service-specific actual generated module formats, not compatibility fallback.
db=({'jdbcUrl':config['jdbcUrl'],'user':config['databaseUser'],'passwordFile':config['databasePasswordFile']} if service=='chronicle' else config['database'])
url=urllib.parse.urlsplit(db['jdbcUrl'].removeprefix('jdbc:'))
assert url.hostname=='127.0.0.1' and url.port==15434 and url.path=='/'+service
assert url.username is None and url.password is None and not url.query
secret=os.path.expandvars(db['passwordFile'].replace('%d',os.environ['CREDENTIALS_DIRECTORY']))
password=pathlib.Path(secret).read_text().removesuffix('\n')
assert password
pg=os.environ['UNIT_GRAPH_PSQL']
def sql(text):
    result=subprocess.run([pg,'-X','-Atq','-h','127.0.0.1','-p','15434','-U',db['user'],'-d',service,'-v','ON_ERROR_STOP=1'],input=text,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={**os.environ,'PGPASSWORD':password,'PGCONNECT_TIMEOUT':'3','PGOPTIONS':'-c statement_timeout=3000 -c lock_timeout=3000'},timeout=6)
    if result.returncode:raise RuntimeError('synthetic adapter database operation failed (SQL/credentials suppressed)')
    return result.stdout.strip()
def probe():
    value=sql("SELECT NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT has_database_privilege(current_user,current_database(),'CREATE') AND EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') FROM pg_roles WHERE rolname=current_user;")
    assert value=='t','actual non-superuser/database privilege or preinstalled extension invariant failed'
def event(name):
    print(json.dumps({'event':name,'service':service,'tag':tag,'mode':mode,'invocation':os.environ['INVOCATION_ID'],'configSha256':hashlib.sha256(raw).hexdigest()}),flush=True)
probe()
if mode=='migrate':
    sql('CREATE TABLE IF NOT EXISTS public.unit_graph_migrations (entry bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY); INSERT INTO public.unit_graph_migrations DEFAULT VALUES;')
    event('unit_graph_adapter_start')
else:
    requested=False
    def request(_signal,_frame):
        global requested
        requested=True
    signal.signal(signal.SIGUSR1,request)
    event('unit_graph_adapter_start')
    while True:
        if requested:
            requested=False
            try:probe();event('unit_graph_adapter_sql_probe_ok')
            except Exception:event('unit_graph_adapter_sql_probe_failed')
        time.sleep(0.1)
