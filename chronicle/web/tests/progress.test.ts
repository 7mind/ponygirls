import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, windowProgress } from '../src/progress.ts';

// Specified: Behavioral-Active Blackbox-Atomic, exact i64 and unknown-vs-zero presentation.
test('byte formatting retains all i64 digits and distinguishes unknown from zero', () => {
  assert.equal(formatBytes(undefined), 'unknown');
  assert.equal(formatBytes(0n), '0 bytes');
  assert.equal(formatBytes(9007199254740993n), '9007199254740993 bytes');
  assert.equal(formatBytes(9223372036854775807n), '9223372036854775807 bytes');
});
test('window progress never invents a total or implies publication', () => {
  assert.equal(windowProgress({ completedWindows: 0, totalWindows: undefined }), '0 / unknown windows processed');
  assert.equal(windowProgress({ completedWindows: 0, totalWindows: 0 }), '0 / 0 windows processed');
  assert.equal(windowProgress({ completedWindows: 3, totalWindows: 3 }), '3 / 3 windows processed');
});
