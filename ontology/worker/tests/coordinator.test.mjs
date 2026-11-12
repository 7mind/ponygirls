import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { captureSourceId } from '../.cache/worker/src/capture.js';
import { WorkerCoordinator } from '../.cache/worker/src/coordinator.js';
import * as C from '../.cache/generated/typescript/ontology/api/index.js';
import { BaboonCodecContext } from '../.cache/generated/typescript/BaboonSharedRuntime.js';
const digest = value => createHash('sha256').update(value).digest('hex');
function fixture() {
  let serial = 0;
  const id = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
  const attachment = { sessionId: 'session', branch: 'activation', epoch: id() };
  let view = { attachment, stamp: '0', entries: [] };
  const exposures = new Map();
  let frontier = 0n;
  let generation = 0n;
  const observed = { ingests: [], capsules: [], deliveries: [] };
  const settings = { scope: 'scope', workContext: 'work', workerActorId: 'agent', collectorActorId: 'collector', collectorNamespace: 'capture-credential',
    boundaryDeadlineMs: 1000, pollEveryMs: 5, maxNewEntries: 100, maxTrackedEntries: 1000, maxCaptureTextBytes: 4096, maxCapsuleBytes: 8192 };
  const workerActor = new C.Actor('agent', C.ActorKind.Agent);
  const context = input => new C.ContextRecord(new C.OriginContext_ReportedNative(input.origin.context), []);
  const cut = () => new C.CapsuleCut(generation, frontier, frontier, frontier > 0n ? generation : undefined, undefined);
  const ingress = () => new C.RequestTrace(id(), 'fixture', C.RequestTransport.Bearer);
  let capsule;
  const worker = {
    identity: async () => new C.Identity(workerActor, ['scope'], [C.Capability.Read]),
    status: async () => new C.CurationStatus('scope', generation, frontier, frontier, C.CurationState.Idle, undefined, frontier > 0n ? generation : undefined, undefined),
    capsule: async request => {
      observed.capsules.push(request);
      const payload = new C.CapsulePayload('scope', 'work', context(request.reportedContext), cut(), request.previousCapsuleId,
        new C.CapsulePolicyIdentity('fixture-policy', digest('policy')), [], new C.CapsuleManifest([], [], []), 'Qualified fixture capsule');
      capsule = new C.Capsule(id(), request.requestId, workerActor, payload,
        digest(JSON.stringify(C.CapsulePayload.jsonCodec().encode(BaboonCodecContext.Default, payload))), new C.CapsuleLimits(100, 8192), '2026-01-01T00:00:00Z', ingress());
      return capsule;
    },
    delivery: async request => {
      observed.deliveries.push(request);
      return new C.DeliveryReceipt(id(), request.requestId, workerActor, request.scope, request.capsuleId, request.capsulePayloadDigest,
        request.workContext, context(request.reportedContext), request.boundary, request.reportedAt, request.reportedBoundaryPayload,
        '2026-01-01T00:00:01Z', ingress(), capsule.payload.cut, C.DeliveryCutComparison.SameGraphAndCoverage);
    },
  };
  const collector = {
    identity: async () => new C.Identity(new C.Actor('collector', C.ActorKind.Collector), ['scope'], [C.Capability.Capture]),
    ingest: async request => {
      observed.ingests.push(request); frontier++; generation += 2n;
      return new C.IngestResult('scope', request.requestId, request.eventId, 'capture-credential', new C.Ref(captureSourceId('capture-credential', request.eventId), 1), [], frontier, false);
    },
  };
  const runtime = { id, now: () => Date.parse('2026-01-01T00:00:01Z'), digest,
    sleep: async (_ms, signal) => { signal.throwIfAborted(); }, current: () => view,
    exposedDeliveries: entryId => exposures.get(entryId) ?? [] };
  const coordinator = new WorkerCoordinator(settings, worker, collector, runtime, view);
  return { coordinator, observed, worker, collector, runtime, settings,
    add(role, content, receipts = []) { exposures.set('entry-' + view.entries.length, receipts); view = { ...view, stamp: String(view.entries.length + 1), entries: [...view.entries,
      { type: 'message', id: 'entry-' + view.entries.length, parentId: null, message: { role, content, stopReason: 'stop', isError: false } }] }; },
    changeStamp() { view = { ...view, stamp: view.stamp + 'changed' }; },
  };
}
const signal = () => new AbortController().signal;

