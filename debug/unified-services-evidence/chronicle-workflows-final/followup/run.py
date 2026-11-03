#!/usr/bin/env python3
"""Only the two failed workflows; preserve and bind all fourteen reusable gates."""
import ast
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
ROOT=Path('/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-chronicle-workflow-fixture')
OLDROOT=Path('/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-chronicle-full-validation')
OLD=OLDROOT/'debug/chronicle-final-7bab-20261103T1004.acvxdD'
REPORT=Path(__file__).resolve().parent
SOURCE='7bab3c1a5d20e518b8f500a32b46628ee98fbfc6'
ELF='04dd2eaeb172c3f426b209b96901abad2ddf353644493c19c94bf5e69b3cdde1'
JARHASH='bd611b6631065e4c2538c9429e6b29248415cb29b01fbb7d934457f0449c4fd4'
NATIVE=Path('/nix/store/mvw89ddwd6pzx00wd6kmsxh5p8p10clq-chronicle-native-development-artifact-0.1.0/libexec/chronicle-server')
PACKAGE=NATIVE.parent.parent
child=None;interrupted=False;results=[]
# Reuse exactly the reviewed, exercised timeout/status/TAP/owned-cleanup functions;
# no original runner module initialization or original evidence write is executed.
text=(OLD/'run.py').read_text();assert hashlib.sha256(text.encode()).hexdigest()=='ce97daf9860c92328a683c1367bd2a2b8bdf3b691f12263e34eb8ca19e392340'
names={'now','digest','save','state','stop_signal','tap_counts','cleanup','phase'}
nodes=[x for x in ast.parse(text).body if isinstance(x,ast.FunctionDef) and x.name in names]
assert {x.name for x in nodes}==names
exec(compile(ast.Module(body=nodes,type_ignores=[]),str(OLD/'run.py'),'exec'),globals())
keys=('PATH','JAVA_HOME','PG_BIN','POSTGRES_HOME','PLAYWRIGHT_BROWSERS_PATH','FONTCONFIG_FILE')
env={key:os.environ[key] for key in keys}
for name in ('home','cache','node-processes'):(REPORT/name).mkdir()
TMP=Path(tempfile.mkdtemp(prefix='cf7fix.',dir='/tmp'))
save(REPORT/'tmp-root.json',{'path':str(TMP),'purpose':'owned short fixture Unix socket paths; preserve failures'})
shutil.copy2(OLD/'node-observer.cjs',REPORT/'node-observer.cjs')
for name in ('user.npmrc','global.npmrc'):(REPORT/name).write_text('')
env.update(HOME=str(REPORT/'home'),XDG_CACHE_HOME=str(REPORT/'cache'),TMPDIR=str(TMP),LANG='C.UTF-8',LC_ALL='C.UTF-8',TZ='UTC',CI='1',
 VALIDATION_NODE_RECORDS=str(REPORT/'node-processes'),NODE_OPTIONS='--require='+str(REPORT/'node-observer.cjs'),PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1',
 NPM_CONFIG_USERCONFIG=str(REPORT/'user.npmrc'),NPM_CONFIG_GLOBALCONFIG=str(REPORT/'global.npmrc'),NPM_CONFIG_CACHE=str(REPORT/'npm-cache'),NPM_CONFIG_REGISTRY='https://registry.npmjs.org/',NPM_CONFIG_AUDIT='false',NPM_CONFIG_FUND='false')
signal.signal(signal.SIGTERM,stop_signal);signal.signal(signal.SIGINT,stop_signal)

def tree_manifest(root):
    return {str(p.relative_to(root)):('symlink:'+os.readlink(p) if p.is_symlink() else digest(p)) for p in root.rglob('*') if p.is_file() or p.is_symlink()}
