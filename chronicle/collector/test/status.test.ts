import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCollectorStatus, type CollectorStatus } from '../src/status.ts';

function status(): CollectorStatus {
  return { namespace: 'synthetic-namespace', lastRun: null, queue: [], diagnostics: [], dropped: [],
    reporting: { sequence: '0', acceptedSequence: null, acceptedAt: null, error: null } };
}

test('GoodAtomic human status retains actionable queue IDs, attempts, errors and dropped receipts', () => {
  const value = status();
  value.queue = [
    { requestId: '00000000-0000-4000-8000-000000000001', sourceKey: 'first-source', attempts: 2, nextAt: Date.parse('2026-01-02T03:04:05Z'), status: 'pending', error: 'upload-unavailable' },
    { requestId: '00000000-0000-4000-8000-000000000002', sourceKey: 'second-source', attempts: 5, nextAt: 0, status: 'stopped', error: 'upload-unavailable' },
    { requestId: '00000000-0000-4000-8000-000000000003', sourceKey: 'third-source', attempts: 1, nextAt: 0, status: 'conflict', error: 'revision-conflict' },
    { requestId: '00000000-0000-4000-8000-000000000004', sourceKey: 'fourth-source', attempts: 0, nextAt: 0, status: 'pending', error: null },
  ];
  value.dropped = [{ requestId: '00000000-0000-4000-8000-000000000005', sourceKey: 'fifth-source', reason: 'operator-drop' }];
  const text = formatCollectorStatus(value);
  assert.match(text, /Queue: 4 entries/);
  assert.match(text, /000000000001: pending · attempts: 2 · next attempt: 2026-01-02T03:04:05\.000Z/);
  assert.match(text, /000000000002: stopped · attempts: 5 · source: second-source/);
  assert.match(text, /000000000003: conflict · attempts: 1/);
  assert.match(text, /000000000004: pending · attempts: 0 · next attempt: due/);
  assert.match(text, /Error: revision-conflict/);
  assert.match(text, /Dropped: 1\n  00000000-0000-4000-8000-000000000005: operator-drop/);
});

test('GoodAtomic human status preserves exact large reporting sequences and explicit failures', () => {
  const value = status();
  value.reporting = { sequence: '9223372036854775807', acceptedSequence: '9223372036854775806', acceptedAt: Date.parse('2026-01-02T03:04:05Z'), error: 'report-failed' };
  const text = formatCollectorStatus(value);
  assert.match(text, /Reporting: sequence 9223372036854775807, acknowledged 9223372036854775806/);
  assert.match(text, /Last acknowledged: 2026-01-02T03:04:05\.000Z\n  Error: report-failed/);
  assert.doesNotMatch(text, /healthy|running|caught up|indexing complete/);
});

test('GoodAtomic human status renders control characters literally, not as terminal commands or forged lines', () => {
  const value = status();
  value.diagnostics = [{ rootId: 'fixture\nFORGED\x1b[2J\u009b\u202e', pathId: 'a'.repeat(64), code: 'unsafe\rdiagnostic' }];
  const text = formatCollectorStatus(value);
  assert.match(text, /fixture\\u000aFORGED\\u001b\[2J\\u009b\\u202e/);
  assert.match(text, /unsafe\\u000ddiagnostic/);
  assert.doesNotMatch(text, /\x1b|\r|\u009b|\u202e|\nFORGED/);
});
