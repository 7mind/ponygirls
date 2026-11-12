import {
  ActorKind, Capability, Capsule, CapsulePayload, CapsuleRequest, CaptureContext,
  DeliveryBoundary, DeliveryCutComparison, DeliveryReceipt, DeliveryRequest,
  IngestRequest, LineageStatus, OriginContext_ReportedNative, ReportedBoundaryDigest,
} from '../../generated/typescript/ontology/api/index.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';
import { captureEntry, captureSourceId, reportedContext, type NativeAttachment, type NativeEntry } from './capture.js';
import { WorkerFailure } from './http.js';
import type { WorkerService } from './service.js';

export interface NativeView {
  readonly attachment: NativeAttachment;
  readonly stamp: string;
  readonly entries: readonly NativeEntry[];
}
export interface CoordinatorSettings {
  readonly scope: string;
  readonly workContext: string;
  readonly workerActorId: string;
  readonly collectorActorId: string;
  readonly collectorNamespace: string;
  readonly boundaryDeadlineMs: number;
  readonly pollEveryMs: number;
  readonly maxNewEntries: number;
  readonly maxTrackedEntries: number;
  readonly maxCaptureTextBytes: number;
  readonly maxCapsuleBytes: number;
}
export interface CoordinatorRuntime {
  id(): string;
  now(): number;
  digest(text: string): string;
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
  current(): NativeView;
  exposedDeliveries(entryId: string): readonly string[];
}
export interface PreparedBoundary {
  readonly id: string;
  readonly stamp: string;
  readonly capsule: Capsule;
  readonly signal: AbortSignal;
}
interface CapturePending { readonly request: IngestRequest; readonly fingerprint: string }
interface DeliveryPending { readonly request: DeliveryRequest; readonly capsule: Capsule }
function insist(value: boolean, code: string): asserts value {
  if (!value) throw new WorkerFailure(code, 'not-sent');
}
function encodedContext(context: CaptureContext): string {
  return JSON.stringify(CaptureContext.jsonCodec().encode(BaboonCodecContext.Default, context));
}
export class WorkerCoordinator {
  private readonly stop = new AbortController();
  private readonly seen = new Map<string, string | null>();
  private readonly pending = new Map<string, CapturePending>();
  private previousCapsuleId: string | undefined;
  private pendingCapsule: CapsuleRequest | null = null;
  private pendingDelivery: DeliveryPending | null = null;
  private busy = false;
  private prepared: PreparedBoundary | null = null;
  private frontier = 0n;
  private readonly origin: string;
  constructor(private readonly settings: CoordinatorSettings, private readonly worker: WorkerService,
    private readonly collector: WorkerService, private readonly runtime: CoordinatorRuntime, private readonly initial: NativeView) {
    for (const value of [settings.scope, settings.workContext, settings.workerActorId, settings.collectorActorId, settings.collectorNamespace]) insist(value.trim().length > 0, 'invalid-worker-config');
    for (const value of [settings.boundaryDeadlineMs, settings.pollEveryMs, settings.maxNewEntries, settings.maxTrackedEntries, settings.maxCaptureTextBytes, settings.maxCapsuleBytes]) {
      insist(Number.isSafeInteger(value) && value > 0, 'invalid-worker-bound');
    }
    insist(settings.boundaryDeadlineMs <= 60_000 && settings.pollEveryMs < settings.boundaryDeadlineMs && settings.maxNewEntries <= settings.maxTrackedEntries, 'invalid-worker-bound');
    insist(initial.entries.length <= settings.maxTrackedEntries, 'attachment-capacity');
    for (const entry of initial.entries) { insist(!this.seen.has(entry.id), 'duplicate-native-entry'); this.seen.set(entry.id, null); }
    this.origin = JSON.stringify(initial.attachment);
  }
  close(): void { this.stop.abort(); this.prepared = null; }
  private current(stamp: string, signal: AbortSignal): void {
    signal.throwIfAborted();
    const view = this.runtime.current();
    insist(JSON.stringify(view.attachment) === this.origin && view.stamp === stamp, 'native-context-changed');
  }
  async prepare(signal: AbortSignal): Promise<PreparedBoundary> {
    const result = await this.synchronize(signal, true);
    insist(result !== null, 'missing-prepared-boundary');
    return result;
  }
  async flush(signal: AbortSignal): Promise<void> { await this.synchronize(signal, false); }
  private async synchronize(signal: AbortSignal, prepareCapsule: boolean): Promise<PreparedBoundary | null> {
    insist(!this.busy, 'boundary-busy');
    this.busy = true;
    this.prepared = null;
    const bounded = AbortSignal.any([signal, this.stop.signal, AbortSignal.timeout(this.settings.boundaryDeadlineMs)]);
    try {
      const view = this.runtime.current();
      this.current(view.stamp, bounded);
      insist(view.entries.length <= this.settings.maxTrackedEntries, 'attachment-capacity');
      const worker = await this.worker.identity(bounded); this.current(view.stamp, bounded);
      insist(worker.actor.id === this.settings.workerActorId && worker.actor.kind === ActorKind.Agent &&
        worker.scopes.includes(this.settings.scope) && worker.capabilities.includes(Capability.Read), 'worker-identity');
      const collector = await this.collector.identity(bounded); this.current(view.stamp, bounded);
      insist(collector.actor.id === this.settings.collectorActorId && collector.actor.kind === ActorKind.Collector &&
        collector.scopes.includes(this.settings.scope) && collector.capabilities.includes(Capability.Capture), 'collector-identity');
      if (this.pendingDelivery !== null) {
        const pending = this.pendingDelivery;
        const receipt = await this.worker.delivery(pending.request, bounded);
        this.validateDelivery(receipt, pending);
        this.pendingDelivery = null;
        this.current(view.stamp, bounded);
      }
      const fresh = view.entries.filter(entry => !this.seen.has(entry.id));
      insist(fresh.length <= this.settings.maxNewEntries && this.seen.size + fresh.length <= this.settings.maxTrackedEntries, 'capture-capacity');
      const unique = new Set<string>();
      for (const entry of view.entries) {
        insist(!unique.has(entry.id), 'duplicate-native-entry'); unique.add(entry.id);
        const fingerprint = this.runtime.digest(JSON.stringify(entry));
        const retained = this.seen.get(entry.id);
        insist(retained === undefined || retained === null || retained === fingerprint, 'native-entry-changed');
      }
      for (const entry of fresh) {
        this.current(view.stamp, bounded);
        const fingerprint = this.runtime.digest(JSON.stringify(entry));
        let pending = this.pending.get(entry.id);
        if (pending === undefined) {
          const request = captureEntry(this.settings.scope, view.attachment, entry,
            { requestId: this.runtime.id(), eventId: this.runtime.id() }, this.runtime.exposedDeliveries(entry.id),
            { maxTextBytes: this.settings.maxCaptureTextBytes });
          if (request === null) { this.seen.set(entry.id, fingerprint); continue; }
          pending = { request, fingerprint }; this.pending.set(entry.id, pending);
        }
        insist(pending.fingerprint === fingerprint, 'native-entry-changed');
        const ack = await this.collector.ingest(pending.request, bounded);
        insist(ack.scope === this.settings.scope && ack.requestId === pending.request.requestId && ack.eventId === pending.request.eventId &&
          ack.sourceNamespace === this.settings.collectorNamespace && ack.frontier > 0n && ack.artifacts.length === 0 &&
          ack.source.revision === 1 && ack.source.id === captureSourceId(this.settings.collectorNamespace, pending.request.eventId), 'capture-ack-mismatch');
        this.seen.set(entry.id, fingerprint); this.pending.delete(entry.id);
        this.frontier = ack.frontier > this.frontier ? ack.frontier : this.frontier;
        this.current(view.stamp, bounded);
      }
      if (!prepareCapsule) return null;
      let status = await this.worker.status(this.settings.scope, bounded); this.current(view.stamp, bounded);
      for (;;) {
        insist(status.scope === this.settings.scope && status.frontier >= this.frontier && status.coveredFrontier <= status.frontier, 'status-mismatch');
        if (status.coveredFrontier === status.frontier) break;
        if (['Failed', 'Stale', 'Interrupted'].includes(status.state)) throw new WorkerFailure('curation-unavailable', 'not-sent');
        await this.runtime.sleep(this.settings.pollEveryMs, bounded); this.current(view.stamp, bounded);
        status = await this.worker.status(this.settings.scope, bounded); this.current(view.stamp, bounded);
      }
      const request = this.pendingCapsule ?? new CapsuleRequest(this.settings.scope, this.runtime.id(), this.settings.workContext,
        reportedContext(view.attachment), status.frontier, this.previousCapsuleId);
      this.pendingCapsule = request;
      let capsule: Capsule;
      try { capsule = await this.worker.capsule(request, bounded); }
      catch (error) {
        if (error instanceof WorkerFailure && error.outcome === 'rejected' && error.code === 'stale-frontier') this.pendingCapsule = null;
        throw error;
      }
      this.current(view.stamp, bounded);
      const payload = capsule.payload;
      const reported = payload.reportedContext.origin;
      insist(capsule.requestId === request.requestId && capsule.owner.id === worker.actor.id && capsule.owner.kind === worker.actor.kind &&
        payload.scope === request.scope && payload.workContext === request.workContext && payload.previousCapsuleId === request.previousCapsuleId &&
        payload.cut.frontier === request.expectedFrontier && payload.cut.coveredFrontier <= payload.cut.frontier &&
        payload.reportedContext.reportedInherited.length === 0 && reported instanceof OriginContext_ReportedNative && encodedContext(reported.context) === encodedContext(new CaptureContext(
          view.attachment.sessionId, undefined, undefined, LineageStatus.Unknown, view.attachment.branch, view.attachment.epoch)), 'capsule-mismatch');
      const bytes = JSON.stringify(CapsulePayload.jsonCodec().encode(BaboonCodecContext.Default, payload));
      insist(Buffer.byteLength(bytes, 'utf8') <= this.settings.maxCapsuleBytes && this.runtime.digest(bytes) === capsule.payloadDigest, 'capsule-digest');
      this.pendingCapsule = null;
      insist(payload.cut.frontier === status.frontier && payload.cut.coveredFrontier === status.frontier &&
        payload.cut.generation >= status.generation && request.previousCapsuleId === this.previousCapsuleId, 'capsule-stale');
      const result = { id: this.runtime.id(), stamp: view.stamp, capsule, signal: bounded };
      this.prepared = result;
      return result;
    } finally { this.busy = false; }
  }
  async observe(prepared: PreparedBoundary, boundaryPayload: string): Promise<DeliveryReceipt> {
    insist(this.prepared === prepared && !this.busy, 'boundary-not-current');
    this.prepared = null;
    this.busy = true;
    try {
      this.current(prepared.stamp, prepared.signal);
      const request = new DeliveryRequest(this.settings.scope, this.runtime.id(), prepared.capsule.id, prepared.capsule.payloadDigest,
        this.settings.workContext, reportedContext(this.initial.attachment), DeliveryBoundary.ExtensionContext,
        new Date(this.runtime.now()).toISOString(), new ReportedBoundaryDigest('pi-extension-context-json-v1', this.runtime.digest(boundaryPayload)));
      const pending = { request, capsule: prepared.capsule };
      this.pendingDelivery = pending;
      const receipt = await this.worker.delivery(request, prepared.signal);
      const sameCut = this.validateDelivery(receipt, pending);
      this.pendingDelivery = null;
      this.current(prepared.stamp, prepared.signal);
      insist(sameCut, 'delivery-cut-changed');
      this.previousCapsuleId = prepared.capsule.id;
      return receipt;
    } finally { this.busy = false; }
  }
  private validateDelivery(receipt: DeliveryReceipt, pending: DeliveryPending): boolean {
      const { request, capsule } = pending;
      insist(receipt.requestId === request.requestId && receipt.capsuleId === request.capsuleId && receipt.capsulePayloadDigest === request.capsulePayloadDigest &&
        receipt.owner.id === this.settings.workerActorId && receipt.owner.kind === ActorKind.Agent && receipt.scope === request.scope &&
        receipt.workContext === request.workContext && receipt.boundary === request.boundary && receipt.reportedAt === request.reportedAt &&
        receipt.reportedBoundaryPayload?.digest === request.reportedBoundaryPayload?.digest &&
        receipt.reportedBoundaryPayload?.encoding === request.reportedBoundaryPayload?.encoding, 'delivery-mismatch');
      const before = capsule.payload.cut;
      const after = receipt.observedCut;
      const origin = receipt.reportedContext.origin;
      insist(origin instanceof OriginContext_ReportedNative && receipt.reportedContext.reportedInherited.length === 0 &&
        encodedContext(origin.context) === encodedContext(new CaptureContext(this.initial.attachment.sessionId, undefined, undefined,
          LineageStatus.Unknown, this.initial.attachment.branch, this.initial.attachment.epoch)), 'delivery-context-mismatch');
      const sameCut = after.generation === before.generation && after.frontier === before.frontier &&
        after.coveredFrontier === before.coveredFrontier && after.lastPublicationGeneration === before.lastPublicationGeneration;
      insist(receipt.cutComparison === (sameCut ? DeliveryCutComparison.SameGraphAndCoverage : DeliveryCutComparison.ChangedGraphOrCoverage), 'delivery-cut-mismatch');
      insist(after.generation >= before.generation && after.frontier >= before.frontier && after.coveredFrontier >= before.coveredFrontier &&
        after.coveredFrontier <= after.frontier, 'delivery-cut-regressed');
      return sameCut;
  }
}
