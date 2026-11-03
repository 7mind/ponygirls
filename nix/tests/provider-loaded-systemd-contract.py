#!/usr/bin/env python3
"""Same production LoadCredential reader in its ACTUAL systemd UID/FD context.
No credential contents printed/changed. Negatives alter only metadata responses
or caller context, not the kernel credential or its permissions.
"""
import copy,importlib.util,json,os,pathlib,struct,sys
spec=importlib.util.spec_from_file_location('provider',sys.argv[1]);p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
cfg=json.loads(pathlib.Path(sys.argv[2]).read_text());key=sys.argv[3]
value=p.loaded_systemd_secret(cfg,key,p.CredentialFilesystem(),os.environ);assert value and len(value.encode())<=4096;del value
passed=['actual-root-owned-UID-ACL-loaded-credential-positive']
class ChangedMetadata(p.CredentialFilesystem):
    def __init__(self,kind):self.kind=kind;self.reads=0
    def read(self,fd,count):self.reads+=1;return super().read(fd,count)
    def fstat(self,fd):
        result=super().fstat(fd)
        if self.kind in ['foreign-owner','foreign-group','writable']:
            class Info:pass
            info=Info()
            for name in ['st_dev','st_ino','st_mode','st_uid','st_gid']:setattr(info,name,getattr(result,name))
            if self.kind=='foreign-owner':info.st_uid=1
            if self.kind=='foreign-group':info.st_gid=1
            if self.kind=='writable':info.st_mode|=0o020
            return info
        return result
    def getxattr(self,fd,name):
        if self.kind=='default-acl' and name.endswith('default'):return b'controlled-default-metadata'
        value=super().getxattr(fd,name)
        if name.endswith('access'):
            if self.kind=='acl-version':return struct.pack('<I',3)+value[4:]
            if self.kind=='acl-truncated':return value[:-1]
            if self.kind=='acl-extra-uid':return value+struct.pack('<HHI',2,4,1)
            if self.kind=='acl-group-read':return value[:20]+struct.pack('<HHI',4,4,0xffffffff)+value[28:]
        return value
for kind in ['foreign-owner','foreign-group','writable','default-acl','acl-version','acl-truncated','acl-extra-uid','acl-group-read']:
    fs=ChangedMetadata(kind)
    try:p.loaded_systemd_secret(cfg,key,fs,os.environ);raise AssertionError('unsafe metadata accepted')
    except (p.ProviderError,OSError):pass
    assert fs.reads==0
    passed.append('controlled-metadata-reject/'+kind)
for kind,environment in [('missing',{}),('forged-root',{**os.environ,'CREDENTIALS_DIRECTORY':'/tmp/forged'}),('escaped-file',{**os.environ,'PONYGIRLS_PASSWORD_FILE':os.environ['CREDENTIALS_DIRECTORY']+'/../database-password'}),('wrong-name',{**os.environ,'PONYGIRLS_PASSWORD_FILE':os.environ['CREDENTIALS_DIRECTORY']+'/other'})]:
    try:p.loaded_systemd_secret(cfg,key,p.CredentialFilesystem(),environment);raise AssertionError('unsafe reference accepted')
    except p.ProviderError:pass
    passed.append('reject-reference/'+kind)
print('UNIT_GRAPH_CREDENTIAL_CONTRACT '+json.dumps({'cases':passed,'tests':len(passed),'failures':0,'errors':0,'skips':0,'scope':'actual production loaded-credential reader/UID/FD positive plus metadata-only negative controls; real credential untouched'}),flush=True)
