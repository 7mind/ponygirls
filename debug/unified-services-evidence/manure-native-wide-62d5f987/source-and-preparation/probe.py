#!/usr/bin/env python3
"""Additional focused native accepted-manager-domain proof, never full335 substitute.
Requires the explicit paired owned provider; never accepts an external DB/URL.
Only current public ManureClient operations and the existing owned fixture are used.
"""
import base64,hashlib,json,math,os,signal,socket,subprocess,sys,tempfile,time
from pathlib import Path

SOURCE=Path('/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-manure-native-62')
COMMIT='62d5f9877d9df9ae2d059c5cec5facff09b182b5'
ARTIFACT=Path('/nix/store/vy90bri36mygbj211vklcgzpilq8ff9a-manure-native-artifact-0.1.0')
ELF_SHA='9318c06043c06b95e7cc4ceafbc6c9b3f22bd685dd43bb01896497d175f7a835'
MANIFEST_SHA='1ed47d780d8a78f14eaad4e75c3e57c841604bb04180a8aaecdaec4c58feb3a1'
EXPECTED=['source-binding','owned-least-privilege-runtime','normal-publication','normal-pinned-query','restart-backfill-wide-first-query','unchanged-head-and-public-snapshot','normal-query-after-roster-change','wide-publication','both-managers-exact-creator-filters','hash-creator-filters-negative','authorization-and-visibility-boundaries','no-model-and-authoritative-identities']

class ProbeFailure(RuntimeError):
    def __init__(self,code):super().__init__(code);self.code=code
def require(value,code):
    if not value:raise ProbeFailure(code)
