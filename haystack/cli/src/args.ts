import {CliError,integer, TIMEOUT_MS, RESPONSE_BYTES, usage} from './core.ts';
import {commands,tokenActions,type CommandSpec} from './commands.ts';
export interface Arguments { readonly words: string[]; readonly flags: Map<string,string|boolean>; readonly json: boolean }
const switches = new Set(['json','help','version','allow-http','include-archived','all','stdin']);
const values = new Set(['color','url','auth','token-file','state-dir','timeout-ms','max-response-bytes','revision','expected-revision','request-id','file','project','limit','cursor','sort','direction','caret','mode','offset','duration-ms','max-events','password-file','name','secret-file','status']);
export function parse(args: string[], flags:Map<string,string|boolean>): Arguments {
  const words: string[] = []; let literal = false;let fault:CliError|undefined;
  for (let i=0;i<args.length;i++) {
    const arg=args[i]!;
    if (arg === '--' && !literal) { literal=true; continue; }
    try{
      if (arg.startsWith('-') && !literal) {
        const m=/^--([a-z-]+)(?:=(.*))?$/.exec(arg);
        if (!m || (!switches.has(m[1]!) && !values.has(m[1]!))) usage('unknown option; see --help');
        const name=m[1]!; if(flags.has(name)) usage(`--${name} may not be repeated`);
        if(switches.has(name)) {if(m[2]!==undefined) usage(`--${name} does not take a value`);flags.set(name,true);}
        else {const value=m[2]===undefined?args[i+1]:m[2];if(value===undefined||value.startsWith('--'))usage(`--${name} requires a value`);if(m[2]===undefined)i++;flags.set(name,value);}
      } else words.push(arg);
    }catch(error){
      if(!(error instanceof CliError))throw error;
      // Recognise later output controls, but never execute arguments with a retained parse fault.
      if(fault===undefined)fault=error;
    }
  }
  if(fault!==undefined)throw fault;
  const color=flags.get('color');if(color!==undefined&&color!=='auto'&&color!=='always'&&color!=='never')usage('--color must be auto, always or never');
  return {words,flags,json:flags.has('json')};
}
export function text(args: Arguments, name: string): string|undefined { const value=args.flags.get(name); return typeof value==='string'?value:undefined; }
export function required(args: Arguments, name: string): string { const value=text(args,name); if(value===undefined || value==='') usage(`--${name} is required`); return value; }
export function number(args: Arguments, name: string, fallback: number, min: number, max: number): number {const value=text(args,name);return value===undefined?fallback:integer(value,min,max,name);}
export function fileOption(args:Arguments):string {const file=text(args,'file');if(file!==undefined&&args.flags.has('stdin'))usage('choose --file or --stdin, not both');return args.flags.has('stdin')?'-':required(args,'file');}
const common = ['json','help','color','url','auth','token-file','state-dir','allow-http','timeout-ms','max-response-bytes'];
interface CommandSelection {readonly command:string;readonly name:string;readonly spec:CommandSpec}
function select(words:readonly string[],actionRequired:boolean):CommandSelection {
  const command=words[0];if(command===undefined||!Object.hasOwn(commands,command))usage('choose a command; see haystack --help');
  if(command==='token'){
    const action=words[1];if(action===undefined&&!actionRequired)return {command,name:command,spec:commands.token!};
    if(action===undefined||!Object.hasOwn(tokenActions,action))usage('choose token list, issue, revoke or acknowledge; see haystack token --help');
    return {command,name:'token '+action,spec:tokenActions[action]!};
  }
  return {command,name:command,spec:commands[command]!};
}
export function helpHint(args:Arguments|undefined):string {
  if(args===undefined)return 'haystack --help';
  const command=args.words[0];if(command===undefined||!Object.hasOwn(commands,command))return 'haystack --help';
  const action=args.words[1];return 'haystack '+command+(command==='token'&&action!==undefined&&Object.hasOwn(tokenActions,action)?' '+action:'')+' --help';
}
export function help(args:Arguments):string {
  const topic=args.words[0]==='help'?args.words.slice(1):args.words;
  if(topic.length===0)return HELP;
  if(args.words[0]==='help'&&topic.length>(topic[0]==='token'?2:1))usage('use help [COMMAND [ACTION]]; see haystack --help');
  const selection=select(topic,false);const spec=selection.spec;
  return `Haystack ${selection.name} — ${spec.summary}\nUsage: haystack ${spec.usage}\n\n${spec.notes}\n\n${GLOBAL_HELP}\nExamples:\n${spec.examples.map(example=>'  '+example).join('\n')}\n`;
}
export function validate(args: Arguments): string {
  const {command,name,spec}=select(args.words,true);
  const allowed=new Set([...common,...spec.options]);for(const flag of args.flags.keys())if(!allowed.has(flag))usage(`--${flag} is not valid for ${name}; see haystack ${name} --help`);
  const count=args.words.length-1;if(count<spec.arity[0]||count>spec.arity[1])usage(`incorrect ${name} arguments; usage: haystack ${spec.usage}`);
  if(spec.requiredOptions!==undefined)for(const option of spec.requiredOptions)required(args,option);
  if(spec.inputSource===true)fileOption(args);
  number(args,'timeout-ms',TIMEOUT_MS,10,600_000);number(args,'max-response-bytes',RESPONSE_BYTES,1024,64*1024*1024);
  const auth=text(args,'auth');if(auth!==undefined&&auth!=='token'&&auth!=='session')usage('--auth must be token or session');
  return command;
}
const GLOBAL_HELP=`Global options (before or after commands):
  --url ORIGIN          HAYSTACK_URL; required except help/version
  --auth token|session  Data default: token if configured, otherwise session
  --token-file FILE     HAYSTACK_TOKEN_FILE; conflicts with HAYSTACK_TOKEN
  --state-dir DIR       HAYSTACK_STATE_DIR; otherwise XDG_STATE_HOME/haystack-cli
  --allow-http          Explicit private/loopback cleartext opt-in (not TLS)
  --timeout-ms N        Per request, default 30000; max 600000
  --max-response-bytes N Default 33554432, max 67108864; never truncates
  --color auto|always|never  Auto: human TTY only; honours NO_COLOR / TERM=dumb
  --json                Machine output; never ANSI. Watch emits NDJSON.
  --help                Command-specific help; no credentials/state/network
  --version             Client version (without a command)
`;
export const HELP=`Haystack — shared versioned knowledge, application CLI
Usage: haystack [global options] COMMAND [options]
Human-readable output is the default, including pipes. --json works before or
after any command. IDs, revisions, request IDs and cursors are never shortened.
Use haystack COMMAND --help or haystack help COMMAND for focused help.

Commands:
  help [COMMAND [ACTION]]                Offline command/action help
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

${GLOBAL_HELP}
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
