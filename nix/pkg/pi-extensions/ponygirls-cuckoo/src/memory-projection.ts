import type {
  MemoryId,
  MemoryRecord,
  RecordState,
  SourceResolution,
  StoredMemoryRecord,
} from './memory-types.ts';

/**
 * Source status for one snapshot record, keyed by the snapshot's own memory id.
 * A snapshot absent from `sources` is treated as `available` (no recorded
 * source problem). `SourceResolution['status']` is
 * 'available' | 'unavailable' | 'changed' | 'out-of-scope'.
 */
export interface SnapshotSourceState {
  readonly id: MemoryId;
  readonly status: SourceResolution['status'];
}

interface Cause {
  readonly id: MemoryId;
  readonly reason: string;
}

function isRecordKind(kind: string): boolean {
  return (
    kind === 'task' ||
    kind === 'snapshot' ||
    kind === 'claim' ||
    kind === 'correction' ||
    kind === 'check-start' ||
    kind === 'check-result'
  );
}

function isSourceStatus(value: string): value is SourceResolution['status'] {
  return (
    value === 'available' ||
    value === 'unavailable' ||
    value === 'changed' ||
    value === 'out-of-scope'
  );
}

function isCorrectionTargetKind(record: MemoryRecord): boolean {
  return record.kind === 'claim' || (record.kind === 'snapshot' && record.purpose === 'artifact');
}

function checkedDependencies(ids: readonly MemoryId[]): readonly MemoryId[] {
  if (new Set(ids).size !== ids.length) {
    throw new Error('projectStates: record lists a dependency more than once');
  }
  return [...ids];
}

function compareIds(a: MemoryId, b: MemoryId): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sortIds(ids: readonly MemoryId[]): MemoryId[] {
  return Array.from(new Set(ids)).sort(compareIds);
}

function dedupeCauses(causes: readonly Cause[]): Cause[] {
  const seen = new Set<MemoryId>();
  const out: Cause[] = [];
  for (const cause of causes) {
    if (seen.has(cause.id)) continue;
    seen.add(cause.id);
    out.push(cause);
  }
  return out;
}

function assertStoredRecord(value: StoredMemoryRecord): void {
  if (value === null || typeof value !== 'object') {
    throw new Error('projectStates: stored memory record must be an object');
  }
  if (typeof value.branch !== 'string') {
    throw new Error('projectStates: stored memory record must carry a branch');
  }
  const record = value.record;
  if (record === null || typeof record !== 'object') {
    throw new Error(`projectStates: stored memory record for entry ${String(value.entryId)} must carry a record`);
  }
  if (typeof record.id !== 'string' || record.id.length === 0) {
    throw new Error('projectStates: memory record must have a nonempty string id');
  }
  if (typeof record.taskId !== 'string' || record.taskId.length === 0) {
    throw new Error('projectStates: memory record must have a nonempty string taskId');
  }
  if (typeof record.kind !== 'string' || !isRecordKind(record.kind)) {
    throw new Error(`projectStates: unsupported memory record kind ${String(record.kind)}`);
  }
}

/**
 * Declared (non-transitive) dependency identifiers of a record.
 * Explicit correction targets are intentionally excluded: a correction's own
 * action must not invalidate the correction.
 */
export function recordDependencies(record: MemoryRecord): readonly MemoryId[] {
  switch (record.kind) {
    case 'task':
      return [];
    case 'snapshot':
      return checkedDependencies(record.dependsOn);
    case 'claim':
      return checkedDependencies([...record.dependsOn, ...record.evidenceIds]);
    case 'correction':
      return checkedDependencies([...record.evidenceIds, ...record.replacementIds]);
    case 'check-start':
      return checkedDependencies([record.artifact.id, ...record.evidence.map((binding) => binding.id)]);
    case 'check-result':
      return checkedDependencies([record.startId]);
  }
  throw new Error(`Unsupported memory record kind: ${String((record as MemoryRecord).kind)}`);
}

function computeState(
  stored: StoredMemoryRecord,
  dependencies: ReadonlyMap<MemoryId, readonly MemoryId[]>,
  sourceStatus: ReadonlyMap<MemoryId, SourceResolution['status']>,
  supersededBy: ReadonlyMap<MemoryId, readonly MemoryId[]>,
  computed: ReadonlyMap<MemoryId, RecordState>,
): RecordState {
  const record = stored.record;
  const correcting = supersededBy.get(record.id);
  if (correcting !== undefined) {
    const ids = sortIds(correcting);
    return {
      id: record.id,
      status: 'superseded',
      reasons: ids.map((correctionId) => `superseded by correction ${correctionId}`),
      supersededBy: ids,
      invalidatedBy: ids,
    };
  }

  const causes: Cause[] = [];
  if (record.kind === 'snapshot') {
    const status = sourceStatus.get(record.id);
    if (status !== undefined && status !== 'available') {
      causes.push({ id: record.id, reason: `source ${status}` });
    }
  }
  const declared = dependencies.get(record.id) ?? [];
  for (const dependencyId of declared) {
    const dependencyState = computed.get(dependencyId);
    if (dependencyState !== undefined && dependencyState.status !== 'active') {
      causes.push({ id: dependencyId, reason: `depends on ${dependencyState.status} ${dependencyId}` });
    }
  }

  if (causes.length === 0) {
    return { id: record.id, status: 'active', reasons: [], supersededBy: [], invalidatedBy: [] };
  }

  const sorted = dedupeCauses(causes).sort((a, b) => compareIds(a.id, b.id));
  return {
    id: record.id,
    status: 'needs-recheck',
    reasons: sorted.map((cause) => cause.reason),
    supersededBy: [],
    invalidatedBy: sorted.map((cause) => cause.id),
  };
}

