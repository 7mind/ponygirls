#!/usr/bin/env python3
"""Orchestration only. No change to immutable native probe's12 checks/180s body.
No cleanup signals: after provider wrapper returns, inspect owned process state;
retain the marked root and fail closed if safe deletion cannot be established.
"""
import errno,hashlib,json,os,pathlib,secrets,shutil,stat,subprocess,sys,tempfile

class CleanupRefused(RuntimeError):pass

def clean_short(root,identity,marker_bytes):
    result={'success':False,'signalsSent':0,'missingPidfilesProveAbsence':False,'sameUidProcessInspectionComplete':False,'pidfileCount':0,'anchoredLiveProcessCount':0}
    try:
        s=root.lstat()
        if (root.parent!=pathlib.Path('/tmp') or not root.name.startswith('mnw-') or root.resolve()!=root or not stat.S_ISDIR(s.st_mode) or (s.st_dev,s.st_ino,s.st_uid)!=identity or s.st_uid!=os.getuid() or stat.S_IMODE(s.st_mode)!=0o700):raise CleanupRefused('short-root-identity-mode-or-uid')
        marker=root/'.owned-manure-native-wide'
        m=marker.lstat()
        if not stat.S_ISREG(m.st_mode) or m.st_uid!=os.getuid() or stat.S_IMODE(m.st_mode)!=0o600 or m.st_nlink!=1 or marker.read_bytes()!=marker_bytes:raise CleanupRefused('short-root-marker')
        # PID files are additional evidence only. Missing PID files, including
        # provider TemporaryDirectory deletion, NEVER establish process absence.
        pidfiles=[];entries=0
        for folder,dirs,files in os.walk(root,followlinks=False):
            entries+=len(dirs)+len(files)
            if entries>50000:raise CleanupRefused('owned-file-inventory-bound')
            for name in files:
                if name=='postmaster.pid' or name.endswith('.pid'):
                    p=pathlib.Path(folder)/name;info=p.lstat()
                    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid():raise CleanupRefused('unsafe-owned-pidfile')
                    with p.open('rb') as stream:first=stream.readline(64)
                    try:pid=int(first.strip())
                    except ValueError:raise CleanupRefused('malformed-owned-pidfile')
                    if pid<=0:raise CleanupRefused('invalid-owned-pidfile')
                    pidfiles.append(pid)
        result['pidfileCount']=len(pidfiles)
        # Read-only /proc scan covers every currently same-UID process, even if
        # all PID files are absent. No liveness guesses and no kill(pid,0).
        owned={};anchored=[]
        for process in pathlib.Path('/proc').iterdir():
            if not process.name.isdecimal():continue
            try:
                before=process.stat()
                if before.st_uid!=os.getuid():continue
                info=(process/'stat').read_text();state=info.rsplit(')',1)[1].split()[0]
                if state in ('Z','X'):continue # observed terminated/zombie, no live ownership
                with (process/'cmdline').open('rb') as stream:command=stream.read(2097153)
                if len(command)>2097152:raise CleanupRefused('owned-proc-command-bound')
                cwd=os.readlink(process/'cwd')
                after=process.stat()
                later=(process/'stat').read_text()
                if (before.st_uid,before.st_ino)!=(after.st_uid,after.st_ino) or info.rsplit(')',1)[1].split()[19]!=later.rsplit(')',1)[1].split()[19]:raise CleanupRefused('owned-pid-identity-race')
                pid=int(process.name);owned[pid]=True
                anchor=os.fsencode(root)
                path=cwd.removesuffix(' (deleted)')
                if anchor in command or path==str(root) or path.startswith(str(root)+'/'):anchored.append(pid)
            except (FileNotFoundError,ProcessLookupError):
                # Disappeared /proc entry or observed terminal state is an exit
                # race. A still-live owned PID with unreadable cwd is NOT proof.
                try:
                    if not process.exists():continue
                    if process.stat().st_uid==os.getuid() and (process/'stat').read_text().rsplit(')',1)[1].split()[0] in ('Z','X'):continue
                except (FileNotFoundError,ProcessLookupError):continue
                raise CleanupRefused('owned-proc-incomplete-exit-race')
            except PermissionError:raise CleanupRefused('owned-proc-inspection-denied')
        result['sameUidProcessInspectionComplete']=True
        result['sameUidLiveProcessesInspected']=len(owned)
        result['anchoredLiveProcessCount']=len(anchored)
        if anchored:raise CleanupRefused('short-root-live-processes')
        for pid in pidfiles:
            p=pathlib.Path('/proc')/str(pid)
            try:
                if not p.exists():continue
                if p.stat().st_uid!=os.getuid():raise CleanupRefused('pidfile-pid-reused-or-foreign')
                if (p/'stat').read_text().rsplit(')',1)[1].split()[0] not in ('Z','X'):raise CleanupRefused('live-pidfile-pid-unbound-or-reused')
            except (FileNotFoundError,ProcessLookupError):continue
        # Recheck ownership, inode, mode and marker immediately before deletion.
        s=root.lstat()
        if (s.st_dev,s.st_ino,s.st_uid)!=identity or stat.S_IMODE(s.st_mode)!=0o700 or marker.read_bytes()!=marker_bytes:raise CleanupRefused('short-root-final-identity')
        shutil.rmtree(root);result['success']=True
    except BaseException as error:
        result['failureType']=type(error).__name__
        result['reason']=str(error) if isinstance(error,CleanupRefused) else 'owned-cleanup-inspection-error'
        result['rootRetained']=True
    return result

