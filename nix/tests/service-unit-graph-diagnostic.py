"""TEST-ONLY observer. Never emits credential bytes, SQL, argv or config values."""
import errno,json,os,pathlib,stat,subprocess,sys,time

def emit(value):
    print('UNIT_GRAPH_SAFE_DIAGNOSTIC '+json.dumps(value,sort_keys=True),flush=True)

def metadata():
    value=os.environ.get('PONYGIRLS_PASSWORD_FILE');directory=os.environ.get('CREDENTIALS_DIRECTORY')
    result={'stage':'credential-metadata','uid':os.getuid(),'credentialEnvPresent':bool(value),'credentialDirectoryEnvPresent':bool(directory),'referenceMatchesLoadedCredential':bool(value and directory and value==directory+'/database-password'),'monotonic':time.monotonic()}
    if value:
        try:
            fd=os.open(value,os.O_RDONLY|os.O_NONBLOCK)
            try:
                info=os.fstat(fd);result.update(regular=stat.S_ISREG(info.st_mode),mode=oct(stat.S_IMODE(info.st_mode)),ownerUid=info.st_uid,byteCount=info.st_size)
            finally:os.close(fd)
        except OSError as error:result.update(exceptionClass=type(error).__name__,errno=error.errno)
    # No paths/values are emitted. Only expected socket and marker presence.
    try:
        config=json.loads(pathlib.Path(sys.argv[1]).read_text());root=pathlib.Path(config['stateDirectory'])
        result.update(managedRootPrivate=not bool(root.stat().st_mode&0o077),ownershipMarkerPresent=(root/'ponygirls-provider-v1').is_file(),major18=(root/'data/PG_VERSION').read_text().strip()=='18',configuredPortPositive=isinstance(config['port'],int) and 0<config['port']<65536,configuredSocketPresent=stat.S_ISSOCK((root/'socket'/('.s.PGSQL.'+str(config['port']))).stat().st_mode))
        clean={key:value for key,value in os.environ.items() if not key.startswith('PG')}
        for label,host in [('defaultUnixPeer','/run/postgresql'),('configuredUnixPeer',str(root/'socket'))]:
            try:
                check=subprocess.run([config['postgresBin']+'/psql','-X','-w','-Atq','-h',host,'-p',str(config['port']),'-U',config['adminRole'],'-d','postgres'],input='SELECT 1;',text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={**clean,'PGCONNECT_TIMEOUT':'2'},timeout=3)
                result[label+'Success']=check.returncode==0 and check.stdout.strip()=='1'
            except Exception as error:result[label+'ExceptionClass']=type(error).__name__
    except Exception as error:result['configMetadataExceptionClass']=type(error).__name__
    emit(result)

_seen=set()
def trace(frame,event,arg):
    if event=='exception' and frame.f_code.co_filename.endswith('-provider.py') and frame.f_code.co_name in {'private_secret','verifier','sql','provision','initialize'}:
        kind=arg[0].__name__;key=(frame.f_code.co_name,kind)
        if key not in _seen:
            _seen.add(key);value={'stage':'provider-exception-class','function':key[0],'exceptionClass':kind,'monotonic':time.monotonic()}
            if isinstance(arg[1],OSError):value['errno']=arg[1].errno
            emit(value)
    return trace

if __name__=='__main__':metadata()
else:sys.settrace(trace)
