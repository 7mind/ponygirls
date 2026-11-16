import { randomUUID } from 'node:crypto';
import type { Operation } from '../../generated/typescript/chronicle/api/Operation.js';
import { Result_Error, type Result } from '../../generated/typescript/chronicle/api/Result.js';
import { CliError, remoteFailure } from './errors.js';
import { Http } from './transport.js';
import { decodeWire, encodeWire, operationName } from './wire.js';
import { isObject, parseJson, type JsonObject } from './json.js';
export interface ToolCall { name: string; arguments: JsonObject }
export function operationTool(operation: Operation): ToolCall | null {
  const name = operationName(operation); const encoded = encodeWire('Operation', operation);
  if (!isObject(encoded) || !isObject(encoded[name])) throw new CliError('protocol-error', 'Invalid internal operation encoding.');
  const body = encoded[name] as JsonObject;
  const filter = (data: unknown): JsonObject => { const result: JsonObject = {}; if (isObject(data)) for (const [key, value] of Object.entries(data)) if (value !== null) result[key] = value; return result; };
  const withView = (): JsonObject => {
    const result: JsonObject = { sessionId: body['sessionId']! };
    if (isObject(body['view'])) { result['revision'] = body['view']['revision']!; if (body['view']['generationId'] !== null) result['generationId'] = body['view']['generationId']!; }
    return result;
  };
  if (name === 'Whoami') return { name: 'whoami', arguments: {} };
  if (name === 'Search') { const query = body['query']; if (!isObject(query) || typeof query['mode'] !== 'string') throw new CliError('protocol-error', 'Invalid internal search encoding.'); return { name: 'search_sessions', arguments: { ...filter(query['filter']), query: query['query']!, mode: query['mode'].toLowerCase(), limit: query['limit']!, offset: query['offset']! } }; }
  if (name === 'GetSession') return { name: 'get_session', arguments: withView() };
  if (name === 'GetChunks' || name === 'GetMessages') return { name: name === 'GetChunks' ? 'get_chunks' : 'get_messages', arguments: { ...withView(), offset: body['offset']!, limit: body['limit']! } };
  if (name === 'ReadMessageContext') return { name: 'read_message_context', arguments: body };
  if (name === 'Related') return { name: 'related_sessions', arguments: body };
  if (name === 'Facets') return { name: 'list_facets', arguments: filter(body['filter']) };
  if (name === 'IngestStatus') return { name: 'ingest_status', arguments: body };
  return null;
}
export async function mcp(http: Http, token: string, tool: ToolCall): Promise<Result> {
  const id = randomUUID();
  const { data } = await http.request('/mcp', 'POST', { jsonrpc: '2.0', id, method: 'tools/call', params: tool }, { token }, false);
  if (!isObject(data) || data['jsonrpc'] !== '2.0' || data['id'] !== id) throw new CliError('protocol-error', 'Uncorrelated MCP response.');
  if (isObject(data['error'])) throw new CliError('invalid', 'MCP rejected the typed tool call.');
  const result = data['result'];
  if (!isObject(result) || typeof result['isError'] !== 'boolean' || !Array.isArray(result['content']) || result['content'].length !== 1) throw new CliError('protocol-error', 'Malformed MCP tool result.');
  const content = result['content'][0]; if (!isObject(content) || content['type'] !== 'text' || typeof content['text'] !== 'string') throw new CliError('protocol-error', 'Expected a generated MCP text result.');
  const canonical = parseJson(content['text']);
  if (result['isError']) { throw remoteFailure(isObject(canonical) ? canonical['code'] : null); }
  const decoded = decodeWire('Result', canonical); if (decoded instanceof Result_Error) throw remoteFailure(decoded.failure.code); return decoded;
}
