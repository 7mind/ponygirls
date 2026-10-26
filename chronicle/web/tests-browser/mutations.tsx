import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Operation_ApplyRetryFailed, Operation_Receipt, Operation_RetryJob, Result_RetryFailed, Result_RetryFailedPreview, RetryFailedCounts, RetryFailedPlan, RetryFailedResult, type Operation, type Result } from '../src/api.ts';
import { useMutations, type MutationConnection } from '../src/mutations.ts';
import { RequestFailure, type RequestOptions } from '../src/transport/types.ts';

interface PendingRequest { operation: Operation; options: RequestOptions; resolve(result: Result): void; reject(error: Error): void }
class MutationFixture implements MutationConnection {
  private listeners = new Set<() => void>();
  constructor(private readonly record: (request: PendingRequest) => void) {}
  onInvalidate(callback: () => void) { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; }
  invalidate() { for (const callback of this.listeners) callback(); }
  request(operation: Operation, options: RequestOptions): Promise<Result> { return new Promise((resolve, reject) => this.record({ operation, options, resolve, reject })); }
}
type ReplyKind = 'valid' | 'wrong-id' | 'wrong-profile' | 'wrong-type';
function requestId(request: PendingRequest): string {
  if (request.operation instanceof Operation_Receipt) return request.operation.mutationId;
  if (request.options.receiptId === null) throw new Error('Fixture mutation requires a receipt ID');
  return request.options.receiptId;
}
function reply(request: PendingRequest, kind: ReplyKind): Result {
  const id = requestId(request), counts = new RetryFailedCounts(1n, 2n, 3n, 4n, 5n, 6n, 7n);
  const targetProfile = request.operation instanceof Operation_ApplyRetryFailed ? request.operation.targetProfile : 'target-profile';
  if (kind === 'wrong-type') return new Result_RetryFailedPreview(new RetryFailedPlan(targetProfile, 'selection-hash', counts));
  const innerId = kind === 'wrong-id' ? `${id.slice(0, -1)}${id.endsWith('0') ? '1' : '0'}` : id;
  return new Result_RetryFailed(new RetryFailedResult(innerId, kind === 'wrong-profile' ? 'other-profile' : targetProfile, 1n, counts));
}
function Mutations() {
  const [requests, setRequests] = useState<PendingRequest[]>([]), [connection] = useState(() => new MutationFixture(request => setRequests(current => [...current, request])));
  const [owner, setOwner] = useState<string | null>('alice');
  const actions = useMutations(connection, owner);
  return <><button onClick={() => void actions.run(new Operation_ApplyRetryFailed('target-profile', 'selection-hash', true), 'Retry synthetic indexing jobs')}>Start apply</button>
    <button onClick={() => void actions.run(new Operation_RetryJob('00000000-0000-4000-8000-000000000001'), 'Another synthetic write')}>Attempt another write</button>
    <button onClick={() => void actions.recover()}>Look up receipt</button><button onClick={() => connection.invalidate()}>Invalidate</button><button onClick={() => setOwner('bob')}>Change account</button><button onClick={() => setOwner(null)}>Sign out</button><button onClick={() => setOwner('alice')}>Sign in original</button>
    <output aria-label="Busy">{String(actions.busy)}</output><output aria-label="Delivered requests">{requests.length}</output><output aria-label="Uncertain request">{actions.uncertain === null ? 'none' : actions.uncertain.id}</output><output aria-label="Uncertain owner">{actions.uncertain === null ? 'none' : actions.uncertain.owner}</output><output aria-label="Error">{actions.error === null ? 'none' : actions.error}</output><output aria-label="Typed result">{actions.retryFailed === null ? 'none' : `${actions.retryFailed.requestId}:${actions.retryFailed.targetProfile}:${actions.retryFailed.retried.toString()}`}</output>
    {requests.map((request, index) => <section aria-label={`Mutation request ${index}`} key={index}><output aria-label="Request ID">{requestId(request)}</output><output aria-label="Operation">{request.operation instanceof Operation_ApplyRetryFailed ? 'apply' : request.operation instanceof Operation_Receipt ? 'receipt' : 'other'}</output>
      <button onClick={() => request.resolve(reply(request, 'valid'))}>Return typed success</button><button onClick={() => request.resolve(reply(request, 'wrong-id'))}>Return wrong inner request ID</button><button onClick={() => request.resolve(reply(request, 'wrong-profile'))}>Return wrong target profile</button><button onClick={() => request.resolve(reply(request, 'wrong-type'))}>Return wrong result type</button>
      <button onClick={() => request.reject(new RequestFailure('Synthetic delivery unknown', 'timeout', 'uncertain', request.options.receiptId))}>Reject uncertain delivery</button>
    </section>)}
  </>;
}
const root = document.getElementById('root');
if (root === null) throw new Error('Mutation fixture root missing');
createRoot(root).render(<Mutations/>);
