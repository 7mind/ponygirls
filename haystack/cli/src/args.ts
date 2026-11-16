import {integer, TIMEOUT_MS, RESPONSE_BYTES, usage} from './core.ts';
export interface Arguments { readonly words: string[]; readonly flags: Map<string,string|boolean>; readonly json: boolean }
const switches = new Set(['json','help','version','allow-http','include-archived','all','stdin']);
const values = new Set(['url','auth','token-file','state-dir','timeout-ms','max-response-bytes','revision','expected-revision','request-id','file','project','limit','cursor','sort','direction','caret','mode','offset','duration-ms','max-events','password-file','name','secret-file','status']);
export function parse(args: string[]): Arguments {
  const flags = new Map<string,string|boolean>(); const words: string[] = []; let literal = false;
  for (let i=0;i<args.length;i++) {
    const arg=args[i]!;
    if (arg === '--' && !literal) { literal=true; continue; }
    if (arg.startsWith('-') && !literal) {
      const m=/^--([a-z-]+)(?:=(.*))?$/.exec(arg);
      if (!m || (!switches.has(m[1]!) && !values.has(m[1]!))) usage('unknown option; see --help');
      const name=m[1]!; if(flags.has(name)) usage('options may not be repeated');
      if(switches.has(name)) {if(m[2]!==undefined) usage('boolean option does not take a value');flags.set(name,true);}
      else { const value=m[2]===undefined?args[++i]:m[2]; if(value===undefined || value.startsWith('--')) usage('option requires a value'); flags.set(name,value); }
    } else words.push(arg);
  }
  return {words,flags,json:flags.has('json')};
}
export function text(args: Arguments, name: string): string|undefined { const value=args.flags.get(name); return typeof value==='string'?value:undefined; }
export function required(args: Arguments, name: string): string { const value=text(args,name); if(value===undefined || value==='') usage(`--${name} is required`); return value; }
export function number(args: Arguments, name: string, fallback: number, min: number, max: number): number {const value=text(args,name);return value===undefined?fallback:integer(value,min,max,name);}
const common = ['json','help','url','auth','token-file','state-dir','allow-http','timeout-ms','max-response-bytes'];
const options: Readonly<Record<string,readonly string[]>> = {
  health:[],versions:[],whoami:[],get:['revision'],put:['file','stdin','expected-revision','request-id'],
  search:['project','limit','cursor','sort','direction','all'],history:[],retrieve:['mode','project','include-archived','offset','limit'],
  analyze:['caret'],complete:['caret'],values:[],watch:['duration-ms','max-events'],
  edit:['file','stdin','request-id'],archive:['request-id'],unarchive:['status','request-id'],attention:['request-id'],restore:['revision','request-id'],
  login:['password-file'],logout:[],status:[],account:[],token:['name','secret-file'],
  pending:[],replay:[],reconcile:[],call:['file','stdin'],
};
export function validate(args: Arguments): string {
  const command=args.words[0]; if(command===undefined || !Object.hasOwn(options,command)) usage('choose a command; see --help');
  const allowed=new Set([...common,...options[command]!]);for(const flag of args.flags.keys())if(!allowed.has(flag))usage('option is not valid for this command');
  const arity: Readonly<Record<string,readonly [number,number]>>={get:[1,1],put:[1,1],search:[0,1],history:[1,1],retrieve:[1,1],analyze:[1,1],complete:[1,1],values:[1,1],edit:[1,1],archive:[1,1],unarchive:[1,1],attention:[2,2],restore:[1,1],login:[1,1],token:[1,2],call:[1,1]};
  const range=arity[command]??[0,0];const count=args.words.length-1;if(count<range[0]!||count>range[1]!)usage('incorrect command arguments; see --help');
  number(args,'timeout-ms',TIMEOUT_MS,10,600_000);number(args,'max-response-bytes',RESPONSE_BYTES,1024,64*1024*1024);
  const auth=text(args,'auth');if(auth!==undefined&&auth!=='token'&&auth!=='session')usage('--auth must be token or session');
  return command;
}
export const HELP=`Haystack — shared versioned knowledge, application CLI
Usage: haystack [global options] COMMAND [options]
Human-readable output is the default, including pipes. --json works before or
 after any command. IDs, revisions, request IDs and cursors are never shortened.

Commands:
  health | versions | whoami             Service and authenticated identity
  get PROJECT:ITEM [--revision N]         Exact current/historical document
  search [QUERY] [--project RAW]          Exact Boolean browse (not retrieval)
    [--sort FIELD --direction asc|desc] [--limit 1..100] [--cursor CURSOR]
    [--all]                              Explicitly follow every page
  history PROJECT:ITEM                   Revision/audit history
  put PROJECT:ITEM --file FILE|-          Whole-document CAS (stdin: --file -)
    --expected-revision N [--request-id UUIDv7]
  edit PROJECT:ITEM --file FILE|-         Read head, replace document with CAS
  archive PROJECT:ITEM                   Read → set archived → CAS
  unarchive PROJECT:ITEM --status STATUS Explicit non-archived status → CAS
  attention PROJECT:ITEM required|cleared Read → set attention → CAS
  restore PROJECT:ITEM --revision N      Read head + old document → new CAS
  pending | replay | reconcile           Inspect / replay retained exact write
  retrieve QUERY [--mode lexical|semantic|hybrid] [--project RAW]
    [--include-archived] [--offset N] [--limit 1..100]
  analyze QUERY [--caret UTF16] | complete QUERY [--caret UTF16]
  values FIELD                           Bounded suggestions, not full facets
  watch [--duration-ms N] [--max-events N] Live changes, bounded/cancellable
  login LOGIN --password-file FILE|-     Independent password-session login
  logout | status | account              Cookie-session settings only
  token list                            Current account's tokens
  token issue --name NAME --secret-file NEW-FILE
  token revoke TOKEN-ID                  Issued tokens only; owner-bound
  token acknowledge                     Clear uncertain issue guard after review
  call OP --file FILE|-                  Validated current typed request (see docs)

Global options:
  --url ORIGIN          HAYSTACK_URL; required except help/version
  --auth token|session  Data default: token if configured, otherwise session
  --token-file FILE     HAYSTACK_TOKEN_FILE; conflicts with HAYSTACK_TOKEN
  --state-dir DIR       HAYSTACK_STATE_DIR; otherwise XDG_STATE_HOME/haystack-cli
  --allow-http          Explicit private/loopback cleartext opt-in (not TLS)
  --timeout-ms N        Per request, default 30000; max 600000
  --max-response-bytes N Default 33554432, max 67108864; never truncates
  --json | --help | --version

Session/account commands never read bearer credentials. No delete endpoint:
archive/attention/restore are whole-document CAS, not server-side patches.
All authenticated users can read and write all items; type is attribution only.
Uncertain writes retain exact bytes/CAS/UUIDv7 privately. No automatic retries
or fresh-ID recovery. reconcile is an explicit replay, not a guessed merge.
Token creation secrets go only to a new 0600 file; never stdout or argv.
Watch --json is NDJSON: one generated changed frame per line inside an event
wrapper. Default watch bound: 60000 ms / 1000 changed events. Ctrl-C cancels.

Examples:
  haystack health
  haystack search 'type:fact and importance:high' --limit 20
  haystack get corporate-activity:example --json
  haystack put project:item --file document.json --expected-revision 0
  haystack attention project:item required
  haystack pending --json; haystack replay
  haystack login alice --password-file /run/credentials/haystack-password
  haystack token issue --name worker --secret-file ./worker.token
`;
