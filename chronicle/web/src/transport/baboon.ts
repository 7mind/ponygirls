import { BaboonCodecContext } from '../../../generated/typescript/BaboonSharedRuntime.ts';
import { ClientEnvelope, ClientEnvelope_JsonCodec } from '../../../generated/typescript/chronicle/api/ClientEnvelope.ts';
import { ServerEnvelope_JsonCodec } from '../../../generated/typescript/chronicle/api/ServerEnvelope.ts';
import { Operation_Hello, Operation_Ping, Operation_Pong, type Operation } from '../../../generated/typescript/chronicle/api/Operation.ts';
import { Result_Hello, Result_Ping, Result_Pong, Result_Error, Result_Search, type Result } from '../../../generated/typescript/chronicle/api/Result.ts';
import { SearchCountScope } from '../../../generated/typescript/chronicle/api/SearchCountScope.ts';
import type { Protocol } from './types.ts';
const API_VERSION = '1.2.0';
const MAX_FRAME_CHARACTERS = 8 * 1024 * 1024;
export function baboonProtocol(nonce: () => string): Protocol<Operation, Result> {
  let helloId: string | null = null;
  const pings = new Map<string, { nonce: string; at: number }>();
  const encode = (id: string, operation: Operation) => JSON.stringify(ClientEnvelope_JsonCodec.instance.encode(BaboonCodecContext.Default, new ClientEnvelope(id, operation)));
  return {
    hello() { helloId = nonce(); return encode(helloId, new Operation_Hello([API_VERSION])); },
    ping(value, at) {
      const id = nonce(); pings.set(id, { nonce: value, at });
      return encode(id, new Operation_Ping(value));
    },
    pong(id, value, _at) { return encode(id, new Operation_Pong(value)); },
    request: encode,
    decode(data) {
      if (data.length > MAX_FRAME_CHARACTERS) return { kind: 'stop', reason: 'protocol-error', message: 'Server message exceeded the configured frame bound' };
      const envelope = ServerEnvelope_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(data));
      if (typeof envelope.requestId !== 'string' || envelope.requestId.length === 0) throw new Error('Missing envelope request ID');
      const result = envelope.result;
      if (result instanceof Result_Error) {
        const { code, message } = result.failure;
        if (code === 'unauthorized') return { kind: 'stop', reason: 'unauthorized', message };
        if (code === 'version-mismatch') return { kind: 'stop', reason: 'update-required', message };
        if (code === 'protocol-error' || envelope.requestId === helloId) return { kind: 'stop', reason: 'protocol-error', message };
        return { kind: 'failure', id: envelope.requestId, code, message, invalidates: false };
      }
      if (result instanceof Result_Hello) {
        if (helloId === null || envelope.requestId !== helloId) throw new Error('Unsolicited Hello');
        helloId = null;
        if (!result.versions.supported.includes(API_VERSION)) return { kind: 'stop', reason: 'update-required', message: 'The server no longer supports this dashboard. Reload to update.' };
        return { kind: 'negotiated' };
      }
      if (result instanceof Result_Ping) return { kind: 'ping', id: envelope.requestId, nonce: result.nonce, at: 0 };
      if (result instanceof Result_Pong) {
        const sent = pings.get(envelope.requestId);
        if (sent && sent.nonce === result.nonce) { pings.delete(envelope.requestId); return { kind: 'pong', nonce: result.nonce, at: sent.at }; }
        return { kind: 'pong', nonce: result.nonce, at: -1 };
      }
      if (result instanceof Result_Search) {
        const { countScope, rankingLimit, total } = result.result;
        if (countScope === SearchCountScope.CandidateWindow) {
          if (rankingLimit === undefined || !Number.isInteger(rankingLimit) || rankingLimit <= 0 || total > rankingLimit) throw new Error('Invalid search count metadata');
        } else if (rankingLimit !== undefined) throw new Error('Invalid search count metadata');
      }
      return { kind: 'reply', id: envelope.requestId, result };
    },
  };
}
