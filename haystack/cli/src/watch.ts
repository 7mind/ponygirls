import WebSocket from 'ws';
import {randomBytes} from 'node:crypto';
import {type Client} from './client.ts';
import {CliError,envelope,key,PROTOCOL} from './core.ts';
import {api,check,materialize,liveSchema,decode,encode} from './protocol.ts';
const HEARTBEAT_MS = 10_000;
const LIVE_FRAME_BYTES = 1024;
const QUEUED_FRAMES = 64;
interface Ping {readonly nonce:string;readonly stamp:number;readonly deadline:NodeJS.Timeout}
export async function watch(client:Client,duration:number,maxEvents:number,emit:(frame:unknown)=>Promise<void>):Promise<void> {
  const credentials=await client.credentials();
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(client.config.origin.replace(/^http/,'ws')+'/api/v1/live',{
      headers:{...credentials,'X-Haystack-Version':PROTOCOL},followRedirects:false,
      handshakeTimeout:client.config.timeout,maxPayload:LIVE_FRAME_BYTES,perMessageDeflate:false,
    });
    let settled=false;let observed=false;let count=0;let draining=false;let pending:Ping|undefined;
    const queue:unknown[]=[];
    const finish=(error:CliError|undefined)=>{
      if(settled)return;settled=true;clearTimeout(deadline);clearInterval(heartbeat);
      if(pending!==undefined)clearTimeout(pending.deadline);
      process.off('SIGINT',cancel);process.off('SIGTERM',cancel);socket.terminate();
      if(error===undefined)resolve();else reject(error);
    };
    const cancel=()=>finish(undefined);
    const deadline=setTimeout(()=>finish(observed?undefined:new CliError('unavailable','watch bound expired before an authenticated live frame was observed',6,{})),duration);
    const ping=()=>{
      if(socket.readyState!==WebSocket.OPEN||pending!==undefined)return;
      const nonce=randomBytes(12).toString('hex');const stamp=Date.now();
      pending={nonce,stamp,deadline:setTimeout(()=>finish(new CliError('unavailable','live application heartbeat deadline exceeded',6,{})),client.config.timeout)};
      socket.send(JSON.stringify(encode(api.LiveFrame.jsonCodec(),new api.LiveFrame('ping',undefined,undefined,nonce,stamp,undefined))),error=>{
        if(error!==undefined&&error!==null)finish(new CliError('unavailable','live heartbeat could not be sent',6,{}));
      });
    };
    const heartbeat=setInterval(ping,HEARTBEAT_MS);
    process.once('SIGINT',cancel);process.once('SIGTERM',cancel);socket.once('open',ping);
    socket.once('unexpected-response',(_request,response)=>{
      response.destroy();const status=response.statusCode;
      finish(new CliError(status!==undefined&&status>=300&&status<400?'redirect-refused':status===401?'unauthorized':'unavailable','live handshake rejected; no redirect or reconnect attempted',status===401?3:6,{}));
    });
    socket.on('error',()=>finish(new CliError('unavailable','live connection failed; no automatic reconnect',6,{})));
    socket.on('close',code=>{
      if(!settled)finish(new CliError(code===4401?'unauthorized':'unavailable',code===4401?'live session rejected':'live stream ended before the requested bound',code===4401?3:6,{}));
    });
    const drain=async()=>{
      if(draining)return;draining=true;socket.pause();
      try{
        while(queue.length&&!settled){const frame=queue.shift()!;await emit(frame);count++;if(count>=maxEvents){finish(undefined);break;}}
      }catch{finish(new CliError('output-failed','could not write live event output',6,{}));}
      finally{draining=false;if(!settled)socket.resume();}
    };
    socket.on('message',(bytes,binary)=>{
      if(settled)return;
      try{
        if(binary)throw new Error();
        const parsed=envelope(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(bytes as Buffer)));
        if(!check(liveSchema,parsed))throw new Error();
        const frame=decode(api.LiveFrame.jsonCodec(),materialize(liveSchema,parsed));
        if(frame.kind==='pong'){
          if(pending===undefined||frame.nonce!==pending.nonce||frame.clientTs!==pending.stamp||typeof frame.serverTs!=='number')throw new Error();
          clearTimeout(pending.deadline);pending=undefined;observed=true;return;
        }
        if(frame.kind!=='changed'||typeof frame.key!=='string'||typeof frame.revision!=='number'||frame.revision<1)throw new Error();
        key(frame.key);observed=true;
        if(queue.length>=QUEUED_FRAMES)throw new Error();
        queue.push(encode(api.LiveFrame.jsonCodec(),frame));void drain();
      }catch{finish(new CliError('invalid-response','invalid or over-limit current-protocol live frame',6,{}));}
    });
  });
}
