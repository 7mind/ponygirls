import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';
import { Operation_JsonCodec, type Operation } from '../../generated/typescript/chronicle/api/Operation.js';
import { Result_JsonCodec, type Result } from '../../generated/typescript/chronicle/api/Result.js';
import { ServerEnvelope_JsonCodec, type ServerEnvelope } from '../../generated/typescript/chronicle/api/ServerEnvelope.js';
import { ClientEnvelope_JsonCodec, type ClientEnvelope } from '../../generated/typescript/chronicle/api/ClientEnvelope.js';
import { IngestRequest_JsonCodec, type IngestRequest } from '../../generated/typescript/chronicle/api/IngestRequest.js';
import { IngestReceipt_JsonCodec, type IngestReceipt } from '../../generated/typescript/chronicle/api/IngestReceipt.js';
import { CollectorProgressUpdate_JsonCodec, type CollectorProgressUpdate } from '../../generated/typescript/chronicle/api/CollectorProgressUpdate.js';
import { CollectorProgressAck_JsonCodec, type CollectorProgressAck } from '../../generated/typescript/chronicle/api/CollectorProgressAck.js';
import { VersionInfo_JsonCodec, type VersionInfo } from '../../generated/typescript/chronicle/api/VersionInfo.js';
import { Failure_JsonCodec, type Failure } from '../../generated/typescript/chronicle/api/Failure.js';
import { schemaData } from './schema-data.js';
import { CliError } from './errors.js';
import { isObject, type JsonObject } from './json.js';
export const schema = schemaData;
type DataDefinition = { readonly kind: 'data'; readonly fields: readonly (readonly [string, string])[] };
type Definition = DataDefinition | { readonly kind: 'enum'; readonly values: readonly string[] } | { readonly kind: 'adt'; readonly variants: Readonly<Record<string, DataDefinition>> };
const definitions: Readonly<Record<string, Definition>> = schemaData.definitions;
export const operationNames = Object.keys(schemaData.definitions.Operation.variants);
export type OperationName = keyof typeof schemaData.definitions.Operation.variants;
export type Effect = 'control' | 'read' | 'mutation' | 'secret';
export const operationPolicy = {
  Hello: 'control', Ping: 'control', Pong: 'control', Whoami: 'read', Search: 'read', GetSession: 'read', GetChunks: 'read', GetMessages: 'read', SearchSessionMessages: 'read', ReadMessageContext: 'read', GetRaw: 'read', Related: 'read', Facets: 'read', CollectionStatus: 'read', IngestStatus: 'read', RetryJob: 'mutation', ListTokens: 'read', MintToken: 'secret', RevokeToken: 'mutation', ListGroups: 'read', CreateGroup: 'mutation', Invite: 'mutation', AcceptInvite: 'mutation', RemoveMember: 'mutation', LeaveGroup: 'mutation', DeleteGroup: 'mutation', Receipt: 'read', Purge: 'mutation', Logout: 'mutation', Archive: 'read', ArchiveSearch: 'read', Activity: 'read', ActivityJobs: 'read', LocateMessage: 'read', PreviewRetryFailed: 'read', ApplyRetryFailed: 'mutation', ExpressionHints: 'read', ModelUsage: 'read', GetPassages: 'read', GetPassageSpans: 'read', PreviewOwnerReindex: 'read', ApplyOwnerReindex: 'mutation', GetReindexStatus: 'read', McpTestTools: 'read', StartMcpTest: 'mutation', ReadMcpTest: 'read', CancelMcpTest: 'mutation',
} as const satisfies Record<OperationName, Effect>;
export function operationName(operation: Operation): OperationName { return Object.keys(encodeWire('Operation', operation) as object)[0] as OperationName; }
export function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new CliError('invalid', 'A full UUID is required.');
  return value;
}
function invalid(): never { throw new CliError('invalid', 'Value does not match the current 1.9.0 typed API schema. Use chronicle rpc help OPERATION.'); }
export function validateType(type: string, value: unknown): void {
  if (type.startsWith('opt[')) { if (value === null) return; validateType(type.slice(4, -1), value); return; }
  if (type.startsWith('lst[')) { if (!Array.isArray(value)) invalid(); for (const item of value) validateType(type.slice(4, -1), item); return; }
  if (type === 'str' || type === 'uid') { if (typeof value !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) invalid(); if (type === 'uid') uuid(value); return; }
  if (type === 'bit') { if (typeof value !== 'boolean') invalid(); return; }
  if (type === 'i32') { if (typeof value !== 'number' || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) invalid(); return; }
  if (type === 'i64') { if (!(typeof value === 'number' && Number.isSafeInteger(value)) && !(typeof value === 'string' && /^-?(0|[1-9]\d*)$/.test(value))) invalid(); const n = BigInt(value); if (n < -(1n << 63n) || n >= 1n << 63n) invalid(); return; }
  if (type === 'f64') { if (typeof value !== 'number' || !Number.isFinite(value)) invalid(); return; }
  const def = definitions[type]; if (def === undefined) throw new CliError('protocol-error', 'Missing internal boundary schema.');
  if (def.kind === 'enum') { if (typeof value !== 'string' || !def.values.includes(value)) invalid(); return; }
  if (!isObject(value)) invalid();
  if (def.kind === 'adt') { const keys = Object.keys(value); if (keys.length !== 1 || !Object.hasOwn(def.variants, keys[0]!)) invalid(); validateData(def.variants[keys[0]!]!, value[keys[0]!]); return; }
  validateData(def, value);
}
function validateData(def: DataDefinition, value: unknown): void {
  if (!isObject(value) || Object.keys(value).length !== def.fields.length) invalid();
  for (const [field, type] of def.fields) { if (!Object.hasOwn(value, field)) invalid(); validateType(type, value[field]); }
}
interface WireTypes { Failure: Failure; Operation: Operation; Result: Result; ServerEnvelope: ServerEnvelope; ClientEnvelope: ClientEnvelope; IngestRequest: IngestRequest; IngestReceipt: IngestReceipt; CollectorProgressUpdate: CollectorProgressUpdate; CollectorProgressAck: CollectorProgressAck; VersionInfo: VersionInfo }
interface Codec<T> { encode(ctx: BaboonCodecContext, value: T): unknown; decode(ctx: BaboonCodecContext, value: unknown): T }
const codecs: { [K in keyof WireTypes]: Codec<WireTypes[K]> } = { Failure: Failure_JsonCodec.instance, Operation: Operation_JsonCodec.instance, Result: Result_JsonCodec.instance, ServerEnvelope: ServerEnvelope_JsonCodec.instance, ClientEnvelope: ClientEnvelope_JsonCodec.instance, IngestRequest: IngestRequest_JsonCodec.instance, IngestReceipt: IngestReceipt_JsonCodec.instance, CollectorProgressUpdate: CollectorProgressUpdate_JsonCodec.instance, CollectorProgressAck: CollectorProgressAck_JsonCodec.instance, VersionInfo: VersionInfo_JsonCodec.instance };
export function decodeWire<K extends keyof WireTypes>(type: K, value: unknown): WireTypes[K] {
  validateType(type, value);
  try { return codecs[type].decode(BaboonCodecContext.Default, value); } catch { return invalid(); }
}
export function encodeWire<K extends keyof WireTypes>(type: K, value: WireTypes[K]): unknown { return codecs[type].encode(BaboonCodecContext.Default, value); }
export function decodeOperation(value: unknown): Operation {
  const operation = decodeWire('Operation', value);
  const maximumPage = operationName(operation) === 'ReadMcpTest' ? 256 : operationName(operation) === 'ArchiveSearch' ? 10 : 100;
  function bounds(v: unknown): void {
    if (!isObject(v)) return;
    for (const [key, item] of Object.entries(v)) {
      if (['offset', 'beforeBytes', 'afterBytes', 'caretUtf16', 'start', 'end'].includes(key) && typeof item === 'number' && item < 0) invalid();
      if (key === 'limit' && (typeof item !== 'number' || item < 1 || item > maximumPage)) invalid();
      if (key === 'revision' && (typeof item !== 'number' || item < 1)) invalid();
      if (isObject(item)) bounds(item);
    }
  }
  bounds(value); return operation;
}
export function operationHelp(name: string): unknown {
  if (!Object.hasOwn(schemaData.definitions.Operation.variants, name)) throw new CliError('usage', 'Unknown operation. Run chronicle rpc help.');
  const found = new Set<string>();
  function gather(type: string): void { const inner = /^(?:opt|lst)\[(.+)\]$/.exec(type); if (inner !== null) { gather(inner[1]!); return; } const def = definitions[type]; if (def === undefined || found.has(type)) return; found.add(type); if (def.kind === 'data') for (const [, fieldType] of def.fields) gather(fieldType); if (def.kind === 'adt') for (const v of Object.values(def.variants)) for (const [, fieldType] of v.fields) gather(fieldType); }
  const operation = schemaData.definitions.Operation.variants[name as OperationName]; for (const [, type] of operation.fields) gather(type);
  return { version: schema.version, operation: name, effect: operationPolicy[name as OperationName], fields: Object.fromEntries(operation.fields), types: Object.fromEntries([...found].map(type => [type, definitions[type]])) };
}
const expectedResults = {
  Hello: ['Hello'], Ping: ['Pong'], Pong: ['Pong'], Whoami: ['Whoami'], Search: ['Search'], GetSession: ['Session'], GetChunks: ['Chunks'], GetMessages: ['Messages'], SearchSessionMessages: ['SessionMessageSearch'], ReadMessageContext: ['MessageContext'], GetRaw: ['Raw'], Related: ['Related'], Facets: ['Facets'], CollectionStatus: ['CollectionStatus'], IngestStatus: ['Status'], RetryJob: ['Mutation'], ListTokens: ['Tokens'], MintToken: ['Token'], RevokeToken: ['Mutation'], ListGroups: ['Groups'], CreateGroup: ['Mutation'], Invite: ['Mutation'], AcceptInvite: ['Mutation'], RemoveMember: ['Mutation'], LeaveGroup: ['Mutation'], DeleteGroup: ['Mutation'], Receipt: ['Mutation', 'Token', 'RetryFailed', 'OwnerReindexed'], Purge: ['Mutation'], Logout: ['Mutation'], Archive: ['Archive'], ArchiveSearch: ['ArchiveSearch'], Activity: ['Activity'], ActivityJobs: ['ActivityJobs'], LocateMessage: ['LocatedMessage'], PreviewRetryFailed: ['RetryFailedPreview'], ApplyRetryFailed: ['RetryFailed'], ExpressionHints: ['ExpressionHints'], ModelUsage: ['ModelUsage'], GetPassages: ['Passages'], GetPassageSpans: ['PassageSpans'], PreviewOwnerReindex: ['OwnerReindexPreview'], ApplyOwnerReindex: ['OwnerReindexed'], GetReindexStatus: ['ReindexStatus'], McpTestTools: ['McpTestTools'], StartMcpTest: ['McpTestRun'], ReadMcpTest: ['McpTestRun'], CancelMcpTest: ['McpTestRun'],
} satisfies Record<OperationName, string[]>;
type ReceiptEntityBinding = { readonly kind: 'argument'; readonly field: 'jobId' | 'tokenId' | 'groupId' | 'sessionId' } | { readonly kind: 'assigned' } | { readonly kind: 'absent' };
const RECEIPT_ENTITIES = {
  RetryJob: { kind: 'argument', field: 'jobId' }, RevokeToken: { kind: 'argument', field: 'tokenId' },
  CreateGroup: { kind: 'assigned' }, Invite: { kind: 'assigned' }, AcceptInvite: { kind: 'assigned' },
  RemoveMember: { kind: 'argument', field: 'groupId' }, LeaveGroup: { kind: 'argument', field: 'groupId' }, DeleteGroup: { kind: 'argument', field: 'groupId' },
  Purge: { kind: 'argument', field: 'sessionId' }, Logout: { kind: 'absent' },
} as const satisfies Partial<Record<OperationName, ReceiptEntityBinding>>;
export function sameUuid(expected: unknown, actual: unknown): boolean { return typeof expected === 'string' && typeof actual === 'string' && expected.toLowerCase() === actual.toLowerCase(); }
function sameNullableUuid(expected: unknown, actual: unknown): boolean { return expected === null && actual === null || sameUuid(expected, actual); }
function invalidAcknowledgement(): never { throw new CliError('protocol-error', 'Acknowledgement does not match the requested operation, receipt identity or target.'); }
function validateAcknowledgement(name: OperationName, body: JsonObject, branch: string, wrapper: JsonObject, requestId: string | null): void {
  const lookup = name === 'Receipt'; const expectedId = lookup ? body['mutationId'] : requestId;
  if (branch === 'Mutation') {
    const receipt = wrapper['receipt'];
    if (!isObject(receipt) || !sameUuid(expectedId, receipt['requestId'])) return invalidAcknowledgement();
    // Lookup knows the historical UUID, not the original operation or its entity arguments.
    if (lookup) return;
    if (receipt['operation'] !== name || !Object.hasOwn(RECEIPT_ENTITIES, name)) return invalidAcknowledgement();
    const binding: ReceiptEntityBinding = RECEIPT_ENTITIES[name as keyof typeof RECEIPT_ENTITIES];
    if (binding.kind === 'absent') { if (receipt['entityId'] !== null) invalidAcknowledgement(); }
    else if (typeof receipt['entityId'] !== 'string' || (binding.kind === 'argument' && !sameUuid(body[binding.field], receipt['entityId']))) invalidAcknowledgement();
  }
  const data = wrapper['result'];
  if ((branch === 'RetryFailed' || branch === 'OwnerReindexed') && (!isObject(data) || !sameUuid(expectedId, data['requestId']) || (!lookup && data['targetProfile'] !== body['targetProfile']))) invalidAcknowledgement();
  if (branch === 'Token') {
    if (!isObject(data)) return invalidAcknowledgement();
    // Token metadata has no request UUID. Stored receipt lookup never recovers a secret.
    if (lookup) { if (data['secret'] !== null) invalidAcknowledgement(); return; }
    const token = data['token']; const scopes = body['scopes'];
    if (!isObject(token) || token['name'] !== body['name'] || !Array.isArray(scopes) || !Array.isArray(token['scopes'])) return invalidAcknowledgement();
    const returned = token['scopes'];
    if (scopes.length !== returned.length || new Set(scopes).size !== scopes.length || new Set(returned).size !== returned.length || !scopes.every(scope => returned.includes(scope))) invalidAcknowledgement();
  }
  if (name === 'GetReindexStatus' && (!isObject(data) || !sameUuid(body['requestId'], data['requestId']))) invalidAcknowledgement();
}
export function validateResponse(operation: Operation, result: Result, requestId: string | null): void {
  const name = operationName(operation); const encoded = encodeWire('Result', result); const request = encodeWire('Operation', operation);
  const reject = (): never => { throw new CliError('protocol-error', 'Response branch, page or immutable content view does not match the request.'); };
  if (!isObject(encoded) || !isObject(request)) return reject();
  const branch = Object.keys(encoded)[0]!; if (!expectedResults[name].includes(branch)) reject();
  const body = request[name]; const wrapper = encoded[branch]; if (!isObject(body) || !isObject(wrapper)) return reject();
  validateAcknowledgement(name, body, branch, wrapper, requestId); const data = wrapper['result'];
  if (isObject(data)) {
    const selected = name === 'GetSession' && isObject(data['session']) ? data['session'] : data;
    if (isObject(body['view']) && (!isObject(selected['view']) || selected['view']['revision'] !== body['view']['revision'] || !sameNullableUuid(body['view']['generationId'], selected['view']['generationId']))) reject();
    if (typeof body['offset'] === 'number' && typeof data['offset'] === 'number' && data['offset'] !== body['offset']) reject();
    if (name === 'GetRaw' && body['revision'] !== null && data['revision'] !== body['revision']) reject();
    if (name === 'GetSession' && !sameUuid(body['sessionId'], selected['id'])) reject();
    if (name === 'ReadMessageContext' && !sameUuid(body['sessionId'], data['sessionId'])) reject();
    if (name === 'Search') {
      if (data['countScope'] === 'CandidateWindow') { if (typeof data['rankingLimit'] !== 'number' || data['rankingLimit'] < 1 || typeof data['total'] !== 'number' || data['total'] > data['rankingLimit']) reject(); }
      else if (data['rankingLimit'] !== null) reject();
    }
  }
}