def digest(value):return hashlib.sha256(value).hexdigest()
def sha(path):return digest(path.read_bytes())
def token():return base64.urlsafe_b64encode(os.urandom(32)).rstrip(b'=').decode()
def alarm(*_):raise TimeoutError('owned-focused-probe-deadline')
def main():
    require(len(sys.argv)==2,'explicit-report-required')
    report=Path(sys.argv[1]);require(report.is_absolute() and report.is_dir(),'owned-report-required')
    checks=[];failure=None;server=None;database=None;temporary=None;started=time.monotonic()
    def passed(name):
        require(name==EXPECTED[len(checks)],'check-order')
        checks.append({'name':name,'status':'passed'})
        with (report/'checks.jsonl').open('a') as output:
            output.write(json.dumps(checks[-1])+'\n');output.flush();os.fsync(output.fileno())
    signal.signal(signal.SIGALRM,alarm);signal.signal(signal.SIGTERM,alarm);signal.signal(signal.SIGINT,alarm);signal.alarm(180)
    try:
        require(subprocess.check_output(['git','-C',str(SOURCE),'rev-parse','HEAD'],text=True,timeout=10).strip()==COMMIT,'source-commit')
        require(not subprocess.check_output(['git','-C',str(SOURCE),'status','--porcelain'],text=True,timeout=10).strip(),'tracked-source-dirty')
        require(sha(ARTIFACT/'libexec/manure-server')==ELF_SHA,'elf-sha')
        manifest=ARTIFACT/'share/manure/compiled-inputs.sha256'
        require(sha(manifest)==MANIFEST_SHA,'manifest-sha')
        actual=subprocess.check_output([sys.executable,'-B',str(SOURCE/'manure/scripts/artifact-source.py')],cwd=SOURCE,timeout=15)
        require(actual==manifest.read_bytes(),'actual-compiled-source-binding')
        require(json.loads(os.environ['MANURE_TEST_SERVER_COMMAND_JSON'])==[str(ARTIFACT/'libexec/manure-server')],'exact-native-command')
        require('MANURE_POSIX_LIBRARY' not in os.environ,'no-shared-jvm-fallback')
        require(os.environ.get('PONYGIRLS_TEST_PROVISION_SERVICE')=='manure','explicit-owned-service')
        require(Path(os.environ['MANURE_TEST_PROVISION_COMMAND']).is_absolute(),'explicit-paired-helper')
        # The paired helper is mandatory; erase wrapper diagnostic admin inputs
        # before constructing the existing fixture so fallback cannot occur.
        for name in ('MANURE_TEST_ALLOW_CREATEDB','MANURE_TEST_JDBC_URL','MANURE_TEST_JDBC_USER','MANURE_TEST_JDBC_PASSWORD_FILE'):
            os.environ.pop(name,None)
        root=Path(os.environ['PONYGIRLS_OWNED_FIXTURE_ROOT'])
        require(root.name.startswith('ponygirls-owned-pg-') and (root/'.owned-test-only').read_text()=='ponygirls-owned-test-v1\n','owned-provider-marker')
        passed('source-binding')
        # All imports resolve only to the frozen current source; no legacy server
        # or ArtifactStore is imported, and no foreign HTTP health probe occurs.
        from target_server import OwnedDatabase,TargetServer
        from manure.client import ManureClient,ManureError
        wide=base64.urlsafe_b64encode(b''.join(hashlib.sha256(f'manure-wide-audience-audit-1:{i}'.encode()).digest() for i in range(96))).rstrip(b'=').decode()
        require(len(wide.encode())==4096 and digest(wide.encode())=='4d467114dfc517618571a6d8739e3f98afb0ebf0a165065636640ba3670cd498','incompressible-wide-id')
        normal='native-probe-normal-manager';normal_token=token();wide_token=token();wrong_token=token()
        temporary=tempfile.TemporaryDirectory(prefix='manure-native-wide-payload-')
        tmp=temporary.name
        own=Path(tmp);(own/'data').mkdir(mode=0o700)
        for name,value in [('normal',normal_token),('wide',wide_token)]:
            p=own/(name+'.digest');p.write_text(digest(value.encode())+'\n');p.chmod(0o600)
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1',0));port=reservation.getsockname()[1]
        config={'data_dir':str(own/'data'),'api_origin':f'http://127.0.0.1:{port}','listen_address':'127.0.0.1','port':port,'content_mode':'path','content_suffix':'','loopback_dev':True,'dashboard_dir':None,'unlock_shell_dir':None,'embedding':None,'sweep_interval_s':3600,'users':[{'id':normal,'type':'human','tokens':[{'id':'primary','hashFile':str(own/'normal.digest')}]}]}
        database=OwnedDatabase(tmp)
        flags=database.runtime_sql("SELECT rolsuper::int||','||rolcreatedb::int||','||rolcreaterole::int||','||rolbypassrls::int||','||has_database_privilege(current_user,current_database(),'CREATE')::int||','||(current_user=(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()))::int FROM pg_roles WHERE rolname=current_user")
        require(flags=='0,0,0,0,0,0','runtime-role-not-owner-or-privileged')
        passed('owned-least-privilege-runtime')
        def start(cfg):
            s=TargetServer(cfg,tmp,owned_database=database,close_database=False)
            require(s.process.poll() is None and s.bound_port==port,'own-child-ready')
            return s
        def client(s,credential,suffix):return ManureClient(s.api_url,token=credential,cache_dir=str(own/suffix))
        def publish(c,name):
            init=c.init_upload(name,'dir','internal',[])
            ack=c.publish(init['artifact_id']);require(ack['state']=='ready','publication-not-ready');return c.get_artifact(init['artifact_id'])
        def query(c,owner=None,**filters):return c.search('audienceprobe','lexical',created_by_user=owner,**filters)
        def one(c,a,creator,name):
            page=query(c,creator);require(page['total']==1 and len(page['hits'])==1,'exact-creator-result-count')
            hit=page['hits'][0];item=hit['artifact'];info=c.get_artifact(a['artifact_id'])
            require(item['artifact_id']==a['artifact_id'] and item['created_by_user']==creator and info['created_by_user']==creator,'public-raw-creator')
            require(item['visibility']=='internal' and item['state']=='ready','visible-state')
            require(hit['embedding_profile'] is None and hit['embedding_space'] is None and hit['policy_id']=='manure-metadata-paths-v1','lexical-profile-or-policy')
            require(len(hit['source_version'])==64 and bool(hit['generation_id']),'pinned-source-provenance')
            require(len(hit['evidence'])==1,'best-evidence')
            evidence=hit['evidence'][0]
            require(evidence['field']=='name' and evidence['text']==name and evidence['path'] is None and math.isfinite(evidence['score']),'exact-name-provenance')
            return hit
        server=start(config);c=client(server,normal_token,'normal-before')
        require(c.capabilities()['search_modes']==['lexical'],'no-model-capabilities')
        first=publish(c,'audienceprobe normal');passed('normal-publication')
        before=one(c,first,normal,'audienceprobe normal');passed('normal-pinned-query')
        server.close();server=None
        config['users'].append({'id':wide,'type':'human','tokens':[{'id':'primary','hashFile':str(own/'wide.digest')}]})
        server=start(config);w=client(server,wide_token,'wide-after-reopen');c=client(server,normal_token,'normal-after-reopen')
        # First application action after managed readiness/Version health is
        # the NEW manager's query, before any new authoritative write.
        after=one(w,first,normal,'audienceprobe normal');passed('restart-backfill-wide-first-query')
        require(after['source_version']==before['source_version'] and after['generation_id']==before['generation_id'],'backfill-regenerated-head')
        require(after['artifact']==before['artifact'] and after['evidence']==before['evidence'],'backfill-mutated-public-snapshot')
        passed('unchanged-head-and-public-snapshot')
        one(c,first,normal,'audienceprobe normal');passed('normal-query-after-roster-change')
        second=publish(w,'audienceprobe wide');require(second['created_by_user']==wide,'wide-publisher-id-truncated');passed('wide-publication')
        for accessor in (c,w):
            one(accessor,first,normal,'audienceprobe normal');one(accessor,second,wide,'audienceprobe wide')
            require({x['artifact']['artifact_id'] for x in query(accessor)['hits']}=={first['artifact_id'],second['artifact_id']},'both-authorized-manager-results')
        passed('both-managers-exact-creator-filters')
        for bad in (digest(wide.encode()),digest(b'manure-management-search-principal-v1\0'+wide.encode())):
            require(query(w,bad)['hits']==[],'public-creator-filter-was-hashed')
        passed('hash-creator-filters-negative')
        for accessor in (c,w):
            require(query(accessor,visibility='public')['hits']==[] and query(accessor,kind='file')['hits']==[],'visibility-or-kind-filter-boundary')
        rejected=False
        try:query(client(server,wrong_token,'invalid-auth'))
        except ManureError as error:rejected=error.code=='unauthorized' and error.http_status==401
        require(rejected,'invalid-management-credential-accepted')
        passed('authorization-and-visibility-boundaries')
        for a,creator in ((first,normal),(second,wide)):
            actual_hex=database.runtime_sql("SELECT encode(created_by_user,'hex') FROM manure.artifacts WHERE id=convert_to('"+a['artifact_id']+"','UTF8')")
            require(actual_hex==creator.encode().hex(),'authority-creator-bytes-mutated')
        rows=database.runtime_sql("SELECT (SELECT count(*) FROM pony_retrieval_jobs)+(SELECT count(*) FROM pony_retrieval_accepted)+(SELECT count(*) FROM pony_retrieval_generations)+(SELECT count(*) FROM pony_retrieval_chunks)")
        require(rows=='0' and config['embedding'] is None,'unexpected-model-job-or-vector')
        require(database.runtime_sql('SELECT max(octet_length(principal)) FROM pony_retrieval_audience')=='86','private-acl-key-not-bounded')
        passed('no-model-and-authoritative-identities')
    except BaseException as error:
        failure={'type':type(error).__name__,'code':getattr(error,'code',None)}
        # Exception text/config/data are deliberately not printed: the ID and all
        # credentials are synthetic but still never dumped into evidence.
    finally:
        signal.alarm(0)
        if server is not None:
            try:server.close()
            except BaseException:failure=failure or {'type':'OwnedServerCleanupFailed','code':None}
        if database is not None:
            try:database.close()
            except BaseException:failure=failure or {'type':'OwnedDatabaseCleanupFailed','code':None}
        if temporary is not None:
            try:temporary.cleanup()
            except BaseException:failure=failure or {'type':'OwnedTemporaryCleanupFailed','code':None}
    summary={'scope':'additional focused ACTUAL native accepted-wide-manager proof; NOT full335 or global acceptance','source':COMMIT,'elfSha256':ELF_SHA,'compiledInputManifestSha256':MANIFEST_SHA,'wideIdBytes':4096,'wideIdSha256':'4d467114dfc517618571a6d8739e3f98afb0ebf0a165065636640ba3670cd498','expectedChecks':len(EXPECTED),'passedChecks':len(checks),'checks':checks,'failure':failure,'success':failure is None and [c['name'] for c in checks]==EXPECTED,'elapsedSeconds':time.monotonic()-started,'model':'explicitNone; lexical only; zero model jobs/vectors','cleanup':'owned child close and paired owned database drop attempted before terminal result'}
    (report/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps({k:v for k,v in summary.items() if k!='checks'},sort_keys=True))
    return 0 if summary['success'] else 1
if __name__=='__main__':raise SystemExit(main())
