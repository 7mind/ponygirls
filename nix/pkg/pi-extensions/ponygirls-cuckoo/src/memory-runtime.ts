import { randomUUID } from 'node:crypto';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { MEMORY_TYPE, MEMORY_VERSION, type MemoryPort, type MemoryRecord, type MemoryRuntime, type SessionView, type StoredMemoryRecord } from './memory-types.ts';

export class NativeMemoryPort implements MemoryPort {
  private readonly sessionId: string;
  private readonly pi: Pick<ExtensionAPI, 'appendEntry'>;
  private readonly manager: ExtensionContext['sessionManager'];
  constructor(pi: Pick<ExtensionAPI, 'appendEntry'>, manager: ExtensionContext['sessionManager']) {
    this.pi = pi; this.manager = manager; this.sessionId = manager.getSessionId();
  }
  view(): SessionView {
    if (this.manager.getSessionId() !== this.sessionId) throw new Error('Cuckoo memory session changed');
    return { sessionId: this.sessionId, entries: this.manager.getEntries(), branch: this.manager.getBranch() };
  }
  append(record: MemoryRecord): StoredMemoryRecord {
    const before = new Set(this.view().entries.map(entry => entry.id));
    this.pi.appendEntry(MEMORY_TYPE, { version: MEMORY_VERSION, record: structuredClone(record) });
    // appendEntry returns no ID; another synchronous observer may append after us.
    const appended = this.view().branch.filter(entry => {
      if (before.has(entry.id) || entry.type !== 'custom' || entry.customType !== MEMORY_TYPE) return false;
      const data: unknown = entry.data;
      return typeof data === 'object' && data !== null && 'version' in data && data.version === MEMORY_VERSION && 'record' in data &&
        typeof data.record === 'object' && data.record !== null && 'id' in data.record && data.record.id === record.id;
    });
    if (appended.length !== 1) throw new Error('Cuckoo memory append identity was not observed exactly once on this branch');
    return { entryId: appended[0].id, timestamp: appended[0].timestamp, branch: 'current', record: structuredClone(record) };
  }
}

export class MemoryScopeEpoch {
  private generation = 0;
  private readonly instanceId: string;
  constructor(instanceId: string) {
    if (instanceId.length === 0) throw new Error('Cuckoo memory scope instance is required');
    this.instanceId = instanceId;
  }
  advance(): void { this.generation++; }
  key(sessionId: string): string { return `${this.instanceId}:${this.generation}:${sessionId}`; }
}

export function nativeMemoryRuntime(): MemoryRuntime {
  return { newId: () => randomUUID(), now: () => new Date().toISOString() };
}
