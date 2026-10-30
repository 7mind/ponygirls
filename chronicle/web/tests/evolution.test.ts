import test from 'node:test';
import assert from 'node:assert/strict';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.ts';
import { CollectorCounters, CollectorProgressUpdate, CollectorProgressAck, CollectorStatus, CollectorStatusResult, CollectorPhase, CollectorProgressUpdate_JsonCodec, CollectorProgressAck_JsonCodec, Result_CollectionStatus, ServerEnvelope, ServerEnvelope_JsonCodec, JobState, JobInfo, JobInfo_JsonCodec, IndexingFailureStage } from '../src/api.ts';
const ctx = BaboonCodecContext.Default;
const id = '00000000-0000-4000-8000-000000000001';
test('BA specified: failure-stage encoder emits present-null or recorded stages; generated TS decoder accepts missing as unknown', () => {
  for (const stage of [undefined, IndexingFailureStage.Annotation, IndexingFailureStage.Embedding, IndexingFailureStage.Publication]) {
    const job = new JobInfo(id, id, 1, JobState.Failed, 1, 'synthetic', 0, undefined, stage), encoded = JobInfo_JsonCodec.instance.encode(ctx, job) as Record<string, unknown>;
    assert.equal(Object.hasOwn(encoded, 'failureStage'), true); assert.equal(encoded.failureStage, stage === undefined ? null : stage); assert.equal(JobInfo_JsonCodec.instance.decode(ctx, encoded).failureStage, stage);
    const missing = { ...encoded }; delete missing.failureStage; assert.equal(JobInfo_JsonCodec.instance.decode(ctx, missing).failureStage, undefined);
  }
});
test('BA specified: collector wire codecs preserve i64 and nullable progress, not number-rounded counters', () => {
  const report = new CollectorProgressUpdate('collector', 9007199254740993n, id, CollectorPhase.Uploading, '2026-10-26T00:00:00Z', new CollectorCounters(1,2,3,4,5,6,7,8,9,10,11,12,9007199254740993n), 10000000000n, 9000000000n, undefined, undefined);
  const encoded = CollectorProgressUpdate_JsonCodec.instance.encode(ctx, report);
  const decoded = CollectorProgressUpdate_JsonCodec.instance.decode(ctx, JSON.parse(JSON.stringify(encoded)));
  assert.equal(decoded.sequence, 9007199254740993n); assert.equal(decoded.counters.scannedBytes, 9007199254740993n); assert.equal(decoded.currentUploadTotalBytes, undefined);
  assert.deepEqual(CollectorProgressUpdate_JsonCodec.instance.encode(ctx, decoded), encoded);
  const ack = new CollectorProgressAck(report.sequence, false);
  assert.equal(CollectorProgressAck_JsonCodec.instance.decode(ctx, CollectorProgressAck_JsonCodec.instance.encode(ctx, ack)).sequence, report.sequence);
  const envelope = new ServerEnvelope(id, new Result_CollectionStatus(new CollectorStatusResult([new CollectorStatus(report, '2026-10-26T00:01:00Z', true)])));
  const frame = ServerEnvelope_JsonCodec.instance.encode(ctx, envelope);
  assert.deepEqual(ServerEnvelope_JsonCodec.instance.encode(ctx, ServerEnvelope_JsonCodec.instance.decode(ctx, frame)), frame);
});
