#!/usr/bin/env python3
"""One bounded-secret contract: strict ordinary files and LoadCredential adapter.
The fast LoadCredential leg uses a hand-written descriptor filesystem; the SAME
production adapter additionally runs against real systemd in the owned VM.
"""
import copy,errno,importlib.util,json,os,pathlib,stat,struct,sys,tempfile,types
spec=importlib.util.spec_from_file_location('provider',sys.argv[1]);provider=importlib.util.module_from_spec(spec);spec.loader.exec_module(provider)
UNDEFINED=0xffffffff
acl=lambda uid,perm:struct.pack('<I',2)+b''.join(struct.pack('<HHI',*entry) for entry in [(1,perm,UNDEFINED),(2,perm,uid),(4,0,UNDEFINED),(16,perm,UNDEFINED),(32,0,UNDEFINED)])
class MemoryDescriptors:
    def __init__(self,raw):
        self.raw=raw;self.position=0;self.fds={};self.closed=[];self.reads=0
        self.nodes={};self.nextfd=10
        for ino,path in enumerate(['/','/run','/run/credentials','/run/credentials/ponygirls-database-manure.service','/run/credentials/ponygirls-database-manure.service/database-password'],1):
            directory=ino<5;mode=(0o550 if ino==4 else 0o755) if directory else 0o440
            self.nodes[path]={'info':types.SimpleNamespace(st_mode=(stat.S_IFDIR if directory else stat.S_IFREG)|mode,st_uid=0,st_gid=0,st_dev=1,st_ino=ino),'acl':acl(71,5 if directory else 4) if ino>=4 else None,'default':None}
    def euid(self):return 71
    def egid(self):return 71
    def service_identity(self,name):assert name=='postgres';return types.SimpleNamespace(pw_uid=71,pw_gid=71)
    def path(self,name,parent):return name if parent is None else self.fds[parent].rstrip('/')+'/'+name
    def stat(self,name,dir_fd=None,follow_symlinks=False):assert follow_symlinks is False;return self.nodes[self.path(name,dir_fd)]['info']
    def open(self,name,flags,dir_fd=None):
        assert flags&os.O_NOFOLLOW
        path=self.path(name,dir_fd);self.nextfd+=1;self.fds[self.nextfd]=path;return self.nextfd
    def fstat(self,fd):
        node=self.nodes[self.fds[fd]];info=copy.copy(node['info'])
        if node.get('swapped'):info.st_ino+=100
        return info
    def getxattr(self,fd,key):
        value=self.nodes[self.fds[fd]]['default' if key.endswith('default') else 'acl']
        if value is None:raise OSError(errno.ENODATA,'absent metadata')
        return value
    def read(self,fd,count):
        self.reads+=1;result=self.raw[self.position:self.position+count];self.position+=len(result);return result
    def close(self,fd):self.closed.append(fd);del self.fds[fd]

cfg={'adminRole':'postgres'};directory='/run/credentials/ponygirls-database-manure.service';file=directory+'/database-password'
env={'CREDENTIALS_DIRECTORY':directory,'PONYGIRLS_PASSWORD_FILE':file};passed=[]
def load(fs,environment=env,key='manure'):
    try:return provider.loaded_systemd_secret(cfg,key,fs,environment)
    finally:assert not fs.fds,'descriptor leak'
# The exact SAME decode/bounds clauses run against both transport implementations.
with tempfile.TemporaryDirectory() as root:
    path=pathlib.Path(root)/'ordinary';path.write_bytes(b'initial');path.chmod(0o600)
    cases=[('ascii',b'value',True),('newline',b'value\n',True),('unicode','I\u00adX'.encode(),True),('maximum',b'x'*4096,True),('empty',b'',False),('too-large',b'x'*4097,False),('embedded-newline',b'a\nb',False),('carriage-return',b'a\r',False),('nul',b'a\0b',False),('invalid-utf8',b'\xff',False)]
    for name,raw,valid in cases:
        path.write_bytes(raw)
        for transport,reader in [('ordinary',lambda:provider.private_secret(path)),('systemd-descriptor-dummy',lambda:load(MemoryDescriptors(raw)))]:
            try:value=reader();assert valid
            except (provider.ProviderError,UnicodeError):assert not valid
            passed.append(transport+'/'+name)
    for mode in [0o440,0o640,0o644,0o660,0o666]:
        path.chmod(mode)
        try:provider.private_secret(path);raise AssertionError('ordinary group/world file accepted')
        except provider.ProviderError:passed.append('ordinary-reject-mode-'+oct(mode))
    # Prior contents invalid-UTF8: restore with owner write, then verify strict400.
    path.chmod(0o600);path.write_bytes(b'private');path.chmod(0o400);assert provider.private_secret(path)=='private';passed.append('ordinary-private0400')

