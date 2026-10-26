import { useEffect, useRef, useState } from 'react';
import { Operation_ApplyRetryFailed, Operation_Receipt, Operation_MintToken, Result_Mutation, Result_RetryFailed, Result_Token, type Operation, type Result, type RetryFailedResult, type TokenResult } from './api.ts';
import type { ChronicleConnection } from './client.ts';
import { RequestFailure } from './transport/types.ts';
import { randomUUID } from './uuid.ts';
interface Uncertain { id: string; owner: string; operation: Operation; label: string; absent: boolean }
export type MutationConnection = Pick<ChronicleConnection, 'request' | 'onInvalidate'>;
export function validateMutationResult(operation: Operation, result: Result, requestId: string): Result_Mutation | Result_Token | Result_RetryFailed {
  if (operation instanceof Operation_ApplyRetryFailed) {
    const unverified = (message: string) => new RequestFailure(message, 'unverified-result', 'uncertain', requestId);
    if (!(result instanceof Result_RetryFailed)) throw unverified('Unexpected mutation response');
    if (result.result.requestId !== requestId) throw unverified('Receipt identity mismatch');
    if (result.result.targetProfile !== operation.targetProfile) throw unverified('Receipt target profile mismatch');
    return result;
  }
  if (!(result instanceof Result_Mutation) && !(result instanceof Result_Token)) throw new Error('Unexpected mutation response');
  return result;
}
export interface MutationState {
  busy: boolean; error: string | null; errorCode: string | null; message: string | null; uncertain: Uncertain | null;
  canRecover: boolean; token: TokenResult | null; retryFailed: RetryFailedResult | null; lostTokenId: string | null; revision: number;
  run(operation: Operation, label: string): Promise<boolean>;
  recover(): Promise<void>;
  retryConfirmedAbsent(): Promise<void>;
  dismissSecret(): void;
}
export function useMutations(connection: MutationConnection, userId: string | null): MutationState {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [errorCode, setErrorCode] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<Uncertain | null>(null), [token, setToken] = useState<TokenResult | null>(null), [retryFailed, setRetryFailed] = useState<{ owner: string; epoch: number; result: RetryFailedResult } | null>(null), [lostToken, setLostToken] = useState<{ id: string; owner: string } | null>(null), [revision, setRevision] = useState(0);
  const currentUser = useRef(userId), currentConnection = useRef(connection), epoch = useRef(0), inFlight = useRef(false);
  if (currentUser.current !== userId || currentConnection.current !== connection) epoch.current++;
  currentUser.current = userId; currentConnection.current = connection;
  useEffect(() => connection.onInvalidate(() => { epoch.current++; setToken(null); setMessage(null); setRetryFailed(null); setErrorCode(null); }), [connection]);
  useEffect(() => { setRetryFailed(null); setErrorCode(null); }, [connection, userId]);
  useEffect(() => {
    if (userId !== null && uncertain !== null && uncertain.owner !== userId) {
      setUncertain(null); setToken(null); setLostToken(null); setError('An uncertain mutation belongs to the previous account. Reconcile it from that account before retrying it.');
    }
  }, [userId, uncertain]);
  async function send(operation: Operation, label: string, id: string, owner: string) {
    if (inFlight.current) return false;
    const requestEpoch = epoch.current, bulk = operation instanceof Operation_ApplyRetryFailed;
    inFlight.current = true; setBusy(true); setError(null); setErrorCode(null); setMessage(null); setToken(null); setRetryFailed(null); setLostToken(null);
    try {
      const result = validateMutationResult(operation, await connection.request(operation, { mutation: true, receiptId: id }), id);
      if (currentUser.current !== null && currentUser.current !== owner) return false;
      if (bulk && (currentUser.current !== owner || epoch.current !== requestEpoch)) return false;
      setUncertain(null);
      if (result instanceof Result_Token) {
        if (result.result.secret === undefined) setLostToken({ id: result.result.token.id, owner });
        else setToken(result.result);
      }
      if (result instanceof Result_RetryFailed) setRetryFailed({ owner, epoch: requestEpoch, result: result.result });
      else setMessage(`${label} completed.`);
      setRevision(n => n + 1); return true;
    } catch (cause) {
      if (bulk && currentUser.current !== null && currentUser.current !== owner) return false;
      setErrorCode(cause instanceof RequestFailure ? cause.code : null);
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
    return send(operation, label, randomUUID(crypto), currentUser.current);
  }
  async function recover() {
    if (uncertain === null || currentUser.current !== uncertain.owner || inFlight.current) return;
    const requestEpoch = epoch.current, bulk = uncertain.operation instanceof Operation_ApplyRetryFailed;
    inFlight.current = true; setBusy(true); setError(null); setErrorCode(null);
    try {
      const reply = await connection.request(new Operation_Receipt(uncertain.id), { mutation: false, receiptId: null });
      const result = validateMutationResult(uncertain.operation, reply, uncertain.id);
      if (bulk && (currentUser.current !== uncertain.owner || epoch.current !== requestEpoch)) return;
      if (result instanceof Result_RetryFailed) setRetryFailed({ owner: uncertain.owner, epoch: requestEpoch, result: result.result });
      else if (uncertain.operation instanceof Operation_MintToken) {
        if (!(result instanceof Result_Token) || result.result.secret !== undefined) throw new Error('Token receipt must contain metadata without a secret');
        setLostToken({ id: result.result.token.id, owner: uncertain.owner });
      } else if (!(result instanceof Result_Mutation) || result.receipt.requestId !== uncertain.id) throw new Error('Receipt identity mismatch');
      setUncertain(null);
      if (!(result instanceof Result_RetryFailed)) setMessage(`${uncertain.label} committed. Receipt ${uncertain.id}.`);
      setRevision(n => n + 1);
    } catch (cause) {
      if (bulk && (currentUser.current !== uncertain.owner || epoch.current !== requestEpoch)) return;
      if (bulk && cause instanceof RequestFailure && cause.code === 'conflict' && cause.outcome === 'failed') {
        // Only the owner-bound Receipt lookup proves rejection; a direct Apply conflict does not.
        setUncertain(null); setMessage(`Receipt ${uncertain.id} confirms that this indexing retry was rejected. Request a fresh preview and explicitly confirm again before retrying.`);
        return;
      }
      setErrorCode(cause instanceof RequestFailure ? cause.code : null);
      if (cause instanceof RequestFailure && cause.code === 'not-found') { setUncertain({ ...uncertain, absent: true }); setMessage('No committed receipt was found. You may explicitly retry the same payload with the same request ID.'); }
      else setError(cause instanceof Error ? cause.message : 'Receipt lookup failed; the outcome is still unknown');
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function retryConfirmedAbsent() {
    if (uncertain === null || !uncertain.absent || currentUser.current !== uncertain.owner) return;
    await send(uncertain.operation, uncertain.label, uncertain.id, uncertain.owner);
  }
  return { busy, error, errorCode, message, uncertain, canRecover: userId !== null && uncertain !== null && uncertain.owner === userId, token, retryFailed: retryFailed !== null && retryFailed.owner === userId && retryFailed.epoch === epoch.current ? retryFailed.result : null, lostTokenId: lostToken !== null && lostToken.owner === userId ? lostToken.id : null, revision, run, recover, retryConfirmedAbsent, dismissSecret: () => setToken(null) };
}
