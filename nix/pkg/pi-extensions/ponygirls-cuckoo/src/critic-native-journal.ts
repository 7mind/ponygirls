import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {
  REFLECTION_NAMESPACE,
  type CriticEnvelope,
  type CriticStoragePort,
} from './experiments/reflection-critic.ts';
import type { CriticSdkAudit } from './experiments/critic-sdk-client.ts';

export const CRITIC_AUDIT_TYPE = 'cuckoo.critic.sdk-audit';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Native accounting journal. The owner guard deliberately does not require
 * feature enablement: genuine same-owner settlement remains recordable OFF.
 */
export class CriticNativeJournal implements CriticStoragePort {
  private readonly pi: ExtensionAPI;
  private readonly context: () => ExtensionContext;
  private readonly assertOwner: () => void;
  private readonly newId: () => string;

  constructor(
    pi: ExtensionAPI,
    context: () => ExtensionContext,
    assertOwner: () => void,
    newId: () => string,
  ) {
    this.pi = pi;
    this.context = context;
    this.assertOwner = assertOwner;
    this.newId = newId;
  }

  load(namespace: typeof REFLECTION_NAMESPACE): readonly CriticEnvelope[] {
    if (namespace !== REFLECTION_NAMESPACE) {
      throw new Error('Invalid critic journal namespace');
    }
    this.assertOwner();

    const result: CriticEnvelope[] = [];
    for (const entry of this.context().sessionManager.getEntries()) {
      if (
        entry.type !== 'custom' ||
        entry.customType !== REFLECTION_NAMESPACE
      ) {
        continue;
      }

      if (
        !object(entry.data) ||
        entry.data.namespace !== REFLECTION_NAMESPACE ||
        !object(entry.data.record)
      ) {
        throw new Error('Malformed native critic journal');
      }

      // Full strict replay validation remains inside ReflectionCritic.
      result.push(
        structuredClone(entry.data) as unknown as CriticEnvelope,
      );
    }
    return result;
  }

  private appendObserved(
    type: string,
    data: unknown,
    identity: (value: unknown) => boolean,
  ): void {
    this.assertOwner();
    const ctx = this.context();
    const file = ctx.sessionManager.getSessionFile();

    if (typeof file !== 'string' || file.length === 0) {
      throw new Error(
        'Critic network work requires a persisted native session',
      );
    }

    const before = new Set(
      ctx.sessionManager.getEntries().map(entry => entry.id),
    );
    const encoded = JSON.stringify(data);

    this.pi.appendEntry(type, structuredClone(data));
    this.assertOwner();

    const matches = ctx.sessionManager.getEntries().filter(entry =>
      !before.has(entry.id) &&
      entry.type === 'custom' &&
      entry.customType === type &&
      identity(entry.data) &&
      JSON.stringify(entry.data) === encoded);

    if (matches.length !== 1) {
      throw new Error('Critic native append was not observed exactly once');
    }
  }

  tryAppend(envelope: CriticEnvelope): boolean {
    if (
      envelope.namespace !== REFLECTION_NAMESPACE ||
      envelope.version !== 1
    ) {
      throw new Error('Invalid critic journal envelope');
    }

    const records = this.load(REFLECTION_NAMESPACE)
      .map(item => item.record);
    const record = envelope.record;

    if (records.some(item => item.id === record.id)) return false;

    if (
      record.kind === 'terminal' &&
      records.some(item =>
        item.kind === 'terminal' &&
        item.startId === record.startId)
    ) {
      return false;
    }

    if (
      record.kind === 'start' &&
      record.trigger === 'automatic' &&
      records.some(item =>
        item.kind === 'start' &&
        item.identity === record.identity)
    ) {
      return false;
    }

    if (
      record.kind === 'transport' &&
      records.some(item =>
        item.kind === 'transport' &&
        item.startId === record.startId &&
        item.observation === record.observation)
    ) {
      return false;
    }

    this.appendObserved(
      REFLECTION_NAMESPACE,
      envelope,
      value =>
        object(value) &&
        object(value.record) &&
        value.record.id === record.id,
    );
    return true;
  }

  audit(event: CriticSdkAudit): void {
    const id = this.newId();
    if (id.length === 0 || id.length > 128) {
      throw new Error('Invalid critic audit identity');
    }

    this.appendObserved(
      CRITIC_AUDIT_TYPE,
      { version: 1, id, event },
      value => object(value) && value.id === id,
    );
  }
}
