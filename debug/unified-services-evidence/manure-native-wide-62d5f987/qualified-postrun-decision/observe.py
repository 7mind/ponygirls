#!/usr/bin/env python3
"""READ ONLY conditional post-run observation. Never signals/deletes/chmods.
No before-root PID baseline exists. Current REALTIME-BOOTTIME offset can qualify
apparently older processes only conditionally: unmonitored historical clock
steps, and later access by a pre-existing protected process, remain unproved.
"""
import ast,hashlib,json,os,pathlib,re,stat,subprocess,time
BASE=pathlib.Path('/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-manure-port/debug/manure-native-wide-probe/result-short')
SOURCE=pathlib.Path('/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-manure-native-62')
PROBE=pathlib.Path('/nix/store/rpgyw9j2diprbjbchpsp1qs2zwqdba6d-probe.py')

def need(value,reason):
    if not value:raise RuntimeError(reason)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def offset():
    a=time.clock_gettime_ns(time.CLOCK_REALTIME);b=time.clock_gettime_ns(time.CLOCK_BOOTTIME);c=time.clock_gettime_ns(time.CLOCK_REALTIME)
    need(c>=a and c-a<100000000,'current-clock-sample-unstable')
    return {'realtimeBeforeNs':a,'boottimeNs':b,'realtimeAfterNs':c,'offsetLowerNs':a-b,'offsetUpperNs':c-b}
def identity(p):
    s=p.stat();v=(p/'stat').read_text().rsplit(')',1)[1].split()
    return {'pid':int(p.name),'uid':s.st_uid,'startTicks':int(v[19]),'state':v[0],'procInode':s.st_ino}
def exited(p):
    try:return identity(p)['state'] in ('Z','X')
    except (FileNotFoundError,ProcessLookupError):return True

