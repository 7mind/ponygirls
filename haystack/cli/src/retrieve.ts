import type {Client} from './client.ts';
import {CliError} from './core.ts';
import {api} from './protocol.ts';
/** The server's not-configured reason: the text a lexical-only server gives for a semantic/hybrid request. */
export const NOT_CONFIGURED='semantic retrieval is not configured; lexical-only capability';
export function lexicalNotice(reason:string):string {return `Hybrid search is not available on this server: ${reason}; showing lexical results`;}
export function pendingNote(pending:string):string {return `${pending} items are not yet indexed for semantic search; results may be incomplete`;}
export interface Retrieved {readonly result:Record<string,unknown>;readonly notices:readonly string[]}
/** An explicit mode is never substituted. Without one: hybrid when the server offers it, otherwise lexical with the reason;
  * a defaulted hybrid refused with a typed unavailability is re-run once lexically, naming the server's reason. */
export async function retrieve(client:Client,explicit:api.RetrievalMode|undefined,request:(mode:api.RetrievalMode)=>unknown):Promise<Retrieved> {
  const run=async(mode:api.RetrievalMode)=>await client.domain('retrieve',request(mode)) as Record<string,unknown>;
  const notices:string[]=[];let result:Record<string,unknown>;
  if(explicit!==undefined)result=await run(explicit);
  else if(!(await client.capabilities()).modes.includes(api.RetrievalMode.Hybrid)){notices.push(lexicalNotice(NOT_CONFIGURED));result=await run(api.RetrievalMode.Lexical);}
  else {
    try{result=await run(api.RetrievalMode.Hybrid);}
    catch(error){
      if(!(error instanceof CliError)||error.code!=='unavailable'||error.details.reason===undefined)throw error;
      notices.push(lexicalNotice(error.message));result=await run(api.RetrievalMode.Lexical);
    }
  }
  if(result.pending!=='0')notices.push(pendingNote(String(result.pending)));
  return {result,notices};
}
