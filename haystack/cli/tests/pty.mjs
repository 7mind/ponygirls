import {spawn} from 'node:child_process';

// Behavioral/Blackbox/Good-Communication: real processes with separately observed PTY descriptors.
export function terminalProcess(command,env,width,terminals){
 const script=String.raw`
import errno,fcntl,json,os,pty,selectors,struct,subprocess,sys,termios,time
command=json.loads(sys.argv[1]);width=int(sys.argv[2]);terminals=sys.argv[3]
pairs={name:pty.openpty() if terminals in ('both',name) else os.pipe() for name in ('stdout','stderr')}
for name,(reader,writer) in pairs.items():
    if terminals in ('both',name):
        attrs=termios.tcgetattr(writer);attrs[1]&=~termios.OPOST;termios.tcsetattr(writer,termios.TCSANOW,attrs)
        fcntl.ioctl(writer,termios.TIOCSWINSZ,struct.pack('HHHH',40,width,0,0))
child=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=pairs['stdout'][1],stderr=pairs['stderr'][1],env=os.environ)
selector=selectors.DefaultSelector();buffers={name:bytearray() for name in pairs}
for name,(reader,writer) in pairs.items():
    os.close(writer);os.set_blocking(reader,False);selector.register(reader,selectors.EVENT_READ,name)
deadline=time.monotonic()+15
try:
    while selector.get_map():
        if time.monotonic()>=deadline: raise TimeoutError('CLI PTY process exceeded test deadline')
        for key,_ in selector.select(.05):
            try: data=os.read(key.fd,65536)
            except OSError as error:
                if error.errno!=errno.EIO: raise
                data=b''
            if data: buffers[key.data].extend(data)
            else: selector.unregister(key.fd);os.close(key.fd)
    code=child.wait(timeout=1)
    print(json.dumps({'code':code if code>=0 else None,'signal':None if code>=0 else -code,**{name:data.decode('utf-8') for name,data in buffers.items()}}))
finally:
    if child.poll() is None: child.kill();child.wait()
    for key in list(selector.get_map().values()): os.close(key.fd)
    selector.close()
`;
 return new Promise((resolve,reject)=>{
  const child=spawn('python3',['-c',script,JSON.stringify(command),String(width),terminals],{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);child.on('error',reject);
  child.on('close',code=>{if(code!==0){reject(new Error('PTY fixture failed: '+stderr));return;}try{resolve(JSON.parse(stdout));}catch(error){reject(error);}});
 });
}
