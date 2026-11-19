import type {Client} from './client.ts';
import {CliError} from './core.ts';
import {api} from './protocol.ts';
/** The server's not-configured reason: the text a lexical-only server gives for a semantic/hybrid request. */
export const NOT_CONFIGURED='semantic retrieval is not configured; lexical-only capability';
export function lexicalNotice(reason:string):string {return `Hybrid search is not available on this server: ${reason}; showing lexical results`;}
export function pendingNote(pending:string):string {return `${pending} ${pending==='1'?'item is':'items are'} not yet indexed for semantic search; results may be incomplete`;}
/** An explicit mode is never substituted. Without one: hybrid when the server offers it, otherwise lexical with the reason;
  * a defaulted hybrid refused with a typed unavailability is re-run once lexically, naming the server's reason. A downgrade
  * is announced before the lexical request, so it stays visible when that request fails too. */
export async function retrieve(client:Client,explicit:api.RetrievalMode|undefined,request:(mode:api.RetrievalMode)=>unknown,notify:(notice:string)=>Promise<void>):Promise<Record<string,unknown>> {
  const run=async(mode:api.RetrievalMode)=>await client.domain('retrieve',request(mode)) as Record<string,unknown>;
  let result:Record<string,unknown>;
  if(explicit!==undefined)result=await run(explicit);
  else if(!(await client.capabilities()).modes.includes(api.RetrievalMode.Hybrid)){await notify(lexicalNotice(NOT_CONFIGURED));result=await run(api.RetrievalMode.Lexical);}
  else {
    try{result=await run(api.RetrievalMode.Hybrid);}
    catch(error){
      if(!(error instanceof CliError)||error.code!=='unavailable'||error.details.reason===undefined)throw error;
      await notify(lexicalNotice(error.message));result=await run(api.RetrievalMode.Lexical);
    }
  }
  if(result.pending!=='0')await notify(pendingNote(String(result.pending)));
  return result;
}
