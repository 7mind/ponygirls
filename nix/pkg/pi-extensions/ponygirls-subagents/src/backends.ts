import { randomUUID } from "node:crypto";
import { err } from "./errors.ts";
import { BACKEND_OFFER_CHANNEL, BACKEND_REQUEST_CHANNEL, parseBackendWorker, type BackendBus, type BackendOffer, type BackendRegistration, type BackendSession, type BackendSessionContext, type BackendWorkerDescriptor } from "./backend-contract.ts";
import type { IpcEnvelope } from "./protocol.ts";
import type { ResolvedModel } from "./types.ts";

export class BackendRegistry {
  private readonly registrations = new Map<string, BackendRegistration>();
  private readonly revocations = new Map<BackendRegistration, Set<() => void>>();
  private retired = false;

  register(registration: BackendRegistration): () => void {
    if (this.retired) throw err("MODEL_UNAVAILABLE", "backend registry is retired");
    if (registration.version !== 1 || typeof registration.id !== "string" || registration.id.length === 0 || !["worker", "parent"].includes(registration.usageOwnership) || typeof registration.claims !== "function" || typeof registration.worker !== "function" || typeof registration.createSession !== "function") throw err("INVALID", "incompatible backend registration");
    if (this.registrations.has(registration.id)) throw err("CONFLICT", `duplicate backend identity ${registration.id}`);
    this.registrations.set(registration.id, registration);
    this.revocations.set(registration, new Set());
    return () => {
      if (this.registrations.get(registration.id) !== registration) return;
      this.registrations.delete(registration.id);
      const listeners = this.revocations.get(registration)!;
      this.revocations.delete(registration);
      for (const revoke of listeners) revoke();
    };
  }

  select(model: ResolvedModel): BackendRegistration | null {
    const claims = [...this.registrations.values()].filter((backend) => backend.claims(model));
    if (claims.length > 1) throw err("CONFLICT", `multiple backends claim ${model.provider}/${model.id}: ${claims.map((backend) => backend.id).join(", ")}`);
    return claims[0] ?? null;
  }

  watch(registration: BackendRegistration, revoke: () => void): () => void {
    const listeners = this.revocations.get(registration);
    if (listeners === undefined) throw err("MODEL_UNAVAILABLE", "backend registration is unavailable");
    listeners.add(revoke);
    return () => { listeners.delete(revoke); };
  }

  retire(): void {
    this.retired = true;
    const listeners = [...this.revocations.values()].flatMap((entries) => [...entries]);
    this.registrations.clear();
    this.revocations.clear();
    for (const revoke of listeners) revoke();
  }
}

export function registerBackendHost(bus: BackendBus, registry: BackendRegistry): () => void {
  const unsubscribe = bus.on(BACKEND_OFFER_CHANNEL, (value) => {
    const offer = value as Partial<BackendOffer> | null;
    if (offer === null || typeof offer !== "object" || typeof offer.respond !== "function") return;
    try {
      if (offer.version !== 1 || offer.registration === undefined) throw new Error("incompatible backend offer");
      offer.respond({ ok: true, unregister: registry.register(offer.registration) });
    } catch (error) { offer.respond({ ok: false, error: error instanceof Error ? error.message : "backend registration failed" }); }
  });
  bus.emit(BACKEND_REQUEST_CHANNEL, { version: 1 });
  return () => { unsubscribe(); registry.retire(); };
}

export interface BackendSlotContext extends BackendSessionContext {
  reportFailure(error: unknown): void;
}

export class BackendSlot implements BackendSession {
  readonly worker: BackendWorkerDescriptor;
  readonly usageOwnership: BackendRegistration["usageOwnership"];
  private readonly id: string;
  private readonly receiptPrefix = randomUUID();
  private readonly currentRegistry: () => BackendRegistry;
  private readonly context: BackendSlotContext;
  private readonly envelopes = new WeakSet<IpcEnvelope>();
  private readonly closing = new Set<Promise<void>>();
  private active: { registry: BackendRegistry; registration: BackendRegistration; session: BackendSession; unwatch(): void } | null = null;
  private retired = false;