test('each request captures finalized new input before capsule and reports a distinct observation', async () => {
  const f = fixture(); f.add('user', 'question');
  const first = await f.coordinator.prepare(signal());
  assert.equal(f.observed.ingests.length, 1);
  assert.equal(f.observed.capsules[0].expectedFrontier, 1n);
  const receipt = await f.coordinator.observe(first, 'full-boundary-fixture');
  assert.equal(receipt.boundary, 'ExtensionContext');
  assert.equal(receipt.reportedBoundaryPayload.digest, digest('full-boundary-fixture'));
  f.add('toolResult', [{ type: 'text', text: 'tool report' }], [receipt.id]);
  await f.coordinator.prepare(signal());
  assert.equal(f.observed.ingests.length, 2);
  assert.equal(f.observed.capsules[1].previousCapsuleId, first.capsule.id);
  assert.deepEqual(f.observed.ingests[1].metadata.exposedDeliveries, [receipt.id]);
});
test('capture acknowledgment must identify the source derived from the sealed event and namespace', async () => {
  const f = fixture(); f.add('user', 'question'); const original = f.collector.ingest;
  f.collector.ingest = async request => (await original(request)).with({ source: new C.Ref('ffffffff-ffff-4fff-8fff-ffffffffffff', 1) });
  await assert.rejects(f.coordinator.prepare(signal()), /capture-ack-mismatch/);
});
test('collector identity is required before any captured bytes are sent', async () => {
  const f = fixture(); f.add('user', 'question');
  f.collector.identity = async () => new C.Identity(new C.Actor('agent', C.ActorKind.Agent), ['scope'], [C.Capability.Capture]);
  await assert.rejects(f.coordinator.prepare(signal()), /collector-identity/);
  assert.equal(f.observed.ingests.length, 0);
});
test('native change after await prevents capsule publication', async () => {
  const f = fixture(); f.add('user', 'question');
  const original = f.collector.ingest;
  f.collector.ingest = async request => { const result = await original(request); f.changeStamp(); return result; };
  await assert.rejects(f.coordinator.prepare(signal()), /native-context-changed/);
  assert.equal(f.observed.capsules.length, 0);
});
test('uncertain capture retries the same immutable request on the next boundary', async () => {
  const f = fixture(); f.add('user', 'question');
  let first;
  const original = f.collector.ingest;
  f.collector.ingest = async request => { first = request; throw Error('response lost'); };
  await assert.rejects(f.coordinator.prepare(signal()));
  f.collector.ingest = async request => { assert.equal(request, first); return original(request); };
  await f.coordinator.prepare(signal());
});
test('modified capsule text fails digest correspondence', async () => {
  const f = fixture(); const original = f.worker.capsule;
  f.worker.capsule = async request => { const value = await original(request); return value.with({ payload: value.payload.with({ text: 'substituted' }) }); };
  await assert.rejects(f.coordinator.prepare(signal()), /capsule-digest/);
});
test('uncertain capsule preparation replays its exact request before another preparation', async () => {
  const f = fixture(); const original = f.worker.capsule; let sealed; let retained;
  f.worker.capsule = async request => { sealed = request; retained = await original(request); throw Error('lost capsule acknowledgment'); };
  await assert.rejects(f.coordinator.prepare(signal()), /lost capsule/);
  f.worker.capsule = async request => { assert.equal(request, sealed, 'capsule request identity changed after uncertain outcome'); return retained; };
  const result = await f.coordinator.prepare(signal());
  assert.equal(result.capsule.id, retained.id);
});
test('uncertain delivery is reconciled with its original request before new capture', async () => {
  const f = fixture(); const original = f.worker.delivery; let sealed; let retained; let reconciled = false;
  const first = await f.coordinator.prepare(signal());
  f.worker.delivery = async request => { sealed = request; retained = await original(request); throw Error('lost delivery acknowledgment'); };
  await assert.rejects(f.coordinator.observe(first, 'first-boundary'), /lost delivery/);
  f.worker.delivery = async request => { assert.equal(request, sealed); reconciled = true; return retained; };
  f.add('user', 'next input');
  const ingest = f.collector.ingest;
  f.collector.ingest = async request => { assert(reconciled, 'new capture preceded uncertain-delivery reconciliation'); return ingest(request); };
  const next = await f.coordinator.prepare(signal());
  assert.equal(next.capsule.payload.previousCapsuleId, undefined, 'recovery must not claim the failed injection became a successful baseline');
  assert.equal(retained.reportedBoundaryPayload.digest, digest('first-boundary'));
});
test('snapshot read failure releases the local boundary guard', async () => {
  const f = fixture(); const original = f.runtime.current;
  f.runtime.current = () => { throw Error('controlled snapshot failure'); };
  await assert.rejects(f.coordinator.prepare(signal()), /snapshot failure/);
  f.runtime.current = original;
  await f.coordinator.prepare(signal());
});
test('receipt comparison label cannot hide a mismatched observed cut', async () => {
  const f = fixture(); const original = f.worker.delivery;
  f.worker.delivery = async request => { const result = await original(request); return result.with({ observedCut: result.observedCut.with({ generation: 99n }) }); };
  const prepared = await f.coordinator.prepare(signal());
  await assert.rejects(f.coordinator.observe(prepared, 'boundary'), /delivery/);
});
test('delivered advice metadata is scoped to the next captured tranche', async () => {
  const f = fixture();
  const first = await f.coordinator.prepare(signal());
  const firstReceipt = await f.coordinator.observe(first, 'boundary1');
  f.add('assistant', 'first output', [firstReceipt.id]);
  const second = await f.coordinator.prepare(signal());
  const secondReceipt = await f.coordinator.observe(second, 'boundary2');
  f.add('assistant', 'second output', [secondReceipt.id]);
  await f.coordinator.prepare(signal());
  assert.deepEqual(f.observed.ingests[0].metadata.exposedDeliveries, [firstReceipt.id]);
  assert.deepEqual(f.observed.ingests[1].metadata.exposedDeliveries, [secondReceipt.id]);
});
test('incoming user text does not inherit an unrelated worker exposure', async () => {
  const f = fixture(); const prepared = await f.coordinator.prepare(signal());
  await f.coordinator.observe(prepared, 'boundary');
  f.add('user', 'new human input');
  await f.coordinator.prepare(signal());
  assert.deepEqual(f.observed.ingests[0].metadata.exposedDeliveries, []);
});
test('resealed capsule cannot introduce inheritance absent from the sealed request', async () => {
  const f = fixture(); const original = f.worker.capsule;
  f.worker.capsule = async request => {
    const value = await original(request);
    const inherited = new C.ReportedInheritance(C.InheritanceKind.Fork, 'foreign-scope', 1n, 1n, 1n, [], [], undefined);
    const payload = value.payload.with({ reportedContext: value.payload.reportedContext.with({ reportedInherited: [inherited] }) });
    return value.with({ payload, payloadDigest: digest(JSON.stringify(C.CapsulePayload.jsonCodec().encode(BaboonCodecContext.Default, payload))) });
  };
  await assert.rejects(f.coordinator.prepare(signal()), /capsule-mismatch/);
});
test('shutdown invalidates prepared observations', async () => {
  const f = fixture(); const prepared = await f.coordinator.prepare(signal());
  f.coordinator.close();
  await assert.rejects(f.coordinator.observe(prepared, 'boundary'));
  assert.equal(f.observed.deliveries.length, 0);
});
