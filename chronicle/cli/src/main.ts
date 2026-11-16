#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { CliError, uncertain } from './errors.js';
import { allow, flag, HELP, integer, makeOperation, option, parseArgs, type Arguments } from './commands.js';
import { bearer, checkSecretDestination, exclusiveSecret, MAX_BYTES, readBounded, readStdin, SessionStore, type Environment } from './files.js';
import { output } from './output.js';
import { isObject, parseJson } from './json.js';
import { decodeOperation, decodeWire, encodeWire, operationHelp, operationName, operationNames, operationPolicy, schema, uuid, sameUuid, validateResponse } from './wire.js';
import { Deadline, Http, origin, websocket } from './transport.js';
import { accountAcknowledgement, accountIssued, login, settings } from './account.js';
import { mcp, operationTool } from './mcp.js';
async function input(args: Arguments, deadline: Deadline): Promise<string> {
  const file = option(args, 'file'); if (file === null) throw new CliError('usage', 'An explicit --file PATH or --file - is required.');
  if (file !== '-') return readBounded(file, MAX_BYTES, 'input');
  return timedStdin(MAX_BYTES, deadline);
}
async function timedStdin(maximum: number, deadline: Deadline): Promise<string> {
  let timer: NodeJS.Timeout | null = null;
  try { return await Promise.race([readStdin(maximum), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { process.stdin.destroy(); reject(new CliError('deadline', 'Stdin deadline exceeded.')); }, deadline.remaining()); })]); }
  finally { if (timer !== null) clearTimeout(timer); }
}
function confirm(args: Arguments): void { if (!flag(args, 'yes')) throw new CliError('usage', 'Mutation requires explicit --yes after reviewing its exact target and effect.'); }
function family(args: Arguments): 'session' | 'bearer' { const selected = option(args, 'auth') ?? 'session'; if (selected !== 'session' && selected !== 'bearer') throw new CliError('usage', '--auth must be session or bearer.'); return selected; }
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
export async function run(args: Arguments, env: Environment): Promise<{ value: unknown; text: boolean }> {
  const [command, subcommand] = args.words;
  if (flag(args, 'help') || command === undefined || command === 'help') return args.json ? { value: { help: HELP }, text: false } : { value: HELP, text: true };
  if ((command === 'rpc' || command === 'call') && subcommand === 'help') { allow(args, [], args.words.length === 3 ? 3 : 2); return { value: args.words[2] === undefined ? { version: schema.version, operations: operationNames.map(name => ({ name, effect: operationPolicy[name as keyof typeof operationPolicy] })) } : operationHelp(args.words[2]), text: false }; }
  const deadline = new Deadline(integer(args, 'timeout-ms', 30000, 100, 900000)); const auth = family(args);
  // Selected-family ambiguity is rejected before opening credentials or contacting any endpoint.
  if (auth === 'bearer' || command === 'ingest' || command === 'report-progress') {
    const token = env['CHRONICLE_TOKEN'] ?? ''; const file = env['CHRONICLE_TOKEN_FILE'] ?? ''; const explicit = option(args, 'token-file');
    if ((token !== '' && (file !== '' || explicit !== null)) || (file !== '' && explicit !== null)) throw new CliError('credentials', 'Ambiguous bearer credentials; select exactly one source.');
  } else if (option(args, 'token-file') !== null) throw new CliError('usage', '--token-file requires a bearer operation, not a human session.');
  const endpoint = origin(option(args, 'url') ?? env['CHRONICLE_URL'] ?? null, flag(args, 'allow-insecure-http')); const http = new Http(endpoint, deadline);
  const store = () => new SessionStore(env, endpoint);
  if (command === 'versions') { allow(args, [], 1); return { value: await current(http), text: false }; }
  if (command === 'login') {
    allow(args, ['login', 'password-file', 'password-stdin'], 1); if (auth !== 'session') throw new CliError('usage', 'Login requires the independent human-session family.');
    const name = option(args, 'login'); const passwordFile = option(args, 'password-file');
    if (name === null || ((passwordFile === null) === !flag(args, 'password-stdin'))) throw new CliError('usage', 'Login requires --login and exactly one --password-file/--password-stdin.');
    const password = (passwordFile === null ? await timedStdin(4096, deadline) : readBounded(passwordFile, 4096, 'credential')).replace(/\r?\n$/, '');
    if (password.length === 0 || password.length > 1024 || /[\r\n\0]/.test(password)) throw new CliError('credentials', 'Password input must contain one nonempty line of at most 1024 characters.');
    return { value: await login(http, store(), name, password), text: false };
  }
  if (command === 'settings' || command === 'session-status' || command === 'logout' || command === 'tokens') {
    if (auth !== 'session') throw new CliError('usage', 'Account operations require the independent human session; bearer authentication is not accepted.');
    if (command === 'logout') { allow(args, [], 1); confirm(args); const state = store(); const session = state.load(); const reply = await http.request('/api/account/v1/logout', 'POST', {}, { session, actor: true }, true); accountAcknowledgement(reply.data); state.remove(session); return { value: { loggedOut: true }, text: false }; }
    if (command !== 'tokens') { allow(args, [], 1); return { value: await settings(http, store().load()), text: false }; }
    if (subcommand === 'list') { allow(args, [], 2); return { value: await settings(http, store().load()), text: false }; }
    if (subcommand === 'mint') {
      allow(args, ['name', 'scopes'], 2); confirm(args); const name = option(args, 'name'); const scopes = option(args, 'scopes'); if (name === null || scopes === null || option(args, 'secret-out') === null) throw new CliError('usage', 'Mint requires --name, --scopes and --secret-out.');
      const requested = scopes.split(','); if (requested.length === 0 || new Set(requested).size !== requested.length || requested.some(s => !['Ingest', 'Read', 'Raw'].includes(s)) || (requested.includes('Raw') && !requested.includes('Read'))) throw new CliError('usage', 'Scopes are distinct Ingest,Read,Raw; Raw requires Read.');
      checkSecretDestination(option(args, 'secret-out')!); const session = store().load(); await settings(http, session); const reply = await http.request('/api/account/v1/tokens', 'POST', { name, scopes: requested }, { session, actor: true }, true);
      try { accountIssued(reply.data); return { value: withoutSecret(reply.data, args), text: false }; } catch { throw uncertain(null); }
    }
    if (subcommand === 'revoke') { allow(args, [], 3); confirm(args); const session = store().load(); await settings(http, session); const reply = await http.request(`/api/account/v1/tokens/${uuid(args.words[2]!)}/revoke`, 'POST', {}, { session, actor: true }, true); return { value: accountAcknowledgement(reply.data), text: false }; }
    throw new CliError('usage', 'Tokens requires list, mint or revoke.');
  }
  if (command === 'ingest' || command === 'report-progress') {
    allow(args, ['file'], 1); confirm(args); const data = parseJson(await input(args, deadline));
    const request = command === 'ingest' ? decodeWire('IngestRequest', data) : decodeWire('CollectorProgressUpdate', data);
    const token = bearer(env, option(args, 'token-file')); await current(http);
    const body = command === 'ingest' ? encodeWire('IngestRequest', request as import('../../generated/typescript/chronicle/api/IngestRequest.js').IngestRequest) : encodeWire('CollectorProgressUpdate', request as import('../../generated/typescript/chronicle/api/CollectorProgressUpdate.js').CollectorProgressUpdate);
    const unknownOutcome = (): CliError => new CliError('uncertain', command === 'ingest'
      ? `Ingestion acknowledgement lost. Preserve requestId=${(data as import('./json.js').JsonObject)['requestId']} and its exact payload/CAS revision; inspect progress before deliberately resending that identical request. No automatic retry occurred.`
      : `Collector progress acknowledgement lost. Preserve runId=${(data as import('./json.js').JsonObject)['runId']} and sequence=${(data as import('./json.js').JsonObject)['sequence']}; inspect collectors before deliberately resending the exact report.`);
    let reply: import('./transport.js').HttpReply;
    try { reply = await http.request(command === 'ingest' ? '/api/ingest' : '/api/collector/progress', 'POST', body, { token }, true); }
    catch (error) { if (error instanceof CliError && error.code === 'uncertain') throw unknownOutcome(); throw error; }
    try {
      if (command === 'ingest') { const receipt = decodeWire('IngestReceipt', reply.data); if (!isObject(body) || !sameUuid(body['requestId'], receipt.requestId)) throw new Error(); return { value: encodeWire('IngestReceipt', receipt), text: false }; }
      const ack = decodeWire('CollectorProgressAck', reply.data); if (!isObject(body) || String(ack.sequence) !== body['sequence']) throw new Error(); return { value: encodeWire('CollectorProgressAck', ack), text: false };
    } catch { throw unknownOutcome(); }
  }
  if (command === 'tags') {
    allow(args, ['cursor', 'limit', 'project', 'branch', 'after', 'before', 'tag'], 2); if (auth !== 'bearer') throw new CliError('usage', 'The tag catalog is a bearer MCP tool; select --auth bearer.');
    const arguments_: import('./json.js').JsonObject = { query: subcommand!, limit: integer(args, 'limit', 20, 1, 100) };
    for (const [key, field] of [['cursor', 'afterTag'], ['project', 'project'], ['branch', 'gitBranch'], ['after', 'after'], ['before', 'before']]) { const value = option(args, key!); if (value !== null) arguments_[field!] = value; }
    const tags = args.options.get('tag'); if (tags !== undefined) arguments_['tags'] = [...tags];
    const token = bearer(env, option(args, 'token-file')); await current(http); return { value: encodeWire('Result', await mcp(http, token, { name: 'search_tags', arguments: arguments_ })), text: false };
  }
  let operation;
  if (command === 'rpc' || command === 'call') { allow(args, ['file'], 1); operation = decodeOperation(parseJson(await input(args, deadline))); } else operation = makeOperation(args);
  const name = operationName(operation); const effect = operationPolicy[name];
  if (effect === 'control') throw new CliError('usage', 'Hello/Ping/Pong are transport-owned controls.');
  if (effect === 'mutation' || effect === 'secret') confirm(args);
  if (effect === 'secret' && option(args, 'secret-out') === null) throw new CliError('usage', 'Mint requires --secret-out to a new private file; secrets are never printed.');
  if (effect === 'secret') checkSecretDestination(option(args, 'secret-out')!);
  if (auth === 'bearer') { const tool = operationTool(operation); const token = bearer(env, option(args, 'token-file')); await current(http); const result = await mcp(http, token, tool); validateResponse(operation, result, null); return { value: encodeWire('Result', result), text: false }; }
  const requestId = option(args, 'request-id') === null ? randomUUID() : uuid(option(args, 'request-id')!);
  const sessionStore = store(); const session = sessionStore.load();
  const result = await websocket(endpoint, session, operation, requestId, effect !== 'read', deadline);
  try { const value = withoutSecret(encodeWire('Result', result), args); if (name === 'Logout') sessionStore.remove(session); return { value, text: false }; }
  catch (error) { if (effect === 'secret') throw uncertain(requestId); throw error; }
}
async function write(stream: NodeJS.WriteStream, text: string): Promise<void> { await new Promise<void>((resolve, reject) => { stream.write(text, error => error === null || error === undefined ? resolve() : reject(error)); }); }
async function main(): Promise<number> {
  try { const args = parseArgs(process.argv.slice(2)); const result = await run(args, process.env); await write(process.stdout, result.text ? String(result.value) : output(result.value, args.json)); return 0; }
  catch (error) { const failure = error instanceof CliError ? error : new CliError('unavailable', 'Operation failed; no credential or remote diagnostic was printed.'); await write(process.stderr, `chronicle: ${failure.code}: ${failure.message}\n`); return failure.exitCode; }
}
// Exit only after stream callbacks: this also bounds native WS close-handshake waits.
if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) void main().then(code => process.exit(code));
