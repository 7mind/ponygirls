import { CliError } from './errors.js';
import { decodeOperation } from './wire.js';
import type { Operation } from '../../generated/typescript/chronicle/api/Operation.js';
import type { Json, JsonObject } from './json.js';
import { commandSpec, usage, type CommandSpec } from './help.js';
import type { ColorMode } from './output.js';
const SWITCHES = new Set(['json', 'help', 'yes', 'allow-insecure-http', 'password-stdin', 'confirm-sharing', 'ascending', 'no-relevance']);
const VALUES = new Set(['color', 'url', 'timeout-ms', 'token-file', 'auth', 'request-id', 'secret-out', 'file', 'login', 'password-file', 'mode', 'project', 'branch', 'after', 'before', 'tag', 'limit', 'offset', 'revision', 'generation', 'cursor', 'sort', 'scope', 'collector', 'message', 'start', 'end', 'before-bytes', 'after-bytes', 'target-profile', 'selection-hash', 'name', 'scopes', 'output']);
const DEFAULT_SEARCH_MODE = 'hybrid';
export function searchMode(args: Arguments): string { return option(args, 'mode') ?? DEFAULT_SEARCH_MODE; }
export interface Arguments { readonly words: string[]; readonly options: ReadonlyMap<string, readonly string[]>; readonly json: boolean; readonly color: ColorMode }
export class ArgumentError extends CliError { constructor(message: string, readonly arguments_: Arguments) { super('usage', message); } }
export function parseArgs(argv: readonly string[]): Arguments {
  const words: string[] = []; const options = new Map<string, string[]>(); let literal = false; let failure: string | null = null;
  const fail = (message: string): void => { if (failure === null) failure = message; };
  // Finish scanning known options after a syntax error so --json/--color also govern diagnostics.
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i]!; if (!literal && arg === '--') { literal = true; continue; }
    if (!literal && arg === '-h') arg = '--help';
    if (!literal && arg.startsWith('-')) {
      if (!arg.startsWith('--')) { fail('Unknown option. Run chronicle --help.'); continue; }
      const eq = arg.indexOf('='); const key = arg.slice(2, eq === -1 ? undefined : eq);
      if (!SWITCHES.has(key) && !VALUES.has(key)) { fail('Unknown option. Run chronicle --help.'); continue; }
      if (options.has(key) && key !== 'tag') fail(`--${key} may only be supplied once.`);
      let value = 'true'; if (SWITCHES.has(key)) { if (eq !== -1) fail(`--${key} is a switch and does not take a value.`); }
      else {
        if (eq !== -1) value = arg.slice(eq + 1);
        else { if (i + 1 >= argv.length || argv[i + 1]!.startsWith('--')) { fail(`--${key} requires a value.`); continue; } value = argv[++i]!; }
        if (value === '' && key !== 'cursor') fail(`--${key} requires a nonempty value.`);
      }
      options.set(key, [...(options.get(key) ?? []), value]);
    } else words.push(arg);
  }
  const rawColor = options.get('color')?.[0] ?? 'auto'; let color: ColorMode = 'auto';
  if (rawColor === 'auto' || rawColor === 'always' || rawColor === 'never') color = rawColor; else fail('--color must be auto, always or never.');
  const result = { words, options, json: options.has('json'), color };
  if (failure !== null) throw new ArgumentError(failure, result);
  return result;
}
export function option(args: Arguments, key: string): string | null { return args.options.get(key)?.[0] ?? null; }
export function flag(args: Arguments, key: string): boolean { return args.options.has(key); }
export function integer(args: Arguments, key: string, fallback: number, minimum: number, maximum: number): number {
  const raw = option(args, key); if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) throw new CliError('usage', `--${key} must be an integer in ${minimum}..${maximum}.`); const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new CliError('usage', `--${key} must be an integer in ${minimum}..${maximum}.`); return value;
}
const GLOBAL = new Set(['json', 'help', 'color', 'yes', 'url', 'allow-insecure-http', 'timeout-ms', 'token-file', 'auth', 'request-id', 'secret-out']);
export function allow(args: Arguments, keys: readonly string[], count: number): void {
  if (args.words.length !== count) throw new CliError('usage', `Incorrect command arguments.\n${usage(args.words)}`);
  for (const key of args.options.keys()) if (!GLOBAL.has(key) && !keys.includes(key)) throw new CliError('usage', `--${key} is not valid for this command.`);
}
export function validateInvocation(args: Arguments): CommandSpec {
  const spec = commandSpec(args.words); if (spec === null) throw new CliError('usage', 'Unknown command. Run chronicle --help.');
  if (spec.kind === 'group') throw new CliError('usage', `A valid subcommand is required.\n${usage(args.words)}`);
  if (args.words.length < spec.minimum || args.words.length > spec.maximum) throw new CliError('usage', `Incorrect command arguments.\n${usage(args.words)}`);
  allow(args, spec.options, args.words.length); return spec;
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
  if (command === 'search') { allow(args, ['mode', ...FILTER, ...PAGE], 2); const mode = searchMode(args); const modes: Record<string, string> = { lexical: 'Lexical', semantic: 'Semantic', hybrid: 'Hybrid' }; if (!Object.hasOwn(modes, mode)) throw new CliError('usage', '--mode is lexical, semantic or hybrid.'); return op('Search', { query: { query: id!, mode: modes[mode]!, filter, limit, offset } }); }
  if (command === 'archive') { allow(args, [...CURSOR, 'sort', 'ascending', 'no-relevance'], id === undefined ? 1 : 2); return op('ArchiveSearch', { query: { expression: id ?? '', sort: option(args, 'sort') ?? 'LastTimestamp', direction: flag(args, 'ascending') ? 'Asc' : 'Desc', cursor, limit, preferRelevance: !flag(args, 'no-relevance') } }); }
  if (command === 'session') { allow(args, VIEW, 2); return op('GetSession', { sessionId: id!, view: view() }); }
  if (command === 'messages' || command === 'chunks') { allow(args, [...VIEW, ...PAGE], 2); return op(command === 'messages' ? 'GetMessages' : 'GetChunks', { sessionId: id!, offset, limit, view: view() }); }
  if (command === 'passages' || command === 'passage-spans') { allow(args, [...VIEW, ...PAGE], command === 'passages' ? 2 : 3); return op(command === 'passages' ? 'GetPassages' : 'GetPassageSpans', { sessionId: id!, view: pinnedView(), offset, limit, ...(command === 'passage-spans' ? { passageId: value! } : {}) }); }
  if (command === 'find') { allow(args, [...VIEW, ...CURSOR], 3); return op('SearchSessionMessages', { sessionId: id!, view: pinnedView(), literal: value!, cursor, limit }); }
  if (command === 'locate') { allow(args, VIEW, 3); return op('LocateMessage', { sessionId: id!, view: pinnedView(), messageId: value! }); }
  if (command === 'context') { allow(args, [...VIEW, 'message', 'start', 'end', 'before-bytes', 'after-bytes'], 2); const messageId = option(args, 'message'); if (messageId === null || option(args, 'start') === null || option(args, 'end') === null) throw new CliError('usage', 'Context requires --message, --start, --end UTF-8 byte coordinates.'); const start = integer(args, 'start', 0, 0, 2147483647); const end = integer(args, 'end', 0, 0, 2147483647); if (end < start) throw new CliError('usage', 'Context end must not precede start.'); return op('ReadMessageContext', { sessionId: id!, view: pinnedView(), anchor: { messageId, start, end }, beforeBytes: integer(args, 'before-bytes', 2048, 0, 65536), afterBytes: integer(args, 'after-bytes', 2048, 0, 65536) }); }
  if (command === 'raw') { allow(args, ['revision', 'file'], 2); if (option(args, 'file') !== null) throw new CliError('usage', '--file selects the file of a download and requires --output PATH|-.'); return op('GetRaw', { sessionId: id!, revision: option(args, 'revision') === null ? null : integer(args, 'revision', 1, 1, 2147483647) }); }
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