def main():
    report,probe,frozen=map(pathlib.Path,sys.argv[1:])
    assert os.getuid()==os.geteuid()
    os.umask(0o077)
    value=json.loads((frozen/'provider-env.json').read_text())
    assert set(value)=={'PG_BIN','PG_CONFIGURATION','PG_HBA','PG_POLICY','PG_PROVIDER'}
    assert all(isinstance(v,str) and v.startswith('/') and '\0' not in v and '\n' not in v for v in value.values())
    assert value['PG_PROVIDER']==str(frozen/'provider.py')
    env={k:os.environ[k] for k in ('PATH','JAVA_HOME','POSTGRES_HOME') if k in os.environ};env.update(value)
    source=pathlib.Path('/home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-manure-native-62')
    home=report/'runtime-home';home.mkdir(mode=0o700)
    # Always a NEW short private root directly in/tmp. No reused cluster/path.
    short=pathlib.Path(tempfile.mkdtemp(prefix='mnw-',dir='/tmp'));short.chmod(0o700)
    initial=short.lstat();identity=(initial.st_dev,initial.st_ino,initial.st_uid)
    marker_bytes=(json.dumps({'scope':'manure-native-wide-short-root-v1','uid':os.getuid(),'nonce':secrets.token_hex(16),'report':str(report)},sort_keys=True)+'\n').encode()
    (short/'.owned-manure-native-wide').write_bytes(marker_bytes)
    (short/'.owned-manure-native-wide').chmod(0o600)
    (report/'short-root.json').write_text(json.dumps({'path':str(short),'uid':os.getuid(),'mode':'0700','device':initial.st_dev,'inode':initial.st_ino,'markerSha256':hashlib.sha256(marker_bytes).hexdigest(),'reason':'parent-reproduced PG18.6 Unix-socket107-byte limit; no application change'},indent=2)+'\n')
    env.update(HOME=str(home),TMPDIR=str(short),LANG='C.UTF-8',LC_ALL='C.UTF-8',TZ='UTC',PYTHONNOUSERSITE='1',PYTHONDONTWRITEBYTECODE='1',PYTHONPATH=str(source/'manure')+os.pathsep+str(source/'manure/tests'),MANURE_TEST_PG_BIN=value['PG_BIN'],PONYGIRLS_TEST_PROVISION_SERVICE='manure',MANURE_TEST_PROVISION_COMMAND=str(report/'provision'),MANURE_TEST_SERVER_COMMAND_JSON=json.dumps(['/nix/store/vy90bri36mygbj211vklcgzpilq8ff9a-manure-native-artifact-0.1.0/libexec/manure-server']))
    status=1;cleanup=None
    try:
        # Probe's180s alarm is INTERNAL to the child. The owning provider wrapper
        # stays outside that deadline and finishes its pg_ctl finally before this
        # synchronous call returns. No orchestration signals are sent here.
        status=subprocess.run([sys.executable,'-B',str(frozen/'with-owned-postgres.py'),sys.executable,'-B',str(probe),str(report)],env=env).returncode
    finally:
        (report/'owned-provider-exit-status').write_text(str(status)+'\n')
        cleanup=clean_short(short,identity,marker_bytes)
        (report/'short-root-cleanup.json').write_text(json.dumps(cleanup,indent=2)+'\n')
    return status if status else (0 if cleanup['success'] else 1)
if __name__=='__main__':raise SystemExit(main())