export function projectStates(
  records: readonly StoredMemoryRecord[],
  sources: readonly SnapshotSourceState[],
): readonly RecordState[] {
  // A. Shape, current-branch, and duplicate-id validation; index by id.
  const byId = new Map<MemoryId, StoredMemoryRecord>();
  for (const stored of records) {
    assertStoredRecord(stored);
    if (stored.branch !== 'current') {
      throw new Error(
        `projectStates: record ${stored.record.id} is on branch '${stored.branch}'; only current-branch records are accepted`,
      );
    }
    if (byId.has(stored.record.id)) {
      throw new Error(`projectStates: duplicate memory record id ${stored.record.id}`);
    }
    byId.set(stored.record.id, stored);
  }

  // B. Declared dependencies with dangling / self / cross-task / duplicate validation.
  const dependencies = new Map<MemoryId, readonly MemoryId[]>();
  for (const stored of records) {
    const record = stored.record;
    const declared = recordDependencies(record);
    const seen = new Set<MemoryId>();
    const validated: MemoryId[] = [];
    for (const dependencyId of declared) {
      if (dependencyId === record.id) {
        throw new Error(`projectStates: record ${record.id} depends on itself`);
      }
      if (seen.has(dependencyId)) {
        throw new Error(`projectStates: record ${record.id} lists dependency ${dependencyId} more than once`);
      }
      seen.add(dependencyId);
      const target = byId.get(dependencyId);
      if (target === undefined) {
        throw new Error(`projectStates: record ${record.id} depends on missing record ${dependencyId}`);
      }
      if (target.record.taskId !== record.taskId) {
        throw new Error(
          `projectStates: record ${record.id} (task ${record.taskId}) depends on cross-task record ${dependencyId} (task ${target.record.taskId})`,
        );
      }
      validated.push(dependencyId);
    }
    dependencies.set(record.id, validated);
  }

  // C. Check-result must reference a check-start (structural invariant).
  for (const stored of records) {
    const record = stored.record;
    if (record.kind === 'check-result') {
      const start = byId.get(record.startId);
      if (start !== undefined && start.record.kind !== 'check-start') {
        throw new Error(`projectStates: check-result ${record.id} references ${record.startId}, which is not a check-start`);
      }
    }
  }

  // D. Correction targets: dangling / self / cross-task / duplicate / kind validation,
  //    building the explicit supersession map (target id -> correcting ids).
  const supersededBy = new Map<MemoryId, readonly MemoryId[]>();
  for (const stored of records) {
    const record = stored.record;
    if (record.kind !== 'correction') continue;
    const seen = new Set<MemoryId>();
    for (const targetId of record.targetIds) {
      if (targetId === record.id) {
        throw new Error(`projectStates: correction ${record.id} targets itself`);
      }
      if (seen.has(targetId)) {
        throw new Error(`projectStates: correction ${record.id} lists target ${targetId} more than once`);
      }
      seen.add(targetId);
      const target = byId.get(targetId);
      if (target === undefined) {
        throw new Error(`projectStates: correction ${record.id} targets missing record ${targetId}`);
      }
      if (target.record.taskId !== record.taskId) {
        throw new Error(`projectStates: correction ${record.id} targets cross-task record ${targetId}`);
      }
      if (!isCorrectionTargetKind(target.record)) {
        throw new Error(`projectStates: correction ${record.id} targets ineligible record ${targetId} (must be a claim or artifact snapshot)`);
      }
      const existing = supersededBy.get(targetId) ?? [];
      supersededBy.set(targetId, [...existing, record.id]);
    }
  }

  // E. Source status validation (valid enum, existing snapshot, no duplicates).
  const sourceStatus = new Map<MemoryId, SourceResolution['status']>();
  for (const source of sources) {
    if (!isSourceStatus(source.status)) {
      throw new Error(`projectStates: invalid source status ${String(source.status)} for snapshot ${source.id}`);
    }
    const target = byId.get(source.id);
    if (target === undefined) {
      throw new Error(`projectStates: source state references missing record ${source.id}`);
    }
    if (target.record.kind !== 'snapshot') {
      throw new Error(`projectStates: source state references non-snapshot record ${source.id} (kind ${target.record.kind})`);
    }
    if (sourceStatus.has(source.id)) {
      throw new Error(`projectStates: duplicate source state for snapshot ${source.id}`);
    }
    sourceStatus.set(source.id, source.status);
  }

  // F. Kahn's algorithm: cycle detection, topological order, and status computation
  //    in a single bounded pass (dependencies are settled before dependents).
  const remaining = new Map<MemoryId, number>();
  const dependents = new Map<MemoryId, MemoryId[]>();
  for (const stored of records) {
    const id = stored.record.id;
    remaining.set(id, dependencies.get(id)!.length);
    dependents.set(id, []);
  }
  for (const [id, deps] of dependencies) {
    for (const dependencyId of deps) {
      dependents.get(dependencyId)!.push(id);
    }
  }

  const computed = new Map<MemoryId, RecordState>();
  const queue: MemoryId[] = [];
  for (const [id, count] of remaining) {
    if (count === 0) queue.push(id);
  }
  let processed = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    processed += 1;
    computed.set(id, computeState(byId.get(id)!, dependencies, sourceStatus, supersededBy, computed));
    for (const dependentId of dependents.get(id)!) {
      const next = remaining.get(dependentId)! - 1;
      remaining.set(dependentId, next);
      if (next === 0) queue.push(dependentId);
    }
  }
  if (processed !== records.length) {
    throw new Error('projectStates: declared dependency graph contains a cycle');
  }

  return records.map((stored) => computed.get(stored.record.id)!);
}
