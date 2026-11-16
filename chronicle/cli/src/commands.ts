import { CliError } from './errors.js';
import { decodeOperation } from './wire.js';
import type { Operation } from '../../generated/typescript/chronicle/api/Operation.js';
import type { Json, JsonObject } from './json.js';
const SWITCHES = new Set(['json', 'help', 'yes', 'allow-insecure-http', 'password-stdin', 'confirm-sharing', 'ascending', 'no-relevance']);
const VALUES = new Set(['url', 'timeout-ms', 'token-file', 'auth', 'request-id', 'secret-out', 'file', 'login', 'password-file', 'mode', 'project', 'branch', 'after', 'before', 'tag', 'limit', 'offset', 'revision', 'generation', 'cursor', 'sort', 'scope', 'collector', 'message', 'start', 'end', 'before-bytes', 'after-bytes', 'target-profile', 'selection-hash', 'name', 'scopes']);
export interface Arguments { readonly words: string[]; readonly options: ReadonlyMap<string, readonly string[]>; readonly json: boolean }
export function parseArgs(argv: readonly string[]): Arguments {
  const words: string[] = []; const options = new Map<string, string[]>(); let literal = false;
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i]!; if (arg === '--') { literal = true; continue; }
    if (arg === '-h') arg = '--help';
    if (!literal && arg.startsWith('-')) {
      if (!arg.startsWith('--')) throw new CliError('usage', 'Unknown option. Run chronicle --help.');
      const eq = arg.indexOf('='); const key = arg.slice(2, eq === -1 ? undefined : eq);
      if (!SWITCHES.has(key) && !VALUES.has(key)) throw new CliError('usage', 'Unknown option. Run chronicle --help.');
      if (options.has(key) && key !== 'tag') throw new CliError('usage', 'Duplicate option.');
      let value = 'true'; if (SWITCHES.has(key)) { if (eq !== -1) throw new CliError('usage', 'Boolean options do not take values.'); }
      else { if (eq !== -1) value = arg.slice(eq + 1); else { i++; if (i >= argv.length || argv[i]!.startsWith('--')) throw new CliError('usage', 'Option requires a value.'); value = argv[i]!; } if (value === '' && key !== 'cursor') throw new CliError('usage', 'Option requires a nonempty value.'); }
      options.set(key, [...(options.get(key) ?? []), value]);
    } else words.push(arg);
  }
  return { words, options, json: options.has('json') };
}
export function option(args: Arguments, key: string): string | null { return args.options.get(key)?.[0] ?? null; }
export function flag(args: Arguments, key: string): boolean { return args.options.has(key); }
export function integer(args: Arguments, key: string, fallback: number, minimum: number, maximum: number): number {
  const raw = option(args, key); if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) throw new CliError('usage', 'Expected a bounded nonnegative integer option.'); const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new CliError('usage', 'Numeric option outside the supported range.'); return value;
}
const GLOBAL = new Set(['json', 'help', 'yes', 'url', 'allow-insecure-http', 'timeout-ms', 'token-file', 'auth', 'request-id', 'secret-out']);
export function allow(args: Arguments, keys: readonly string[], count: number): void {
  if (args.words.length !== count) throw new CliError('usage', 'Incorrect command arguments. Run chronicle --help.');
  for (const key of args.options.keys()) if (!GLOBAL.has(key) && !keys.includes(key)) throw new CliError('usage', 'Option is not valid for this command.');
}
const PAGE = ['offset', 'limit']; const CURSOR = ['cursor', 'limit']; const VIEW = ['revision', 'generation']; const FILTER = ['project', 'branch', 'after', 'before', 'tag'];
export function makeOperation(args: Arguments): Operation {
  const [command, id, value] = args.words; const limit = integer(args, 'limit', command === 'archive' ? 10 : 20, 1, command === 'archive' ? 10 : 100); const offset = integer(args, 'offset', 0, 0, 2147483647);
  const cursor = option(args, 'cursor'); const view = (): Json => {
    const revision = option(args, 'revision'); const generationId = option(args, 'generation');
    if (revision === null) { if (generationId !== null) throw new CliError('usage', '--generation requires --revision.'); return null; }
    return { revision: integer(args, 'revision', 1, 1, 2147483647), generationId };
  };
  const pinnedView = (): Json => { const selected = view(); if (selected === null) throw new CliError('usage', 'This command requires --revision and optional --generation from the cited ContentView.'); return selected; };
  const filter: JsonObject = { project: option(args, 'project'), gitBranch: option(args, 'branch'), after: option(args, 'after'), before: option(args, 'before'), tags: [...(args.options.get('tag') ?? [])] };
  function op(name: string, body: JsonObject): Operation { return decodeOperation({ [name]: body }); }
  if (command === 'whoami') { allow(args, [], 1); return op('Whoami', {}); }
  if (command === 'search') { allow(args, ['mode', ...FILTER, ...PAGE], 2); const mode = option(args, 'mode') ?? 'lexical'; const modes: Record<string, string> = { lexical: 'Lexical', semantic: 'Semantic', hybrid: 'Hybrid' }; if (!Object.hasOwn(modes, mode)) throw new CliError('usage', '--mode is lexical, semantic or hybrid.'); return op('Search', { query: { query: id!, mode: modes[mode]!, filter, limit, offset } }); }
  if (command === 'archive') { allow(args, [...CURSOR, 'sort', 'ascending', 'no-relevance'], id === undefined ? 1 : 2); return op('ArchiveSearch', { query: { expression: id ?? '', sort: option(args, 'sort') ?? 'LastTimestamp', direction: flag(args, 'ascending') ? 'Asc' : 'Desc', cursor, limit, preferRelevance: !flag(args, 'no-relevance') } }); }
  if (command === 'session') { allow(args, VIEW, 2); return op('GetSession', { sessionId: id!, view: view() }); }
  if (command === 'messages' || command === 'chunks') { allow(args, [...VIEW, ...PAGE], 2); return op(command === 'messages' ? 'GetMessages' : 'GetChunks', { sessionId: id!, offset, limit, view: view() }); }
  if (command === 'passages' || command === 'passage-spans') { allow(args, [...VIEW, ...PAGE], command === 'passages' ? 2 : 3); return op(command === 'passages' ? 'GetPassages' : 'GetPassageSpans', { sessionId: id!, view: pinnedView(), offset, limit, ...(command === 'passage-spans' ? { passageId: value! } : {}) }); }
  if (command === 'find') { allow(args, [...VIEW, ...CURSOR], 3); return op('SearchSessionMessages', { sessionId: id!, view: pinnedView(), literal: value!, cursor, limit }); }
  if (command === 'locate') { allow(args, VIEW, 3); return op('LocateMessage', { sessionId: id!, view: pinnedView(), messageId: value! }); }
  if (command === 'context') { allow(args, [...VIEW, 'message', 'start', 'end', 'before-bytes', 'after-bytes'], 2); const messageId = option(args, 'message'); if (messageId === null || option(args, 'start') === null || option(args, 'end') === null) throw new CliError('usage', 'Context requires --message, --start, --end UTF-8 byte coordinates.'); const start = integer(args, 'start', 0, 0, 2147483647); const end = integer(args, 'end', 0, 0, 2147483647); if (end < start) throw new CliError('usage', 'Context end must not precede start.'); return op('ReadMessageContext', { sessionId: id!, view: pinnedView(), anchor: { messageId, start, end }, beforeBytes: integer(args, 'before-bytes', 2048, 0, 65536), afterBytes: integer(args, 'after-bytes', 2048, 0, 65536) }); }
  if (command === 'raw') { allow(args, ['revision'], 2); return op('GetRaw', { sessionId: id!, revision: option(args, 'revision') === null ? null : integer(args, 'revision', 1, 1, 2147483647) }); }
  if (command === 'related') { allow(args, ['limit'], 2); return op('Related', { sessionId: id!, limit }); }
  if (command === 'facets') { allow(args, FILTER, 1); return op('Facets', { filter }); }
  if (command === 'activity') { allow(args, [...CURSOR, 'sort', 'ascending'], id === undefined ? 1 : 2); return op('Activity', { query: { expression: id ?? '', sort: option(args, 'sort') ?? 'CollectorId', direction: flag(args, 'ascending') ? 'Asc' : 'Desc', cursor, limit } }); }
  if (command === 'jobs') {
    if (id === 'retry') { allow(args, [], 3); return op('RetryJob', { jobId: value! }); }
    allow(args, [...CURSOR, 'sort', 'ascending', 'scope', 'collector'], id === undefined ? 1 : 2); return op('ActivityJobs', { query: { collectorId: option(args, 'collector'), scope: option(args, 'scope') ?? 'Current', expression: id ?? '', sort: option(args, 'sort') ?? 'LastTimestamp', direction: flag(args, 'ascending') ? 'Asc' : 'Desc', cursor, limit } });
  }
  if (command === 'usage' || command === 'collectors' || command === 'progress') { allow(args, command === 'progress' ? PAGE : [], 1); return op(command === 'usage' ? 'ModelUsage' : command === 'collectors' ? 'CollectionStatus' : 'IngestStatus', command === 'progress' ? { offset, limit } : {}); }
  if (command === 'reindex' || command === 'retry-failed') {
    if (id === 'preview') { allow(args, [], 2); return op(command === 'reindex' ? 'PreviewOwnerReindex' : 'PreviewRetryFailed', {}); }
    if (id === 'apply') { allow(args, ['target-profile', 'selection-hash'], 2); const targetProfile = option(args, 'target-profile'); const selectionHash = option(args, 'selection-hash'); if (targetProfile === null || selectionHash === null) throw new CliError('usage', 'Apply requires exact --target-profile and --selection-hash from a reviewed preview.'); return op(command === 'reindex' ? 'ApplyOwnerReindex' : 'ApplyRetryFailed', { targetProfile, selectionHash, confirm: flag(args, 'yes') }); }
    if (id === 'status' && command === 'reindex') { allow(args, [], 3); return op('GetReindexStatus', { requestId: value! }); }
  }
  if (command === 'receipt') { allow(args, [], 2); return op('Receipt', { mutationId: id! }); }
  if (command === 'purge') { allow(args, [], 2); return op('Purge', { sessionId: id! }); }
  if (command === 'groups') {
    if (id === undefined || id === 'list') { allow(args, [], id === undefined ? 1 : 2); return op('ListGroups', {}); }
    if (id === 'create') { allow(args, [], 3); return op('CreateGroup', { name: value! }); }
    if (id === 'invite' || id === 'remove') { allow(args, [], 4); return op(id === 'invite' ? 'Invite' : 'RemoveMember', { groupId: value!, [id === 'invite' ? 'targetId' : 'userId']: args.words[3]! }); }
    if (id === 'accept') { allow(args, ['confirm-sharing'], 3); return op('AcceptInvite', { invitationId: value!, confirmSharing: flag(args, 'confirm-sharing') }); }
    if (id === 'leave' || id === 'delete') { allow(args, [], 3); return op(id === 'leave' ? 'LeaveGroup' : 'DeleteGroup', { groupId: value! }); }
  }
  throw new CliError('usage', 'Unknown command or subcommand. Run chronicle --help.');
}
export const HELP = `chronicle — Chronicle application client (API 1.9.0)

Usage: chronicle [global options] COMMAND [options]
Readable output is the default, including pipes. --json before/after any command
emits one JSON document on stdout; diagnostics go only to stderr.

Authentication (independent credentials; no automatic interchange):
  login --login NAME (--password-file PATH | --password-stdin)
  logout --yes                  Revoke this independent human session
  session-status | settings     Check cookie owner and account token metadata
  tokens list | mint --name NAME --scopes Read,Raw --secret-out PATH --yes
  tokens revoke TOKEN_UUID --yes
  --auth session                Default: private cookie + exact-Origin WS
  --auth bearer                 Ten read-only MCP tools only; never settings
  CHRONICLE_TOKEN or CHRONICLE_TOKEN_FILE; both nonempty is an error

Discovery and retrieval:
  versions                      Public supported protocol versions
  whoami                        Identity of selected credential family
  search 'TEXT' [--mode lexical|semantic|hybrid] [--limit N --offset N]
  archive ['EXPRESSION'] [--cursor CURSOR --limit N --sort LastTimestamp]
  session UUID                  Metadata, full source identity and ContentView
  messages UUID | chunks UUID   [--revision N --generation UUID --offset N]
  passages UUID | passage-spans UUID PASSAGE_UUID   --revision N [--generation UUID]
  find UUID 'LITERAL' --revision N [--generation UUID --cursor CURSOR]
  locate UUID MESSAGE_ID --revision N [--generation UUID]
  context UUID --revision N --message ID --start BYTE --end BYTE
      [--generation UUID --before-bytes N --after-bytes N]
  raw UUID [--revision N]        Raw JSONL fidelity as encoded data; no implicit extraction
  related UUID | facets         Facets/search filters: --project --branch --after --before --tag
  tags 'QUERY' [--cursor TAG]   Bearer MCP tag catalog; requires --auth bearer

Activity and management (session only except progress):
  activity ['EXPRESSION'] | jobs ['EXPRESSION'] [--cursor CURSOR --limit N]
  jobs retry JOB_UUID --yes
  usage | collectors | progress [--offset N --limit N]
  reindex preview | retry-failed preview
  reindex apply | retry-failed apply --target-profile P --selection-hash H --yes
  reindex status REQUEST_UUID
  groups [list] | create NAME | invite GROUP_UUID USER | accept INVITE_UUID --confirm-sharing
  groups remove GROUP_UUID USER | leave GROUP_UUID | delete GROUP_UUID
      All group changes require --yes; acceptance explicitly shares your archive.
  purge SESSION_UUID --yes       Irreversible; no automatic retries
  receipt REQUEST_UUID           Recover durable WS mutation metadata after uncertainty

Explicit ingestion (bearer Ingest scope; NEVER discovers local history):
  ingest --file PATH|- --yes     Current generated IngestRequest JSON; stable requestId
  report-progress --file PATH|- --yes    Current CollectorProgressUpdate JSON

Complete current API, including expression hints and MCP test runs:
  rpc help [OPERATION]           Local typed fields, enums and effect policy
  rpc --file PATH|-             One current generated Operation ADT, validated before I/O
      Mutations require --yes; MintToken also requires --secret-out (new private file).
      Hello/Ping/Pong are owned by the transport and cannot be called directly.

Global options:
  --url ORIGIN                  Or CHRONICLE_URL; exact HTTPS origin, no path/credentials/query
  --allow-insecure-http         Explicit trusted private-network HTTP opt-in (plaintext secrets!)
  --timeout-ms N                Whole command deadline, 100..900000 (default 30000)
  --request-id UUID             Deliberate WS receipt identity; never auto replayed
  --secret-out PATH             New 0600 file in a private 0700 directory, never stdout
  --json | --help                Lazy: help requires no credential file or network

Examples:
  chronicle --url https://archive.example login --login alice --password-file /private/password
  chronicle search 'deployment failure' --json
  chronicle messages 11111111-1111-4111-8111-111111111111 --revision 3 --offset 20
  chronicle --auth bearer tags 'postgres' --json
  chronicle rpc help StartMcpTest

Pages are explicit: pass returned nextCursor/offset; no hidden all-pages requests,
HEAD repinning, semantic fallback, credential redirects, reconnect or mutation retry.
Human text escapes terminal controls/bidi; --json preserves exact text as JSON strings.
i64 fields use generated decimal strings, never lossy JavaScript numbers.
State: CHRONICLE_STATE_DIR or \${XDG_STATE_HOME:-$HOME/.local/state}/chronicle-cli,
0700 directory / origin-bound 0600 files. No credentials on argv or URLs.
Exit: 0 success; 2 usage/invalid; 3 auth/credentials; 4 missing/gone/retired;
5 conflict; 6 transport/protocol/deadline/state/availability; 7 uncertain mutation.
`;