  constructor(registration: BackendRegistration, currentRegistry: () => BackendRegistry, context: BackendSlotContext) {
    this.id = registration.id;
    this.usageOwnership = registration.usageOwnership;
    this.currentRegistry = currentRegistry;
    this.context = context;
    this.worker = parseBackendWorker(registration.worker(context.model));
    if (this.worker.backendId !== registration.id) throw err("INVALID", "backend worker identity does not match registration");
  }

  async handle(payload: unknown, envelope: IpcEnvelope): Promise<unknown> {
    if (this.retired) throw err("MODEL_UNAVAILABLE", "backend session is retired");
    this.context.assertOwner(envelope);
    const registry = this.currentRegistry();
    const registration = registry.select(this.context.model);
    if (registration === null || registration.id !== this.id || registration.usageOwnership !== this.usageOwnership) throw err("MODEL_UNAVAILABLE", "selected backend is unavailable; reload the worker");
    if (this.active !== null && (this.active.registry !== registry || this.active.registration !== registration)) this.retireActive();
    await Promise.all(this.closing);
    if (this.retired) throw err("MODEL_UNAVAILABLE", "backend session is retired");
    this.context.assertOwner(envelope);
    if (this.currentRegistry() !== registry || registry.select(this.context.model) !== registration) throw err("MODEL_UNAVAILABLE", "backend registration changed");
    if (this.active === null) {
      const assertCurrent = (): void => {
        if (this.retired || this.currentRegistry() !== registry || registry.select(this.context.model) !== registration) throw err("MODEL_UNAVAILABLE", "backend registration was revoked");
      };
      const session = registration.createSession({
        model: this.context.model, cwd: this.context.cwd,
        assertOwner: (owned) => { assertCurrent(); this.context.assertOwner(owned); },
        receipt: (owned, receiptId, usage) => {
          if (this.usageOwnership !== "parent" || !this.envelopes.has(owned) || typeof receiptId !== "string" || receiptId.length === 0) throw err("INVALID", "backend usage sink identity mismatch");
          if (typeof usage !== "object" || usage === null || typeof usage.unknown !== "boolean" || (usage.reasoning !== undefined && (!Number.isFinite(usage.reasoning) || usage.reasoning < 0))) throw err("INVALID", "invalid backend usage receipt");
          const source = usage.sourceModel;
          if (source !== undefined && (typeof source !== "object" || source === null || ![source.provider, source.id, source.api].every((value) => typeof value === "string" && value.length > 0))) throw err("INVALID", "invalid backend usage source model");
          if (![usage.input, usage.output, usage.cacheRead, usage.cacheWrite].every((value) => Number.isFinite(value) && value >= 0) || (usage.cost !== null && (!Number.isFinite(usage.cost) || usage.cost < 0))) throw err("INVALID", "invalid backend usage receipt");
          return this.context.receipt(owned, `${this.receiptPrefix}:${receiptId}`, usage);
        },
      });
      this.active = { registry, registration, session, unwatch: registry.watch(registration, () => this.retireActive()) };
    }
    const owned = Object.freeze({ ...envelope });
    this.envelopes.add(owned);
    return this.active.session.handle(payload, owned);
  }

  cancel(): void { if (this.active !== null) this.active.session.cancel(); }

  refreshAuthority(): Promise<void> {
    this.retireActive();
    return Promise.all(this.closing).then(() => {});
  }

  dispose(): Promise<void> {
    this.retired = true;
    return this.refreshAuthority();
  }

  private retireActive(): void {
    const active = this.active;
    if (active === null) return;
    this.active = null;
    active.unwatch();
    active.session.cancel();
    const closing = active.session.dispose();
    this.closing.add(closing);
    void closing.then(() => this.closing.delete(closing), (error: unknown) => this.context.reportFailure(error));
  }
}
