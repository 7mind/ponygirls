import { Buffer } from 'node:buffer';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';

/*
 * Trusted, read-only, self-contained adapters only. Exact owner-verified bytes
 * are imported as data-URL ESM; relative imports are unsupported. Adapters must
 * not import absolute/package/network modules or other unbound dependencies.
 * Only node: built-ins are permitted by the trusted registration contract.
 *
 * This is termination isolation, NOT a security sandbox. A malicious trusted
 * module still has extension-process authority. No request may choose source,
 * module URLs, exports, commands, or expected outcomes.
 */

const BOOTSTRAP_KIND = 'cuckoo.memory.check.v1';
const MAX_FINDINGS = 32;
const MAX_REFS = 32;

function invalid() {
  throw new Error('CHECK_INVALID_OUTPUT');
}

function text(value, max) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) invalid();
  return value;
}

function nonblankText(value, max) {
  const result = text(value, max);
  if (result.trim().length === 0) invalid();
  return result;
}

function exact(value, keys) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some(key => typeof key !== 'string' || !keys.includes(key))
  ) invalid();
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, 'value')) invalid();
  }
  return value;
}

function ids(value, allowed) {
  if (!Array.isArray(value) || value.length > MAX_REFS) invalid();
  const selected = Array.from(value, item => text(item, 128));
  if (new Set(selected).size !== selected.length) invalid();
  if (selected.some(id => !allowed.has(id))) invalid();
  return Object.freeze(selected);
}

function result(value, allowed, byteLimit) {
  const raw = exact(value, ['outcome', 'findings']);
  if (raw.outcome !== 'pass' && raw.outcome !== 'fail' && raw.outcome !== 'inconclusive') {
    invalid();
  }
  if (!Array.isArray(raw.findings) || raw.findings.length > MAX_FINDINGS) invalid();
  const findings = Array.from(raw.findings, value => {
    const finding = exact(value, ['code', 'message', 'evidenceIds']);
    return Object.freeze({
      code: nonblankText(finding.code, 128),
      message: nonblankText(finding.message, 4000),
      evidenceIds: ids(finding.evidenceIds, allowed),
    });
  });
  const parsed = Object.freeze({
    outcome: raw.outcome,
    findings: Object.freeze(findings),
  });
  const frame = { type: 'result', result: parsed };
  if (Buffer.byteLength(JSON.stringify(frame), 'utf8') > byteLimit) {
    throw new Error('CHECK_OUTPUT_LIMIT');
  }
  return frame;
}

function immutableInput(value) {
  // Input came from owner-side validated snapshots, never an adapter request.
  Object.freeze(value.artifact);
  for (const item of value.evidence) Object.freeze(item);
  Object.freeze(value.evidence);
  return Object.freeze(value);
}

function sendError(code) {
  parentPort.postMessage({ type: 'error', code });
}

/** Deliberately syntax only: parsing is not schema or semantic verification. */
export function checkJsonSyntax(input) {
  try {
    JSON.parse(input.artifact.text);
    return { outcome: 'pass', findings: [] };
  } catch {
    return {
      outcome: 'fail',
      findings: [{
        code: 'JSON_SYNTAX_INVALID',
        message: 'The selected artifact text is not valid JSON syntax.',
        evidenceIds: [],
      }],
    };
  }
}

async function execute() {
  if (parentPort === null) return;

  const data = workerData;
  if (
    typeof data.inputJSON !== 'string'
    || !Number.isSafeInteger(data.maxInputBytes)
    || data.maxInputBytes < 256
    || data.maxInputBytes > 524288
    || Buffer.byteLength(data.inputJSON, 'utf8') > data.maxInputBytes
    || !Number.isSafeInteger(data.maxOutputBytes)
    || data.maxOutputBytes < 256
    || data.maxOutputBytes > 50000
    || typeof data.moduleURL !== 'string'
    || !data.moduleURL.startsWith('data:text/javascript;base64,')
    || typeof data.exportName !== 'string'
    || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(data.exportName)
  ) {
    sendError('CHECK_WORKER_PROTOCOL');
    return;
  }

  let input;
  let adapter;
  try {
    input = immutableInput(JSON.parse(data.inputJSON));
    // This imports exact trusted bytes, not a second read of a mutable path.
    // For the built-in this resolves the already-evaluated bootstrap module.
    const module = await import(data.moduleURL);
    adapter = module[data.exportName];
    if (typeof adapter !== 'function') throw new Error('missing adapter export');
  } catch {
    sendError('CHECK_WORKER_PROTOCOL');
    return;
  }

  let raw;
  try {
    raw = await adapter(input);
  } catch {
    // Do not expose stack traces, environment data, or unbounded exceptions.
    sendError('CHECK_ADAPTER_ERROR');
    return;
  }

  let frame;
  try {
    frame = result(raw, new Set(input.evidence.map(item => item.id)), data.maxOutputBytes);
  } catch (error) {
    sendError(error instanceof Error && error.message === 'CHECK_OUTPUT_LIMIT'
      ? 'CHECK_OUTPUT_LIMIT'
      : 'CHECK_INVALID_OUTPUT');
    return;
  }

  try {
    parentPort.postMessage(frame);
  } catch {
    sendError('CHECK_WORKER_PROTOCOL');
  }
}

// Importing this file on the main thread is inert. Importing its exact bytes
// as the built-in adapter does not recursively launch another execution.
if (
  !isMainThread
  && workerData !== null
  && typeof workerData === 'object'
  && workerData.kind === BOOTSTRAP_KIND
  && workerData.bootstrapURL === import.meta.url
) {
  void execute().catch(() => {
    if (parentPort !== null) sendError('CHECK_WORKER_PROTOCOL');
  });
}
