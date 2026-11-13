import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { appendMemory, readMemory, textDigest } from './memory-core.ts';
import type {
  CheckFinding,
  CheckFinishedRecord,
  CheckerIdentity,
  CheckOutcome,
  CheckStartedRecord,
  MemoryPort,
  MemoryRuntime,
  SessionView,
  SnapshotRecord,
  SourceRole,
  StoredMemoryRecord,
  TextDigest,
} from './memory-types.ts';

/**
 * Trusted extension-side checker registration.
 *
 * Never construct specs from tool arguments or repository discovery.
 *
 * A registered adapter is an owner-audited, read-only, self-contained ESM
 * module. Only node: built-in imports are permitted by this trust contract:
 * no relative, absolute, package, network, or other transitive module imports.
 * This is an owner assertion, not a source-code sandbox or regex-based proof.
 *
 * Exact verified module bytes execute as a data URL. Relative imports therefore
 * do not work. Worker termination bounds execution; workers are NOT security
 * sandboxes. Trusted adapters retain the authority of extension code.
 */
export interface CheckerSpec {
  readonly id: string;
  readonly version: string;
  readonly scope: string;
  readonly moduleURL: URL;
  readonly moduleDigest: string;
  readonly exportName: string;
  readonly evidence: CheckerEvidenceRule;
}

export interface CheckerEvidenceRule {
  readonly min: number;
  readonly max: number;
  readonly roles: readonly SourceRole[];
}

export interface CheckerDescription {
  readonly identity: CheckerIdentity;
  readonly evidence: CheckerEvidenceRule;
}

/** The complete model-facing execution request. No executable fields exist. */
export interface CheckRequest {
  readonly taskId: string;
  readonly artifactId: string;
  readonly checkerId: string;
  readonly evidenceIds: readonly string[];
}

export interface CheckerSnapshotInput {
  readonly id: string;
  readonly digest: TextDigest;
  readonly text: string;
  readonly role: SourceRole;
  readonly purpose: 'artifact' | 'evidence';
}

export interface CheckerInput {
  readonly taskId: string;
  readonly artifact: CheckerSnapshotInput;
  readonly evidence: readonly CheckerSnapshotInput[];
}

/** An adapter cannot author lifecycle outcomes such as timeout or cancellation. */
export interface CheckerExecutionResult {
  readonly outcome: 'pass' | 'fail' | 'inconclusive';
  readonly findings: readonly CheckFinding[];
}

export interface CheckLimits {
  readonly timeoutMs: number;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
}

export const DEFAULT_CHECK_LIMITS: CheckLimits = Object.freeze({
  timeoutMs: 2000,
  maxInputBytes: 262144,
  maxOutputBytes: 32768,
});

export interface CheckRunContext {
  readonly toolCallId: string;
  readonly signal: AbortSignal | undefined;

  /**
   * Trusted parent-owned scope identity: extension-instance nonce + session
   * identity + navigation/reload epoch. Stable across ordinary appends; changed
   * on tree navigation, session replacement/reload, and shutdown.
   *
   * SessionView alone cannot distinguish navigation to a fork that still
   * contains the start entry. Never obtain this value from model arguments.
   */
  readonly scopeKey: () => string;
}

export interface CheckRunResult {
  readonly start: StoredMemoryRecord;
  readonly terminal: StoredMemoryRecord | null;
  readonly status: 'recorded' | 'scope-changed';
}

export interface CheckReadResult {
  readonly start: StoredMemoryRecord;
  readonly terminal: StoredMemoryRecord | null;
  readonly lifecycle: 'finished' | 'unresolved';
}

interface ModuleImage {
  readonly digest: string;
  readonly dataURL: string;
}

interface Registration {
  readonly identity: CheckerIdentity;
  readonly evidence: CheckerEvidenceRule;
  readonly moduleHref: string;
  readonly moduleDigest: string;
  readonly exportName: string;
}

interface PreparedChecker {
  readonly identity: CheckerIdentity;
  readonly evidence: CheckerEvidenceRule;
  readonly bootstrapURL: string;
  readonly moduleURL: string;
  readonly exportName: string;
}

