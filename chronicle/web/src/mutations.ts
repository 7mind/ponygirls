import { useEffect, useRef, useState } from 'react';
import { Operation_Receipt, Operation_MintToken, Result_Mutation, Result_Token, type Operation, type TokenResult } from './api.ts';
import { read, mutate, type ChronicleConnection } from './client.ts';
import { RequestFailure } from './transport/types.ts';
interface Uncertain { id: string; owner: string; operation: Operation; label: string; absent: boolean }
export interface MutationState {
  busy: boolean; error: string | null; message: string | null; uncertain: Uncertain | null;
  canRecover: boolean; token: TokenResult | null; lostTokenId: string | null; revision: number;
  run(operation: Operation, label: string): Promise<boolean>;
  recover(): Promise<void>;
  retryConfirmedAbsent(): Promise<void>;
  dismissSecret(): void;
}
export function useMutations(connection: ChronicleConnection, userId: string | null): MutationState {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<Uncertain | null>(null), [token, setToken] = useState<TokenResult | null>(null), [lostToken, setLostToken] = useState<{ id: string; owner: string } | null>(null), [revision, setRevision] = useState(0);
  const currentUser = useRef(userId), inFlight = useRef(false); currentUser.current = userId;
  useEffect(() => connection.onInvalidate(() => { setToken(null); setMessage(null); }), [connection]);
  useEffect(() => {
    if (userId !== null && uncertain !== null && uncertain.owner !== userId) {
      setUncertain(null); setToken(null); setLostToken(null); setError('An uncertain mutation belongs to the previous account. Reconcile it from that account before retrying it.');
    }
  }, [userId, uncertain]);
  async function send(operation: Operation, label: string, id: string, owner: string) {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError(null); setMessage(null); setToken(null); setLostToken(null);
    try {
      const result = await mutate(connection, operation, id);
      if (currentUser.current !== null && currentUser.current !== owner) return false;
      if (!(result instanceof Result_Mutation) && !(result instanceof Result_Token)) throw new Error('Unexpected mutation response');
      setUncertain(null);
      if (result instanceof Result_Token) {
        if (result.result.secret === undefined) setLostToken({ id: result.result.token.id, owner });
        else setToken(result.result);
      }
      setMessage(`${label} completed.`); setRevision(n => n + 1); return true;
    } catch (cause) {
      if (cause instanceof RequestFailure && cause.outcome === 'uncertain') {
        setUncertain({ id, owner, operation, label, absent: false });
        setError(`${label}: outcome unknown. Do not repeat it; look up the receipt after reconnection.`);
      } else setError(cause instanceof Error ? cause.message : 'Mutation failed');
      return false;
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function run(operation: Operation, label: string) {
    if (uncertain !== null) { setError('Resolve the uncertain mutation before starting another write.'); return false; }
    if (currentUser.current === null) { setError('Sign in before changing the archive.'); return false; }
    return send(operation, label, crypto.randomUUID(), currentUser.current);
  }
  async function recover() {
    if (uncertain === null || currentUser.current !== uncertain.owner || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await read(connection, new Operation_Receipt(uncertain.id), r => r instanceof Result_Mutation || r instanceof Result_Token ? r : null);
      if (uncertain.operation instanceof Operation_MintToken) {
        if (!(result instanceof Result_Token) || result.result.secret !== undefined) throw new Error('Token receipt must contain metadata without a secret');
        setLostToken({ id: result.result.token.id, owner: uncertain.owner });
      } else if (!(result instanceof Result_Mutation) || result.receipt.requestId !== uncertain.id) throw new Error('Receipt identity mismatch');
      setUncertain(null); setMessage(`${uncertain.label} committed. Receipt ${uncertain.id}.`); setRevision(n => n + 1);
    } catch (cause) {
      if (cause instanceof RequestFailure && cause.code === 'not-found') { setUncertain({ ...uncertain, absent: true }); setMessage('No committed receipt was found. You may explicitly retry the same payload with the same request ID.'); }
      else setError(cause instanceof Error ? cause.message : 'Receipt lookup failed; the outcome is still unknown');
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function retryConfirmedAbsent() {
    if (uncertain === null || !uncertain.absent || currentUser.current !== uncertain.owner) return;
    await send(uncertain.operation, uncertain.label, uncertain.id, uncertain.owner);
  }
  return { busy, error, message, uncertain, canRecover: userId !== null && uncertain !== null && uncertain.owner === userId, token, lostTokenId: lostToken !== null && lostToken.owner === userId ? lostToken.id : null, revision, run, recover, retryConfirmedAbsent, dismissSecret: () => setToken(null) };
}
