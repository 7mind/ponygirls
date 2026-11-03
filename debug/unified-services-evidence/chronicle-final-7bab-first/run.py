#!/usr/bin/env python3
"""Ignored frozen-input acceptance runner, launched by parent's durable bg_task."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
ROOT=Path('/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-chronicle-full-validation')
REPORT=Path(__file__).resolve().parent
SOURCE='7bab3c1a5d20e518b8f500a32b46628ee98fbfc6'
PACKAGE=Path('/nix/store/mvw89ddwd6pzx00wd6kmsxh5p8p10clq-chronicle-native-development-artifact-0.1.0')
NATIVE=PACKAGE/'libexec/chronicle-server'
ELF='04dd2eaeb172c3f426b209b96901abad2ddf353644493c19c94bf5e69b3cdde1'
CACHE=Path('/nix/store/nbir0l4pyslr5x1b85nafpgyi14zwywi-coursier-cache')
child=None
interrupted=False
results=[]
def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def save(path,value):
    path=Path(path);temp=path.with_name(path.name+'.new');temp.write_text(json.dumps(value,indent=2)+'\n');temp.replace(path)
def state(value,stage):save(REPORT/'status.json',{'state':value,'stage':stage,'observedAt':now(),'source':SOURCE,'elfSha256':ELF,'completedStages':len(results)})
def stop_signal(number,frame):
    global interrupted
    interrupted=True
    if child and child.poll() is None:
        try:os.killpg(child.pid,signal.SIGTERM)
        except ProcessLookupError:pass
signal.signal(signal.SIGTERM,stop_signal);signal.signal(signal.SIGINT,stop_signal)
# Explicit pinned inputs only; no ambient service URLs, tokens, proxy/npm auth,
# test-selection filters or user configuration enters a child process.
keys=('PATH','JAVA_HOME','SBT_LAUNCH_JAR','PG_BIN','POSTGRES_HOME','PLAYWRIGHT_BROWSERS_PATH','FONTCONFIG_FILE')
env={key:os.environ[key] for key in keys if key in os.environ}
for key in keys:
    if not env.get(key):raise RuntimeError('missing pinned '+key)
for name in ('home','cache','node-processes'):(REPORT/name).mkdir()
TMP=Path(tempfile.mkdtemp(prefix='cf7b.',dir='/tmp'))
save(REPORT/'tmp-root.json',{'path':str(TMP),'purpose':'owned short Unix socket paths; preserve on failure'})
env.update(HOME=str(REPORT/'home'),XDG_CACHE_HOME=str(REPORT/'cache'),TMPDIR=str(TMP),
 LANG='C.UTF-8',LC_ALL='C.UTF-8',TZ='UTC',CI='1',PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1',
 VALIDATION_NODE_RECORDS=str(REPORT/'node-processes'),NODE_OPTIONS='--require='+str(REPORT/'node-observer.cjs'))
(REPORT/'user.npmrc').write_text('');(REPORT/'global.npmrc').write_text('')
env.update(NPM_CONFIG_USERCONFIG=str(REPORT/'user.npmrc'),NPM_CONFIG_GLOBALCONFIG=str(REPORT/'global.npmrc'),
 NPM_CONFIG_CACHE=str(REPORT/'npm-cache'),NPM_CONFIG_REGISTRY='https://registry.npmjs.org/',NPM_CONFIG_AUDIT='false',NPM_CONFIG_FUND='false')
assert CACHE.is_dir()
shutil.copytree(CACHE,REPORT/'coursier',symlinks=True)
for path in [REPORT/'coursier',*(REPORT/'coursier').rglob('*')]:
    if not path.is_symlink():path.chmod(path.stat().st_mode | (0o700 if path.is_dir() else 0o600))
repo=REPORT/'offline-repositories';repo.write_text('[repositories]\nmaven-offline: file://'+str(CACHE)+'/https/repo.maven.apache.org/maven2/\n')
env.update(COURSIER_MODE='offline',COURSIER_CACHE=str(REPORT/'coursier'))
env['SBT_JAVA_OPTS']=' '.join(['-Dsbt.offline=true','-Dsbt.server.autostart=false','-Dsbt.supershell=false','-Dsbt.override.build.repos=true','-Dsbt.repository.config='+str(repo),
 '-Dsbt.boot.directory='+str(REPORT/'home/.sbt/boot'),'-Dsbt.global.base='+str(REPORT/'home/.sbt/global'),
 '-Dsbt.ivy.home='+str(REPORT/'home/.ivy2'),'-Dcoursier.cache='+str(REPORT/'coursier'),'-Duser.home='+str(REPORT/'home'),'-XX:ActiveProcessorCount=8','-Xmx4g'])
def provenance():
    assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==SOURCE
    assert not subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=ROOT,text=True).strip()
    assert NATIVE.read_bytes()[:4]==b'\x7fELF' and digest(NATIVE)==ELF
    receipt=PACKAGE/'share/chronicle';source=Path((receipt/'runtime-source').read_text().strip())
    entries={name.removeprefix('./'):h for h,name in [line.split('  ',1) for line in (receipt/'compiled-inputs.sha256').read_text().splitlines()]}
    assert set(entries)=={str(p.relative_to(source)) for p in source.rglob('*') if p.is_file()}
    for name,h in entries.items():assert digest(ROOT/name)==h==digest(source/name),name
    files=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
    relevant={name:digest(ROOT/name) for name in files if name and (name.startswith(('chronicle/','shared/service-runtime/','shared/baboon-runtime/','shared/model-http/','shared/retrieval-core/','shared/retrieval-postgres/','project/')) or name in ('build.sbt','deps.lock.json','lockfile-config.json','scripts/backend-sbt.sh'))}
    save(REPORT/'input-manifest.json',relevant)
    save(REPORT/'provenance.json',{'source':SOURCE,'runtimeSource':str(source),'compiledInputs':len(entries),'allCompiledFilesEquivalent':True,
      'native':str(NATIVE),'elfSha256':ELF,'toolchainReceipt':(receipt/'toolchain').read_text().strip(),
      'environmentKeys':sorted(env),'runnerSha256':digest(__file__),'observerSha256':digest(REPORT/'node-observer.cjs')})
web=json.loads((ROOT/'chronicle/web/package.json').read_text())
def browser_inventory(name):
    found=[]
    for part in web['scripts'][name].split(' && '):
        args=shlex.split(part)
        if args[:2]==['npm','run']:found.extend(browser_inventory(args[2]))
        else:
            entry=[a for a in args if a.startswith('tests-browser/') and a.endswith('.mjs')];assert len(entry)==1
            found.append(str((ROOT/'chronicle/web'/entry[0]).resolve()))
    return found
browser_programs=browser_inventory('test:browser');assert browser_programs and len(set(browser_programs))==len(browser_programs)
planned=['npm-web','npm-collector','npm-tests','web-typecheck','web-node','web-build','collector-typecheck','collector-node','protocol','web-browser','relevance-python','relevance-node','native-recovery','native-workflow','jvm-assembly','jvm-workflow']
save(REPORT/'inventory.json',{'plannedStages':planned,'browserPrograms':browser_programs,
 'webNodeFiles':[str(p.relative_to(ROOT)) for p in sorted((ROOT/'chronicle/web/tests').glob('*.test.ts'))],
 'collectorNodeFiles':[str(p.relative_to(ROOT)) for p in sorted((ROOT/'chronicle/collector/test').glob('*.test.ts'))],
 'relevancePythonFiles':[str(p.relative_to(ROOT)) for p in sorted((ROOT/'chronicle/eval/relevance/tests').glob('test*.py'))],
 'relevanceNodeFiles':[str(p.relative_to(ROOT)) for p in sorted((ROOT/'chronicle/eval/relevance/tests').glob('*.test.mjs'))],
 'nativeFiles':['chronicle/tests/indexing-recovery.test.ts','chronicle/tests/workflow.test.ts'],
 'excludedLiveProviderGate':'CUDA/real-provider semantic trials are not authorized or run'})
def tap_counts(log):
    text=log.read_text();values={}
    for key in ('tests','pass','fail','cancelled','skipped','todo'):
        matches=re.findall(r'^(?:#|ℹ) '+key+r' (\d+)\s*$',text,re.M);assert matches,'missing Node count '+key
        values[key]=int(matches[-1])
    assert values['tests']>0,values
    return values
# Cleanup observes ONLY owned paths below this run's TMPDIR and this exact pinned
# PostgreSQL ELF. No daemon discovery or stop is performed outside that boundary.
def cleanup(directory,session):
    observed=[]
    for pidfile in TMP.rglob('postmaster.pid'):
        try:
            pid=int(pidfile.read_text().splitlines()[0]);proc=Path('/proc')/str(pid)
            args=(proc/'cmdline').read_bytes().split(b'\0');exe=(proc/'exe').resolve()
            expected=(Path(env['PG_BIN'])/'.postgres-wrapped').resolve()
            data=pidfile.parent.resolve();assert data.is_relative_to(TMP.resolve())
            if exe!=expected or b'-D' not in args:continue
            if Path(os.fsdecode(args[args.index(b'-D')+1])).resolve()!=data:continue
            if proc.stat().st_uid!=os.getuid():continue
            start=(proc/'stat').read_text().split(') ',1)[1].split()[19]
            call=subprocess.run([str(Path(env['PG_BIN'])/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'],env=env,capture_output=True,text=True,timeout=60)
            observed.append({'pid':pid,'data':str(data),'startTicks':start,'stopStatus':call.returncode})
            assert call.returncode==0
        except FileNotFoundError:continue
    # An exited leader can leave children in its session (model/browser/CLI).
    members=[]
    for proc in Path('/proc').glob('[0-9]*'):
        try:
            fields=(proc/'stat').read_text().split(') ',1)[1].split()
            if int(fields[3])==session and proc.stat().st_uid==os.getuid():members.append(int(proc.name))
        except (FileNotFoundError,ProcessLookupError):pass
    if members:
        for pid in members:
            try:os.kill(pid,signal.SIGTERM)
            except ProcessLookupError:pass
        until=time.monotonic()+45
        while time.monotonic()<until and any(Path('/proc',str(pid)).exists() for pid in members):time.sleep(.1)
        survivors=[pid for pid in members if Path('/proc',str(pid)).exists()]
        for pid in survivors:
            try:os.kill(pid,signal.SIGKILL)
            except ProcessLookupError:pass
        save(directory/'session-cleanup.json',{'observed':members,'forcedKill':survivors})
    save(directory/'postgres-cleanup.json',{'observedOwnedOrphans':observed})
    return not observed and not members

def phase(name,command,cwd,budget,kind=None,extra=None):
    global child
    if interrupted:return False
    directory=REPORT/name;directory.mkdir();state('running',name)
    runenv=dict(env,VALIDATION_STAGE=name);runenv.update(extra or {})
    record={'stage':name,'command':command,'cwd':str(cwd),'startedAt':now(),'finishedAt':None,'commandExitStatus':None,'status':'running'}
    save(directory/'result.json',record);session=None
    try:
        with (directory/'run.log').open('wb') as output:
            child=subprocess.Popen(command,cwd=cwd,env=runenv,stdout=output,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,start_new_session=True);session=child.pid
            try:code=child.wait(timeout=budget)
            except subprocess.TimeoutExpired:
                record['status']='timed-out';os.killpg(child.pid,signal.SIGTERM)
                try:child.wait(timeout=90)
                except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait();record['forcedKill']=True
                code=child.returncode
        record['commandExitStatus']=code
        if kind=='tap':
            try:record['counts']=tap_counts(directory/'run.log')
            except Exception as error:record['countError']=str(error)
        if kind=='browser':
            nodes=[json.loads(p.read_text()) for p in (REPORT/'node-processes').glob('*.json')]
            selected=[r for r in nodes if r['stage']==name and r['program'] in browser_programs]
            save(directory/'process-inventory.json',selected)
            record['missingPrograms']=sorted(set(browser_programs)-{r['program'] for r in selected})
        if interrupted:record['status']='interrupted'
        elif record['status']=='timed-out':pass
        elif code!=0:record['status']='failed'
        else:
            if kind=='tap':
                counts=record['counts']
                assert counts['pass']==counts['tests'] and all(counts[k]==0 for k in ('fail','cancelled','skipped','todo')),counts
            elif kind=='python':
                text=(directory/'run.log').read_text();match=re.search(r'Ran (\d+) tests? in ',text);assert match and int(match[1])>0
                assert re.search(r'^OK\s*$',text,re.M) and not re.search(r'^OK \(',text,re.M)
                record['counts']={'tests':int(match[1]),'failures':0,'errors':0,'skipped':0}
            elif kind=='browser':
                nodes=[json.loads(p.read_text()) for p in (REPORT/'node-processes').glob('*.json')]
                selected=[r for r in nodes if r['stage']==name and r['program'] in browser_programs]
                assert {r['program'] for r in selected}==set(browser_programs)
                assert all(r['finishedAt'] and r['exitStatus']==0 for r in selected)
                signals=re.findall(r'^PASS .+$',(directory/'run.log').read_text(),re.M);assert signals
                record['counts']={'completedPrograms':len(browser_programs),'programExecutions':len(selected),'reportedPassSignals':len(signals),'failedPrograms':0,'skippedPrograms':0}
                save(directory/'process-inventory.json',selected)
            elif kind=='protocol':
                text=(directory/'run.log').read_text();match=re.search(r'(\d+) generated TypeScript fixture groups passed; 1 API version',text);assert match and int(match[1])>0
                reports=list((ROOT/'chronicle/target/test-reports').glob('*.xml'));roots=[ET.parse(p).getroot() for p in reports]
                assert {r.get('name') for r in roots}=={'chronicle.CodecFixtureTest','chronicle.ApiVersionCompatibilityTest','chronicle.ProtocolEvolutionTest'}
                counts={k:sum(int(r.get(k,'0')) for r in roots) for k in ('tests','failures','errors','skipped')}
                assert counts['tests']>0 and counts['failures']==counts['errors']==counts['skipped']==0
                record['counts']=dict(counts,typescriptFixtureGroups=int(match[1]),scalaSuites=len(roots))
            record['status']='passed'
    except Exception as error:record.update(status='validation-failed',validationError=type(error).__name__+': '+str(error))
    finally:
        child=None
        try:
            if session and not cleanup(directory,session):record['cleanupRescueRequired']=True;record['status']='cleanup-failed'
        except Exception as error:record.update(status='cleanup-failed',cleanupError=type(error).__name__+': '+str(error))
        record['finishedAt']=now();save(directory/'result.json',record);results.append(record);save(REPORT/'results.json',results)
    return record['status']=='passed'

def main():
    provenance();state('running','setup')
    ready=all([phase('npm-'+name,['npm','ci'],ROOT/'chronicle'/name,900) for name in ('web','collector','tests')])
    if ready:
        phase('web-typecheck',['npm','run','typecheck'],ROOT/'chronicle/web',300)
        phase('web-node',['npm','test'],ROOT/'chronicle/web',600,'tap')
        phase('web-build',['npm','run','build'],ROOT/'chronicle/web',300)
        phase('collector-typecheck',['npm','run','typecheck'],ROOT/'chronicle/collector',300)
        phase('collector-node',['npm','test'],ROOT/'chronicle/collector',600,'tap')
        prior=ROOT/'chronicle/target/test-reports'
        if prior.exists():prior.rename(REPORT/'preserved-full-backend-test-reports')
        phase('protocol',['bash','scripts/test-codecs.sh'],ROOT/'chronicle',900,'protocol',{'TSC':str(ROOT/'chronicle/web/node_modules/.bin/tsc')})
        if (ROOT/'chronicle/target/test-reports').exists():(ROOT/'chronicle/target/test-reports').rename(REPORT/'protocol-scala-test-reports')
        phase('web-browser',['npm','run','test:browser'],ROOT/'chronicle/web',3600,'browser')
        phase('relevance-python',['python3','-m','unittest','discover','-s','chronicle/eval/relevance/tests','-v'],ROOT,900,'python')
        phase('relevance-node',['bash','-c','node --test chronicle/eval/relevance/tests/*.test.mjs'],ROOT,600,'tap')
        native_env={'CHRONICLE_SERVER_COMMAND':json.dumps([str(NATIVE)])}
        phase('native-recovery',['node','--import','tsx','--test','indexing-recovery.test.ts'],ROOT/'chronicle/tests',900,'tap',native_env)
        phase('native-workflow',['npm','test'],ROOT/'chronicle/tests',900,'tap',native_env)
        assembled=phase('jvm-assembly',['bash','scripts/backend-sbt.sh','chronicleServer/assembly'],ROOT,900)
        if assembled:
            java=str(Path(env['JAVA_HOME'])/'bin/java');jar=ROOT/'chronicle/target/chronicle-server.jar'
            phase('jvm-workflow',['npm','test'],ROOT/'chronicle/tests',900,'tap',{'CHRONICLE_SERVER_COMMAND':json.dumps([java,'-XX:ActiveProcessorCount=8','-Xmx2g','-jar',str(jar)])})
    manifest=json.loads((REPORT/'input-manifest.json').read_text());assert all(digest(ROOT/path)==h for path,h in manifest.items())
    assert digest(NATIVE)==ELF
    complete={r['stage'] for r in results}==set(planned)
    passed=not interrupted and complete and all(r['status']=='passed' for r in results)
    save(REPORT/'summary.json',{'source':SOURCE,'elfSha256':ELF,'status':'passed' if passed else 'interrupted' if interrupted else 'failed',
      'startedStageInventoryComplete':complete,'unstartedStages':sorted(set(planned)-{r['stage'] for r in results}),'startedStages':len(results),'passedStages':sum(r['status']=='passed' for r in results),
      'failedStages':[r['stage'] for r in results if r['status']!='passed'],'finishedAt':now(),
      'fullBackend':'not rerun: parent separately verified frozen7bab960/112 zero failures/errors/skips','results':results})
    if passed:shutil.rmtree(TMP)
    state('passed' if passed else 'interrupted' if interrupted else 'failed','finished')
    return 0 if passed else 1
try:sys.exit(main())
except Exception as error:
    save(REPORT/'orchestrator-failure.json',{'type':type(error).__name__,'message':str(error),'observedAt':now()})
    state('failed','orchestrator');raise