interface TerminalExecution {
  readonly outcome: CheckOutcome;
  readonly findings: readonly CheckFinding[];
  readonly errorCode: string | null;
}

const MODULE_BYTES = 131072;
const MAX_INPUT_BYTES = 524288;
const MAX_OUTPUT_BYTES = 50000;
const MAX_FINDINGS = 32;
const MAX_REFS = 32;
const BOOTSTRAP_KIND = 'cuckoo.memory.check.v1';
const WORKER_URL = new URL('./memory-check-worker.mjs', import.meta.url);
const WORKER_ERROR_CODES = Object.freeze([
  'CHECK_ADAPTER_ERROR',
  'CHECK_INVALID_OUTPUT',
  'CHECK_OUTPUT_LIMIT',
  'CHECK_WORKER_PROTOCOL',
]);

function problem(message: string): never {
  throw new Error(`memory check: ${message}`);
}

function boundedString(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    problem(`invalid ${label}`);
  }
  return value;
}

function nonblankString(value: unknown, max: number, label: string): string {
  const result = boundedString(value, max, label);
  if (result.trim().length === 0) problem(`invalid ${label}`);
  return result;
}

function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    problem(`invalid ${label}`);
  }
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    problem(`invalid ${label}`);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) problem(`invalid ${label}`);
  if (Object.getOwnPropertySymbols(value).length !== 0) problem(`invalid ${label}`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const descriptor of Object.values(descriptors)) {
    if (!Object.hasOwn(descriptor, 'value')) problem(`invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  const record = object(value, label);
  const actual = Object.getOwnPropertyNames(record);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    problem(`invalid ${label}: unexpected or missing fields`);
  }
  return record;
}

function stringIds(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_REFS) problem(`invalid ${label}`);
  const values: readonly unknown[] = value;
  const ids = Array.from(values, item => boundedString(item, 128, label));
  if (new Set(ids).size !== ids.length) problem(`duplicate ${label}`);
  return Object.freeze(ids);
}

export function parseCheckRequest(value: unknown): CheckRequest {
  const request = exactObject(
    value,
    ['taskId', 'artifactId', 'checkerId', 'evidenceIds'],
    'check request',
  );
  return Object.freeze({
    taskId: boundedString(request.taskId, 128, 'taskId'),
    artifactId: boundedString(request.artifactId, 128, 'artifactId'),
    checkerId: boundedString(request.checkerId, 128, 'checkerId'),
    evidenceIds: stringIds(request.evidenceIds, 'evidenceIds'),
  });
}

/**
 * Owner-only trusted module read. This is not a model-facing filesystem API.
 * Reading is bounded even if a file grows while being read.
 */
function readTrustedModule(moduleURL: URL): ModuleImage {
  if (
    !(moduleURL instanceof URL)
    || moduleURL.protocol !== 'file:'
    || moduleURL.search !== ''
    || moduleURL.hash !== ''
    || !moduleURL.pathname.endsWith('.mjs')
  ) {
    problem('trusted module must be an explicit .mjs file URL');
  }

  const descriptor = openSync(moduleURL, 'r');
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size === 0 || before.size > MODULE_BYTES) {
      problem('trusted module size or file type');
    }

    const bytes = Buffer.alloc(MODULE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }

    const after = fstatSync(descriptor);
    if (
      length === 0
      || length > MODULE_BYTES
      || before.size !== length
      || after.size !== length
      || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs
    ) {
      problem('trusted module changed during read or exceeded size bound');
    }

    const selected = bytes.subarray(0, length);
    return Object.freeze({
      digest: `sha256-bytes:${createHash('sha256').update(selected).digest('hex')}`,
      dataURL: `data:text/javascript;base64,${selected.toString('base64')}`,
    });
  } finally {
    closeSync(descriptor);
  }
}

/** Owner-side convenience for static registration and fixtures only. */
export function readTrustedModuleDigest(moduleURL: URL): string {
  return readTrustedModule(moduleURL).digest;
}

function evidenceRule(value: CheckerEvidenceRule): CheckerEvidenceRule {
  const min = integer(value.min, 0, MAX_REFS, 'minimum evidence');
  const max = integer(value.max, min, MAX_REFS, 'maximum evidence');
  if (!Array.isArray(value.roles) || value.roles.length > 3) problem('invalid evidence roles');
  const roles: SourceRole[] = [];
  for (const role of value.roles) {
    if (role !== 'user' && role !== 'assistant' && role !== 'toolResult') {
      problem('invalid evidence role');
    }
    if (roles.includes(role)) problem('duplicate evidence role');
    roles.push(role);
  }
  if (max > 0 && roles.length === 0) problem('missing admissible evidence roles');
  return Object.freeze({ min, max, roles: Object.freeze(roles) });
}

export class TrustedCheckerRegistry {
  private readonly registrations: ReadonlyMap<string, Registration>;
  private readonly bootstrap: ModuleImage;

  constructor(specs: readonly CheckerSpec[]) {
    if (!Array.isArray(specs) || specs.length === 0 || specs.length > 32) {
      problem('invalid trusted registry size');
    }
    this.bootstrap = readTrustedModule(WORKER_URL);
    const registrations = new Map<string, Registration>();

    for (const spec of specs) {
      const id = boundedString(spec.id, 128, 'checker id');
      const version = boundedString(spec.version, 128, 'checker version');
      const scope = boundedString(spec.scope, 4000, 'checker scope');
      const exportName = boundedString(spec.exportName, 128, 'checker export');
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportName)) problem('invalid checker export');
      if (!/^sha256-bytes:[0-9a-f]{64}$/.test(spec.moduleDigest)) {
        problem('invalid trusted module digest');
      }
      if (registrations.has(id)) problem('duplicate checker id');
      const image = readTrustedModule(spec.moduleURL);
      if (image.digest !== spec.moduleDigest) problem('trusted module identity mismatch');

      // Include the selected export and termination/bootstrap implementation.
      const implementationDigest = `sha256-checker-v1:${createHash('sha256')
        .update(JSON.stringify({
          moduleDigest: spec.moduleDigest,
          exportName,
          bootstrapDigest: this.bootstrap.digest,
          nodeVersion: process.version,
          v8Version: process.versions.v8,
        }))
        .digest('hex')}`;

      const identity: CheckerIdentity = Object.freeze({
        id,
        version,
        scope,
        implementationDigest,
      });
      registrations.set(id, Object.freeze({
        identity,
        evidence: evidenceRule(spec.evidence),
        moduleHref: spec.moduleURL.href,
        moduleDigest: spec.moduleDigest,
        exportName,
      }));
    }
    this.registrations = registrations;
  }

  /** Safe metadata only: no module paths, source bytes, or result cache. */
  list(): readonly CheckerDescription[] {
    return Object.freeze(Array.from(this.registrations.values(), registration => Object.freeze({
      identity: registration.identity,
      evidence: registration.evidence,
    })));
  }

  /** Owner-side execution preparation, never a tool endpoint. */
  prepare(id: string): PreparedChecker {
    const registration = this.registrations.get(id);
    if (registration === undefined) problem('unknown checker');

    const bootstrap = readTrustedModule(WORKER_URL);
    if (bootstrap.digest !== this.bootstrap.digest) problem('worker implementation identity changed');

    const module = readTrustedModule(new URL(registration.moduleHref));
    if (module.digest !== registration.moduleDigest) problem('trusted module identity changed');

    // Execute the exact bytes just verified, not a second filesystem import.
    return Object.freeze({
      identity: registration.identity,
      evidence: registration.evidence,
      bootstrapURL: bootstrap.dataURL,
      moduleURL: module.dataURL,
      exportName: registration.exportName,
    });
  }
}

export function createBuiltinCheckerRegistry(): TrustedCheckerRegistry {
  return new TrustedCheckerRegistry([{
    id: 'json-syntax',
    version: '1',
    scope: 'JSON syntax only; no schema, semantics, task correctness or authorization.',
    moduleURL: WORKER_URL,
    moduleDigest: readTrustedModuleDigest(WORKER_URL),
    exportName: 'checkJsonSyntax',
    evidence: { min: 0, max: 0, roles: [] },
  }]);
}

function limits(value: CheckLimits): CheckLimits {
  return Object.freeze({
    timeoutMs: integer(value.timeoutMs, 1, 30000, 'deadline'),
    maxInputBytes: integer(value.maxInputBytes, 256, MAX_INPUT_BYTES, 'input byte limit'),
    maxOutputBytes: integer(value.maxOutputBytes, 256, MAX_OUTPUT_BYTES, 'output byte limit'),
  });
}

function snapshot(
  records: readonly StoredMemoryRecord[],
  id: string,
  taskId: string,
): SnapshotRecord {
  const stored = records.find(item => item.record.id === id);
  if (stored === undefined || stored.record.kind !== 'snapshot') problem('snapshot not found on branch');
  const record = stored.record;
  if (record.taskId !== taskId) problem('snapshot task mismatch');
  if (record.digest !== textDigest(record.text) || record.source.digest !== record.digest) {
    problem('snapshot digest mismatch');
  }
  return record;
}

function snapshotInput(record: SnapshotRecord): CheckerSnapshotInput {
  return Object.freeze({
    id: record.id,
    digest: record.digest,
    text: record.text,
    role: record.source.role,
    purpose: record.purpose,
  });
}

function parseExecution(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
): CheckerExecutionResult {
  const result = exactObject(value, ['outcome', 'findings'], 'checker output');
  const outcome = result.outcome;
  if (outcome !== 'pass' && outcome !== 'fail' && outcome !== 'inconclusive') {
    problem('invalid checker outcome');
  }
  if (!Array.isArray(result.findings) || result.findings.length > MAX_FINDINGS) {
    problem('invalid checker findings');
  }
  const rawFindings: readonly unknown[] = result.findings;
  const findings = Array.from(rawFindings, value => {
    const finding = exactObject(value, ['code', 'message', 'evidenceIds'], 'checker finding');
    const ids = stringIds(finding.evidenceIds, 'finding evidenceIds');
    if (ids.some(id => !evidenceIds.has(id))) problem('finding evidence binding mismatch');
    return Object.freeze({
      code: nonblankString(finding.code, 128, 'finding code'),
      message: nonblankString(finding.message, 4000, 'finding message'),
      evidenceIds: ids,
    });
  });
  return Object.freeze({ outcome, findings: Object.freeze(findings) });
}

function errorExecution(code: string, outcome: CheckOutcome): TerminalExecution {
  return Object.freeze({ outcome, findings: Object.freeze([]), errorCode: code });
}

function parseWorkerFrame(
  value: unknown,
  selectedEvidence: ReadonlySet<string>,
  outputLimit: number,
): TerminalExecution {
  const frame = object(value, 'worker frame');
  if (frame.type === 'error') {
    const error = exactObject(frame, ['type', 'code'], 'worker error');
    if (typeof error.code !== 'string' || !WORKER_ERROR_CODES.includes(error.code)) {
      problem('invalid worker error code');
    }
    return errorExecution(error.code, 'error');
  }
  const resultFrame = exactObject(frame, ['type', 'result'], 'worker result');
  if (resultFrame.type !== 'result') problem('invalid worker result type');
  const result = parseExecution(resultFrame.result, selectedEvidence);
  if (Buffer.byteLength(JSON.stringify({ type: 'result', result }), 'utf8') > outputLimit) {
    return errorExecution('CHECK_OUTPUT_LIMIT', 'error');
  }
  return Object.freeze({
    outcome: result.outcome,
    findings: result.findings,
    errorCode: null,
  });
}

/**
 * Stateless historical inspection. No worker is started, no time is refreshed,
 * and no success is associated with anything other than the original start's
 * exact artifact/evidence bindings. A terminal-less start is unresolved.
 */
export function readCheck(view: SessionView, startId: string): CheckReadResult {
  boundedString(startId, 128, 'startId');
  const records = readMemory(view, 'branch');
  const start = records.find(item => item.record.id === startId);
  if (start === undefined || start.record.kind !== 'check-start') problem('check start not found');
  const terminals = records.filter(item =>
    item.record.kind === 'check-result' && item.record.startId === startId);
  if (terminals.length > 1) problem('duplicate check terminal');
  const terminal = terminals[0] ?? null;
  return Object.freeze({
    start,
    terminal,
    lifecycle: terminal === null ? 'unresolved' : 'finished',
  });
}

export class MemoryCheckRunner {
  private readonly port: MemoryPort;
  private readonly runtime: MemoryRuntime;
  private readonly registry: TrustedCheckerRegistry;
  private readonly bounds: CheckLimits;

  constructor(
    port: MemoryPort,
    runtime: MemoryRuntime,
    registry: TrustedCheckerRegistry,
    bounds: CheckLimits,
  ) {
    this.port = port;
    this.runtime = runtime;
    this.registry = registry;
    this.bounds = limits(bounds);
  }

  async run(value: unknown, context: CheckRunContext): Promise<CheckRunResult> {
    const request = parseCheckRequest(value);
    boundedString(context.toolCallId, 128, 'toolCallId');
    if (typeof context.scopeKey !== 'function') problem('missing trusted scope fence');
    if (context.signal !== undefined && !(context.signal instanceof AbortSignal)) {
      problem('invalid abort signal');
    }

    const prepared = this.registry.prepare(request.checkerId);
    const scopeKey = boundedString(context.scopeKey(), 512, 'scope key');
    const initial = this.port.view();
    const records = readMemory(initial, 'branch');

    const task = records.find(item => item.record.id === request.taskId);
    if (task === undefined || task.record.kind !== 'task') problem('task not found on branch');

    const artifact = snapshot(records, request.artifactId, request.taskId);
    if (artifact.purpose !== 'artifact') problem('main artifact must have artifact purpose');

    const evidence = request.evidenceIds.map(id => snapshot(records, id, request.taskId));
    if (evidence.length < prepared.evidence.min || evidence.length > prepared.evidence.max) {
      problem('checker evidence count mismatch');
    }
    if (evidence.some(item => !prepared.evidence.roles.includes(item.source.role))) {
      problem('checker evidence role mismatch');
    }

    const input: CheckerInput = Object.freeze({
      taskId: request.taskId,
      artifact: snapshotInput(artifact),
      evidence: Object.freeze(evidence.map(snapshotInput)),
    });
    const inputJSON = JSON.stringify(input);
    if (Buffer.byteLength(inputJSON, 'utf8') > this.bounds.maxInputBytes) {
      problem('checker input byte limit exceeded');
    }

    // Nothing asynchronous occurs before this append. The model cannot author
    // these identity, binding, or timestamp fields.
    const started: CheckStartedRecord = {
      kind: 'check-start',
      id: this.runtime.newId(),
      taskId: request.taskId,
      toolCallId: context.toolCallId,
      checker: prepared.identity,
      artifact: { id: artifact.id, digest: artifact.digest },
      evidence: evidence.map(item => ({ id: item.id, digest: item.digest })),
      startedAt: this.runtime.now(),
    };
    const start = appendMemory(this.port, started);
    const afterStart = this.port.view();
    const prefix = Object.freeze(afterStart.branch.map(entry => entry.id));

    if (
      afterStart.sessionId !== initial.sessionId
      || !prefix.includes(start.entryId)
      || context.scopeKey() !== scopeKey
    ) {
      return Object.freeze({ start, terminal: null, status: 'scope-changed' });
    }

    const deadline = performance.now() + this.bounds.timeoutMs;
    const selectedEvidence = new Set(evidence.map(item => item.id));

    return await new Promise<CheckRunResult>((resolve, reject) => {
      let settled = false;
      let worker: Worker | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let logBytes = 0;

      const fenced = (): boolean => {
        try {
          if (context.scopeKey() !== scopeKey) return false;
          const view = this.port.view();
          return view.sessionId === initial.sessionId
            && prefix.every((id, index) => view.branch[index]?.id === id);
        } catch {
          return false;
        }
      };

      const finish = (candidate: TerminalExecution): void => {
        if (settled) return;
        settled = true;

        let execution = candidate;
        if (context.signal?.aborted === true) {
          execution = errorExecution('CHECK_ABORTED', 'cancelled');
        } else if (performance.now() >= deadline) {
          execution = errorExecution('CHECK_DEADLINE', 'timeout');
        }

        if (timer !== null) clearTimeout(timer);
        context.signal?.removeEventListener('abort', onAbort);

        const complete = async (): Promise<void> => {
          if (worker !== null) {
            try {
              // Always stop the worker, including adapters leaving timers open
              // after returning. Cooperative signals cannot stop JS loops.
              await worker.terminate();
            } catch {
              execution = errorExecution('CHECK_TERMINATION_ERROR', 'error');
            }
          }

          if (!fenced()) {
            resolve(Object.freeze({ start, terminal: null, status: 'scope-changed' }));
            return;
          }

          const terminalRecord: CheckFinishedRecord = {
            kind: 'check-result',
            id: this.runtime.newId(),
            taskId: request.taskId,
            startId: started.id,
            outcome: execution.outcome,
            findings: execution.findings,
            errorCode: execution.errorCode,
            finishedAt: this.runtime.now(),
          };
          // Core performs read-after-write branch/reference/unique-terminal
          // validation. A failed append leaves the persisted start unresolved.
          const terminal = appendMemory(this.port, terminalRecord);
          resolve(Object.freeze({ start, terminal, status: 'recorded' }));
        };

        void complete().catch(reject);
      };

      const onAbort = (): void => {
        finish(errorExecution('CHECK_ABORTED', 'cancelled'));
      };

      timer = setTimeout(() => {
        finish(errorExecution('CHECK_DEADLINE', 'timeout'));
      }, this.bounds.timeoutMs);

      context.signal?.addEventListener('abort', onAbort, { once: true });
      if (context.signal?.aborted === true) {
        onAbort();
        return;
      }

      try {
        worker = new Worker(new URL(prepared.bootstrapURL), {
          name: 'bounded-memory-check',
          // Do not inherit environment secrets or arbitrary parent preloads.
          env: {},
          execArgv: [],
          argv: [],
          stdin: false,
          stdout: true,
          stderr: true,
          resourceLimits: {
            maxOldGenerationSizeMb: 32,
            maxYoungGenerationSizeMb: 8,
            stackSizeMb: 4,
          },
          workerData: {
            kind: BOOTSTRAP_KIND,
            bootstrapURL: prepared.bootstrapURL,
            moduleURL: prepared.moduleURL,
            exportName: prepared.exportName,
            inputJSON,
            maxInputBytes: this.bounds.maxInputBytes,
            maxOutputBytes: this.bounds.maxOutputBytes,
          },
        });

        const onLog = (chunk: Buffer): void => {
          if (settled) return;
          logBytes += chunk.length;
          if (logBytes > this.bounds.maxOutputBytes) {
            finish(errorExecution('CHECK_OUTPUT_LIMIT', 'error'));
          }
        };
        worker.stdout?.on('data', onLog);
        worker.stderr?.on('data', onLog);

        worker.on('message', (frame: unknown) => {
          if (settled) return;
          try {
            finish(parseWorkerFrame(frame, selectedEvidence, this.bounds.maxOutputBytes));
          } catch {
            finish(errorExecution('CHECK_WORKER_PROTOCOL', 'error'));
          }
        });
        // Keep the error listener installed through termination so a late
        // worker error cannot become an unhandled parent EventEmitter error.
        worker.on('error', () => {
          finish(errorExecution('CHECK_WORKER_ERROR', 'error'));
        });
        worker.on('exit', () => {
          finish(errorExecution('CHECK_WORKER_EXIT', 'error'));
        });
      } catch {
        finish(errorExecution('CHECK_WORKER_START', 'error'));
      }
    });
  }
}
