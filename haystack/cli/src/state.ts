import path from 'node:path';
import os from 'node:os';
import {constants} from 'node:fs';
import {lstat, mkdir, open, unlink, rename, type FileHandle} from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';
import {CliError, fail, object} from './core.ts';
const PRIVATE_FILE = 0o600;
const PRIVATE_DIRECTORY = 0o700;
export function stateDirectory(env: NodeJS.ProcessEnv, explicit: string|undefined): string {
  const root = explicit ?? (env.HAYSTACK_STATE_DIR || undefined) ?? path.join(env.XDG_STATE_HOME || path.join(env.HOME || os.homedir(),'.local','state'),'haystack-cli');
  if (!path.isAbsolute(root)) fail('unsafe-state','state directory must be absolute',2);
  return path.resolve(root);
}
export async function syncDirectory(directory:string):Promise<void> {
  const handle=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await handle.sync();}finally{await handle.close();}
}
export async function readBounded(handle:FileHandle,max:number):Promise<string> {
  const chunks:Buffer[]=[];let size=0;
  while(size<=max){const buffer=Buffer.alloc(Math.min(65536,max+1-size));const read=await handle.read(buffer,0,buffer.length,null);if(read.bytesRead===0)break;size+=read.bytesRead;chunks.push(buffer.subarray(0,read.bytesRead));}
  if(size>max)throw new Error('input bound');return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
}
export async function privateDirectory(directory: string): Promise<void> {
  const parsed=path.parse(directory);let current=parsed.root;
  try {
    for(const part of directory.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      current=path.join(current,part);
      try {await mkdir(current,{mode:PRIVATE_DIRECTORY});await syncDirectory(path.dirname(current));} catch(error) {if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
      const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink())throw new Error();
    }
    const info=await lstat(directory);if(info.uid!==process.getuid!()||(info.mode&0o777)!==PRIVATE_DIRECTORY)throw new Error();
  } catch { fail('unsafe-state','state directory must be owner-only (0700), owned by this user and free of symlink components',2); }
}
export async function readPrivate(file: string, max: number): Promise<string|undefined> {
  let handle;
  try {
    handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const info=await handle.stat();if(!info.isFile()||info.uid!==process.getuid!()||(info.mode&0o777)!==PRIVATE_FILE||info.nlink>1||info.size>max)throw new Error();
    return await readBounded(handle,max);
  } catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;return fail('unsafe-state','private state or credential file must be a bounded regular owner-only (0600) file; symlinks/hardlinks are refused',2);}
  finally {await handle?.close();}
}
async function newPrivate(file: string, value: string): Promise<void> {
  let handle;
  try {handle=await open(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,PRIVATE_FILE);await handle.writeFile(value,'utf8');await handle.sync();}
  catch {fail('unsafe-state','could not create exclusive private state file; existing files are never overwritten',2);}
  finally {await handle?.close();}
}
export async function secretDestination(file: string): Promise<import('node:fs/promises').FileHandle> {
  if(!path.isAbsolute(file))file=path.resolve(file);
  const dir=path.dirname(file);let current=path.parse(dir).root;
  try {for(const part of dir.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink())throw new Error();}
    return await open(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,PRIVATE_FILE);
  } catch {return fail('unsafe-state','secret-file must be a new file in an existing non-symlink directory',2);}
}
export class State {
  readonly directory: string; readonly origin: string; readonly prefix: string;
  constructor(directory: string, origin: string) {this.directory=directory;this.origin=origin;this.prefix=createHash('sha256').update(origin).digest('hex');}
  filename(kind: string): string {return path.join(this.directory,`${this.prefix}.${kind}.json`);}
  async read(kind: string): Promise<Record<string,unknown>|undefined> {
    await privateDirectory(this.directory);const text=await readPrivate(this.filename(kind),4*1024*1024);if(text===undefined)return undefined;
    try {const value: unknown=JSON.parse(text);if(!object(value)||value.origin!==this.origin)throw new Error();return value;} catch {return fail('unsafe-state','private state is invalid or belongs to another origin; no fallback is attempted',2);}
  }
  async create(kind: string, value: Record<string,unknown>): Promise<void> {await privateDirectory(this.directory);await newPrivate(this.filename(kind),JSON.stringify({origin:this.origin,...value})+'\n');await syncDirectory(this.directory);}
  async remove(kind: string): Promise<void> {await privateDirectory(this.directory);await readPrivate(this.filename(kind),4*1024*1024);try{await unlink(this.filename(kind));await syncDirectory(this.directory);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')fail('unsafe-state','cannot remove private state',2);}}
  async replace(kind: string, value: Record<string,unknown>): Promise<void> {
    await privateDirectory(this.directory);await readPrivate(this.filename(kind),4*1024*1024);
    const temporary=this.filename(kind+'.'+randomBytes(12).toString('hex')+'.temporary');
    try {
      await newPrivate(temporary,JSON.stringify({origin:this.origin,...value})+'\n');
      await rename(temporary,this.filename(kind));await syncDirectory(this.directory);
    } finally {try{await unlink(temporary);await syncDirectory(this.directory);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  }

  async locked<T>(operation: () => Promise<T>): Promise<T> {
    await privateDirectory(this.directory);const lock=this.filename('lock');let handle;
    try {handle=await open(lock,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,PRIVATE_FILE);await handle.writeFile(JSON.stringify({pid:process.pid,nonce:randomBytes(16).toString('hex')}));await handle.sync();await syncDirectory(this.directory);}
    catch {await handle?.close();return fail('state-busy','another operation owns this origin state; after process termination inspect the retained lock before manual removal',6);}
    try{return await operation();}finally{await handle.close();try{await unlink(lock);await syncDirectory(this.directory);}catch{throw new CliError('unsafe-state','could not release private state lock; inspect state before another write',2,{});}}
  }
}
