#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { CliError, embeddingFailure, uncertain } from './errors.js';
import { ArgumentError, flag, searchMode, integer, makeOperation, option, parseArgs, validateInvocation, type Arguments } from './commands.js';
import { help, helpHint } from './help.js';
import { bearer, checkSecretDestination, exclusiveSecret, MAX_BYTES, readBounded, readStdin, SessionStore, type Environment } from './files.js';
import { Presentation, useColor } from './output.js';
import { isObject, parseJson, type JsonObject } from './json.js';
import { decodeOperation, decodeWire, encodeWire, operationHelp, operationName, operationNames, operationPolicy, schema, uuid, sameUuid, validateResponse } from './wire.js';
import { Deadline, Http, origin, websocket } from './transport.js';
import { accountAcknowledgement, accountIssued, login, settings } from './account.js';
import { mcp, operationTool } from './mcp.js';
async function input(args: Arguments, deadline: Deadline): Promise<string> {
  const file = option(args, 'file'); if (file === null) throw new CliError('usage', 'An explicit --file PATH or --file - is required.');
  if (file !== '-') return readBounded(file, MAX_BYTES, 'input');
  return timedStdin(MAX_BYTES, deadline);
}
interface IngestionInput { readonly document: JsonObject; readonly body: unknown }
async function ingestionInput(command: 'ingest' | 'report-progress', args: Arguments, deadline: Deadline): Promise<IngestionInput> {
  const data = parseJson(await input(args, deadline));
  const body = command === 'ingest' ? encodeWire('IngestRequest', decodeWire('IngestRequest', data)) : encodeWire('CollectorProgressUpdate', decodeWire('CollectorProgressUpdate', data));
  return { document: data as JsonObject, body };
}
async function timedStdin(maximum: number, deadline: Deadline): Promise<string> {
  let timer: NodeJS.Timeout | null = null;
  try { return await Promise.race([readStdin(maximum), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { process.stdin.destroy(); reject(new CliError('deadline', 'Stdin deadline exceeded.')); }, deadline.remaining()); })]); }
  finally { if (timer !== null) clearTimeout(timer); }
}
function confirm(args: Arguments): void { if (!flag(args, 'yes')) throw new CliError('usage', 'Mutation requires explicit --yes after reviewing its exact target and effect.'); }
type Support = 'public' | 'session' | 'bearer' | 'either';
function family(args: Arguments, env: Environment, support: Support): 'session' | 'bearer' {
  const selected = option(args, 'auth') ?? 'auto'; if (selected !== 'auto' && selected !== 'session' && selected !== 'bearer') throw new CliError('usage', '--auth must be auto, session or bearer.');
  if (support === 'public' && option(args, 'auth') !== null) throw new CliError('usage', '--auth is not used by public versions.');
  if (support === 'session' && selected === 'bearer') throw new CliError('usage', 'This operation requires the independent human session; bearer authentication is not supported.');
  if (support === 'bearer' && selected === 'session') throw new CliError('usage', 'This operation requires bearer authentication, not a human session.');
  const configured = (env['CHRONICLE_TOKEN'] ?? '') !== '' || (env['CHRONICLE_TOKEN_FILE'] ?? '') !== '' || option(args, 'token-file') !== null;
  const auth = selected === 'auto' ? support === 'bearer' || (support === 'either' && configured) ? 'bearer' : 'session' : selected;
  if (auth !== 'bearer' && option(args, 'token-file') !== null) throw new CliError('usage', '--token-file requires a bearer operation, not a human session or public command.');
  return auth;
}
function checkBearerSources(args: Arguments, env: Environment, auth: 'session' | 'bearer'): void {
  if (auth !== 'bearer') return;
  const token = env['CHRONICLE_TOKEN'] ?? ''; const file = env['CHRONICLE_TOKEN_FILE'] ?? ''; const explicit = option(args, 'token-file');
  if ((token !== '' && (file !== '' || explicit !== null)) || (file !== '' && explicit !== null)) throw new CliError('credentials', 'Ambiguous bearer credentials; select exactly one source.');
}
function executionOptions(args: Arguments, mutation: boolean, secret: boolean, ws: boolean): void {
  for (const [key, consumed] of [['yes', mutation], ['secret-out', secret], ['request-id', ws]] as const) if (option(args, key) !== null && !consumed) throw new CliError('usage', `--${key} is not used by this command or selected authentication family.`);
  if (option(args, 'request-id') !== null) uuid(option(args, 'request-id')!);
}
function mintScopes(args: Arguments): string[] {
  const scopes = option(args, 'scopes'); if (option(args, 'name') === null || scopes === null) throw new CliError('usage', 'Mint requires --name, --scopes and --secret-out.');
  const requested = scopes.split(','); if (new Set(requested).size !== requested.length || requested.some(s => !['Ingest', 'Read', 'Raw'].includes(s)) || (requested.includes('Raw') && !requested.includes('Read'))) throw new CliError('usage', 'Scopes are distinct Ingest,Read,Raw; Raw requires Read.');
  return requested;
}
async function current(http: Http): Promise<unknown> {
  const reply = await http.request('/api/versions', 'GET', null, null, false); const versions = decodeWire('VersionInfo', reply.data);
  if (versions.current !== schema.version || versions.minimum !== schema.version || versions.supported.length !== 1 || versions.supported[0] !== schema.version) throw new CliError('version-mismatch', 'Server does not advertise the sole current API 1.9.0.'); return encodeWire('VersionInfo', versions);
}
function withoutSecret(value: unknown, args: Arguments): unknown {
  const secretOut = option(args, 'secret-out');
  // Both generated WS and independent account results keep the one-time secret
  // separate from ordinary presentation. The only destination is an exclusive file.
  if (isObject(value) && isObject(value['Token']) && isObject(value['Token']['result'])) {
    const result = value['Token']['result']; const secret = result['secret']; if (secret !== null && typeof secret !== 'string') throw new CliError('protocol-error', 'Invalid issued token secret.');
    if (typeof secret === 'string') { if (secretOut === null) throw new CliError('state', 'Missing explicit private secret destination.'); if (!/^[A-Za-z0-9_+/.=-]{43,1024}$/.test(secret)) throw new CliError('protocol-error', 'Invalid issued token credential.'); exclusiveSecret(secretOut, `${secret}\n`); }
    return { Token: { result: { ...result, secret: null }, secretSaved: typeof secret === 'string' } };
  }
  if (isObject(value) && Object.hasOwn(value, 'secret')) { if (typeof value['secret'] !== 'string' || secretOut === null) throw new CliError('protocol-error', 'Invalid issued account secret.'); exclusiveSecret(secretOut, `${value['secret']}\n`); return { token: value['token'], secretSaved: true }; }
  return value;
}
export interface RunResult { value: unknown; text: boolean; mode?: string }
// Only a defaulted hybrid search falls back (to exactly `--mode lexical`); the retry gets its own --timeout-ms budget. Explicit modes and every other failure propagate.
// The fallback notice is emitted before the retry runs, so it is shown whether the retry succeeds or fails. A search result carries its effective mode.
export async function run(args: Arguments, env: Environment, notify: (line: string) => Promise<void> = async () => {}): Promise<RunResult> {
  const isSearch = args.words[0] === 'search' && args.words.length === 2 && !flag(args, 'help');
  try { const result = await runOnce(args, env); return isSearch ? { ...result, mode: searchMode(args) } : result; }
  catch (error) {
    const reason = isSearch && option(args, 'mode') === null ? embeddingFailure(error) : null;
    if (reason === null) throw error;
    const lexical: Arguments = { ...args, options: new Map(args.options).set('mode', ['lexical']) };
    await notify(`chronicle: hybrid search unavailable (${reason}); showing lexical results\n`);
    return { ...await runOnce(lexical, env), mode: 'lexical' };
  }
}
async function runOnce(args: Arguments, env: Environment): Promise<RunResult> {
  const [command, subcommand] = args.words;
  if (flag(args, 'help') || command === undefined || command === 'help') {
    const text = help(command === 'help' ? args.words.slice(1) : args.words, command === 'help'); if (text === '') throw new CliError('usage', 'Unknown help command. Run chronicle --help.');
    return args.json ? { value: { help: text }, text: false } : { value: text, text: true };
  }
  const spec = validateInvocation(args);
  if (['rpc', 'call', 'ingest', 'report-progress'].includes(command) && subcommand !== 'help' && option(args, 'file') === null) throw new CliError('usage', 'An explicit --file PATH or --file - is required.');
  if ((command === 'rpc' || command === 'call') && subcommand === 'help') return { value: args.words[2] === undefined ? { version: schema.version, operations: operationNames.map(name => ({ name, effect: operationPolicy[name as keyof typeof operationPolicy] })) } : operationHelp(args.words[2]), text: false };
  const deadline = new Deadline(integer(args, 'timeout-ms', 30000, 100, 900000));
  const operation = spec.kind === 'operation' ? makeOperation(args) : command === 'rpc' || command === 'call' ? decodeOperation(parseJson(await input(args, deadline))) : null;
  const name = operation === null ? null : operationName(operation); const effect = name === null ? null : operationPolicy[name];
  if (effect === 'control') throw new CliError('usage', 'Hello/Ping/Pong are transport-owned controls.');
  const tool = operation === null ? null : operationTool(operation);
  const support: Support = command === 'versions' ? 'public' : command === 'ingest' || command === 'report-progress' || command === 'tags' ? 'bearer' : tool === null ? 'session' : 'either';
  const auth = family(args, env, support);
  const mutation = effect === 'mutation' || effect === 'secret' || command === 'logout' || command === 'ingest' || command === 'report-progress' || (command === 'tokens' && (subcommand === 'mint' || subcommand === 'revoke'));
  const secret = effect === 'secret' || (command === 'tokens' && subcommand === 'mint');
  executionOptions(args, mutation, secret, operation !== null && auth === 'session');
  if (mutation) confirm(args);
  if (secret && option(args, 'secret-out') === null) throw new CliError('usage', 'Mint requires --secret-out to a new private file; secrets are never printed.');
  if (command === 'login' && (option(args, 'login') === null || ((option(args, 'password-file') === null) === !flag(args, 'password-stdin')))) throw new CliError('usage', 'Login requires --login and exactly one --password-file/--password-stdin.');
  if (command === 'tokens' && subcommand === 'revoke') uuid(args.words[2]!);
  const requestedScopes = command === 'tokens' && subcommand === 'mint' ? mintScopes(args) : null;
  if (command === 'tags') integer(args, 'limit', 20, 1, 100);
  checkBearerSources(args, env, auth);
  const ingestion = command === 'ingest' || command === 'report-progress' ? await ingestionInput(command, args, deadline) : null;
  const endpoint = origin(option(args, 'url') ?? env['CHRONICLE_URL'] ?? null, flag(args, 'allow-insecure-http')); const http = new Http(endpoint, deadline);
  const store = () => new SessionStore(env, endpoint);
  if (command === 'versions') return { value: await current(http), text: false };
  if (command === 'login') {
    const name = option(args, 'login')!; const passwordFile = option(args, 'password-file');
    const password = (passwordFile === null ? await timedStdin(4096, deadline) : readBounded(passwordFile, 4096, 'credential')).replace(/\r?\n$/, '');
    if (password.length === 0 || password.length > 1024 || /[\r\n\0]/.test(password)) throw new CliError('credentials', 'Password input must contain one nonempty line of at most 1024 characters.');
    return { value: await login(http, store(), name, password), text: false };
  }
  if (command === 'settings' || command === 'session-status' || command === 'logout' || command === 'tokens') {
    if (command === 'logout') { const state = store(); const session = state.load(); const reply = await http.request('/api/account/v1/logout', 'POST', {}, { session, actor: true }, true); accountAcknowledgement(reply.data); state.remove(session); return { value: { loggedOut: true }, text: false }; }
    if (command !== 'tokens' || subcommand === 'list') return { value: await settings(http, store().load()), text: false };
    if (subcommand === 'mint') {
      checkSecretDestination(option(args, 'secret-out')!); const session = store().load(); await settings(http, session); const reply = await http.request('/api/account/v1/tokens', 'POST', { name: option(args, 'name')!, scopes: requestedScopes! }, { session, actor: true }, true);
      try { accountIssued(reply.data); return { value: withoutSecret(reply.data, args), text: false }; } catch { throw uncertain(null); }
    }
    if (subcommand === 'revoke') { const session = store().load(); await settings(http, session); const reply = await http.request(`/api/account/v1/tokens/${uuid(args.words[2]!)}/revoke`, 'POST', {}, { session, actor: true }, true); return { value: accountAcknowledgement(reply.data), text: false }; }
    throw new CliError('usage', 'Tokens requires list, mint or revoke.');
  }
  if (command === 'ingest' || command === 'report-progress') {
    if (ingestion === null) throw new CliError('protocol-error', 'Missing prepared ingestion input.');
    const { document: data, body } = ingestion;
    const token = bearer(env, option(args, 'token-file')); await current(http);
    const unknownOutcome = (): CliError => new CliError('uncertain', command === 'ingest'
      ? `Ingestion acknowledgement lost. Preserve requestId=${data['requestId']} and its exact payload/CAS revision; inspect progress before deliberately resending that identical request. No automatic retry occurred.`
      : `Collector progress acknowledgement lost. Preserve runId=${data['runId']} and sequence=${data['sequence']}; inspect collectors before deliberately resending the exact report.`);
    let reply: import('./transport.js').HttpReply;
    try { reply = await http.request(command === 'ingest' ? '/api/ingest' : '/api/collector/progress', 'POST', body, { token }, true); }
    catch (error) { if (error instanceof CliError && error.code === 'uncertain') throw unknownOutcome(); throw error; }
    try {
      if (command === 'ingest') { const receipt = decodeWire('IngestReceipt', reply.data); if (!isObject(body) || !sameUuid(body['requestId'], receipt.requestId)) throw new Error(); return { value: encodeWire('IngestReceipt', receipt), text: false }; }
      const ack = decodeWire('CollectorProgressAck', reply.data); if (!isObject(body) || String(ack.sequence) !== body['sequence']) throw new Error(); return { value: encodeWire('CollectorProgressAck', ack), text: false };
    } catch { throw unknownOutcome(); }
  }
  if (command === 'tags') {

    const arguments_: import('./json.js').JsonObject = { query: subcommand!, limit: integer(args, 'limit', 20, 1, 100) };
    for (const [key, field] of [['cursor', 'afterTag'], ['project', 'project'], ['branch', 'gitBranch'], ['after', 'after'], ['before', 'before']]) { const value = option(args, key!); if (value !== null) arguments_[field!] = value; }
    const tags = args.options.get('tag'); if (tags !== undefined) arguments_['tags'] = [...tags];
    const token = bearer(env, option(args, 'token-file')); await current(http); return { value: encodeWire('Result', await mcp(http, token, { name: 'search_tags', arguments: arguments_ })), text: false };
  }
  if (operation === null) throw new CliError('usage', 'Unknown command or subcommand. Run chronicle --help.');
  if (effect === 'secret') checkSecretDestination(option(args, 'secret-out')!);
  if (auth === 'bearer') { if (tool === null) throw new CliError('usage', 'This operation requires the independent human session.'); const token = bearer(env, option(args, 'token-file')); await current(http); const result = await mcp(http, token, tool); validateResponse(operation, result, null); return { value: encodeWire('Result', result), text: false }; }
  const requestId = option(args, 'request-id') === null ? randomUUID() : uuid(option(args, 'request-id')!);
  const sessionStore = store(); const session = sessionStore.load();
  const result = await websocket(endpoint, session, operation, requestId, effect !== 'read', deadline);
  try { const value = withoutSecret(encodeWire('Result', result), args); if (name === 'Logout') sessionStore.remove(session); return { value, text: false }; }
  catch (error) { if (effect === 'secret') throw uncertain(requestId); throw error; }
}
/** Output is written in pieces, cut between code points, so a large answer is not encoded into one more buffer of its size. */
const WRITE_PIECE = 1024 * 1024;
async function write(stream: NodeJS.WriteStream, text: string): Promise<void> {
  for (let at = 0; at < text.length;) {
    let end = Math.min(at + WRITE_PIECE, text.length); const last = text.charCodeAt(end - 1); if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    const piece = text.slice(at, end); at = end;
    await new Promise<void>((resolve, reject) => { stream.write(piece, error => error === null || error === undefined ? resolve() : reject(error)); });
  }
}
async function main(): Promise<number> {
  let args: Arguments | null = null;
  try { args = parseArgs(process.argv.slice(2)); const result = await run(args, process.env, line => write(process.stderr, line)); const presentation = new Presentation(useColor(args.color, args.json, process.stdout.isTTY === true, process.env)); const modeLine = result.mode === undefined || args.json ? '' : `${presentation.style('muted', `mode: ${result.mode}`)}\n`; await write(process.stdout, modeLine + (result.text ? presentation.help(String(result.value)) : presentation.output(result.value, args.json))); return 0; }
  catch (error) {
    const failure = error instanceof CliError ? error : new CliError('unavailable', 'Operation failed; no credential or remote diagnostic was printed.');
    if (error instanceof ArgumentError) args = error.arguments_;
    const presentation = new Presentation(useColor(args === null ? 'auto' : args.color, args !== null && args.json, process.stderr.isTTY === true, process.env));
    const hint = failure.code === 'usage' || failure.code === 'invalid' ? helpHint(args === null ? [] : args.words) : '';
    await write(process.stderr, presentation.failure(failure, hint)); return failure.exitCode;
  }
}
// Exit only after stream callbacks: this also bounds native WS close-handshake waits.
if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) void main().then(code => process.exit(code));
