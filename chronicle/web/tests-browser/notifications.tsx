import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationReceipt, Operation_ApplyRetryFailed, Operation_MintToken, Operation_Receipt, Operation_RetryJob, Result_Mutation, Result_RetryFailed, Result_Token, RetryFailedCounts, RetryFailedResult, Scope, TokenInfo, TokenResult, type Operation, type Result } from '../src/api.ts';
import { MutationNotice } from '../src/MutationNotice.tsx';
import { Dialog } from '../src/Dialog.tsx';
import { dismissPopoverOnExternalFocus } from '../src/Popover.tsx';
import { useMutations, type MutationConnection } from '../src/mutations.ts';
import { RequestFailure, type RequestOptions } from '../src/transport/types.ts';
interface Pending { operation: Operation; options: RequestOptions; resolve(result: Result): void; reject(error: Error): void }
class NotificationFixture implements MutationConnection {
  private listeners = new Set<() => void>();
  constructor(private readonly record: (request: Pending) => void) {}
  onInvalidate(callback: () => void) { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; }
  invalidate() { for (const callback of this.listeners) callback(); }
  request(operation: Operation, options: RequestOptions): Promise<Result> { return new Promise((resolve, reject) => this.record({ operation, options, resolve, reject })); }
}
function Notifications() {
  const [requests, setRequests] = useState<Pending[]>([]), [connection] = useState(() => new NotificationFixture(request => setRequests(previous => [...previous, request])));
  const [owner, setOwner] = useState<string | null>('alice'), [conversation, setConversation] = useState(false), actions = useMutations(connection, owner), pending = requests.at(-1);
  function id(request: Pending) { return request.operation instanceof Operation_Receipt ? request.operation.mutationId : request.options.receiptId!; }
  function success() {
    if (pending === undefined) throw new Error('No pending fixture request');
    if (pending.operation instanceof Operation_ApplyRetryFailed) pending.resolve(new Result_RetryFailed(new RetryFailedResult(id(pending), 'target-profile', 1n, new RetryFailedCounts(1n, 0n, 0n, 0n, 0n, 0n, 0n))));
    else pending.resolve(new Result_Mutation(new MutationReceipt(id(pending), 'RetryJob', undefined)));
  }
  return <div onFocusCapture={dismissPopoverOnExternalFocus}>
    <div id="notices"><MutationNotice actions={actions}/></div><main><h1>Notification fixture</h1>
      <button onClick={() => void actions.run(new Operation_RetryJob('00000000-0000-4000-8000-000000000001'), 'Retry indexing job')}>Retry job</button>
      <button onClick={() => void actions.run(new Operation_ApplyRetryFailed('target-profile', 'selection-hash', true), 'Retry indexing jobs')}>Retry bulk</button>
      <button onClick={() => void actions.run(new Operation_MintToken('Synthetic token', [Scope.Read]), 'Mint token')}>Mint token</button>
      <button onClick={success}>Return success</button><button onClick={() => setConversation(true)}>Open conversation</button>
      <button onClick={() => pending!.reject(new RequestFailure('Synthetic unknown delivery', 'timeout', 'uncertain', pending!.options.receiptId))}>Lose acknowledgement</button>
      <button onClick={() => pending!.reject(new RequestFailure('No receipt', 'not-found', 'failed', null))}>Receipt absent</button>
      <button onClick={() => pending!.reject(new RequestFailure('Rejected', 'conflict', 'failed', null))}>Receipt rejected</button>
      <button onClick={() => pending!.resolve(new Result_Token(new TokenResult(new TokenInfo('00000000-0000-4000-8000-000000000099', 'Synthetic token', [Scope.Read], '2026-11-01T00:00:00Z', false), undefined)))}>Return token metadata</button>
      <button onClick={() => connection.invalidate()}>Invalidate</button><button onClick={() => setOwner('bob')}>Change account</button><button onClick={() => setOwner(null)}>Sign out</button><button onClick={() => setOwner('alice')}>Sign in original</button>
      <output aria-label="Delivered requests">{requests.length}</output><output aria-label="Request ID">{pending === undefined ? 'none' : id(pending)}</output>
    </main>
    {conversation && <Dialog title="Source conversation" close={() => setConversation(false)}><p>Synthetic conversation content</p><button onClick={success}>Return modal success</button></Dialog>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Notifications/>);
