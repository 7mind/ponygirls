import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { wirePlan } from '../../generated/typescript/GeneratedWirePlan.js';
import { WireValidation } from '../../web/src/wire-validation.js';
import { FileCredentials, loadConfig, type WorkerConfig } from './config.js';
import { WorkerCoordinator, type NativeView, type PreparedBoundary } from './coordinator.js';
import { HttpWorkerService } from './service.js';
import { OntologyHttp, WorkerFailure } from './http.js';
import type { NativeAttachment } from './capture.js';
import { ExposureLedger, MAX_EXPOSURE_RECEIPTS } from './exposures.js';

interface Stage {
  readonly serial: number;
  readonly original: AgentMessage[];
  readonly owned: AgentMessage;
  readonly prepared: PreparedBoundary;
}
const STATUS_KEY = 'ontology-sidecar';
function digest(text: string): string { return createHash('sha256').update(text).digest('hex'); }
function diagnostic(error: unknown): string {
  return error instanceof WorkerFailure && /^[a-z][a-z0-9-]{0,63}$/.test(error.code) ? error.code : 'alignment-unavailable';
}
export default function ontologySidecar(pi: ExtensionAPI): void {
  pi.registerFlag('ontology-config', { description: 'Explicit authorized ontology sidecar configuration; no history backfill', type: 'string' });
  let generation = 0;
  let serial = 0;
  let config: WorkerConfig | null = null;
  let coordinator: WorkerCoordinator | null = null;
  let stage: Stage | null = null;
  let owner = new AbortController();
  let currentReceipts: string[] = [];
  let exposures: ExposureLedger | null = null;
  const status = (ctx: ExtensionContext, text: string) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, text);
    else process.stderr.write(text + '\n');
  };
  const stop = () => {
    generation++; serial++; owner.abort();
    if (coordinator !== null) coordinator.close();
    coordinator = null; stage = null; currentReceipts = [];
    if (exposures !== null) exposures.clear();
    exposures = null;
  };
  const attach = (ctx: ExtensionContext, settings: WorkerConfig) => {
    const runtimeGeneration = generation;
    const ledger = new ExposureLedger(settings.coordinator.maxTrackedEntries);
    exposures = ledger;
    const attachment: NativeAttachment = { sessionId: ctx.sessionManager.getSessionId(), branch: randomUUID(), epoch: randomUUID() };
    const current = (): NativeView => {
      if (runtimeGeneration !== generation || owner.signal.aborted) throw new WorkerFailure('attachment-obsolete', 'not-sent');
      const branch = ctx.sessionManager.getBranch();
      if (branch.length > settings.coordinator.maxTrackedEntries) throw new WorkerFailure('attachment-capacity', 'not-sent');
      const entries = branch.map(entry => ({ id: entry.id, parentId: entry.parentId, type: entry.type,
        message: entry.type === 'message' ? entry.message : null }));
      return { attachment, entries, stamp: `${runtimeGeneration}:${serial}:${ctx.sessionManager.getSessionId()}:${ctx.sessionManager.getLeafId()}:${digest(JSON.stringify(entries.map(entry => entry.id)))}` };
    };
    const validation = new WireValidation(wirePlan);
    const worker = new HttpWorkerService(new OntologyHttp(settings.http, new FileCredentials(settings.workerTokenFile), fetch, validation));
    const collector = new HttpWorkerService(new OntologyHttp(settings.http, new FileCredentials(settings.collectorTokenFile), fetch, validation));
    coordinator = new WorkerCoordinator(settings.coordinator, worker, collector, {
      id: randomUUID, now: Date.now, digest, current,
      sleep: (milliseconds, signal) => delay(milliseconds, undefined, { signal }),
      exposedDeliveries: entryId => ledger.get(entryId),
    }, current());
    status(ctx, 'ontology: attached from now; prior pending replay unavailable; ordinary context retained');
  };
  pi.on('session_start', async (_event, ctx) => {
    stop(); owner = new AbortController(); config = null;
    const path = pi.getFlag('ontology-config');
    if (path === undefined || path === '') return;
    const expectedGeneration = generation;
    try {
      if (typeof path !== 'string') throw new WorkerFailure('invalid-config-flag', 'not-sent');
      const loaded = await loadConfig(path, owner.signal);
      if (expectedGeneration !== generation) return;
      config = loaded; attach(ctx, loaded);
    } catch (error) { if (expectedGeneration === generation) status(ctx, 'ontology: ' + diagnostic(error)); }
  });
  pi.on('session_shutdown', (_event, ctx) => {
    stop(); config = null;
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });
  pi.on('session_tree', (_event, ctx) => {
    stop(); owner = new AbortController();
    if (config !== null) {
      try { attach(ctx, config); } catch (error) { status(ctx, 'ontology: ' + diagnostic(error)); }
    }
  });
  pi.on('turn_start', () => { currentReceipts = []; stage = null; });
  pi.on('context_with_system', async (event, ctx) => {
    serial++; stage = null;
    const active = coordinator;
    if (active === null) return;
    const requestSerial = serial;
    const original = event.messages;
    try {
      const prepared = await active.prepare(ctx.signal ?? owner.signal);
      if (requestSerial !== serial || active !== coordinator) throw new WorkerFailure('boundary-obsolete', 'not-sent');
      const owned: AgentMessage = { role: 'custom', customType: 'ontology-derived-context', display: false,
        timestamp: Date.now(), content: 'Derived ontology account. Not execution permission, authenticated Human intent, or independent evidence.\n' + prepared.capsule.payload.text };
      stage = { serial: requestSerial, original, owned, prepared };
      return { messages: [...original, owned] };
    } catch (error) {
      status(ctx, 'ontology: ' + diagnostic(error) + '; ordinary context retained');
      return { messages: original };
    }
  });
  pi.on('context_with_system', async (event, ctx) => {
    const observed = stage; stage = null;
    const active = coordinator;
    if (observed === null || active === null) return;
    try {
      if (observed.serial !== serial || event.messages.length !== observed.original.length + 1 ||
          event.messages[event.messages.length - 1] !== observed.owned ||
          !observed.original.every((message, index) => event.messages[index] === message)) throw new WorkerFailure('boundary-slot-mismatch', 'not-sent');
      if (currentReceipts.length >= MAX_EXPOSURE_RECEIPTS) throw new WorkerFailure('exposure-capacity', 'not-sent');
      const receipt = await active.observe(observed.prepared, JSON.stringify(event.messages));
      if (observed.serial !== serial || active !== coordinator) throw new WorkerFailure('boundary-obsolete', 'not-sent');
      currentReceipts.push(receipt.id);
      status(ctx, 'ontology: extension-context observation recorded; provider use unverified');
      return { messages: event.messages };
    } catch (error) {
      status(ctx, 'ontology: ' + diagnostic(error) + '; ordinary context retained');
      return { messages: observed.original };
    }
  });
  pi.on('turn_end', (event, ctx) => {
    if (exposures === null || currentReceipts.length === 0) return;
    try {
      if (config === null || event.toolResultEntryIds.length >= config.coordinator.maxTrackedEntries) throw new WorkerFailure('exposure-capacity', 'not-sent');
      exposures.record([event.messageEntryId, ...event.toolResultEntryIds], currentReceipts);
    } catch (error) {
      stop();
      status(ctx, 'ontology: ' + diagnostic(error) + '; capture tracking stopped; ordinary context retained');
    }
  });
  pi.on('agent_settled', async (_event, ctx) => {
    serial++; stage = null;
    const active = coordinator;
    if (active === null) return;
    try { await active.flush(owner.signal); }
    catch (error) { status(ctx, 'ontology: ' + diagnostic(error) + '; final capture unavailable'); }
  });
}
