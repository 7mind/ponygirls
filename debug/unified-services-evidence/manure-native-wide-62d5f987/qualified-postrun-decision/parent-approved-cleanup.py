#!/usr/bin/env python3
"""PROPOSED ONLY: Root approval required; NOT run by preparing agent.
Deletes ONLY the reviewed exact root's sole marker then empty directory. No
signals, recursive deletion, chmod, sudo, PID allowlist or protected-proc bypass.
Current-clock-qualified ordering is NOT a historical/access proof.
"""
import hashlib,importlib.util,json,os,pathlib,stat,sys
OBSERVER='/nix/store/9hzjvdn8zi4wivhgfr8d9vy7kdx21nkj-observe.py'
PROOF='/nix/store/ph769kjc6w8k139nwlggnazj74dlk6c1-readonly-observation.json'
SHA='7dd09b1571b2becf3032a351a79c74c57f6aaf00f947b2af8d80254609cd02f1'
def need(value,code):
    if not value:raise RuntimeError(code)
def main():
    # The parent must explicitly accept the written historical-clock/access
    # limitations. Without approval the script exits BEFORE any inspection/mutation.
    need(sys.argv[1:]==['--parent-approve-one-exact-empty-root','--ack-current-clock-not-historical-or-access-proof'],'explicit-parent-approval-required')
    proof=pathlib.Path(PROOF);need(hashlib.sha256(proof.read_bytes()).hexdigest()==SHA,'reviewed-proof-sha')
    old=json.loads(proof.read_text())
    spec=importlib.util.spec_from_file_location('native_wide_readonly_observer',OBSERVER);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    fresh=module.observe()
    need(fresh['conditionallyEligibleForParentReview'] and not fresh['exactRootReadableMatches'] and not fresh['inspectionErrors'],'fresh-observer-refuses')
    need(fresh['bootId']==old['bootId'] and fresh['hz']==old['hz'] and fresh['uid']==old['uid'],'boot-hz-uid-changed')
    need(fresh['root']==old['root'],'reviewed-root-or-birth-changed')
    key=lambda x:(x['pid'],x['uid'],x['startTicks'],x['procInode'])
    # This is an additional POSTRUN review identity check, NOT a fabricated
    # before-root baseline or blanket PID exception. Every denied PID is still
    # dynamically current-clock-qualified by the fresh observer before this check.
    need({key(x) for x in fresh['protectedSameUidProcesses']}=={key(x) for x in old['protectedSameUidProcesses']},'new-or-changed-protected-pid')
    root=pathlib.Path(old['root']['path']);need(root==pathlib.Path('/tmp/mnw-up_nid5o'),'one-exact-root-only')
    marker=root/'.owned-manure-native-wide'
    need(list(root.iterdir())==[marker],'not-exact-empty-marker-only-root')
    s=root.lstat();need((s.st_uid,s.st_dev,s.st_ino,stat.S_IMODE(s.st_mode))==(old['root']['uid'],old['root']['device'],old['root']['inode'],0o700),'last-root-identity')
    m=marker.lstat();need(stat.S_ISREG(m.st_mode) and m.st_uid==os.getuid() and m.st_nlink==1 and stat.S_IMODE(m.st_mode)==0o600 and hashlib.sha256(marker.read_bytes()).hexdigest()==old['root']['markerSha256'],'last-marker-identity')
    marker.unlink();root.rmdir()
    print(json.dumps({'scope':'PARENT-APPROVED marker+EMPTY directory removal only; original runner1/cleanupfalse unchanged','path':str(root),'signalsSent':0,'recursiveDeletion':False,'deleted':True,'reviewedProofSha256':SHA,'clockQualificationIsConditional':True}))
if __name__=='__main__':main()
