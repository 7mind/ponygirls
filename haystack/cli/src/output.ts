import {type Writable} from 'node:stream';
import {fstatSync} from 'node:fs';
import {Socket} from 'node:net';
import {CliError} from './core.ts';

interface OutputDescriptor extends Writable {readonly fd:number}
export class LiveOutput {
  private readonly target:Writable;private readonly owned:boolean;
  constructor(stdout:OutputDescriptor){
    const info=fstatSync(stdout.fd);this.owned=info.isFIFO()||info.isSocket();
    // Node intentionally makes process.stdout.destroy() a no-op for its underlying descriptor.
    this.target=this.owned?new Socket({fd:stdout.fd,readable:false,writable:true}):stdout;
    this.target.on('error',()=>{});
  }
  write(value:string,signal:AbortSignal):Promise<void>{return streamOutput(this.target,value,signal);}
  close():void{if(this.owned)this.target.destroy();}
}

function streamOutput(stream:Writable,value:string,signal:AbortSignal):Promise<void> {
  return new Promise((resolve,reject)=>{
    let pending=true;
    const finish=(error:Error|null|undefined)=>{
      if(!pending)return;pending=false;signal.removeEventListener('abort',abort);
      if(error!==undefined&&error!==null)reject(new CliError('output-failed','live output could not be completely delivered before cancellation or its bound',6,{}));else resolve();
    };
    const abort=()=>{finish(new Error('delivery cancelled'));stream.destroy();};
    if(signal.aborted){finish(new Error('delivery cancelled'));return;}
    signal.addEventListener('abort',abort,{once:true});
    try{stream.write(value,finish);}catch{finish(new Error('delivery failed'));}
  });
}