def main():
    state('running','input-verification')
    assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==SOURCE
    file='chronicle/tests/workflow.test.ts'
    before=subprocess.check_output(['git','show',SOURCE+':'+file],cwd=ROOT)
    old=b"annotation: { ...endpointConfig, endpoint: model.endpoint + '/chat/completions' },"
    new=b"annotation: { ...endpointConfig, endpoint: model.endpoint + '/chat/completions', requestPolicy: 'strict-json-schema' },"
    assert before.count(old)==1 and (ROOT/file).read_bytes()==before.replace(old,new)
    assert subprocess.check_output(['git','diff','--name-only'],cwd=ROOT,text=True).splitlines()==[file]
    diff=subprocess.check_output(['git','diff','--',file],cwd=ROOT);(REPORT/'fixture.patch').write_bytes(diff)
    manifest=json.loads((OLD/'input-manifest.json').read_text())
    assert all(digest(ROOT/path)==h for path,h in manifest.items() if path!=file)
    manifest[file]=digest(ROOT/file);save(REPORT/'input-manifest.json',manifest)
    receipt=PACKAGE/'share/chronicle';source=Path((receipt/'runtime-source').read_text().strip())
    entries={name.removeprefix('./'):h for h,name in [line.split('  ',1) for line in (receipt/'compiled-inputs.sha256').read_text().splitlines()]}
    assert len(entries)==231 and file not in entries
    assert set(entries)=={str(p.relative_to(source)) for p in source.rglob('*') if p.is_file()}
    assert all(digest(ROOT/name)==h==digest(source/name) for name,h in entries.items())
    assert NATIVE.read_bytes()[:4]==b'\x7fELF' and digest(NATIVE)==ELF
    (REPORT/'inputs').mkdir();jar=REPORT/'inputs/chronicle-server.jar'
    assert digest(OLDROOT/'chronicle/target/chronicle-server.jar')==JARHASH
    shutil.copy2(OLDROOT/'chronicle/target/chronicle-server.jar',jar);assert digest(jar)==JARHASH
    reuse=[]
    for name in ('web/node_modules','collector/node_modules','tests/node_modules','web/dist','collector/dist'):
        src=OLDROOT/'chronicle'/name;dest=ROOT/'chronicle'/name
        assert src.is_dir() and not dest.exists()
        expected=tree_manifest(src);shutil.copytree(src,dest,symlinks=True);assert tree_manifest(dest)==expected
        reuse.append({'path':'chronicle/'+name,'filesAndSymlinks':len(expected),'manifestSha256':hashlib.sha256(json.dumps(expected,sort_keys=True).encode()).hexdigest()})
    original=json.loads((OLD/'results.json').read_text());passed=[r for r in original if r['status']=='passed']
    assert len(original)==16 and len(passed)==14
    assert {r['stage'] for r in original if r['status']!='passed'}=={'native-workflow','jvm-workflow'}
    save(REPORT/'reused-gates.json',{'source':SOURCE,'originalEvidence':str(OLD),'originalSummarySha256':digest(OLD/'summary.json'),
     'reusedStages':[{'stage':r['stage'],'resultSha256':digest(OLD/r['stage']/'result.json'),'counts':r.get('counts'),'commandExitStatus':r['commandExitStatus']} for r in passed],
     'reusedDependencyAndBuildTrees':reuse,'reason':'only one test fixture JSON required field changed; all remaining tracked inputs byte-identical'})
    save(REPORT/'provenance.json',{'baseSource':SOURCE,'fixturePath':file,'fixtureBeforeSha256':hashlib.sha256(before).hexdigest(),'fixtureAfterSha256':digest(ROOT/file),
      'fixturePatchSha256':hashlib.sha256(diff).hexdigest(),'compiledInputs':231,'allCompiledFilesEquivalent':True,'runtimeSource':str(source),
      'native':str(NATIVE),'elfSha256':ELF,'jar':str(jar),'jarSha256':JARHASH,'originalJar':str(OLDROOT/'chronicle/target/chronicle-server.jar'),
      'environmentKeys':sorted(env),'runnerSha256':digest(__file__),'observerSha256':digest(REPORT/'node-observer.cjs')})
    save(REPORT/'inventory.json',{'expectedStages':['native-workflow','jvm-workflow'],'testsPerStage':1,'testSource':file,'testSourceSha256':digest(ROOT/file),
      'coverage':'unchanged complete collector/archive/HTTPS annotation/vector/WS/MCP/live ACLs/restart/live-dashboard workflow; no broader native admission matrix claim'})
    phase('native-workflow',['npm','test'],ROOT/'chronicle/tests',900,'tap',{'CHRONICLE_SERVER_COMMAND':json.dumps([str(NATIVE)])})
    phase('jvm-workflow',['npm','test'],ROOT/'chronicle/tests',900,'tap',{'CHRONICLE_SERVER_COMMAND':json.dumps([str(Path(env['JAVA_HOME'])/'bin/java'),'-XX:ActiveProcessorCount=8','-Xmx2g','-jar',str(jar)])})
    assert all(digest(ROOT/path)==h for path,h in manifest.items())
    assert subprocess.check_output(['git','diff','--',file],cwd=ROOT)==diff
    assert digest(NATIVE)==ELF and digest(jar)==JARHASH and digest(OLDROOT/'chronicle/target/chronicle-server.jar')==JARHASH
    ok=not interrupted and len(results)==2 and all(r['status']=='passed' for r in results)
    save(REPORT/'summary.json',{'status':'passed' if ok else 'interrupted' if interrupted else 'failed','baseSource':SOURCE,'fixtureSha256':digest(ROOT/file),
      'elfSha256':ELF,'jarSha256':JARHASH,'passedStages':sum(r['status']=='passed' for r in results),'expectedStages':2,'reusedPassedStages':14,
      'inputsUnchangedAfter':True,'finishedAt':now(),'results':results})
    if ok:shutil.rmtree(TMP)
    state('passed' if ok else 'interrupted' if interrupted else 'failed','finished');return 0 if ok else 1
try:sys.exit(main())
except Exception as error:
    save(REPORT/'orchestrator-failure.json',{'type':type(error).__name__,'message':str(error),'observedAt':now()});state('failed','orchestrator');raise