def reject(name,change=None,environment=env,key='manure'):
    fs=MemoryDescriptors(b'not-logged')
    if change:change(fs)
    try:load(fs,environment,key);raise AssertionError('invalid transport accepted: '+name)
    except (provider.ProviderError,OSError):pass
    assert fs.reads==0,'invalid transport read bytes'
    passed.append('loaded-reject/'+name)
for name,environment in [('missing',{}),('forged-root',{'CREDENTIALS_DIRECTORY':'/tmp/forged','PONYGIRLS_PASSWORD_FILE':'/tmp/forged/database-password'}),('escaped',{'CREDENTIALS_DIRECTORY':directory,'PONYGIRLS_PASSWORD_FILE':directory+'/../database-password'}),('wrong-name',{'CREDENTIALS_DIRECTORY':directory,'PONYGIRLS_PASSWORD_FILE':directory+'/other'})]:reject(name,environment=environment)
reject('invalid-unit',key='../manure')
for target in ['/', '/run','/run/credentials',directory,file]:
    for kind in ['foreign-owner','foreign-group','writable','symlink','default-acl','identity-swap']:
        def change(fs,target=target,kind=kind):
            node=fs.nodes[target];info=node['info']
            if kind=='foreign-owner':info.st_uid=72
            elif kind=='foreign-group':info.st_gid=72
            elif kind=='writable':info.st_mode|=0o020
            elif kind=='symlink':info.st_mode=stat.S_IFLNK|0o777
            elif kind=='default-acl':node['default']=acl(71,4)
            elif kind=='identity-swap':node['swapped']=True
        reject(target.rsplit('/',1)[-1]+'/'+kind,change)
for target in [directory,file]:
    for name,raw in [('foreign-user',acl(72,4)),('wrong-version',struct.pack('<I',3)+acl(71,4)[4:]),('truncated',acl(71,4)[:-1]),('extra-group',acl(71,4)+struct.pack('<HHI',8,4,72)),('group-read',struct.pack('<I',2)+b''.join(struct.pack('<HHI',*e) for e in [(1,4,UNDEFINED),(2,4,71),(4,4,UNDEFINED),(16,4,UNDEFINED),(32,0,UNDEFINED)]))]:
        reject(target.rsplit('/',1)[-1]+'/'+name,lambda fs,target=target,raw=raw:fs.nodes[target].update(acl=raw))
reject('fifo',lambda fs:setattr(fs.nodes[file]['info'],'st_mode',stat.S_IFIFO|0o440))
reject('directory-as-file',lambda fs:setattr(fs.nodes[file]['info'],'st_mode',stat.S_IFDIR|0o440))
# Nix admits long attribute keys when concrete DB/role identifiers are short.
long_key='a'*65;long_directory='/run/credentials/ponygirls-database-'+long_key+'.service'
fs=MemoryDescriptors(b'long-key-private')
fs.nodes={path.replace(directory,long_directory):node for path,node in fs.nodes.items()}
assert load(fs,{'CREDENTIALS_DIRECTORY':long_directory,'PONYGIRLS_PASSWORD_FILE':long_directory+'/database-password'},long_key)=='long-key-private'
passed.append('loaded-existing-65-character-unit-key-admission')
assert len(passed)==len(set(passed))
report={'cases':passed,'tests':len(passed),'failures':0,'errors':0,'skips':0,'scope':'same bounded read contract: ordinary real FS + hand-written loaded-credential descriptor adapter; exact real systemd leg separately mandatory'}
if len(sys.argv)>2:pathlib.Path(sys.argv[2]).write_text(json.dumps(report,indent=2)+'\n')
print('PASS credential transport contract:',len(passed),'cases; no credential bytes logged')