def observe():
    result={'scope':'READONLY POSTRUN; original body12PASS/provider0/runner1/cleanupfalse remain unchanged','observedRealtimeNs':time.time_ns(),'uid':os.getuid(),'bootId':pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'hz':os.sysconf('SC_CLK_TCK'),'automaticDeletionAuthorized':False,'signalsSent':0,'deletionPerformed':False,'historicalBaselineAvailable':False}
    original=json.loads((BASE/'short-root.json').read_text());root=pathlib.Path(original['path']);s=root.lstat();marker=root/'.owned-manure-native-wide'
    need(root.parent==pathlib.Path('/tmp') and root.name.startswith('mnw-') and root.resolve()==root,'root-path')
    need(stat.S_ISDIR(s.st_mode) and stat.S_IMODE(s.st_mode)==0o700 and (s.st_uid,s.st_dev,s.st_ino)==(original['uid'],original['device'],original['inode']) and s.st_uid==os.getuid()==os.geteuid(),'root-identity-mode-uid')
    m=marker.lstat();need(stat.S_ISREG(m.st_mode) and m.st_uid==os.getuid() and m.st_nlink==1 and stat.S_IMODE(m.st_mode)==0o600 and sha(marker)==original['markerSha256'],'root-marker')
    marker_value=json.loads(marker.read_text());need(marker_value['uid']==os.getuid() and marker_value['scope']=='manure-native-wide-short-root-v1' and marker_value['report']==str(BASE),'marker-scope')
    need(re.fullmatch('[0-9a-f]{32}',marker_value['nonce']) is not None,'marker-nonce')
    summary=json.loads((BASE/'summary.json').read_text());cleanup=json.loads((BASE/'short-root-cleanup.json').read_text())
    expected=next(ast.literal_eval(n.value) for n in ast.parse(PROBE.read_text()).body if isinstance(n,ast.Assign) and any(isinstance(x,ast.Name) and x.id=='EXPECTED' for x in n.targets))
    need(summary['success'] and summary['failure'] is None and summary['expectedChecks']==summary['passedChecks']==len(expected)==12 and [x['name'] for x in summary['checks']]==expected and all(x['status']=='passed' for x in summary['checks']),'actual-body12')
    need((BASE/'owned-provider-exit-status').read_text().strip()=='0' and (BASE/'runner-exit-status').read_text().strip()=='1' and (BASE/'command-exit-status').read_text().strip()=='1' and cleanup['success'] is False and cleanup['reason']=='owned-proc-inspection-denied','preserve-original-statuses')
    need((BASE/'source-before.sha256').read_bytes()==(BASE/'source-after.sha256').read_bytes(),'source-before-after')
    for file,cwd in [('source-before.sha256',SOURCE),('inputs.sha256',None)]:subprocess.run(['sha256sum','-c',str(BASE/file)],cwd=cwd,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=60)
    need(summary['source']=='62d5f9877d9df9ae2d059c5cec5facff09b182b5' and summary['compiledInputManifestSha256']=='1ed47d780d8a78f14eaad4e75c3e57c841604bb04180a8aaecdaec4c58feb3a1' and summary['elfSha256']=='9318c06043c06b95e7cc4ceafbc6c9b3f22bd685dd43bb01896497d175f7a835','exact-bindings')
    birth=subprocess.check_output(['stat','--printf=%W\n%w\n',str(root)],text=True,timeout=10).splitlines()
    need(len(birth)==2 and birth[0].isdecimal() and int(birth[0])>0,'statx-birth-unavailable')
    fraction=re.search(r'\.([0-9]{9}) [+-][0-9]{4}$',birth[1]);need(fraction is not None,'birth-ns-unavailable')
    birth_ns=int(birth[0])*1000000000+int(fraction.group(1));first=offset()
    result.update(root={'path':str(root),'uid':s.st_uid,'device':s.st_dev,'inode':s.st_ino,'mode':'0700','markerSha256':original['markerSha256'],'birthRealtimeNs':birth_ns,'birthStatx':birth[1]},actualBody={'passed':12,'elapsedSeconds':summary['elapsedSeconds'],'providerExit':0,'originalRunnerExit':1,'originalCleanupSuccess':False,'sourceBeforeAfterAndCurrentInputsVerified':True,'summarySha256':sha(BASE/'summary.json'),'originalCleanupSha256':sha(BASE/'short-root-cleanup.json')},clockBefore=first)
    # No alternate interfaces, /proc/environ, privilege changes or protected
    # cmdline peeks. Raw readable cmdline/cwd bytes are never emitted.
    readable=[];protected=[];matches=[];terminal=[];errors=[];pidfiles=[];seen=0
    for folder,dirs,files in os.walk(root,followlinks=False):
        seen+=len(dirs)+len(files);need(seen<=50000,'root-inventory-bound')
        for name in files:
            if name=='postmaster.pid' or name.endswith('.pid'):
                p=pathlib.Path(folder)/name;v=p.lstat();need(stat.S_ISREG(v.st_mode) and v.st_uid==os.getuid(),'pidfile-identity')
                with p.open('rb') as stream:pid=int(stream.readline(64).strip())
                need(pid>0,'invalid-pidfile');pidfiles.append({'relativePath':str(p.relative_to(root)),'pid':pid})
    for p in pathlib.Path('/proc').iterdir():
        if not p.name.isdecimal():continue
        try:
            before=identity(p)
            if before['uid']!=os.getuid():continue
            if before['state'] in ('Z','X'):terminal.append(before);continue
            denied=[];command=None;cwd=None
            try:
                with (p/'cmdline').open('rb') as stream:command=stream.read(2097153)
                need(len(command)<=2097152,'cmdline-bound')
            except PermissionError:denied.append('cmdline')
            try:cwd=os.readlink(p/'cwd')
            except PermissionError:denied.append('cwd')
            after=identity(p)
            if after['state'] in ('Z','X'):terminal.append(after);continue
            need(all(before[k]==after[k] for k in ('pid','uid','startTicks','procInode')),'pid-identity-changed')
            own_anchor=command is not None and os.fsencode(root) in command
            path=cwd.removesuffix(' (deleted)') if cwd is not None else None
            own_anchor=own_anchor or (path is not None and (path==str(root) or path.startswith(str(root)+'/')))
            row={k:before[k] for k in ('pid','uid','startTicks','procInode')}
            if own_anchor:matches.append(row)
            if denied:row['deniedFields']=denied;protected.append(row)
            else:readable.append(row)
        except (FileNotFoundError,ProcessLookupError):
            if exited(p):continue
            errors.append({'pid':int(p.name),'reason':'unresolved-own-pid-exit-race'})
        except BaseException as error:errors.append({'pid':int(p.name),'reason':type(error).__name__})
    last=offset();need(result['bootId']==pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'boot-changed')
    drift=max(first['offsetUpperNs'],last['offsetUpperNs'])-min(first['offsetLowerNs'],last['offsetLowerNs']);need(drift<=2000000,'current-offset-drift-over2ms')
    lower_birth_boot=birth_ns-max(first['offsetUpperNs'],last['offsetUpperNs'])
    for row in protected:
        upper=((row['startTicks']+1)*1000000000+result['hz']-1)//result['hz']
        margin=lower_birth_boot-upper
        row.update(startBoottimeUpperNs=upper,rootBirthBoottimeLowerNs=lower_birth_boot,apparentPreRootMarginNs=margin,classification='clock-qualified-apparent-pre-root' if margin>2000000000 else 'UNRESOLVED-new-or-uncertain',notHistoricalBaseline=True)
    pid_status=[]
    for row in pidfiles:
        p=pathlib.Path('/proc')/str(row['pid'])
        try:row['currentIdentity']=identity(p);row['terminal']=row['currentIdentity']['state'] in ('Z','X')
        except (FileNotFoundError,ProcessLookupError):row['terminal']=True
        pid_status.append(row)
    eligible=not matches and not errors and all(p['classification']=='clock-qualified-apparent-pre-root' for p in protected) and all(p['terminal'] for p in pid_status)
    result.update(clockAfter=last,currentOffsetWindowDriftNs=drift,readableSameUidProcesses=readable,protectedSameUidProcesses=protected,observedTerminatedCount=len(terminal),exactRootReadableMatches=matches,inspectionErrors=errors,pidfiles=pid_status,missingPidfileIsNotProof=True,conditionallyEligibleForParentReview=eligible,unconditionalProcessAbsenceProven=eligible and not protected,limitations=['NO before-root immutable PID baseline exists; no baseline is invented.','CLOCK_REALTIME filesystem birth mapped with CURRENT CLOCK_REALTIME-CLOCK_BOOTTIME bounds only. Unmonitored historical wallclock steps between root birth and this observation can invalidate historical temporal ordering.','Each denied PID margin states how large a historical offset shift would be needed to overturn its apparent pre-root ordering. It does NOT prove no such shift happened.','Protected pre-existing processes could change cwd/access a later root; denied cmdline/cwd cannot prove absence of such later access.','New/uncertain denied PID, live pidfile PID, readable root match, unresolved inspection error => fail closed. No protected PID is blanket ignored/allowlisted.','Future runs need before-root PID identities and tracked children/subreaper, not whole-UID blind scan.'])
    return result
if __name__=='__main__':print(json.dumps(observe(),indent=2))
