import * as current from './current-protocol.js';
import {hashBlob} from './sha256.js';

export const MAX_TAGS=32;
export const MAX_TAG_SCALARS=128;
// Comma separated; exact and case-sensitive like the server's tags. Returns an inline error instead of throwing.
export function parseTags(text) {
  const tags=text.split(',').map(tag=>tag.trim()).filter(tag=>tag!=='');
  if(new Set(tags).size!==tags.length) return {tags,error:'Tags must be distinct.'};
  if(tags.length>MAX_TAGS) return {tags,error:'At most '+MAX_TAGS+' tags.'};
  if(tags.some(tag=>[...tag].length>MAX_TAG_SCALARS)) return {tags,error:'A tag is at most '+MAX_TAG_SCALARS+' characters.'};
  return {tags,error:null};
}

// One instance per staged file. Retain the exact artifact/offset across retries;
// correlation IDs do not deduplicate InitUpload.
export class FileUpload {
  constructor(file,visibility) {
    this.file=file;this.visibility=visibility;this.expiresInSeconds=null;this.tags=[];this.error=null;this.stopped=false;this.id=null;this.offset=0;
    this.chunkBytes=null;this.password=null;this.link=null;this.phase='staged';this.busy=false;
  }
  async run(request,fetch,check,signal,progress) {
    if(this.busy || this.phase==='ready' || this.phase==='init-uncertain') return;
    this.busy=true;
    try {
      check();
      if(this.id===null) {
        this.phase='hashing';progress();
        const caps=await request(current.capabilities());check();
        if(BigInt(this.file.size)>caps.max_file_bytes || BigInt(this.file.size)>caps.max_artifact_bytes || caps.max_files_per_artifact<1) throw new Error('too-large');
        if(this.expiresInSeconds!==null && this.expiresInSeconds>caps.max_ttl_seconds) throw new Error('invalid-ttl');
        const digest=await hashBlob(this.file,check);check();
        // Cancelling stops before the reservation; after it, the ID and password must be recorded first.
        if(signal.aborted) throw new Error('cancelled');
        this.phase='initializing';progress();
        // Once dispatched, a lost/malformed response may still have reserved an
        // artifact. Do not silently create another reservation on Retry.
        this.phase='init-uncertain';
        let init;
        try { init=await request(current.initUpload(this.file,this.visibility,digest,this.expiresInSeconds,this.tags)); }
        catch (error) {
          check();
          // These typed admission checks precede all reservation/payload writes.
          // Other failures may hide a committed reservation and stay uncertain.
          if (error.status >= 400 && error.status < 500 &&
              ['quota-exceeded','session-limit'].includes(error.message)) { this.phase='staged'; }
          throw error;
        }
        check();
        if(!/^[0-9a-f]{32}$/.test(init.artifact_id)) throw new Error('bad-response');
        this.id=init.artifact_id;this.password=init.external_password;
        if(!Number.isInteger(init.chunk_bytes) || init.chunk_bytes<=0) throw new Error('bad-response');
        this.chunkBytes=init.chunk_bytes;
      }
      if(this.chunkBytes===null) throw new Error('bad-response');
      this.phase='uploading';progress();
      while(this.offset<this.file.size) {
        check();
        const chunk=this.file.slice(this.offset,this.offset+this.chunkBytes);
        const digest=await hashBlob(chunk,check);check();
        await current.putChunk(fetch,this.id,this.file.name,this.offset,chunk,digest,signal);check();
        this.offset+=chunk.size;progress();
      }
      this.phase='finalizing';progress();
      const result=await request(current.finishUpload(this.id));check();
      if(result.artifact_id!==this.id || result.state!=='ready') throw new Error('bad-response');
      this.link=result.content_url;this.phase='ready';progress();
    } catch (error) {
      // A failure before the reservation was dispatched leaves a plain staged file.
      if(this.id===null && this.phase!=='init-uncertain') this.phase='staged';
      throw error;
    } finally { this.busy=false; }
  }
  clear() {this.password=null;this.file=null;this.link=null;}
}
