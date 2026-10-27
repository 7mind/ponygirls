import test from 'node:test';
import assert from 'node:assert/strict';
import { ArchiveReadLane, SupersededArchiveRead } from '../src/archive-requests.ts';
import { ArchiveResult, ArchiveTextScope } from '../src/api.ts';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function result(): ArchiveResult { return new ArchiveResult([], 0n, undefined, ArchiveTextScope.ExactLexical, undefined); }
async function turn() { await new Promise<void>(resolve => setImmediate(resolve)); }

test('Behavioral-Active Blackbox Atomic: one active Archive read and only the latest distinct queued read', async () => {
  const lane = new ArchiveReadLane(), scope = Symbol(), first = deferred<ArchiveResult>(), last = deferred<ArchiveResult>(), starts: string[] = [];
  const a = lane.request(scope, () => true, () => { starts.push('a'); return first.promise; });
  await turn();
  const b = lane.request(scope, () => true, async () => { starts.push('b'); return result(); });
  const superseded = assert.rejects(b, SupersededArchiveRead);
  const c = lane.request(scope, () => true, () => { starts.push('c'); return last.promise; });
  await superseded; assert.deepEqual(starts, ['a']);
  const aResult = result(); first.resolve(aResult); assert.equal(await a, aResult); await turn(); assert.deepEqual(starts, ['a', 'c']);
  const cResult = result(); last.resolve(cResult); assert.equal(await c, cResult); assert.notEqual(cResult, aResult);
});
test('Behavioral-Active Blackbox Atomic: authority invalidation drops queued reads but retains the physical permit until settlement', async () => {
  const lane = new ArchiveReadLane(), scope = Symbol(), first = deferred<ArchiveResult>(), starts: string[] = [];
  const a = lane.request(scope, () => true, () => { starts.push('alice'); return first.promise; }), staleA = assert.rejects(a, SupersededArchiveRead);
  await turn();
  const b = lane.request(scope, () => true, async () => { starts.push('queued alice'); return result(); }), staleB = assert.rejects(b, SupersededArchiveRead);
  lane.invalidate(); await staleB;
  const c = lane.request(Symbol(), () => true, async () => { starts.push('bob'); return result(); });
  await turn(); assert.deepEqual(starts, ['alice']); first.resolve(result()); await staleA; await c; assert.deepEqual(starts, ['alice', 'bob']);
});
test('Behavioral-Active Blackbox Atomic: navigation cancels its queued scope, not the later mount, and does not release active work', async () => {
  const lane = new ArchiveReadLane(), old = Symbol(), next = Symbol(), first = deferred<ArchiveResult>(), starts: string[] = [];
  let mounted = true;
  const a = lane.request(old, () => mounted, () => { starts.push('old active'); return first.promise; }), staleA = assert.rejects(a, SupersededArchiveRead);
  await turn();
  const b = lane.request(old, () => mounted, async () => { starts.push('old queued'); return result(); }), staleB = assert.rejects(b, SupersededArchiveRead);
  mounted = false; lane.cancel(old); await staleB;
  const c = lane.request(next, () => true, async () => { starts.push('new mount'); return result(); });
  lane.cancel(old); await turn(); assert.deepEqual(starts, ['old active']); first.resolve(result()); await staleA; await c; assert.deepEqual(starts, ['old active', 'new mount']);
});
test('Behavioral-Active Blackbox Atomic: an obsolete captured query never dispatches after the wait', async () => {
  const lane = new ArchiveReadLane(), scope = Symbol(), first = deferred<ArchiveResult>(), starts: string[] = [];
  const a = lane.request(scope, () => true, () => first.promise); await turn(); let current = true;
  const b = lane.request(scope, () => current, async () => { starts.push('obsolete'); return result(); }), stale = assert.rejects(b, SupersededArchiveRead);
  current = false; first.resolve(result()); await a; await stale; assert.deepEqual(starts, []);
});
test('Behavioral-Active Blackbox Atomic: a failed active read propagates unchanged and releases the next read', async () => {
  const lane = new ArchiveReadLane(), scope = Symbol(), first = deferred<ArchiveResult>(), error = new Error('synthetic denial'), starts: string[] = [];
  const a = lane.request(scope, () => true, () => first.promise), denied = assert.rejects(a, cause => cause === error); await turn();
  const b = lane.request(scope, () => true, async () => { starts.push('next'); return result(); });
  first.reject(error); await denied; await b; assert.deepEqual(starts, ['next']);
});
test('Behavioral-Active Blackbox Atomic: invalidation before dispatch sends no obsolete read', async () => {
  const lane = new ArchiveReadLane(), scope = Symbol(), starts: string[] = [];
  const a = lane.request(scope, () => true, async () => { starts.push('obsolete'); return result(); }), stale = assert.rejects(a, SupersededArchiveRead);
  lane.invalidate(); const b = lane.request(scope, () => true, async () => { starts.push('current'); return result(); });
  await stale; await b; assert.deepEqual(starts, ['current']);
});
